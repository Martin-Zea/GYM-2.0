import { AppState, Exercise, ExerciseUnit, Session, SetRecord, WorkoutDay } from '../models/workout.model';

const uid = () => Math.random().toString(36).slice(2, 9);

function seedDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 7);
  return d.toISOString().slice(0, 10);
}

function ex(
  name: string,
  brick: number,
  sets: number,
  repTarget: number,
  rest: number,
  unit: ExerciseUnit = 'kg'
): Exercise {
  return { id: uid(), name, brick, defaultSets: sets, defaultRepTarget: repTarget, restSeconds: rest, unit, notes: '' };
}

function seedSession(dayId: string, exercises: Exercise[], weights: number[][], reps: number[][]): Session {
  const sets: SetRecord[] = [];
  exercises.forEach((e, i) => {
    const ws = weights[i] ?? [];
    const rs = reps[i] ?? [];
    for (let s = 0; s < e.defaultSets; s++) {
      sets.push({
        exerciseId: e.id,
        setIndex: s,
        weight: ws[s] ?? 0,
        reps: rs[s] ?? e.defaultRepTarget,
        target: `${e.defaultSets}x${e.defaultRepTarget}`,
      });
    }
  });
  return { id: uid(), dayId, dateISO: seedDate(), sets };
}

export function createInitialState(): AppState {
  // ── Day 1: Pecho + Triceps + Core ──────────────────────────────────────
  const d1: Exercise[] = [
    ex('Press de Pecho (Maquina)',   2.5, 4,  6, 180),
    ex('Press Inclinado (Mancuernas)', 2, 4,  8, 120, 'kg por mano'),
    ex('Aperturas (Mancuernas)',       2, 4, 12,  90, 'kg por mano'),
    ex('Extension Triceps (Polea)',  2.5, 4, 15,  90),
    ex('Plancha',                      0, 4, 45,  60, 'tiempo'),
  ];

  // ── Day 2: Espalda + Biceps ─────────────────────────────────────────────
  const d2: Exercise[] = [
    ex('Remo en Maquina',      2.5, 4,  6, 180),
    ex('Jalon al Pecho',       2.5, 4,  8, 120),
    ex('Remo Polea Baja',      2.5, 4, 12,  90),
    ex('Pullover (Polea)',     2.5, 4, 12,  90),
    ex('Curl Biceps (Maquina)', 2.5, 4, 15,  90),
  ];

  // ── Day 3: Hombros + Core ───────────────────────────────────────────────
  const d3: Exercise[] = [
    ex('Press Hombros (Maquina)',    2.5, 4,  6, 180),
    ex('Elevaciones Laterales',        2, 4, 12,  90),
    ex('Face Pull',                  2.5, 4, 15,  90),
    ex('Rotacion Externa (Polea)',   2.5, 4, 15,  60),
    ex('Elevaciones de Piernas',       0, 4, 15,  60, 'peso corporal'),
  ];

  // ── Day 4: Espalda + Triceps ────────────────────────────────────────────
  const d4: Exercise[] = [
    ex('Remo Unilateral',      2.5, 4,  6, 180),
    ex('Jalon al Pecho',       2.5, 4, 10, 120),
    ex('Pullover (Polea)',     2.5, 4, 12,  90),
    ex('Press Frances',        2.5, 4, 12,  90),
    ex('Plancha',                0, 4, 45,  60, 'tiempo'),
  ];

  // ── Day 5: Pierna ───────────────────────────────────────────────────────
  const d5: Exercise[] = [
    ex('Prensa',                 10, 4,  6, 180),
    ex('Extension Cuadriceps', 2.5, 4, 12, 120),
    ex('Curl Femoral',         2.5, 4, 12,  90),
    ex('Gemelos',                5, 4, 20,  60),
    ex('Crunch',                 0, 4, 25,  60, 'peso corporal'),
  ];

  const days: WorkoutDay[] = [
    { id: uid(), name: 'Pecho + Triceps + Core',  exercises: d1 },
    { id: uid(), name: 'Espalda + Biceps',         exercises: d2 },
    { id: uid(), name: 'Hombros + Core',            exercises: d3 },
    { id: uid(), name: 'Espalda + Triceps',         exercises: d4 },
    { id: uid(), name: 'Pierna',                    exercises: d5 },
  ];

  const sessions: Session[] = [
    seedSession(days[0].id, d1,
      [[32.5,35,37.5,40],[12,14,16,18],[10,10,12,12],[15,17.5,20,22.5],[0,0,0,0]],
      [[6,6,6,5],[8,8,8,8],[10,10,10,12],[12,12,12,15],[30,35,40,45]]
    ),
    seedSession(days[1].id, d2,
      [[37.5,40,42.5,45],[32.5,35,37.5,40],[25,27.5,30,32.5],[20,22.5,25,27.5],[15,17.5,20,22.5]],
      [[6,6,6,5],[8,8,8,8],[10,10,10,12],[10,10,10,12],[12,12,12,15]]
    ),
    seedSession(days[2].id, d3,
      [[22.5,25,27.5,30],[10,12,14,16],[15,17.5,20,22.5],[5,7.5,10,10],[0,0,0,0]],
      [[6,6,6,5],[10,10,10,12],[12,12,12,15],[15,15,15,15],[12,12,15,15]]
    ),
    seedSession(days[3].id, d4,
      [[17.5,20,22.5,25],[30,32.5,35,37.5],[20,22.5,25,27.5],[15,17.5,20,22.5],[0,0,0,0]],
      [[6,6,6,6],[8,8,8,10],[10,10,10,12],[10,10,10,12],[30,35,40,45]]
    ),
    seedSession(days[4].id, d5,
      [[80,90,100,110],[25,27.5,30,32.5],[20,22.5,25,27.5],[45,50,55,60],[0,0,0,0]],
      [[6,6,6,5],[10,10,10,12],[10,10,10,12],[15,15,15,20],[20,20,25,25]]
    ),
  ];

  return {
    schemaVersion: 3,
    days,
    sessions,
    activeDayIndex: 0,
    routinePointer: 0,
    todayProgress: {},
    settings: {
      apiKey: '',
      defaultRest: 60,
      sounds: true,
      theme: 'dark',
      userProfile: { weightKg: null, heightCm: null, age: null, sex: null },
    },
  };
}
