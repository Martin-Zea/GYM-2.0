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
  // ── Day 1: Pecho y Tríceps ──────────────────────────────────────────────
  const d1: Exercise[] = [
    ex('Press de Pecho (Máquina)',    2.5, 4,  6, 180),
    ex('Press Inclinado (Máquina)',   2.5, 3,  8, 120),
    ex('Cruce/Aperturas (Máquina)',   2.5, 3, 10,  90),
    ex('Extensión Tríceps (Polea)',   2.5, 3, 12,  90),
  ];

  // ── Day 2: Espalda y Bíceps ─────────────────────────────────────────────
  const d2: Exercise[] = [
    ex('Remo en Máquina (Sentado)',   2.5, 4,  6, 180),
    ex('Jalón al Pecho (Polea Alta)', 2.5, 3,  8, 120),
    ex('Remo Polea Baja',             2.5, 3, 10,  90),
    ex('Curl de Bíceps (Máquina)',    2.5, 3, 12,  90),
  ];

  // ── Day 3: Hombros y Core ───────────────────────────────────────────────
  const d3: Exercise[] = [
    ex('Press de Hombros (Máquina)',       2.5, 4,  6, 180),
    ex('Elevaciones Laterales (Máquina)',  2.5, 3,  8, 120),
    ex('Pájaros (Face Pulls)',             2.5, 3, 10,  90),
    ex('Abdominal (Crunch Máquina)',       2.5, 3, 15,  60),
  ];

  // ── Day 4: Espalda (Auxiliar) y Tríceps ────────────────────────────────
  const d4: Exercise[] = [
    ex('Remo Unilateral (Máquina)',      2.5, 4,  6, 180, 'kg por brazo'),
    ex('Jalón en P (Polea Alta)',         2.5, 3,  8, 120),
    ex('Press Francés (Máquina)',         2.5, 3, 10,  90),
    ex('Curl Martillo (Máquina/Polea)',   2.5, 3, 12,  90),
  ];

  // ── Day 5: Pierna ───────────────────────────────────────────────────────
  const d5: Exercise[] = [
    ex('Prensa de Piernas',        5, 4,  6, 180),
    ex('Extensión Cuádriceps',   2.5, 3, 10, 120),
    ex('Curl Femoral (Acostado)', 2.5, 3, 10,  90),
    ex('Elevación Gemelos',         5, 4, 15,  60),
  ];

  const days: WorkoutDay[] = [
    { id: uid(), name: 'Pecho y Tríceps',                exercises: d1 },
    { id: uid(), name: 'Espalda y Bíceps',               exercises: d2 },
    { id: uid(), name: 'Hombros y Core',                  exercises: d3 },
    { id: uid(), name: 'Espalda (Auxiliar) y Tríceps',   exercises: d4 },
    { id: uid(), name: 'Pierna',                          exercises: d5 },
  ];

  const sessions: Session[] = [
    seedSession(days[0].id, d1,
      [[30,30,30,30], [20,20,20], [20,20,20], [15,15,15]],
      [[6,6,6,6],     [8,8,8],    [10,10,10], [12,12,12]]
    ),
    seedSession(days[1].id, d2,
      [[35,35,35,35], [30,30,30], [25,25,25], [15,15,15]],
      [[6,6,6,6],     [8,8,8],    [10,10,10], [12,12,12]]
    ),
    seedSession(days[2].id, d3,
      [[20,20,20,20], [10,10,10], [15,15,15], [20,20,20]],
      [[6,6,6,6],     [8,8,8],    [10,10,10], [15,15,15]]
    ),
    seedSession(days[3].id, d4,
      [[15,15,15,15], [25,25,25], [15,15,15], [12,12,12]],
      [[6,6,6,6],     [8,8,8],    [10,10,10], [12,12,12]]
    ),
    seedSession(days[4].id, d5,
      [[70,70,70,70], [25,25,25], [20,20,20], [40,40,40,40]],
      [[6,6,6,6],     [10,10,10], [10,10,10], [15,15,15,15]]
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
      cohereApiKey: '',
      defaultRest: 60,
      sounds: true,
      theme: 'dark',
      userProfile: { weightKg: null, heightCm: null, age: null, sex: null },
    },
  };
}
