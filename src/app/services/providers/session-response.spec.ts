import { Exercise, UserProfile } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import { AiSessionContext } from './session-context';
import {
  MAX_INCREASE,
  allowedCeiling,
  injuryBlocksIncrease,
  validateSessionResponse,
} from './session-response';

function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    name: 'Press banca',
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
    ...over,
  };
}

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    weightKg: null,
    heightCm: null,
    age: null,
    sex: null,
    weightLog: [],
    goal: null,
    level: null,
    equipment: null,
    daysPerWeek: null,
    aiNotes: '',
    ...over,
  };
}

function entry(weight: number): HistoryEntry {
  const sets = [
    { exerciseId: 'ex1', setIndex: 0, weight, reps: 10 },
    { exerciseId: 'ex1', setIndex: 1, weight, reps: 10 },
  ];
  return {
    dateISO: '2026-08-20',
    sets,
    topWeight: weight,
    topReps: 10,
    totalReps: 20,
    volume: weight * 20,
  };
}

function ctx(over: Partial<AiSessionContext> = {}, ex = exercise()): AiSessionContext {
  const h = [entry(100)];
  return {
    dayId: 'd1',
    dayName: 'Pecho',
    userProfile: profile(),
    lang: 'es',
    todayISO: '2026-08-29',
    exercises: [
      {
        exercise: ex,
        history: h,
        lastSets: h[0].sets,
        lastSessionDate: '2026-08-20',
        lastFeel: null,
        lastNote: null,
      },
    ],
    ...over,
  };
}

const ok = { r: [{ e: 1, sets: [{ w: 105, r: 8 }], why: 'subida moderada' }] };

describe('validateSessionResponse() — RF-IA-04, Art. 6', () => {
  it('acepta una respuesta dentro de límites y la reparte por ejercicio', () => {
    const out = validateSessionResponse(ok, ctx(), 'groq');

    expect(out.byExercise['ex1'].sets).toHaveLength(3);
    expect(out.byExercise['ex1'].sets[0]).toEqual({ weight: 105, reps: 8 });
    expect(out.byExercise['ex1'].source).toBe('groq');
    expect(out.corrections).toHaveLength(0);
  });

  it('corta un incremento por encima del 10% al tope, no lo muestra (EA-3)', () => {
    const out = validateSessionResponse({ r: [{ e: 1, sets: [{ w: 150, r: 8 }] }] }, ctx(), 'groq');

    expect(out.byExercise['ex1'].sets[0].weight).toBeLessThanOrEqual(100 * (1 + MAX_INCREASE));
    expect(out.corrections[0].reasons.join()).toMatch(/incremento/);
  });

  it('un peso de 0 o negativo nunca pasa', () => {
    const out = validateSessionResponse(
      {
        r: [
          {
            e: 1,
            sets: [
              { w: 0, r: 8 },
              { w: -20, r: 8 },
            ],
          },
        ],
      },
      ctx(),
      'groq',
    );

    expect(out.byExercise['ex1'].sets.every((s) => s.weight > 0)).toBe(true);
    expect(out.corrections[0].reasons.join()).toMatch(/no positivo/);
  });

  it('reps absurdas se sustituyen por el objetivo del ejercicio', () => {
    const out = validateSessionResponse(
      { r: [{ e: 1, sets: [{ w: 100, r: 900 }] }] },
      ctx(),
      'groq',
    );

    expect(out.byExercise['ex1'].sets[0].reps).toBe(10);
  });

  it('una sesión marcada como dura impide subir, aunque el modelo insista', () => {
    const base = ctx();
    base.exercises[0].lastFeel = 'hard';

    const out = validateSessionResponse(ok, base, 'groq');

    expect(out.byExercise['ex1'].sets[0].weight).toBeLessThanOrEqual(100);
  });

  it('una molestia declarada sobre ese ejercicio impide subir (RF-IA-04)', () => {
    const base = ctx({ userProfile: profile({ aiNotes: 'me molesta el hombro en press banca' }) });

    const out = validateSessionResponse(ok, base, 'groq');

    expect(out.byExercise['ex1'].sets[0].weight).toBeLessThanOrEqual(100);
  });

  it('sin historial no hay tope: el primer peso de un ejercicio nuevo es libre', () => {
    const base = ctx();
    base.exercises[0].history = [];
    base.exercises[0].lastSets = null;

    const out = validateSessionResponse({ r: [{ e: 1, sets: [{ w: 40, r: 10 }] }] }, base, 'groq');

    expect(out.byExercise['ex1'].sets[0].weight).toBe(40);
  });

  it('un ejercicio sin respuesta se marca como faltante en vez de inventarse', () => {
    const out = validateSessionResponse({ r: [] }, ctx(), 'groq');

    expect(out.missing).toEqual(['ex1']);
    expect(out.byExercise['ex1']).toBeUndefined();
  });

  it('una respuesta con basura no revienta ni produce sugerencias', () => {
    expect(validateSessionResponse(null, ctx(), 'groq').missing).toEqual(['ex1']);
    expect(validateSessionResponse('texto', ctx(), 'groq').missing).toEqual(['ex1']);
    expect(validateSessionResponse({ r: 'no-array' }, ctx(), 'groq').missing).toEqual(['ex1']);
  });

  it('en peso corporal y tiempo el peso se normaliza a 0', () => {
    const bw = ctx({}, exercise({ unit: 'BODYWEIGHT' }));
    const out = validateSessionResponse({ r: [{ e: 1, sets: [{ w: 99, r: 12 }] }] }, bw, 'groq');

    expect(out.byExercise['ex1'].sets.every((s) => s.weight === 0)).toBe(true);
    expect(out.byExercise['ex1'].sets[0].reps).toBe(12);
  });

  it('rellena hasta el número de series del ejercicio', () => {
    const out = validateSessionResponse(
      { r: [{ e: 1, sets: [{ w: 100, r: 10 }] }] },
      ctx(),
      'groq',
    );
    expect(out.byExercise['ex1'].sets).toHaveLength(3);
  });
});

describe('injuryBlocksIncrease()', () => {
  it('reconoce el ejercicio dentro de la nota del atleta', () => {
    expect(injuryBlocksIncrease('Press Banca', 'cuidado con el press banca, hombro')).toBe(true);
  });

  it('no bloquea cuando la nota habla de otra cosa', () => {
    expect(injuryBlocksIncrease('Sentadilla', 'me molesta el hombro')).toBe(false);
    expect(injuryBlocksIncrease('Sentadilla', '')).toBe(false);
    expect(injuryBlocksIncrease('Sentadilla', undefined)).toBe(false);
  });
});

describe('allowedCeiling()', () => {
  it('es el 110% de la última marca', () => {
    const ec = ctx().exercises[0];
    expect(allowedCeiling(ec, '')).toBeCloseTo(110, 5);
  });

  it('sin referencia no hay tope', () => {
    const ec = { ...ctx().exercises[0], history: [], lastSets: null };
    expect(allowedCeiling(ec, '')).toBeNull();
  });
});
