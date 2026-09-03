import { AiRecommendation, SetRecommendation } from '../../models/workout.model';
import { normalizeExerciseName } from '../storage.service';
import { roundToBrick } from './prompt-helpers';
import { layoffFactor } from './progression-rules';
import { AiSessionContext, ExerciseContext } from './session-context';

/** Tope duro de incremento sobre la referencia (RF-IA-04, Art. 6). */
export const MAX_INCREASE = 0.1;

/** Reps/segundos máximos aceptables en una respuesta antes de considerarla alucinada. */
const MAX_REPS = 100;

/**
 * Por qué el techo vale lo que vale (T-839).
 *
 * Hasta ahora `allowedCeiling()` devolvía un número pelado y las tres causas —parar dos
 * meses, declarar una molestia, marcar la última sesión como dura— quedaban
 * indistinguibles. El registro de correcciones decía siempre "incremento por encima del
 * 10%", que en el caso del parón es sencillamente falso: el recorte no lo puso la regla
 * del 10%, lo puso el parón.
 *
 * La causa se guarda como CÓDIGO, no como frase, porque quien la enseña la traduce.
 */
export type CeilingCause = 'layoff' | 'injury' | 'hard_feel' | 'max_increase';

/** Frases para el registro interno. La UI no las usa: traduce desde `CeilingCause`. */
const CEILING_REASON: Record<CeilingCause, string> = {
  layoff: 'recorte por parón',
  injury: 'molestia declarada: no se sube',
  hard_feel: 'última sesión marcada como dura: no se sube',
  max_increase: `incremento por encima del ${Math.round(MAX_INCREASE * 100)}%`,
};

export interface Ceiling {
  weight: number;
  cause: CeilingCause;
}

export interface CorrectionLog {
  exerciseId: string;
  /** Qué se tuvo que corregir; vacío si la respuesta llegó dentro de límites. */
  reasons: string[];
  /** Presente solo si el recorte lo impuso el techo, con su causa. */
  causes?: CeilingCause[];
}

export interface ValidatedSession {
  byExercise: Record<string, AiRecommendation>;
  corrections: CorrectionLog[];
  /** Ejercicios de la sesión para los que la respuesta no traía nada utilizable. */
  missing: string[];
}

/**
 * Peso de referencia del ejercicio: el tope de la última sesión registrada.
 *
 * Sin referencia (ejercicio nuevo) no hay tope que aplicar: cualquier peso inicial es
 * legítimo, y es el motor local el que propone el punto de partida.
 */
function referenceWeight(ec: ExerciseContext): number | null {
  const sets = ec.lastSets?.length ? ec.lastSets : (ec.history.at(-1)?.sets ?? []);
  const weights = sets.filter((s) => !s.isWarmup).map((s) => s.weight || 0);
  const top = weights.length ? Math.max(...weights) : 0;
  return top > 0 ? top : null;
}

/**
 * `true` si el atleta declaró una molestia que menciona este ejercicio.
 *
 * Heurística deliberadamente simple: se busca el nombre del ejercicio dentro del texto que
 * el propio atleta escribió. No entiende el texto — no puede — pero cubre el caso que
 * importa ("me molestó el hombro en press militar") sin inventar interpretaciones. Cuando
 * acierta, prohíbe subir; nunca prohíbe entrenar (RF-IA-04).
 */
export function injuryBlocksIncrease(exerciseName: string, notes: string | undefined): boolean {
  if (!notes?.trim()) return false;
  const haystack = normalizeExerciseName(notes);
  const needle = normalizeExerciseName(exerciseName);
  if (!needle) return false;
  return haystack.includes(needle);
}

/** Tope permitido para este ejercicio y la causa que lo fija; `null` si no hay referencia. */
export function ceilingFor(
  ec: ExerciseContext,
  aiNotes: string | undefined,
  todayISO: string,
): Ceiling | null {
  const reference = referenceWeight(ec);
  if (reference === null) return null;

  const factor = layoffFactor(ec.lastSessionDate, todayISO);
  // Tras un parón el techo es la marca RECORTADA, nunca la vieja: volver no es continuar.
  if (factor < 1) return { weight: reference * factor, cause: 'layoff' };

  // Molestia declarada o última sesión marcada como dura: se permite mantener, no subir.
  // Se distinguen porque al atleta le importa la diferencia: una es una lesión que hay que
  // vigilar y la otra es una sesión que salió pesada y no vuelve a pasar.
  if (injuryBlocksIncrease(ec.exercise.name, aiNotes)) {
    return { weight: reference, cause: 'injury' };
  }
  if (ec.lastFeel === 'hard') return { weight: reference, cause: 'hard_feel' };
  return { weight: reference * (1 + MAX_INCREASE), cause: 'max_increase' };
}

