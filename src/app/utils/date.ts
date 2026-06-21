/** Fecha: helpers puros para trabajar con fechas en formato ISO `YYYY-MM-DD`. */

const MS_PER_DAY = 86_400_000;

/**
 * Días enteros transcurridos entre dos fechas ISO (`YYYY-MM-DD`), `to - from`.
 * Centraliza el cálculo que antes estaba duplicado en varios componentes.
 */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.floor((new Date(toISO).getTime() - new Date(fromISO).getTime()) / MS_PER_DAY);
}
