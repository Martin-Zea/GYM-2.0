import type { CorrectionLog } from './session-response';
import {
  AiFeedbackAction,
  AiRecommendation,
  Exercise,
  SetRecord,
  TrainingFeel,
  UserProfile,
} from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';

/** Máximo de sesiones por ejercicio que viajan en el contexto (RF-IA-03: 6). */
export const MAX_CONTEXT_SESSIONS = 6;

/** Tope de tokens de entrada del contexto de sugerencia (CE-4). */
export const CONTEXT_TOKEN_BUDGET = 1200;

/** Versión del formato serializado. Va en la primera línea para poder evolucionarlo. */
export const CONTEXT_FORMAT = 'GT1';

export interface ExerciseContext {
  exercise: Exercise;
  history: HistoryEntry[];
  lastSets: SetRecord[] | null;
  lastSessionDate: string | null;
  lastFeel: TrainingFeel | null;
  lastNote: string | null;
  /** Qué hizo el atleta con las últimas sugerencias de este ejercicio (RF-IA-05). */
  feedback?: AiFeedbackAction[];
}

/**
 * Contexto de una SESIÓN completa (RF-IA-03, Art. 5).
 *
 * La unidad de trabajo de la capa IA es la sesión, no el ejercicio: una llamada por
 * ejercicio multiplicaba el gasto de tokens por 6–8 sin añadir información que el modelo
 * no tuviera ya (`audit.md` §6.1).
 */
export interface AiSessionContext {
  dayId: string;
  dayName: string;
  exercises: ExerciseContext[];
  userProfile: UserProfile;
  lang: 'es' | 'en';
  todayISO: string;
}

/** Sugerencias de una sesión: una por ejercicio, indexadas por su id. */
export interface SessionRecommendation {
  byExercise: Record<string, AiRecommendation>;
  source: 'groq' | 'cohere' | 'local';
  /** Qué hubo que corregir y qué ejercicios quedaron sin respuesta (RF-IA-04). */
  validated?: {
    corrections: CorrectionLog[];
    missing: string[];
  };
}

const GOAL_CODE = { strength: 'STR', hypertrophy: 'HYP', endurance: 'END' } as const;
const LEVEL_CODE = { beginner: 'BEG', intermediate: 'INT', advanced: 'ADV' } as const;
const FEEL_CODE = { easy: 'E', ok: 'O', hard: 'H' } as const;
const FEEDBACK_CODE = { accepted: 'A', modified: 'M', rejected: 'R' } as const;

/**
 * Diccionario que acompaña al contexto. Se manda una vez por llamada, no por ejercicio,
 * y ahorra repetir nombres de campo en cada línea (RF-IA-03, CE-4).
 */
export const CONTEXT_DICTIONARY = [
  'P=profile(level,goal,bodyweight_kg)',
  'X=exercise(idx,name,unit,sets x reps,increment_kg,days_since_last)',
  'S=session(exercise_idx,date,"weightxreps" comma-separated)',
  'F=feel(exercise_idx,E|O|H)',
  'N=note(exercise_idx,text)',
  'B=feedback on past suggestions(exercise_idx,A=accepted|M=modified|R=rejected, newest first)',
  'units: KG | KGH=per hand | KGA=per arm | T=seconds | BW=bodyweight',
].join(' ');

const UNIT_CODE: Record<string, string> = {
  KG: 'KG',
  KG_PER_HAND: 'KGH',
  KG_PER_ARM: 'KGA',
  TIME: 'T',
  BODYWEIGHT: 'BW',
};

function daysSince(iso: string | null, todayISO: string): number | '' {
  if (!iso) return '';
  const ms = Date.parse(todayISO) - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  return Math.max(0, Math.round(ms / 86400000));
}

/** Recorta y limpia texto libre: sin saltos ni separadores que rompan el formato. */
function clean(text: string, max: number): string {
  return text
    .replace(/[\r\n|]+/g, ' ')
    .trim()
    .slice(0, max);
}

/**
 * Serializa la sesión en un formato CSV-like abreviado (RF-IA-03).
 *
 * Neutro respecto al idioma del usuario: los códigos son fijos y el idioma solo se pide como
 * instrucción de salida para el campo `reason` (`spec.md` §8, [ACLARAR 3]). Así el mismo
 * contexto produce el mismo prompt en ES y en EN, y la caché por hash no se parte por idioma.
 */
