/** Formato de etiquetas de sets y recomendaciones IA — compartido entre componentes. */

import { ExerciseUnit } from '../models/workout.model';

interface WeightReps {
  weight: number;
  reps: number;
}

/** Sufijo de peso según la unidad: `kg`, `kg/m` (por mano) o `kg/b` (por brazo). */
export function unitSuffix(unit: ExerciseUnit | string): string {
  return unit === 'kg por mano' ? 'kg/m' : unit === 'kg por brazo' ? 'kg/b' : 'kg';
}

/**
 * Etiqueta corta para una recomendación IA (primer set, o rango si el peso sube).
 * @param withRepsInRange incluye `× reps` también en la variante de rango (cards).
 */
export function formatRecLabel(
  unit: ExerciseUnit | string,
  sets: readonly WeightReps[] | undefined,
  opts: { withRepsInRange?: boolean } = {},
): string {
  if (!sets?.length) return '';
  const first = sets[0];
  const last = sets[sets.length - 1];
  if (unit === 'peso corporal') return `${first.reps} reps`;
  if (unit === 'tiempo') return `${first.reps} seg`;
  const suffix = unitSuffix(unit);
  if (last.weight > first.weight) {
    return opts.withRepsInRange
      ? `${first.weight}${suffix} × ${first.reps} → ${last.weight}${suffix}`
      : `${first.weight}${suffix} → ${last.weight}${suffix}`;
  }
  return `${first.weight}${suffix} × ${first.reps} reps`;
}

/** Etiqueta de un set ya registrado, p. ej. `40kg × 8`, `12 reps`, `30 seg`. */
export function formatSetLine(weight: number, reps: number, unit: ExerciseUnit | string): string {
  if (unit === 'peso corporal') return `${reps} reps`;
  if (unit === 'tiempo') return `${reps} seg`;
  return `${weight}${unitSuffix(unit)} × ${reps}`;
}
