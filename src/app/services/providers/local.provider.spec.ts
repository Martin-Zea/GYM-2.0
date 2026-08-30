import { LocalProvider } from './local.provider';
import { Exercise, SetRecord, TrainingLevel, UserProfile } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';

const REPS = 10;
const SETS = 3;

function exercise(over: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    name: 'Press banca',
    brick: 2.5,
    defaultSets: SETS,
    defaultRepTarget: REPS,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
    ...over,
  };
}

function profile(level: TrainingLevel | null): UserProfile {
  return {
    weightKg: null,
    heightCm: null,
    age: null,
    sex: null,
    weightLog: [],
    goal: null,
    level,
    equipment: null,
    daysPerWeek: null,
    aiNotes: '',
  };
}

function setsAt(weight: number, reps: number, n = SETS): SetRecord[] {
  return Array.from({ length: n }, (_, i) => ({
    exerciseId: 'ex1',
    setIndex: i,
    weight,
    reps,
  }));
}

function history(pairs: [number, number][]): HistoryEntry[] {
  return pairs.map(([w, r], i) => ({
    dateISO: `2026-05-${String(i + 1).padStart(2, '0')}`,
    sets: setsAt(w, r),
    topWeight: w,
    topReps: r,
    totalReps: r * SETS,
    volume: w * r * SETS,
  }));
}

/**
 * Escenarios completos del motor local (T-302, RF-IA-01).
 *
 * Fixtures de historial reales: progreso, meseta, regresión y sesión marcada como dura. Es el
 * corazón que funciona sin key y sin red, así que se prueba por su decisión final, no por sus
 * piezas — las piezas están en `progression-rules.spec.ts`.
 */
describe('Motor de progresión local — escenarios', () => {
  const engine = new LocalProvider();

  const run = (
    hist: HistoryEntry[],
    level: TrainingLevel | null = null,
    opts: Parameters<LocalProvider['compute']>[7] = {},
  ) => {
    const last = hist.length ? hist[hist.length - 1].sets : null;
    return engine.compute(exercise(), [], last, hist, profile(level), null, 'es', opts);
  };

  describe('progreso', () => {
    it('primera vez cumpliendo: sube solo las últimas series, no todas', () => {
      const rec = run(
        history([
          [47.5, 10],
          [50, 10],
        ]),
      );

      expect(rec.sets[0].weight).toBe(50);
      expect(rec.sets[SETS - 1].weight).toBe(52.5);
    });

    it('confirmado dos sesiones seguidas: suben todas las series', () => {
      const rec = run(
        history([
          [50, 10],
          [50, 10],
        ]),
      );

      expect(rec.sets.every((s) => s.weight === 52.5)).toBe(true);
    });

    it('un principiante sube ya en la primera confirmación (lineal agresiva, §3)', () => {
      const hist = history([
        [47.5, 10],
        [50, 10],
      ]);

      const novato = run(hist, 'beginner');
      const intermedio = run(hist, 'intermediate');

      expect(novato.sets.every((s) => s.weight === 52.5)).toBe(true);
      expect(intermedio.sets[0].weight).toBe(50);
    });
  });

  describe('regresión', () => {
    it('dos sesiones seguidas sin cerrar el objetivo bajan el peso', () => {
      const rec = run(
        history([
          [50, 10],
          [55, 6],
          [55, 5],
        ]),
      );

      expect(rec.sets[0].weight).toBeLessThan(55);
      expect(rec.reason).toMatch(/sin cerrar el objetivo/i);
    });

    it('el recorte es mayor para un avanzado que para un principiante (§3)', () => {
      const hist = history([
        [100, 10],
        [100, 6],
        [100, 5],
      ]);

      const novato = run(hist, 'beginner');
      const avanzado = run(hist, 'advanced');

      expect(novato.sets[0].weight).toBeGreaterThan(avanzado.sets[0].weight);
    });

    it('fallar UNA sola sesión no baja el peso: una mala noche no es una tendencia', () => {
      const rec = run(
        history([
          [50, 10],
          [50, 10],
          [52.5, 7],
        ]),
      );

      expect(rec.sets[0].weight).toBeGreaterThanOrEqual(52.5);
    });
  });

  describe('meseta y estancamiento', () => {
    it('fallar y no mover la marca en 3 sesiones dispara la descarga (§4.5)', () => {
      const rec = run(
        history([
          [60, 7],
          [60, 6],
          [60, 6],
        ]),
      );

      expect(rec.sets[0].weight).toBeLessThan(60);
      expect(rec.reason).toMatch(/descarga|sin avanzar/i);
    });

    it('cumplir el objetivo 3 sesiones al mismo peso NO es estancarse: toca subir', () => {
      // Estancarse es no avanzar a pesar de intentarlo. Quien completa todo cada sesión
      // no necesita una descarga: necesita más peso.
      const rec = run(
        history([
          [50, 10],
          [50, 10],
          [50, 10],
        ]),
      );

      expect(rec.sets.every((s) => s.weight >= 50)).toBe(true);
      expect(rec.sets.some((s) => s.weight > 50)).toBe(true);
      expect(rec.reason).not.toMatch(/descarga/i);
    });

    it('un solo fallo con la marca parada sostiene el peso y sugiere cambiar el esquema', () => {
      const rec = run(
        history([
          [50, 10],
          [50, 10],
          [50, 7],
        ]),
      );

      expect(rec.sets.every((s) => s.weight === 50)).toBe(true);
      expect(rec.reason).toMatch(/meseta/i);
    });

    it('una racha larga de subidas propone descarga preventiva', () => {
      const rec = run(history([...Array(7)].map((_, i) => [40 + i * 2.5, 10] as [number, number])));

      expect(rec.reason).toMatch(/descarga/i);
      expect(rec.sets[0].weight).toBeLessThan(55);
    });
  });

  describe('sensación registrada (RPE simplificado)', () => {
    it('si la última costó, consolida en vez de subir aunque salgan las reps (§4.5)', () => {
      const hist = history([
        [50, 10],
        [50, 10],
      ]);

      const normal = run(hist);
      const duro = run(hist, null, { lastFeel: 'hard' });

      expect(normal.sets[0].weight).toBe(52.5);
      expect(duro.sets.every((s) => s.weight === 50)).toBe(true);
      expect(duro.reason).toMatch(/pesada/i);
    });

    it("marcarla como 'fácil' no bloquea nada", () => {
      const rec = run(
        history([
          [50, 10],
          [50, 10],
        ]),
        null,
        { lastFeel: 'easy' },
      );

      expect(rec.sets.every((s) => s.weight === 52.5)).toBe(true);
    });
  });

  describe('sin datos', () => {
    it('sin historial propone un punto de partida y lo explica', () => {
      const rec = engine.compute(exercise(), [], null, [], profile(null), null, 'es');

      expect(rec.sets).toHaveLength(SETS);
      expect(rec.source).toBe('local');
      expect(rec.reason).toMatch(/primera sesión/i);
    });
  });
});

