import { AppState, Exercise, ExerciseUnit, Session, SetRecord } from '../models/workout.model';
import { MuscleGroup } from '../data/exercise-catalog';
import {
  AGGREGATION_THRESHOLD,
  WEEKLY_SET_RANGE,
  adherence,
  aggregateWeekly,
  averageDurationMinutes,
  bestE1rm,
  volumeByGroup,
  volumeImbalances,
  weekStartISO,
} from './stats';

function ex(id: string, unit: ExerciseUnit = 'KG'): Exercise {
  return {
    id,
    name: id,
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit,
    notes: '',
  };
}

function set(exerciseId: string, weight: number, reps: number, isWarmup = false): SetRecord {
  return { exerciseId, setIndex: 0, weight, reps, isWarmup };
}

function session(dateISO: string, sets: SetRecord[], over: Partial<Session> = {}): Session {
  return { id: dateISO, dayId: 'd1', dateISO, sets, ...over };
}

function state(exercises: Exercise[], sessions: Session[]): AppState {
  return {
    schemaVersion: 10,
    exercises,
    days: [],
    routines: [{ id: 'r1', name: '', dayIds: [] }],
    activeRoutineId: 'r1',
    sessions,
    activeDayIndex: 0,
    routinePointer: 0,
    todayProgress: {},
    settings: {} as AppState['settings'],
  };
}

describe('bestE1rm()', () => {
  it('toma la mejor serie efectiva, ignorando el calentamiento', () => {
    const sets = [set('e', 100, 5, true), set('e', 80, 5)];
    // 80×5 estima más que nada porque la de 100 es calentamiento y no cuenta
    expect(bestE1rm(sets)).toBeCloseTo(93.33, 1);
  });

  it('sin series devuelve 0', () => {
    expect(bestE1rm([])).toBe(0);
  });
});

describe('weekStartISO()', () => {
  it('devuelve el lunes de esa semana', () => {
    expect(weekStartISO('2026-08-29')).toBe('2026-08-24'); // sábado → lunes
    expect(weekStartISO('2026-08-24')).toBe('2026-08-24'); // lunes → él mismo
  });
});

describe('aggregateWeekly() — RF-PRO-04', () => {
  it('agrupa por semana y promedia', () => {
    const out = aggregateWeekly([
      { dateISO: '2026-08-24', value: 100 },
      { dateISO: '2026-08-26', value: 120 },
      { dateISO: '2026-08-31', value: 140 },
    ]);

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ weekISO: '2026-08-24', value: 110, sessions: 2 });
  });

  it('deja el orden cronológico', () => {
    const out = aggregateWeekly([
      { dateISO: '2026-09-07', value: 1 },
      { dateISO: '2026-08-24', value: 2 },
    ]);
    expect(out.map((o) => o.weekISO)).toEqual(['2026-08-24', '2026-09-07']);
  });

  it('el umbral de agregación es explícito y razonable', () => {
    expect(AGGREGATION_THRESHOLD).toBe(200);
  });
});

describe('volumeByGroup() — RF-PRO-01', () => {
  const catalog = [ex('press', 'KG'), ex('mancuernas', 'KG_PER_HAND'), ex('raro')];
  const groupOf = (e: Exercise): MuscleGroup | null =>
    e.id === 'press' ? 'chest' : e.id === 'mancuernas' ? 'shoulders' : null;

  it('cuenta el factor de unidad: por mano vale doble (R-4)', () => {
    const s = state(catalog, [
      session('2026-08-25', [set('press', 100, 5), set('mancuernas', 20, 10)]),
    ]);

    const out = volumeByGroup(s, groupOf, '2026-08-01', '2026-08-31');

    expect(out.find((g) => g.group === 'chest')!.tonnage).toBe(500);
    expect(out.find((g) => g.group === 'shoulders')!.tonnage).toBe(400);
  });

  it('un ejercicio sin grupo conocido va a "unknown", no se reparte a ojo', () => {
    const s = state(catalog, [session('2026-08-25', [set('raro', 50, 10)])]);

    const out = volumeByGroup(s, groupOf, '2026-08-01', '2026-08-31');

    expect(out.map((g) => g.group)).toEqual(['unknown']);
  });

  it('el calentamiento y las sesiones saltadas no cuentan', () => {
    const s = state(catalog, [
      session('2026-08-25', [set('press', 100, 5, true)]),
      session('2026-08-26', [set('press', 100, 5)], { skipped: true }),
    ]);

    expect(volumeByGroup(s, groupOf, '2026-08-01', '2026-08-31')).toEqual([]);
  });

  it('respeta el rango de fechas', () => {
    const s = state(catalog, [session('2026-07-01', [set('press', 100, 5)])]);
    expect(volumeByGroup(s, groupOf, '2026-08-01', '2026-08-31')).toEqual([]);
  });
});

