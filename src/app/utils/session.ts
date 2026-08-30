import { Exercise, ExerciseUnit, Session, SetRecord } from '../models/workout.model';

/**
 * Cuántas veces cuenta el peso de una serie en el tonelaje.
 *
 * Una mancuerna de 20 kg "por mano" son 40 kg movidos; contarla como 20 subestima a la mitad
 * el trabajo de todo el tren superior con mancuernas (`audit.md` R-4).
 */
export function unitWeightFactor(unit: ExerciseUnit): number {
  return unit === 'KG_PER_HAND' || unit === 'KG_PER_ARM' ? 2 : 1;
}

/**
 * Tonelaje de un conjunto de series: Σ peso × reps × factor de unidad.
 *
 * Los ejercicios por tiempo quedan fuera: sus "reps" son segundos, así que multiplicarlos por
 * un peso da un número sin significado físico.
 *
 * NOTA: `StorageService.weeklyStats()` e `historyForExercise()` siguen usando la fórmula vieja
 * (peso × reps, sin factor). Unificarlas es el AC de T-600; cambiarlas aquí movería números que
 * el usuario ya viene viendo en el dashboard sin que nada en la sesión lo explique.
 */
export function tonnageOf(sets: SetRecord[], catalog: Exercise[]): number {
  return sets.reduce((sum, set) => {
    const ex = catalog.find((e) => e.id === set.exerciseId);
    if (ex?.unit === 'TIME') return sum;
    const factor = ex ? unitWeightFactor(ex.unit) : 1;
    return sum + (set.weight || 0) * (set.reps || 0) * factor;
  }, 0);
}

export function sessionTonnage(session: Session, catalog: Exercise[]): number {
  return tonnageOf(session.sets, catalog);
}

/** Series efectivas: el calentamiento no cuenta como trabajo. */
export function workingSets(sets: SetRecord[]): SetRecord[] {
  return sets.filter((s) => !s.isWarmup);
}

/**
 * Duración en minutos, o `null` si la sesión no la registró.
 *
 * `null` NO es cero: todo el historial anterior a v7 carece de marcas de tiempo y presentarlo
 * como "0 min" sería inventar un dato (RF-SES-08b, RF-PRO-05, `audit.md` R-5).
 */
export function sessionDurationMinutes(session: Session): number | null {
  if (!session.startedAt || !session.endedAt) return null;
  const start = Date.parse(session.startedAt);
  const end = Date.parse(session.endedAt);
  if (isNaN(start) || isNaN(end) || end < start) return null;
  return Math.round((end - start) / 60000);
}

/** `true` si la sesión tiene trabajo registrado (no está vacía ni fue saltada). */
export function hasWork(session: Session): boolean {
  return !session.skipped && session.sets.length > 0;
}