/** Solo el número, para quien no necesita saber por qué. */
export function allowedCeiling(
  ec: ExerciseContext,
  aiNotes: string | undefined,
  todayISO: string,
): number | null {
  return ceilingFor(ec, aiNotes, todayISO)?.weight ?? null;
}

interface RawSet {
  w?: unknown;
  weight?: unknown;
  r?: unknown;
  reps?: unknown;
}

interface RawEntry {
  e?: unknown;
  exercise?: unknown;
  sets?: unknown;
  why?: unknown;
  reason?: unknown;
}

function num(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Valida y ACOTA la respuesta del modelo (RF-IA-04, EA-3).
 *
 * Nada de lo que devuelve el modelo llega al usuario sin pasar por aquí: un peso por encima
 * del tope se corrige al tope, no se muestra y se descarta después. Lo que no se puede
 * corregir se marca como faltante para que el llamador use el motor local en su lugar.
 */
export function validateSessionResponse(
  raw: unknown,
  ctx: AiSessionContext,
  source: 'groq' | 'cohere',
): ValidatedSession {
  const byExercise: Record<string, AiRecommendation> = {};
  const corrections: CorrectionLog[] = [];
  const missing: string[] = [];

  const container = raw as { r?: unknown; recommendations?: unknown } | null;
  const list = Array.isArray(container?.r)
    ? container.r
    : Array.isArray(container?.recommendations)
      ? container.recommendations
      : [];

  const entryByIndex = new Map<number, RawEntry>();
  (list as RawEntry[]).forEach((entry, position) => {
    if (typeof entry !== 'object' || entry === null) return;
    // El índice explícito manda; si falta, se usa la posición en el array
    const idx = num(entry.e ?? entry.exercise) ?? position + 1;
    entryByIndex.set(Math.round(idx), entry);
  });

  ctx.exercises.forEach((ec, i) => {
    const entry = entryByIndex.get(i + 1);
    const exercise = ec.exercise;
    const setsTarget = exercise.defaultSets || 3;
    const repTarget = exercise.defaultRepTarget || 10;
    const brick = exercise.brick || 2.5;
    const cap = ceilingFor(ec, ctx.userProfile.aiNotes, ctx.todayISO);
    const ceiling = cap?.weight ?? null;
    const reasons: string[] = [];
    const causes: CeilingCause[] = [];

    const rawSets = Array.isArray(entry?.sets) ? (entry.sets as RawSet[]) : [];
    if (!rawSets.length) {
      missing.push(exercise.id);
      return;
    }

    const sets: SetRecommendation[] = [];
    for (let s = 0; s < setsTarget; s++) {
      const rs = rawSets[s] ?? rawSets[rawSets.length - 1];
      let weight = num(rs?.w ?? rs?.weight);
      let reps = num(rs?.r ?? rs?.reps);

      if (reps === null || reps <= 0) {
        reps = repTarget;
        reasons.push('reps inválidas');
      }
      if (reps > MAX_REPS) {
        reps = repTarget;
        reasons.push('reps fuera de rango');
      }
      reps = Math.round(reps);

      if (exercise.unit === 'BODYWEIGHT' || exercise.unit === 'TIME') {
        // Sin carga externa: el peso no se usa y se normaliza a 0
        sets.push({ weight: 0, reps });
        continue;
      }

      if (weight === null || weight <= 0) {
        // Art. 6: un peso de 0 o negativo nunca es una sugerencia válida
        weight = ceiling ?? brick;
        reasons.push('peso no positivo');
      }
      if (ceiling !== null && cap && weight > ceiling) {
        weight = roundToBrick(ceiling, brick);
        reasons.push(CEILING_REASON[cap.cause]);
        causes.push(cap.cause);
      }
      sets.push({ weight: Math.round(weight * 100) / 100, reps });
    }

    const reason =
      typeof (entry?.why ?? entry?.reason) === 'string'
        ? String(entry?.why ?? entry?.reason).slice(0, 200)
        : '';

    byExercise[exercise.id] = { sets, reason, source };
    if (reasons.length) {
      const unique = [...new Set(causes)];
      corrections.push({
        exerciseId: exercise.id,
        reasons: [...new Set(reasons)],
        ...(unique.length ? { causes: unique } : {}),
      });
    }
  });

  return { byExercise, corrections, missing };
}
