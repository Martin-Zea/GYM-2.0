import {
  REFERENCE_PERCENTS,
  displayStep,
  estimateOneRm,
  fromDisplayWeight,
  kgToLb,
  lbToKg,
  percentOfOneRm,
  repsAtWeight,
  toDisplayWeight,
  unitSuffixFor,
} from './one-rm';

describe('Calculadora de 1RM (RF-HER-01)', () => {
  it('a una repetición el 1RM es el peso', () => {
    expect(estimateOneRm(100, 1)).toBe(100);
  });

  it('estima por Epley, igual que la detección de récords', () => {
    expect(estimateOneRm(100, 10)).toBeCloseTo(133.3, 1);
  });

  it('con datos imposibles no inventa un número', () => {
    expect(estimateOneRm(0, 5)).toBeNull();
    expect(estimateOneRm(80, 0)).toBeNull();
  });

  it('los porcentajes salen del 1RM y se redondean a 0,25', () => {
    expect(percentOfOneRm(100, 75)).toBe(75);
    expect(percentOfOneRm(133.3, 80)).toBe(106.75);
  });

  it('sin 1RM no hay porcentaje', () => {
    expect(percentOfOneRm(0, 80)).toBeNull();
  });

  it('la tabla de referencia va de mayor a menor', () => {
    const values = [...REFERENCE_PERCENTS];
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });

  it('acota las reps estimadas: por encima de 12 la fórmula ya no es fiable', () => {
    expect(repsAtWeight(100, 100)).toBe(1);
    expect(repsAtWeight(100, 50)).toBe(12);
    expect(repsAtWeight(100, 120)).toBeNull();
  });
});

describe('Conversión kg ⇄ lb (RF-HER-01, RF-PWA-04)', () => {
  it('convierte en los dos sentidos', () => {
    expect(kgToLb(100)).toBeCloseTo(220.5, 1);
    expect(lbToKg(220.5)).toBeCloseTo(100, 1);
  });

  it('ida y vuelta no corre el número de forma apreciable', () => {
    expect(lbToKg(kgToLb(62.5))).toBeCloseTo(62.5, 1);
  });

  it('en kg la presentación no toca el valor guardado', () => {
    expect(toDisplayWeight(62.5, 'kg')).toBe(62.5);
    expect(fromDisplayWeight(62.5, 'kg')).toBe(62.5);
    expect(toDisplayWeight(62.5, undefined)).toBe(62.5);
  });

  it('en lb convierte al mostrar y deshace al guardar', () => {
    const shown = toDisplayWeight(60, 'lb');
    expect(shown).toBeCloseTo(132.3, 1);
    expect(fromDisplayWeight(shown, 'lb')).toBeCloseTo(60, 1);
  });

  it('el sufijo acompaña a la unidad elegida', () => {
    expect(unitSuffixFor('lb')).toBe('lb');
    expect(unitSuffixFor('kg')).toBe('kg');
    expect(unitSuffixFor(undefined)).toBe('kg');
  });
});

describe('displayStep()', () => {
  it('en kg el paso es el ladrillo del ejercicio', () => {
    expect(displayStep(2.5, 'kg')).toBe(2.5);
    expect(displayStep(1.25, undefined)).toBe(1.25);
  });

  it('en lb usa incrementos que existen en un gimnasio, no el ladrillo convertido', () => {
    // 2,5 kg son 5,51 lb: un número que no está en ningún disco
    expect(displayStep(2.5, 'lb')).toBe(5);
    expect(displayStep(1.25, 'lb')).toBe(2.5);
  });

  it('un ladrillo mal configurado no deja el stepper en cero', () => {
    expect(displayStep(0, 'kg')).toBe(0.5);
    expect(displayStep(0, 'lb')).toBeGreaterThan(0);
  });
});
