import { TrainingGoal, TrainingLevel } from '../models/workout.model';
import { normalizeExerciseName } from './storage.service';
import { AiSessionContext } from './providers/session-context';
import { allowedCeiling } from './providers/session-response';
import { floorToBrick, roundToBrick } from './providers/prompt-helpers';

/**
 * Propuesta de cambio de CONTEXTO que el coach puede sugerir en el chat (T-811).
 *
 * Solo tres campos, y ninguno es un peso ni una serie. El chat puede cambiar lo que la app
 * *sabe* del atleta —que empezó a boxear, que vuelve de una lesión, que ahora busca fuerza—
 * pero nunca lo que la app le *manda levantar*: eso sigue pasando por el motor y su
 * validador. Un modelo que escribe números en tu rutina es exactamente lo que el Art. 6
 * existe para impedir.
 */
export interface CoachProposal {
  notes?: string;
  goal?: TrainingGoal;
  level?: TrainingLevel;
  /** Pesos propuestos para la PRÓXIMA sesión. Se acotan antes de mostrarse (ver abajo). */
  weights?: WeightProposal[];
}

/** Un peso propuesto por el chat, todavía sin resolver contra la sesión real. */
export interface WeightProposal {
  /** Nombre tal cual lo escribió el modelo; se resuelve por nombre normalizado. */
  exercise: string;
  weight: number;
  reps?: number;
}

/** Una propuesta ya resuelta y acotada, lista para enseñar y aplicar. */
export interface ResolvedWeight {
  exerciseId: string;
  name: string;
  /** Peso de referencia actual (lo que el motor proponía antes). */
  from: number;
  to: number;
  reps: number;
  /** `true` si hubo que recortar lo que pedía el modelo para respetar el tope. */
  clamped: boolean;
}

/**
 * Marcadores del bloque que el modelo añade al final de su respuesta.
 *
 * Se eligen feos a propósito: tienen que ser imposibles de escribir por accidente en una
 * conversación sobre entrenamiento.
 */
const OPEN = '<<GT_CONTEXT>>';
const CLOSE = '<<END>>';

/**
 * Tope de las notas.
 *
 * Son 200 porque es exactamente lo que el serializador del contexto manda al modelo
 * (`N|0|` truncado a 200). Aceptar más sería enseñarle al usuario un texto que la IA nunca
 * va a leer entero.
 */
export const MAX_NOTES = 200;

/** Tope de ejercicios por propuesta: una sesión no tiene más, y acota respuestas absurdas. */
const MAX_WEIGHTS = 12;
const MAX_REPS = 100;

const GOALS: readonly string[] = ['strength', 'hypertrophy', 'endurance'];
const LEVELS: readonly string[] = ['beginner', 'intermediate', 'advanced'];

export interface ParsedReply {
  /** El texto que se le muestra al usuario, ya sin el bloque. */
  text: string;
  /** La propuesta, si traía una válida. */
  proposal: CoachProposal | null;
}

/**
 * Separa la respuesta conversacional de la propuesta estructurada.
 *
 * El bloque se quita SIEMPRE, aunque no se pueda parsear: enseñarle al usuario un `{"notes":`
 * a medias sería peor que perder la propuesta.
 */
export function parseCoachReply(raw: string): ParsedReply {
  const start = raw.indexOf(OPEN);
  if (start === -1) return { text: raw.trim(), proposal: null };

  const end = raw.indexOf(CLOSE, start);
  const text = (raw.slice(0, start) + (end === -1 ? '' : raw.slice(end + CLOSE.length))).trim();
  if (end === -1) return { text, proposal: null };

  const body = raw.slice(start + OPEN.length, end).trim();
  return { text, proposal: validateProposal(safeParse(body)) };
}

function safeParse(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Acepta solo lo que se reconoce y descarta el resto en silencio.
 *
 * Un objetivo inventado o unas notas de tres mil caracteres no se "corrigen" ni se rechazan
 * enteros: se ignora el campo malo y se conserva lo demás, que es lo mismo que hace el
 * validador de sesión con una respuesta parcialmente rota.
 */
export function validateProposal(raw: unknown): CoachProposal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as { notes?: unknown; goal?: unknown; level?: unknown; weights?: unknown };
  const out: CoachProposal = {};

  if (typeof r.notes === 'string') {
    const notes = r.notes.trim().slice(0, MAX_NOTES);
    if (notes) out.notes = notes;
  }
  if (typeof r.goal === 'string' && GOALS.includes(r.goal)) out.goal = r.goal as TrainingGoal;
  if (typeof r.level === 'string' && LEVELS.includes(r.level)) out.level = r.level as TrainingLevel;

  const weights = validateWeights(r.weights);
  if (weights.length) out.weights = weights;

  return Object.keys(out).length ? out : null;
}

