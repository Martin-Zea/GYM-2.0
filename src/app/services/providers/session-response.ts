import { AiRecommendation, SetRecommendation } from '../../models/workout.model';
import { normalizeExerciseName } from '../storage.service';
import { roundToBrick } from './prompt-helpers';
import { layoffFactor } from './progression-rules';
import { AiSessionContext, ExerciseContext } from './session-context';

/** Tope duro de incremento sobre la referencia (RF-IA-04, Art. 6). */
export const MAX_INCREASE = 0.1;

/** Reps/segundos máximos aceptables en una respuesta antes de considerarla alucinada. */
const MAX_REPS = 100;

export interface CorrectionLog {
  exerciseId: string;
  /** Qué se tuvo que corregir; vacío si la respuesta llegó dentro de límites. */
  reasons: string[];
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

/** Tope permitido para este ejercicio, o `null` si no hay referencia con la que acotar. */
export function allowedCeiling(
  ec: ExerciseContext,
  aiNotes: string | undefined,
  todayISO: string,
): number | null {
  const reference = referenceWeight(ec);
  if (reference === null) return null;

  const factor = layoffFactor(ec.lastSessionDate, todayISO);
  // Tras un parón el techo es la marca RECORTADA, nunca la vieja: volver no es continuar.
  if (factor < 1) return reference * factor;

  // Molestia declarada o última sesión marcada como dura: se permite mantener, no subir.
  if (ec.lastFeel === 'hard' || injuryBlocksIncrease(ec.exercise.name, aiNotes)) return reference;
  return reference * (1 + MAX_INCREASE);
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
    const ceiling = allowedCeiling(ec, ctx.userProfile.aiNotes, ctx.todayISO);
    const reasons: string[] = [];

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
      if (ceiling !== null && weight > ceiling) {
        weight = roundToBrick(ceiling, brick);
        reasons.push(`incremento por encima del ${Math.round(MAX_INCREASE * 100)}%`);
      }
      sets.push({ weight: Math.round(weight * 100) / 100, reps });
    }

    const reason =
      typeof (entry?.why ?? entry?.reason) === 'string'
        ? String(entry?.why ?? entry?.reason).slice(0, 200)
        : '';

    byExercise[exercise.id] = { sets, reason, source };
    if (reasons.length)
      corrections.push({ exerciseId: exercise.id, reasons: [...new Set(reasons)] });
  });

  return { byExercise, corrections, missing };
}