describe('volumeImbalances() — RF-PRO-03', () => {
  it('señala lo que está por debajo y por encima del rango', () => {
    const out = volumeImbalances([
      { group: 'chest', tonnage: 1, sets: 4 },
      { group: 'back', tonnage: 1, sets: 30 },
      { group: 'quads', tonnage: 1, sets: 14 },
    ]);

    expect(out).toEqual([
      { group: 'chest', sets: 4, kind: 'low' },
      { group: 'back', sets: 30, kind: 'high' },
    ]);
  });

  it('no avisa de grupos que el usuario no entrena: eso es ruido, no una alerta', () => {
    expect(volumeImbalances([{ group: 'calves', tonnage: 0, sets: 0 }])).toEqual([]);
  });

  it('ignora el cajón "unknown": no se puede opinar de lo que no se sabe qué es', () => {
    expect(volumeImbalances([{ group: 'unknown', tonnage: 100, sets: 2 }])).toEqual([]);
  });

  it('el rango objetivo está declarado y es coherente', () => {
    expect(WEEKLY_SET_RANGE.min).toBeLessThan(WEEKLY_SET_RANGE.max);
  });
});

describe('adherence()', () => {
  const sessions = [
    session('2026-08-24', [set('e', 50, 5)]),
    session('2026-08-26', [set('e', 50, 5)]),
  ];

  it('compara lo hecho con lo planificado', () => {
    // La primera sesión es del 24 y hoy es el 29: 6 días → 1 semana de ventana.
    // 2 sesiones de 4 planificadas → 50 %.
    expect(adherence(sessions, 4, '2026-08-29')).toBe(50);
  });

  it('con historial largo usa la ventana completa de 4 semanas', () => {
    const viejo = [session('2026-07-01', [set('e', 50, 5)]), ...sessions];
    // 4 semanas × 4 = 16 planificadas; solo las 2 de agosto caen dentro → 13 %.
    expect(adherence(viejo, 4, '2026-08-29')).toBe(13);
  });

  /**
   * Un usuario recién instalado se daba de bruces con un 25 %: se le exigían 20 sesiones
   * planificadas en 4 semanas en las que ni siquiera tenía la app (T-834).
   */
  it('no exige sesiones anteriores a la primera que registró', () => {
    const reciente = [session('2026-08-28', [set('e', 50, 5)])];
    // Un solo día de historia → una semana de ventana, no cuatro.
    expect(adherence(reciente, 5, '2026-08-29')).toBe(20);
  });

  it('sin plan declarado devuelve null en vez de un porcentaje inventado', () => {
    expect(adherence(sessions, null, '2026-08-29')).toBeNull();
    expect(adherence(sessions, 0, '2026-08-29')).toBeNull();
  });

  it('sin ninguna sesión real no hay adherencia que calcular', () => {
    expect(adherence([], 4, '2026-08-29')).toBeNull();
  });

  it('no pasa del 100 % aunque entrene de más', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      session(`2026-08-${String((i % 28) + 1).padStart(2, '0')}`, [set('e', 50, 5)]),
    );
    expect(adherence(many, 1, '2026-08-29')).toBe(100);
  });
});

describe('averageDurationMinutes() — RF-PRO-05', () => {
  it('promedia solo las sesiones que registraron duración', () => {
    const out = averageDurationMinutes([
      session('2026-08-24', [], {
        startedAt: '2026-08-24T10:00:00Z',
        endedAt: '2026-08-24T11:00:00Z',
      }),
      session('2026-08-26', []), // sin marcas: se salta, NO cuenta como 0 min
    ]);

    expect(out).toBe(60);
  });

  it('si ninguna la registró devuelve null, no cero', () => {
    expect(averageDurationMinutes([session('2026-08-24', [])])).toBeNull();
  });
});