describe('Volver tras un parón — el motor local coincide con el validador (T-812)', () => {
  const engine = new LocalProvider();

  /** 100 kg cumpliendo el objetivo, y la última sesión hace `daysAgo` días. */
  function afterLayoff(daysAgo: number) {
    const last = new Date();
    last.setDate(last.getDate() - daysAgo);
    const iso = last.toISOString().slice(0, 10);
    const hist: HistoryEntry[] = [
      {
        dateISO: iso,
        sets: setsAt(100, REPS),
        topWeight: 100,
        topReps: REPS,
        totalReps: REPS * SETS,
        volume: 100 * REPS * SETS,
      },
    ];
    return engine.compute(exercise(), [], hist[0].sets, hist, profile(null), iso, 'es', {});
  }

  it('tres meses parado tras levantar 100 kg propone 85, no 95', () => {
    // El recorte fijo de dos incrementos daba 95 kg: demasiado para tres meses sin entrenar,
    // y además no era lo que el validador permitía si contestaba la IA.
    expect(afterLayoff(90).sets[0].weight).toBe(85);
  });

  it('tres semanas paradas recortan menos que tres meses', () => {
    const tresSemanas = afterLayoff(21).sets[0].weight;
    const tresMeses = afterLayoff(90).sets[0].weight;
    expect(tresSemanas).toBe(90);
    expect(tresMeses).toBeLessThan(tresSemanas);
  });

  it('entrenando con normalidad no se recorta nada por espaciado', () => {
    expect(afterLayoff(3).sets[0].weight).toBeGreaterThanOrEqual(100);
  });

  it('explica el motivo: el atleta tiene que entender por qué baja', () => {
    const { reason } = afterLayoff(90);
    expect(reason).toContain('85'); // el peso que se propone
    expect(reason).toMatch(/sin entrenar/i); // y por qué es más bajo
  });
});

