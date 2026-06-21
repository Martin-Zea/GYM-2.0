import { TestBed } from '@angular/core/testing';
import { ProgressionService } from './progression.service';
import { AppSettings, Exercise, SetRecord, TodaySetProgress } from '../models/workout.model';
import { StorageService } from './storage.service';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    name: 'Press de Pecho',
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit: 'kg',
    notes: '',
    ...overrides,
  };
}

function makeSettings(overrides: Partial<AppSettings> = {}): AppSettings {
  return {
    apiKey: '',
    cohereApiKey: '',
    defaultRest: 60,
    sounds: true,
    haptics: true,
    theme: 'dark',
    userProfile: { weightKg: null, heightCm: null, age: null, sex: null, weightLog: [], goal: null, aiNotes: '' },
    ...overrides,
  };
}

function makeDoneSet(weight: number, reps: number): TodaySetProgress {
  return { weight, reps, done: true };
}

function lastSetsAt(weight: number, reps: number, count = 3): SetRecord[] {
  return Array.from({ length: count }, (_, i) => ({
    exerciseId: 'ex1',
    setIndex: i,
    weight,
    reps,
  }));
}

/** Respuesta con la forma de la API de Groq cuyo content es el JSON dado */
function groqResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

describe('ProgressionService', () => {
  let service: ProgressionService;

  beforeEach(() => {
    localStorage.clear(); // limpia también el cache IA (gym_ai_cache_v1)
    service = TestBed.inject(ProgressionService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('localRecommendation()', () => {
    it('sin historial sugiere un peso estimado (no cero con perfil) o cero sin perfil', () => {
      const rec = service.localRecommendation(makeExercise(), [], null);
      expect(rec.source).toBe('local');
      // Sin userProfile.weightKg devuelve brick*4 = 10
      expect(rec.sets.length).toBe(3);
      expect(rec.sets.every((s) => s.reps === 10)).toBe(true);
    });

    it('objetivo cumplido (primera vez): sube 1 brick solo en las últimas 2 series', () => {
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 10));
      expect(rec.sets).toEqual([
        { weight: 20, reps: 10 },
        { weight: 22.5, reps: 10 },
        { weight: 22.5, reps: 10 },
      ]);
    });

    it('el peso recomendado queda redondeado al brick', () => {
      // top 21kg + brick 2.5 = 23.5 → redondea a 22.5 (múltiplo de 2.5)
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(21, 10));
      for (const s of rec.sets.slice(1)) {
        expect(s.weight % 2.5).toBe(0);
      }
      expect(rec.sets[2].weight).toBe(22.5);
    });

    it('completion < 50%: baja 1 brick y sube reps ~30%', () => {
      // 3 reps de 30 posibles → ratio 0.1
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 1));
      expect(rec.sets.every((s) => s.weight === 17.5)).toBe(true);
      expect(rec.sets.every((s) => s.reps === 13)).toBe(true); // round(10 * 1.3)
    });

    it('completion 80-99%: repite el mismo peso con el rep target', () => {
      // 24 reps de 30 posibles → ratio 0.8
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 8));
      expect(rec.sets.every((s) => s.weight === 20 && s.reps === 10)).toBe(true);
    });

    it('doble progresión: si confirmó 100% dos sesiones seguidas sube todas las series', () => {
      const history = [
        {
          dateISO: '2026-06-05',
          sets: lastSetsAt(20, 10),
          topWeight: 20,
          topReps: 10,
          totalReps: 30,
          volume: 600,
        },
        {
          dateISO: '2026-06-12',
          sets: lastSetsAt(20, 10),
          topWeight: 20,
          topReps: 10,
          totalReps: 30,
          volume: 600,
        },
      ];
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 10), history);
      expect(rec.sets.every((s) => s.weight === 22.5)).toBe(true);
    });

    it('deload: 4+ sesiones consecutivas subiendo peso', () => {
      const history = [
        {
          dateISO: '2026-05-01',
          sets: lastSetsAt(15, 10),
          topWeight: 15,
          topReps: 10,
          totalReps: 30,
          volume: 450,
        },
        {
          dateISO: '2026-05-08',
          sets: lastSetsAt(17.5, 10),
          topWeight: 17.5,
          topReps: 10,
          totalReps: 30,
          volume: 525,
        },
        {
          dateISO: '2026-05-15',
          sets: lastSetsAt(20, 10),
          topWeight: 20,
          topReps: 10,
          totalReps: 30,
          volume: 600,
        },
        {
          dateISO: '2026-05-22',
          sets: lastSetsAt(22.5, 10),
          topWeight: 22.5,
          topReps: 10,
          totalReps: 30,
          volume: 675,
        },
      ];
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(22.5, 10), history);
      expect(rec.reason).toContain('descarga');
      expect(rec.sets[0].weight).toBeLessThan(22.5);
    });

    it('super-completado: salta 2 ladrillos cuando reps >= 150% del objetivo', () => {
      const lastSets: SetRecord[] = [
        { exerciseId: 'ex1', setIndex: 0, weight: 25, reps: 10 },
        { exerciseId: 'ex1', setIndex: 1, weight: 25, reps: 10 },
        { exerciseId: 'ex1', setIndex: 2, weight: 25, reps: 18 }, // 180% del target (10)
      ];
      const rec = service.localRecommendation(makeExercise(), [], lastSets);
      expect(rec.sets[0].weight).toBe(30); // +2 ladrillos (25 + 2×2.5)
      expect(rec.sets.every((s) => s.weight === 30)).toBe(true);
      expect(rec.reason).toMatch(/liviano|light/i);
    });

    it('sesión espaciada >14 días: reduce un brick', () => {
      const lastDate = new Date();
      lastDate.setDate(lastDate.getDate() - 20);
      const lastSessionDate = lastDate.toISOString().slice(0, 10);
      const rec = service.localRecommendation(
        makeExercise(),
        [],
        lastSetsAt(20, 10),
        [],
        undefined,
        lastSessionDate,
      );
      expect(rec.sets[0].weight).toBe(17.5);
      expect(rec.reason).toContain('días');
    });
  });

  describe('normalización de la respuesta IA (via recommend con fetch mockeado)', () => {
    const settings = makeSettings({ apiKey: 'test-key' });

    it('ajusta la cantidad de sets al objetivo y redondea pesos al brick', async () => {
      // La IA devuelve 2 sets para un objetivo de 3, con un peso fuera de brick
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          groqResponse(
            JSON.stringify({
              sets: [
                { weight: 20, reps: 10 },
                { weight: 22.6, reps: 10 },
              ],
              reason: 'ok',
            }),
          ),
        ),
      );

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('groq');
      expect(rec.sets.length).toBe(3);
      expect(rec.sets[1].weight).toBe(22.5); // 22.6 redondeado al brick
      expect(rec.sets[2]).toEqual(rec.sets[1]); // se replica el último set válido
    });

    it('descarta sets sin weight/reps numéricos', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue(
          groqResponse(
            JSON.stringify({
              sets: [
                { weight: '20', reps: 10 }, // weight string → descartado
                { weight: 25, reps: null }, // reps no numérico → descartado
                { weight: 25, reps: 8 }, // válido
              ],
              reason: 'ok',
            }),
          ),
        ),
      );

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('groq');
      expect(rec.sets).toEqual([
        { weight: 25, reps: 8 },
        { weight: 25, reps: 8 },
        { weight: 25, reps: 8 },
      ]);
    });

    it('ante JSON inválido cae al fallback local en modo offline', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('esto no es JSON')));

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('local');
      expect(rec.reason).toContain('modo offline');
    });

    it('ante respuesta sin ningún set válido cae al fallback local', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => {});
      vi.stubGlobal(
        'fetch',
        vi
          .fn()
          .mockResolvedValue(
            groqResponse(
              JSON.stringify({ sets: [{ weight: 'mucho', reps: 'pocas' }], reason: 'x' }),
            ),
          ),
      );

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('local');
      expect(rec.reason).toContain('modo offline');
    });

    it('con navigator.onLine=false no llama a fetch y retorna local inmediatamente', async () => {
      vi.stubGlobal('navigator', { onLine: false });
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('local');
      expect(rec.reason).toContain('modo offline');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin API keys no llama a fetch y usa la recomendación local', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const rec = await service.recommend(
        makeSettings(),
        makeExercise(),
        [],
        lastSetsAt(20, 10),
        [],
      );
      expect(rec.source).toBe('local');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('localRecommendation() — casos de ratio 50-79%', () => {
    it('50-79%: repite el mismo peso con el rep target y mensaje de consolidación', () => {
      // 3 sets × 5 reps = 15 / (3 × 10) = 0.5 → rama consolidar
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 5));
      expect(rec.sets.every((s) => s.weight === 20 && s.reps === 10)).toBe(true);
      expect(rec.reason).toContain('consolidando');
    });

    it('70%: también cae en la rama 50-79% (no baja peso)', () => {
      // 3 sets × 7 reps = 21 / 30 = 0.7
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 7));
      expect(rec.sets.every((s) => s.weight === 20)).toBe(true);
      expect(rec.sets.every((s) => s.reps === 10)).toBe(true);
    });
  });

  describe('localRecommendation() — prioridad todaySets sobre lastSets', () => {
    it('si todaySets tiene sets hechos, los usa en lugar de lastSets', () => {
      // todaySets: completó 3 series a 30kg (100% objetivo)
      const todaySets = [makeDoneSet(30, 10), makeDoneSet(30, 10), makeDoneSet(30, 10)];
      // lastSets: sesión previa a 20kg (no debe usarse como base)
      const rec = service.localRecommendation(makeExercise(), todaySets, lastSetsAt(20, 10));
      // La base es 30kg → sube brick (sin doble progresión confirmada, últimas 2 series)
      expect(rec.sets[rec.sets.length - 1].weight).toBe(32.5);
    });

    it('si todaySets está vacío, cae en lastSets normalmente', () => {
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 10));
      // Completó al 100% → sube las últimas 2 series a 22.5
      expect(rec.sets[rec.sets.length - 1].weight).toBe(22.5);
    });
  });

  describe('caché de IA (via recommend())', () => {
    const settings = makeSettings({ apiKey: 'test-key' });
    const history = [
      { dateISO: '2026-06-01', sets: [], topWeight: 20, topReps: 10, totalReps: 30, volume: 200 },
    ];

    it('segundo recommend() con mismos parámetros no llama a fetch (cache hit)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        groqResponse(
          JSON.stringify({
            sets: [
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
            ],
            reason: 'ok',
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history);
      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history);

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('cache miss si cambia la fecha (cachedForDate difiere)', async () => {
      const storage = TestBed.inject(StorageService);
      vi.spyOn(storage, 'todayISO').mockReturnValue('2026-06-10');

      const fetchMock = vi.fn().mockResolvedValue(
        groqResponse(
          JSON.stringify({
            sets: [
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
            ],
            reason: 'ok',
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history);

      // Simulamos que el día cambió
      vi.spyOn(storage, 'todayISO').mockReturnValue('2026-06-11');
      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('cache miss si cambia la última sesión del historial (lastSessionISO difiere)', async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        groqResponse(
          JSON.stringify({
            sets: [
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
              { weight: 22.5, reps: 10 },
            ],
            reason: 'ok',
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      const history1 = [
        { dateISO: '2026-06-01', sets: [], topWeight: 20, topReps: 10, totalReps: 30, volume: 200 },
      ];
      const history2 = [
        ...history1,
        {
          dateISO: '2026-06-08',
          sets: [],
          topWeight: 22.5,
          topReps: 10,
          totalReps: 30,
          volume: 225,
        },
      ];

      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history1);
      await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), history2);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });
});
