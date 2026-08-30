import { SetRecord, TrainingLevel } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';

/**
 * Parámetros de progresión por nivel (§3, §4.5, RF-IA-01).
 *
 * El nivel no cambia QUÉ reglas se aplican, sino cuánto tardan en dispararse: un principiante
 * sube casi cada sesión que cumple, un avanzado necesita confirmar y descarga mucho antes.
 */
export interface LevelParams {
  /** Sesiones seguidas cumpliendo el objetivo antes de subir TODAS las series. */
  confirmSessions: number;
  /** Sesiones seguidas fallando el objetivo antes de bajar el peso. */
  failSessions: number;
  /** Cuánto se baja tras fallos consecutivos, como fracción del peso (5–10%, §4.5). */
  failDrop: number;
  /** Sesiones sin mejorar la marca que se consideran estancamiento. */
  stagnationSessions: number;
  /** Sesiones seguidas subiendo peso antes de proponer una descarga preventiva. */
  deloadAfterProgress: number;
  /** Peso de la descarga como fracción del actual. */
  deloadFactor: number;
}

/**
 * Tabla de §3. `advanced` descarga antes porque el análisis pide descarga "autoregulada por
 * fatiga": sin RPE numérico no podemos medir fatiga, así que se aproxima con una racha de
 * progreso más corta. Es una aproximación deliberada, no la regla final.
 */
export const LEVEL_PARAMS: Record<TrainingLevel, LevelParams> = {
  beginner: {
    confirmSessions: 1,
    failSessions: 2,
    failDrop: 0.05,
    stagnationSessions: 4,
    deloadAfterProgress: 8,
    deloadFactor: 0.8,
  },
  intermediate: {
    confirmSessions: 2,
    failSessions: 2,
    failDrop: 0.075,
    stagnationSessions: 3,
    deloadAfterProgress: 6,
    deloadFactor: 0.7,
  },
  advanced: {
    confirmSessions: 2,
    failSessions: 2,
    failDrop: 0.1,
    stagnationSessions: 3,
    deloadAfterProgress: 4,
    deloadFactor: 0.65,
  },
};

/**
 * Sin nivel declarado se asume intermedio: el punto medio, el que menos daño hace si erramos.
 *
 * También cubre un valor desconocido: el nivel puede llegar de un backup importado y el
 * validador no lo comprueba, así que un `"experto"` cualquiera no puede dejar al motor sin
 * parámetros a mitad de cálculo.
 */
export function levelParams(level: TrainingLevel | null | undefined): LevelParams {
  return LEVEL_PARAMS[level as TrainingLevel] ?? LEVEL_PARAMS.intermediate;
}

/**
 * Qué fracción del objetivo se completó: Σ min(reps, objetivo) / (series × objetivo).
 *
 * Usa el `repTarget` guardado en cada serie cuando existe, no el actual: si el usuario cambió
 * el objetivo del ejercicio, las sesiones viejas se juzgarían contra una vara que no tenían.
 */
export function completionRatio(
  sets: readonly SetRecord[],
  repTarget: number,
  setsTarget: number,
): number {
  const maxPossible = setsTarget * repTarget;
  if (maxPossible <= 0) return 0;
  const totalReps = sets.reduce((sum, s) => {
    const target = s.repTarget ?? repTarget;
    return sum + Math.min(s.reps || 0, target);
  }, 0);
  return totalReps / maxPossible;
}

/** `true` si esa sesión cumplió el objetivo de series × reps. */
export function metTarget(entry: HistoryEntry, repTarget: number, setsTarget: number): boolean {
  return completionRatio(entry.sets, repTarget, setsTarget) >= 1;
}

/**
 * Sesiones consecutivas más recientes que NO alcanzaron el objetivo (§4.5).
 *
 * Fallar una vez es ruido —una mala noche, poco tiempo—. Fallar dos seguidas al mismo peso
 * es la señal de que el peso es demasiado, y ahí sí toca bajar.
 */
export function consecutiveFailures(
  history: readonly HistoryEntry[],
  repTarget: number,
  setsTarget: number,
): number {
  let count = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (metTarget(history[i], repTarget, setsTarget)) break;
    count++;
  }
  return count;
}

