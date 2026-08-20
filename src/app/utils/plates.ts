/** Calculadora de discos: qué poner a cada lado de la barra para un peso objetivo. */

export const DEFAULT_BAR_KG = 20;
export const DEFAULT_PLATES_KG = [20, 15, 10, 5, 2.5, 1.25];

export interface PlateBreakdown {
  /** Discos por lado, de mayor a menor (con repeticiones, p. ej. [15, 5, 1.25]). */
  perSide: number[];
  /** Peso que NO se pudo repartir con los discos disponibles (0 = exacto). */
  remainderKg: number;
  /** El objetivo es menor que la barra sola. */
  belowBar: boolean;
}

export function plateBreakdown(
  targetKg: number,
  barKg: number = DEFAULT_BAR_KG,
  plates: number[] = DEFAULT_PLATES_KG,
): PlateBreakdown {
  if (targetKg <= barKg) {
    return { perSide: [], remainderKg: 0, belowBar: targetKg < barKg };
  }
  let perSideTarget = (targetKg - barKg) / 2;
  const perSide: number[] = [];
  const sorted = [...plates].sort((a, b) => b - a);
  for (const p of sorted) {
    while (perSideTarget >= p - 1e-9) {
      perSide.push(p);
      perSideTarget = Math.round((perSideTarget - p) * 1000) / 1000;
    }
  }
  return { perSide, remainderKg: Math.round(perSideTarget * 2 * 1000) / 1000, belowBar: false };
}