export function serializeSessionContext(
  ctx: AiSessionContext,
  opts: { stableDates?: boolean } = {},
): string {
  const p = ctx.userProfile;
  const lines: string[] = [
    `${CONTEXT_FORMAT}|${clean(ctx.dayName, 40)}`,
    `P|${p.level ? LEVEL_CODE[p.level] : ''}|${p.goal ? GOAL_CODE[p.goal] : ''}|${p.weightKg ?? ''}`,
  ];

  ctx.exercises.forEach((ec, idx) => {
    const e = ec.exercise;
    const i = idx + 1;
    // Para el prompt van los DÍAS transcurridos (el modelo no hace bien aritmética de
    // fechas); para el hash va la fecha ABSOLUTA. Si el hash llevara los días, cambiaría
    // solo con que pase la medianoche y las sugerencias precalculadas caducarían cada día
    // sin que nada del entrenamiento haya cambiado (T-815).
    const when = opts.stableDates
      ? (ec.lastSessionDate ?? '')
      : daysSince(ec.lastSessionDate, ctx.todayISO);
    lines.push(
      `X|${i}|${clean(e.name, 40)}|${UNIT_CODE[e.unit] ?? e.unit}|` +
        `${e.defaultSets}x${e.defaultRepTarget}|${e.brick}|${when}`,
    );

    ec.history.slice(-MAX_CONTEXT_SESSIONS).forEach((h) => {
      const sets = h.sets
        .filter((s) => !s.isWarmup)
        .map((s) => `${s.weight}x${s.reps}`)
        .join(',');
      if (sets) lines.push(`S|${i}|${h.dateISO}|${sets}`);
    });

    if (ec.feedback?.length) {
      lines.push(
        `B|${i}|${ec.feedback
          .slice(0, 3)
          .map((f) => FEEDBACK_CODE[f])
          .join('')}`,
      );
    }
    if (ec.lastFeel) lines.push(`F|${i}|${FEEL_CODE[ec.lastFeel]}`);
    if (ec.lastNote?.trim()) lines.push(`N|${i}|${clean(ec.lastNote, 120)}`);
  });

  if (p.aiNotes?.trim()) lines.push(`N|0|${clean(p.aiNotes, 200)}`);

  return lines.join('\n');
}

/**
 * Estimación de tokens por caracteres/4.
 *
 * Es una aproximación: no tenemos el tokenizador del modelo en el navegador y traerlo costaría
 * más que el ahorro. Sirve para verificar el presupuesto de CE-4 con margen, no para facturar.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Recorta el contexto hasta entrar en el presupuesto (CE-4).
 *
 * Se sacrifica historial antiguo antes que ejercicios: perder un ejercicio entero deja a ese
 * sin sugerencia, mientras que perder la sexta sesión de hace dos meses casi no cambia la
 * decisión. Solo si aun así no entra se recortan ejercicios, y se avisa al llamador.
 */
export function fitToBudget(
  ctx: AiSessionContext,
  budget = CONTEXT_TOKEN_BUDGET,
): { text: string; sessionsPerExercise: number; droppedExercises: number } {
  for (let sessions = MAX_CONTEXT_SESSIONS; sessions >= 1; sessions--) {
    const trimmed: AiSessionContext = {
      ...ctx,
      exercises: ctx.exercises.map((e) => ({ ...e, history: e.history.slice(-sessions) })),
    };
    const text = serializeSessionContext(trimmed);
    if (estimateTokens(text) <= budget) {
      return { text, sessionsPerExercise: sessions, droppedExercises: 0 };
    }
  }

  // Ni con una sesión por ejercicio entra: hay demasiados ejercicios en el día.
  let exercises = ctx.exercises.map((e) => ({ ...e, history: e.history.slice(-1) }));
  let dropped = 0;
  let text = serializeSessionContext({ ...ctx, exercises });
  while (estimateTokens(text) > budget && exercises.length > 1) {
    exercises = exercises.slice(0, -1);
    dropped++;
    text = serializeSessionContext({ ...ctx, exercises });
  }
  return { text, sessionsPerExercise: 1, droppedExercises: dropped };
}
