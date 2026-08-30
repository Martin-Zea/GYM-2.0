import { ExerciseUnit } from '../models/workout.model';

/**
 * Tipos de récord que la app reconoce (RF-SES-06).
 *
 * - `weight`: más peso que nunca en ese ejercicio.
 * - `reps_at_weight`: mismas kilos, más repeticiones que la mejor vez a ese peso.
 * - `e1rm`: ni peso ni reps son máximos, pero la combinación estima un 1RM mayor.
 * - `reps`: para ejercicios sin peso (corporal) o por tiempo, donde el récord es aguantar más.
 */
export type PrKind = 'weight' | 'reps_at_weight' | 'e1rm' | 'reps';

export interface PrResult {
  kind: PrKind;
  /** Valor que batió el récord: kg en `weight`, repeticiones/segundos en el resto, e1RM en `e1rm`. */
  value: number;
  /** Marca anterior superada, para poder decir "antes: 100". */
  previous: number;
}

export interface WeightReps {
  weight: number;
  reps: number;
}

/**
 * 1RM estimado por la fórmula de Epley.
 *
 * Es una estimación, no una medición: por encima de ~10 reps se aleja bastante, por eso solo
 * se usa para comparar series parecidas entre sí, nunca para prescribir un peso.
 */
export function e1rm(weight: number, reps: number): number {
  if (weight <= 0 || reps <= 0) return 0;
  if (reps === 1) return weight;
  return weight * (1 + reps / 30);
}

const EPS = 0.01;

/**
 * Detecta si una serie recién registrada es récord, y de qué tipo.
 *
 * `previous` son las series de sesiones ANTERIORES (sin las de hoy y sin calentamientos). Sin
 * historial no hay récord: la primera vez que se hace un ejercicio todo sería "récord", y
 * celebrarlo convierte la celebración en ruido.
 *
 * Devuelve el récord más fuerte de los que aplican: más peso pesa más que más reps al mismo
 * peso, y eso más que una mejora solo estimada.
 */
export function detectPr(
  unit: ExerciseUnit,
  previous: readonly WeightReps[],
  candidate: WeightReps,
): PrResult | null {
  if (!previous.length) return null;

  if (unit === 'TIME' || unit === 'BODYWEIGHT') {
    const best = Math.max(...previous.map((p) => p.reps));
    if (candidate.reps > best) return { kind: 'reps', value: candidate.reps, previous: best };
    return null;
  }

  if (candidate.weight <= 0 || candidate.reps <= 0) return null;

  const maxWeight = Math.max(...previous.map((p) => p.weight));
  if (candidate.weight > maxWeight + EPS) {
    return { kind: 'weight', value: candidate.weight, previous: maxWeight };
  }

  const atWeight = previous.filter((p) => Math.abs(p.weight - candidate.weight) < EPS);
  if (atWeight.length) {
    const bestReps = Math.max(...atWeight.map((p) => p.reps));
    if (candidate.reps > bestReps) {
      return { kind: 'reps_at_weight', value: candidate.reps, previous: bestReps };
    }
  }

  const bestE1rm = Math.max(...previous.map((p) => e1rm(p.weight, p.reps)));
  const current = e1rm(candidate.weight, candidate.reps);
  if (current > bestE1rm + EPS) {
    return {
      kind: 'e1rm',
      value: Math.round(current * 10) / 10,
      previous: Math.round(bestE1rm * 10) / 10,
    };
  }

  return null;
}
