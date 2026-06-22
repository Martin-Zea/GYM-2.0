import { describe, expect, it } from 'vitest';
import { bodyweightRepFloor, parseAndNormalizeSets } from './prompt-helpers';

describe('bodyweightRepFloor', () => {
  it('returns 1 for cargas en kg (no aplica piso de no-regresión)', () => {
    expect(bodyweightRepFloor('kg', [{ reps: 12 }])).toBe(1);
    expect(bodyweightRepFloor('kg por mano', [{ reps: 12 }], true)).toBe(1);
  });

  it('returns 1 sin sesión anterior', () => {
    expect(bodyweightRepFloor('peso corporal', null)).toBe(1);
    expect(bodyweightRepFloor('peso corporal', [])).toBe(1);
  });

  it('sin deload: piso = máximo de reps anterior (bloquea regresión)', () => {
    expect(bodyweightRepFloor('peso corporal', [{ reps: 8 }, { reps: 10 }])).toBe(10);
    expect(bodyweightRepFloor('tiempo', [{ reps: 45 }, { reps: 30 }])).toBe(45);
  });

  it('con deload: piso relajado al 50% del máximo (permite back-off acotado)', () => {
    expect(bodyweightRepFloor('peso corporal', [{ reps: 10 }], true)).toBe(5);
    expect(bodyweightRepFloor('tiempo', [{ reps: 45 }], true)).toBe(23);
  });

  it('con deload nunca baja de 1', () => {
    expect(bodyweightRepFloor('peso corporal', [{ reps: 1 }], true)).toBe(1);
  });

  it('parsea reps en string de la sesión anterior', () => {
    expect(bodyweightRepFloor('peso corporal', [{ reps: '12' }])).toBe(12);
  });
});

describe('parseAndNormalizeSets — deload en peso corporal', () => {
  const parsed = { sets: [{ weight: 0, reps: 7 }] };
  const lastSets = [{ reps: 10 }];

  it('sin deload: sube las reps al máximo anterior (no permite regresión)', () => {
    const out = parseAndNormalizeSets(parsed, 1, 2.5, 10, {
      unit: 'peso corporal',
      lastSets,
    });
    expect(out[0].reps).toBe(10);
  });

  it('con deload: respeta la bajada de la IA por encima del piso de seguridad', () => {
    const out = parseAndNormalizeSets(parsed, 1, 2.5, 10, {
      unit: 'peso corporal',
      lastSets,
      deload: true,
    });
    expect(out[0].reps).toBe(7);
  });

  it('con deload: una bajada absurda queda acotada al piso del 50%', () => {
    const out = parseAndNormalizeSets({ sets: [{ weight: 0, reps: 1 }] }, 1, 2.5, 10, {
      unit: 'peso corporal',
      lastSets,
      deload: true,
    });
    expect(out[0].reps).toBe(5);
  });
});
