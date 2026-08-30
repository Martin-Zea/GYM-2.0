import { detectPr, e1rm } from './pr';

describe('e1rm()', () => {
  it('a una repetición el 1RM estimado es el peso levantado', () => {
    expect(e1rm(100, 1)).toBe(100);
  });

  it('sube con las repeticiones (Epley)', () => {
    expect(e1rm(100, 10)).toBeCloseTo(133.33, 1);
    expect(e1rm(100, 5)).toBeLessThan(e1rm(100, 10));
  });

  it('sin peso o sin reps no hay estimación', () => {
    expect(e1rm(0, 8)).toBe(0);
    expect(e1rm(80, 0)).toBe(0);
  });
});

describe('detectPr() — RF-SES-06', () => {
  const previous = [
    { weight: 80, reps: 8 },
    { weight: 85, reps: 5 },
  ];

  it('sin historial NO hay récord: la primera vez todo sería récord', () => {
    expect(detectPr('KG', [], { weight: 200, reps: 10 })).toBeNull();
  });

  it('más peso que nunca es récord de peso', () => {
    const pr = detectPr('KG', previous, { weight: 90, reps: 3 });
    expect(pr).toEqual({ kind: 'weight', value: 90, previous: 85 });
  });

  it('más reps al mismo peso es récord aunque el peso no sea máximo', () => {
    const pr = detectPr('KG', previous, { weight: 80, reps: 10 });
    expect(pr).toEqual({ kind: 'reps_at_weight', value: 10, previous: 8 });
  });

  it('mejorar el 1RM estimado cuenta, aunque ni peso ni reps sean máximos', () => {
    // 84×7 no supera 85 kg ni iguala un peso ya usado, pero estima más 1RM que 85×5
    const pr = detectPr('KG', previous, { weight: 84, reps: 7 });
    expect(pr?.kind).toBe('e1rm');
    expect(pr!.value).toBeGreaterThan(pr!.previous);
  });

  it('igualar la marca anterior no es récord', () => {
    expect(detectPr('KG', previous, { weight: 80, reps: 8 })).toBeNull();
    expect(detectPr('KG', previous, { weight: 85, reps: 5 })).toBeNull();
  });

  it('el récord de peso gana al de reps cuando ambos aplican', () => {
    const pr = detectPr('KG', previous, { weight: 90, reps: 12 });
    expect(pr?.kind).toBe('weight');
  });

  it('en peso corporal el récord son las repeticiones', () => {
    const prev = [
      { weight: 0, reps: 12 },
      { weight: 0, reps: 15 },
    ];
    expect(detectPr('BODYWEIGHT', prev, { weight: 0, reps: 16 })).toEqual({
      kind: 'reps',
      value: 16,
      previous: 15,
    });
    expect(detectPr('BODYWEIGHT', prev, { weight: 0, reps: 15 })).toBeNull();
  });

  it('en ejercicios por tiempo el récord es aguantar más segundos', () => {
    const pr = detectPr('TIME', [{ weight: 0, reps: 45 }], { weight: 0, reps: 60 });
    expect(pr).toEqual({ kind: 'reps', value: 60, previous: 45 });
  });

  it('una serie sin reps no puede ser récord', () => {
    expect(detectPr('KG', previous, { weight: 100, reps: 0 })).toBeNull();
  });
});