/**
 * Estancamiento: `sessions` sesiones seguidas sin mejorar la mejor marca (§4.5).
 *
 * "Sin mejorar" incluye bajar: lo que importa es que la marca no avanza. Se mide sobre el peso
 * tope, que es la referencia que el usuario reconoce; las reps entran por `consecutiveFailures`.
 */
export function isStagnant(history: readonly HistoryEntry[], sessions: number): boolean {
  if (sessions <= 1 || history.length < sessions) return false;
  const recent = history.slice(-sessions);
  const best = Math.max(...recent.map((h) => h.topWeight));
  // Si la mejor marca del tramo está en la primera sesión, no se ha mejorado desde entonces
  return recent[0].topWeight >= best;
}

/** Sesiones consecutivas (contando hacia atrás) en las que la marca subió. */
export function progressStreak(history: readonly HistoryEntry[]): number {
  let streak = 0;
  for (let i = history.length - 1; i > 0; i--) {
    if (history[i].topWeight <= history[i - 1].topWeight) break;
    streak++;
  }
  return streak;
}

/**
 * `true` si el usuario confirmó el peso actual las sesiones que su nivel exige.
 *
 * Es el corazón de la doble progresión: primero se consolidan las reps al peso actual y solo
 * después sube el peso. Un principiante confirma con una sesión (progresión lineal agresiva);
 * un intermedio o avanzado necesita dos.
 */
export function confirmedAtWeight(
  history: readonly HistoryEntry[],
  topWeight: number,
  repTarget: number,
  setsTarget: number,
  confirmSessions: number,
): boolean {
  if (history.length < confirmSessions) return false;
  return history
    .slice(-confirmSessions)
    .every((h) => h.topWeight === topWeight && metTarget(h, repTarget, setsTarget));
}

/**
 * Peso tras fallar el objetivo varias sesiones seguidas: se baja el porcentaje del nivel,
 * redondeado al ladrillo disponible y nunca por debajo de un ladrillo.
 */
export function failureDropWeight(topWeight: number, brick: number, failDrop: number): number {
  const target = topWeight * (1 - failDrop);
  const step = brick > 0 ? brick : 2.5;
  const rounded = Math.floor(target / step) * step;
  // Bajar tiene que bajar de verdad: si el redondeo devuelve el mismo peso, se cae un ladrillo
  const dropped = rounded >= topWeight ? topWeight - step : rounded;
  return Math.max(step, Math.round(dropped * 100) / 100);
}

/** Días sin entrenar UN ejercicio a partir de los cuales se recorta la referencia. */
export const LAYOFF_MODERATE_DAYS = 14;
export const LAYOFF_LONG_DAYS = 28;
const LAYOFF_MODERATE_FACTOR = 0.9;
const LAYOFF_LONG_FACTOR = 0.85;

/**
 * Cuánto se recorta la última marca según el tiempo parado.
 *
 * Vive aquí, con el resto de reglas puras, porque la aplican DOS motores: el local al
 * proponer y el validador al acotar lo que responde la IA. Cuando cada uno tenía la suya,
 * volver tras tres meses daba 95 kg por un lado y 85 kg por el otro para la misma marca de
 * 100 kg — y el usuario veía uno u otro según hubiera red.
 *
 * Es proporcional a propósito: un recorte fijo de dos incrementos da el mismo peso tras un
 * mes que tras tres años, que es justo cuando más se equivoca.
 */
export function layoffFactor(lastSessionDate: string | null, todayISO: string): number {
  if (!lastSessionDate) return 1;
  const days = Math.round(
    (Date.parse(todayISO) - Date.parse(lastSessionDate)) / (1000 * 60 * 60 * 24),
  );
  if (!Number.isFinite(days)) return 1;
  if (days > LAYOFF_LONG_DAYS) return LAYOFF_LONG_FACTOR;
  if (days > LAYOFF_MODERATE_DAYS) return LAYOFF_MODERATE_FACTOR;
  return 1;
}