/**
 * Filtro de FORMA de los pesos propuestos: que sean números usables.
 *
 * Aquí no se decide si el peso es sensato —eso necesita el historial y lo hace
 * {@link resolveWeightProposal}—, solo se descarta lo que ni siquiera es un número.
 */
function validateWeights(raw: unknown): WeightProposal[] {
  if (!Array.isArray(raw)) return [];
  const out: WeightProposal[] = [];
  for (const row of raw.slice(0, MAX_WEIGHTS)) {
    if (typeof row !== 'object' || row === null) continue;
    const w = row as { exercise?: unknown; weight?: unknown; reps?: unknown };
    const name = typeof w.exercise === 'string' ? w.exercise.trim() : '';
    const weight = Number(w.weight);
    if (!name || !Number.isFinite(weight) || weight <= 0) continue;
    const reps = Number(w.reps);
    out.push({
      exercise: name,
      weight,
      ...(Number.isFinite(reps) && reps > 0 && reps <= MAX_REPS && { reps: Math.round(reps) }),
    });
  }
  return out;
}

/**
 * Resuelve los pesos propuestos contra la sesión real y los ACOTA (Art. 6).
 *
 * Esta es la razón por la que el chat puede tocar pesos sin ser un agujero: pasa por el mismo
 * `allowedCeiling` que la respuesta de sesión, así que el tope por parón, el bloqueo por
 * lesión declarada y el +10% se siguen aplicando aunque el número venga de una conversación.
 * Bajar siempre se permite —nadie se lesiona levantando menos—; subir se recorta.
 *
 * Un ejercicio que no está en la sesión se descarta: el chat no añade ejercicios.
 */
export function resolveWeightProposal(
  weights: readonly WeightProposal[],
  ctx: AiSessionContext,
  current: Partial<Record<string, { weight: number; reps: number }>> = {},
): ResolvedWeight[] {
  const byName = new Map(ctx.exercises.map((ec) => [normalizeExerciseName(ec.exercise.name), ec]));
  const out: ResolvedWeight[] = [];
  const seen = new Set<string>();

  for (const w of weights) {
    const ec = byName.get(normalizeExerciseName(w.exercise));
    if (!ec || seen.has(ec.exercise.id)) continue;

    const ceiling = allowedCeiling(ec, ctx.userProfile.aiNotes, ctx.todayISO);
    const brick = ec.exercise.brick || 2.5;
    const capped = ceiling === null ? w.weight : Math.min(w.weight, ceiling);

    // Redondear DESPUÉS de acotar puede volver a pasarse: con tope 44 y ladrillo 2,5 el
    // redondeo normal da 45. Cuando eso ocurre se baja al ladrillo inmediatamente inferior,
    // porque un tope que el redondeo deshace no es un tope.
    let to = Math.max(brick, roundToBrick(capped, brick));
    if (ceiling !== null && to > ceiling) to = floorToBrick(ceiling, brick);

    const reps = w.reps ?? ec.exercise.defaultRepTarget ?? 10;
    const from = current[ec.exercise.id]?.weight ?? referenceOf(ec);
    const clamped = to < roundToBrick(w.weight, brick);

    // Un no-cambio no se ofrece... salvo que venga de un recorte: si pediste subir y el
    // validador lo impidió, callarse deja al atleta creyendo que su pedido se perdió.
    if (to === from && !clamped && (current[ec.exercise.id]?.reps ?? reps) === reps) continue;

    seen.add(ec.exercise.id);
    out.push({ exerciseId: ec.exercise.id, name: ec.exercise.name, from, to, reps, clamped });
  }
  return out;
}

function referenceOf(ec: AiSessionContext['exercises'][number]): number {
  const sets = ec.lastSets?.length ? ec.lastSets : (ec.history.at(-1)?.sets ?? []);
  const weights = sets.filter((s) => !s.isWarmup).map((s) => s.weight || 0);
  return weights.length ? Math.max(...weights) : 0;
}
