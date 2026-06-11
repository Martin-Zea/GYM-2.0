import { TestBed } from '@angular/core/testing';
import { ProgressionService } from './progression.service';
import { AppSettings, Exercise, SetRecord } from '../models/workout.model';

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
    theme: 'dark',
    userProfile: { weightKg: null, heightCm: null, age: null, sex: null, weightLog: [] },
    ...overrides,
  };
}

function lastSetsAt(weight: number, reps: number, count = 3): SetRecord[] {
  return Array.from({ length: count }, (_, i) => ({ exerciseId: 'ex1', setIndex: i, weight, reps }));
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
    it('sin historial usa los defaults del ejercicio (peso 0, repTarget)', () => {
      const rec = service.localRecommendation(makeExercise(), [], null);
      expect(rec.source).toBe('local');
      expect(rec.sets).toEqual([
        { weight: 0, reps: 10 },
        { weight: 0, reps: 10 },
        { weight: 0, reps: 10 },
      ]);
    });

    it('objetivo cumplido: sube 1 brick en las últimas 2 series', () => {
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
      expect(rec.sets.every(s => s.weight === 17.5)).toBe(true);
      expect(rec.sets.every(s => s.reps === 13)).toBe(true); // round(10 * 1.3)
    });

    it('completion 80-99%: repite el mismo peso con el rep target', () => {
      // 24 reps de 30 posibles → ratio 0.8
      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(20, 8));
      expect(rec.sets.every(s => s.weight === 20 && s.reps === 10)).toBe(true);
    });
  });

  describe('normalización de la respuesta IA (via recommend con fetch mockeado)', () => {
    const settings = makeSettings({ apiKey: 'test-key' });

    it('ajusta la cantidad de sets al objetivo y redondea pesos al brick', async () => {
      // La IA devuelve 2 sets para un objetivo de 3, con un peso fuera de brick
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse(
        JSON.stringify({ sets: [{ weight: 20, reps: 10 }, { weight: 22.6, reps: 10 }], reason: 'ok' }),
      )));

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('groq');
      expect(rec.sets.length).toBe(3);
      expect(rec.sets[1].weight).toBe(22.5); // 22.6 redondeado al brick
      expect(rec.sets[2]).toEqual(rec.sets[1]); // se replica el último set válido
    });

    it('descarta sets sin weight/reps numéricos', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse(
        JSON.stringify({
          sets: [
            { weight: '20', reps: 10 },   // weight string → descartado
            { weight: 25, reps: null },   // reps no numérico → descartado
            { weight: 25, reps: 8 },      // válido
          ],
          reason: 'ok',
        }),
      )));

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
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse(
        JSON.stringify({ sets: [{ weight: 'mucho', reps: 'pocas' }], reason: 'x' }),
      )));

      const rec = await service.recommend(settings, makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('local');
      expect(rec.reason).toContain('modo offline');
    });

    it('sin API keys no llama a fetch y usa la recomendación local', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const rec = await service.recommend(makeSettings(), makeExercise(), [], lastSetsAt(20, 10), []);
      expect(rec.source).toBe('local');
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
