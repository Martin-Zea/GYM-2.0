import { Exercise, UserProfile } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import {
  AiSessionContext,
  CONTEXT_TOKEN_BUDGET,
  estimateTokens,
  fitToBudget,
  serializeSessionContext,
} from './session-context';

function exercise(id: string, name: string, over: Partial<Exercise> = {}): Exercise {
  return {
    id,
    name,
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
    ...over,
  };
}

function history(id: string, n: number): HistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    dateISO: `2026-0${(i % 9) + 1}-1${i % 9}`,
    sets: [
      { exerciseId: id, setIndex: 0, weight: 60 + i, reps: 10 },
      { exerciseId: id, setIndex: 1, weight: 60 + i, reps: 9 },
      { exerciseId: id, setIndex: 2, weight: 60 + i, reps: 8 },
    ],
    topWeight: 60 + i,
    topReps: 10,
    totalReps: 27,
    volume: (60 + i) * 27,
  }));
}

function profile(over: Partial<UserProfile> = {}): UserProfile {
  return {
    weightKg: 80,
    heightCm: null,
    age: null,
    sex: null,
    weightLog: [],
    goal: 'hypertrophy',
    level: 'intermediate',
    equipment: null,
    daysPerWeek: null,
    aiNotes: '',
    ...over,
  };
}

function ctx(
  exerciseCount: number,
  sessions = 6,
  over: Partial<AiSessionContext> = {},
): AiSessionContext {
  return {
    dayId: 'd1',
    dayName: 'Pecho + Tríceps',
    userProfile: profile(),
    lang: 'es' as const,
    todayISO: '2026-08-29',
    exercises: Array.from({ length: exerciseCount }, (_, i) => {
      const id = `ex${i + 1}`;
      const h = history(id, sessions);
      return {
        exercise: exercise(id, `Ejercicio numero ${i + 1}`),
        history: h,
        lastSets: h.at(-1)?.sets ?? null,
        lastSessionDate: h.at(-1)?.dateISO ?? null,
        lastFeel: null,
        lastNote: null,
      };
    }),
    ...over,
  };
}

describe('serializeSessionContext() — RF-IA-03', () => {
  it('una línea por ejercicio y una por sesión, sin nombres de campo repetidos', () => {
    const text = serializeSessionContext(ctx(2, 2));
    const lines = text.split('\n');

    expect(lines[0]).toMatch(/^GT1\|/);
    expect(lines.filter((l) => l.startsWith('X|'))).toHaveLength(2);
    expect(lines.filter((l) => l.startsWith('S|'))).toHaveLength(4);
  });

  it('no manda más de 6 sesiones por ejercicio', () => {
    const text = serializeSessionContext(ctx(1, 12));
    expect(text.split('\n').filter((l) => l.startsWith('S|'))).toHaveLength(6);
  });

  it('el calentamiento no viaja: no informa sobre la progresión', () => {
    const base = ctx(1, 1);
    base.exercises[0].history[0].sets[0].isWarmup = true;

    const line = serializeSessionContext(base)
      .split('\n')
      .find((l) => l.startsWith('S|'))!;

    expect(line.split('|')[3].split(',')).toHaveLength(2);
  });

  it('es neutro respecto al idioma: el mismo contexto en ES y EN es idéntico', () => {
    // Si el idioma se colara en el contexto, la caché por hash se partiría en dos
    const es = serializeSessionContext(ctx(2, 3));
    const en = serializeSessionContext({ ...ctx(2, 3), lang: 'en' });
    expect(es).toBe(en);
  });

  it('el texto libre no puede romper el formato', () => {
    const base = ctx(1, 1);
    base.exercises[0].lastNote = 'me\ndolió|el hombro';

    const line = serializeSessionContext(base)
      .split('\n')
      .find((l) => l.startsWith('N|'))!;

    expect(line.split('|')).toHaveLength(3);
  });

  it('incluye el feedback previo sobre las sugerencias (RF-IA-05)', () => {
    const base = ctx(1, 1);
    base.exercises[0].feedback = ['rejected', 'modified'];

    expect(serializeSessionContext(base)).toContain('B|1|RM');
  });
});

describe('fitToBudget() — CE-4', () => {
  it('una sesión normal entra holgada en el presupuesto', () => {
    const { text, droppedExercises } = fitToBudget(ctx(6));

    expect(estimateTokens(text)).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
    expect(droppedExercises).toBe(0);
  });

  it('con demasiado historial recorta sesiones antes que ejercicios', () => {
    // Perder un ejercicio lo deja sin sugerencia; perder su sexta sesión casi no cambia nada
    const { sessionsPerExercise, droppedExercises } = fitToBudget(ctx(30, 6));

    expect(sessionsPerExercise).toBeLessThan(6);
    expect(droppedExercises).toBe(0);
  });

  it('12 ejercicios con 6 sesiones cada uno todavía entran enteros', () => {
    const { sessionsPerExercise, droppedExercises } = fitToBudget(ctx(12, 6));

    expect(sessionsPerExercise).toBe(6);
    expect(droppedExercises).toBe(0);
  });

  it('nunca supera el presupuesto, ni en el peor caso', () => {
    const { text } = fitToBudget(ctx(30, 6));
    expect(estimateTokens(text)).toBeLessThanOrEqual(CONTEXT_TOKEN_BUDGET);
  });

  it('siempre deja al menos un ejercicio: un contexto vacío no sirve de nada', () => {
    const { text } = fitToBudget(ctx(40, 6), 50);
    expect(text.split('\n').filter((l) => l.startsWith('X|')).length).toBeGreaterThanOrEqual(1);
  });
});
