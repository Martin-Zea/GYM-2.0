import { TrainingGoal, TrainingLevel } from '../models/workout.model';

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
  const r = raw as { notes?: unknown; goal?: unknown; level?: unknown };
  const out: CoachProposal = {};

  if (typeof r.notes === 'string') {
    const notes = r.notes.trim().slice(0, MAX_NOTES);
    if (notes) out.notes = notes;
  }
  if (typeof r.goal === 'string' && GOALS.includes(r.goal)) out.goal = r.goal as TrainingGoal;
  if (typeof r.level === 'string' && LEVELS.includes(r.level)) out.level = r.level as TrainingLevel;

  return Object.keys(out).length ? out : null;
}