describe('Molestia declarada — el motor local también escucha (T-816)', () => {
  const local = new LocalProvider();

  function withNote(aiNotes: string): UserProfile {
    return { ...profile(null), aiNotes };
  }

  it('sin molestia declarada, cumplir el objetivo sube el peso', () => {
    const rec = local.compute(exercise(), [], setsAt(50, REPS), [], withNote(''));
    expect(Math.max(...rec.sets.map((s) => s.weight))).toBeGreaterThan(50);
  });

  it('una molestia en ESE ejercicio impide subir, aunque las reps salgan', () => {
    // Antes esto solo lo respetaba la IA: el motor local no leía las notas y te mandaba
    // subir el mismo día que le contabas al coach que te dolía.
    const rec = local.compute(
      exercise(),
      [],
      setsAt(50, REPS),
      [],
      withNote('me molesta el hombro en press banca'),
    );
    expect(Math.max(...rec.sets.map((s) => s.weight))).toBe(50);
    expect(rec.reason).toMatch(/molestia/i);
  });

  it('pone un TECHO, no baja el peso: una molestia no es motivo para descargar', () => {
    const rec = local.compute(
      exercise(),
      [],
      setsAt(50, REPS),
      [],
      withNote('cuidado con press banca'),
    );
    expect(rec.sets.every((s) => s.weight === 50)).toBe(true);
  });

  it('una molestia en otro ejercicio no lo toca', () => {
    const rec = local.compute(
      exercise(),
      [],
      setsAt(50, REPS),
      [],
      withNote('me molesta la rodilla en sentadilla'),
    );
    expect(Math.max(...rec.sets.map((s) => s.weight))).toBeGreaterThan(50);
  });

  it('en peso corporal no aplica: ahí el techo sería un 0 kg sin sentido', () => {
    const bw = exercise({ unit: 'BODYWEIGHT' });
    const rec = local.compute(bw, [], setsAt(0, REPS), [], withNote('press banca me molesta'));
    expect(rec.sets[0].reps).toBeGreaterThan(REPS);
  });

  it('sin referencia previa no hay techo que poner', () => {
    const rec = local.compute(exercise(), [], null, [], withNote('press banca me molesta'));
    expect(rec.sets[0].weight).toBeGreaterThan(0);
  });
});

describe('El parón manda sobre la forma de las series (T-821)', () => {
  const local = new LocalProvider();
  const HACE_60_DIAS = new Date(Date.now() - 60 * 86400000).toISOString().slice(0, 10);
  const HACE_3_DIAS = new Date(Date.now() - 3 * 86400000).toISOString().slice(0, 10);

  /** Las últimas series EXACTAS del reporte: 25×6 / 25×6 / 30×6 / 35×10. */
  function setsDelReporte(): SetRecord[] {
    return [
      { exerciseId: 'ex1', setIndex: 0, weight: 25, reps: 6 },
      { exerciseId: 'ex1', setIndex: 1, weight: 25, reps: 6 },
      { exerciseId: 'ex1', setIndex: 2, weight: 30, reps: 6 },
      { exerciseId: 'ex1', setIndex: 3, weight: 35, reps: 10 },
    ];
  }

  it('series asimétricas + 60 días parado = peso reducido, NO "saltamos 2 ladrillos"', () => {
    // El bug del reporte: la rama de pirámide retornaba antes de mirar la fecha, y a quien
    // volvía de dos meses le proponía subir a 45kg. La fecha se evalúa primero.
    const rec = local.compute(exercise(), [], setsDelReporte(), [], profile(null), HACE_60_DIAS);

    const top = Math.max(...rec.sets.map((s) => s.weight));
    expect(top).toBeLessThan(35); // 85% de 35 = 29.75 → al ladrillo hacia abajo
    expect(rec.sets.every((s) => s.weight === top)).toBe(true); // vuelta a peso uniforme
    expect(rec.reason).not.toMatch(/ladrillos/);
  });

  it('sin parón, las mismas series asimétricas siguen siendo una pirámide', () => {
    const rec = local.compute(exercise(), [], setsDelReporte(), [], profile(null), HACE_3_DIAS);
    expect(new Set(rec.sets.map((s) => s.weight)).size).toBeGreaterThan(1);
  });

  it('el resultado coincide con el techo del validador: los dos motores dicen lo mismo', () => {
    const rec = local.compute(exercise(), [], setsDelReporte(), [], profile(null), HACE_60_DIAS);
    expect(Math.max(...rec.sets.map((s) => s.weight))).toBeLessThanOrEqual(35 * 0.85);
  });

  it('en TIEMPO el parón recorta el objetivo de segundos', () => {
    const plancha = exercise({ unit: 'TIME', defaultRepTarget: 60, brick: 5 });
    const hechas = [{ exerciseId: 'ex1', setIndex: 0, weight: 0, reps: 60 }];
    const rec = local.compute(plancha, [], hechas, [], profile(null), HACE_60_DIAS);
    expect(rec.sets[0].reps).toBeLessThan(60);
  });

  it('en PESO CORPORAL el parón recorta el objetivo de reps', () => {
    const dominadas = exercise({ unit: 'BODYWEIGHT', defaultRepTarget: 17 });
    const hechas = [{ exerciseId: 'ex1', setIndex: 0, weight: 0, reps: 17 }];
    const rec = local.compute(dominadas, [], hechas, [], profile(null), HACE_60_DIAS);
    expect(rec.sets[0].reps).toBeLessThan(17); // 17 × 0.85 ≈ 14
    expect(rec.sets[0].reps).toBeGreaterThan(0);
  });

  it('la primera sesión de un ejercicio nuevo no se recorta: no hay marca que proteger', () => {
    const rec = local.compute(exercise(), [], null, [], profile(null), HACE_60_DIAS);
    expect(rec.sets[0].weight).toBeGreaterThan(0);
    expect(rec.reason).toMatch(/Primera/);
  });
});
