import { DEFAULT_BAR_KG, DEFAULT_PLATES_KG, plateBreakdown } from './plates';

describe('plateBreakdown()', () => {
  it('reparte un peso exacto', () => {
    expect(plateBreakdown(60).perSide).toEqual([20]);
    expect(plateBreakdown(60).remainderKg).toBe(0);
  });

  it('avisa de lo que no se puede repartir', () => {
    const out = plateBreakdown(61, DEFAULT_BAR_KG, [20]);
    expect(out.remainderKg).toBeCloseTo(1, 3);
  });

  it('un objetivo por debajo de la barra no lleva discos', () => {
    expect(plateBreakdown(15).belowBar).toBe(true);
    expect(plateBreakdown(15).perSide).toEqual([]);
  });

  /**
   * Un disco de 0 no resta nada: el `while` no avanzaba y la pestaña quedaba colgada, sin
   * error y sin salida (T-831). Por la UI no entra —`patchPlates()` filtra `n > 0`— pero un
   * backup importado llegaba hasta aquí.
   */
  it('un disco de 0 o negativo NO cuelga la app', () => {
    expect(plateBreakdown(60, 20, [20, 0]).perSide).toEqual([20]);
    expect(plateBreakdown(60, 20, [-5, 20]).perSide).toEqual([20]);
    // `remainderKg` es el peso TOTAL sin repartir (por lado x 2): 60 - 20 de barra = 40.
    expect(plateBreakdown(60, 20, [0]).remainderKg).toBe(40);
  });

  it('sin discos utilizables, todo queda como resto', () => {
    expect(plateBreakdown(60, 20, []).remainderKg).toBe(40);
    expect(plateBreakdown(60, 20, DEFAULT_PLATES_KG).remainderKg).toBe(0);
  });
});
