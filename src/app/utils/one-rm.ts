import { e1rm } from './pr';

/**
 * Calculadoras de 1RM y porcentajes (RF-HER-01, vista A6).
 *
 * Todo se apoya en Epley, la misma fórmula que usa la detección de récords: dos calculadoras
 * distintas para lo mismo darían dos respuestas y el usuario no sabría a cuál creer.
 */

/** 1RM estimado a partir de una serie. `null` si los datos no permiten estimar. */
export function estimateOneRm(weight: number, reps: number): number | null {
  const value = e1rm(weight, reps);
  return value > 0 ? Math.round(value * 10) / 10 : null;
}

/**
 * Peso al que corresponde un porcentaje del 1RM.
 *
 * Se redondea a 0,25 kg —no al ladrillo— porque esto es una calculadora, no una sugerencia
 * de entrenamiento: el usuario decide qué disco pone.
 */
export function percentOfOneRm(oneRm: number, percent: number): number | null {
  if (oneRm <= 0 || percent <= 0) return null;
  return Math.round(((oneRm * percent) / 100) * 4) / 4;
}

/** Porcentajes de referencia que se muestran en la tabla. */
export const REFERENCE_PERCENTS = [95, 90, 85, 80, 75, 70, 65, 60] as const;

/**
 * Repeticiones estimadas a un peso dado, invirtiendo Epley.
 *
 * Por encima de ~12 la fórmula deja de ser fiable, así que se acota: prometer "24 reps"
 * sería darle un número que no va a poder hacer.
 */
export function repsAtWeight(oneRm: number, weight: number): number | null {
  if (oneRm <= 0 || weight <= 0 || weight > oneRm) return null;
  const reps = (oneRm / weight - 1) * 30;
  if (reps < 1) return 1;
  return Math.min(12, Math.round(reps));
}

const LB_PER_KG = 2.2046226218;

export function kgToLb(kg: number): number {
  return Math.round(kg * LB_PER_KG * 10) / 10;
}

export function lbToKg(lb: number): number {
  return Math.round((lb / LB_PER_KG) * 10) / 10;
}

/**
 * Convierte un peso guardado (siempre en kg) a la unidad de presentación (RF-PWA-04).
 *
 * El almacenamiento nunca cambia: cambiar de unidad no puede reescribir el historial, o dos
 * conversiones de ida y vuelta acabarían corriendo los números (edge case §6 de la spec).
 */
export function toDisplayWeight(kg: number, units: 'kg' | 'lb' | undefined): number {
  return units === 'lb' ? kgToLb(kg) : kg;
}

export function fromDisplayWeight(value: number, units: 'kg' | 'lb' | undefined): number {
  return units === 'lb' ? lbToKg(value) : value;
}

export function unitSuffixFor(units: 'kg' | 'lb' | undefined): string {
  return units === 'lb' ? 'lb' : 'kg';
}

/**
 * Incremento de peso en la unidad de presentación.
 *
 * En libras NO se usa el ladrillo convertido: 2,5 kg son 5,5 lb, un número que no existe en
 * ningún gimnasio. Se redondea al incremento real que la gente usa con discos en libras.
 */
export function displayStep(brickKg: number, units: 'kg' | 'lb' | undefined): number {
  if (units !== 'lb') return brickKg > 0 ? brickKg : 0.5;
  const lb = kgToLb(brickKg > 0 ? brickKg : 0.5);
  return lb >= 4 ? 5 : lb >= 2 ? 2.5 : 1;
}
