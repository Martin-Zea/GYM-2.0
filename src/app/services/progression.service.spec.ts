import { TestBed } from '@angular/core/testing';
import { ProgressionService, effectiveLastSession } from './progression.service';
import { AppSettings, Exercise, SetRecord, TodaySetProgress } from '../models/workout.model';
import { StorageService } from './storage.service';
import { AiShadowLogService, SHADOW_MODELS } from './ai-shadow-log.service';
import { GROQ_MODEL } from './providers/groq.provider';
import { STORAGE_KEYS } from './storage-keys';

function makeExercise(overrides: Partial<Exercise> = {}): Exercise {
  return {
    id: 'ex1',
    name: 'Press de Pecho',
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit: 'KG',
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
    userProfile: {
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
    },
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
    // El shadow logging es una feature ortogonal (ver specs/ai-shadow-log.md) — se
    // no-opea acá para que los tests de recommend() no se vean afectados por los
    // fetch adicionales que dispararía. Tiene su propio describe block más abajo.
    vi.spyOn(TestBed.inject(AiShadowLogService), 'maybeRecord').mockImplementation(() => {});
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

    it('deload preventivo: racha de progreso del largo que pide el nivel', () => {
      // Nivel por defecto (intermedio): 6 sesiones seguidas subiendo antes de descargar
      const history = Array.from({ length: 7 }, (_, i) => {
        const w = 15 + i * 2.5;
        return {
          dateISO: `2026-05-0${i + 1}`,
          sets: lastSetsAt(w, 10),
          topWeight: w,
          topReps: 10,
          totalReps: 30,
          volume: w * 30,
        };
      });
      const top = history[history.length - 1].topWeight;

      const rec = service.localRecommendation(makeExercise(), [], lastSetsAt(top, 10), history);

      expect(rec.reason).toContain('descarga');
      expect(rec.sets[0].weight).toBeLessThan(top);
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

  // ── Sugerencias precalculadas: caducar por datos, no por calendario (T-815, T-817) ──

  describe('effectiveLastSession()', () => {
    it('sin parón declarado manda el registro', () => {
      expect(effectiveLastSession('2026-08-23', null)).toBe('2026-08-23');
    });

    it('el parón declarado gana cuando es MÁS antiguo que el registro', () => {
      // El caso real: el log dice que entrenaste la semana pasada porque quedó una sesión
      // suelta, y vos sabés que no pisás el gimnasio desde junio.
      expect(effectiveLastSession('2026-08-23', '2026-06-30')).toBe('2026-06-30');
    });

    it('declarar un parón no vuelve reciente un ejercicio abandonado hace un año', () => {
      expect(effectiveLastSession('2025-08-30', '2026-06-30')).toBe('2025-08-30');
    });

    it('sin registro no hay nada que recortar', () => {
      expect(effectiveLastSession(null, '2026-06-30')).toBeNull();
    });

    it('una sesión POSTERIOR a la declaración le gana: es entrenamiento real de vuelta (T-827)', () => {
      // Declaró el 30/08; entrenó (de verdad) el 31/08 → ese ejercicio progresa normal.
      expect(effectiveLastSession('2026-08-31', '2026-07-01', '2026-08-30')).toBe('2026-08-31');
      // El mismo día de la declaración también cuenta como vuelta real.
      expect(effectiveLastSession('2026-08-30', '2026-07-01', '2026-08-30')).toBe('2026-08-30');
    });

    it('un registro DENTRO de la ventana sigue perdiendo: ese log miente', () => {
      // Y por eso la primera sesión de vuelta NO reacondiciona al resto de la rutina:
      // los demás ejercicios siguen con su log viejo dentro de la ventana → recorte.
      expect(effectiveLastSession('2026-08-23', '2026-07-01', '2026-08-30')).toBe('2026-07-01');
    });
  });

  describe('suggestionsForDay() — vigencia', () => {
    const byExercise = {
      ex1: { sets: [{ weight: 100, reps: 5 }], reason: '', source: 'local' as const },
    };

    it('con el mismo hash, la sugerencia guardada se sirve', () => {
      service.storeSuggestions('d1', 'hash-a', byExercise, 'groq');
      expect(service.suggestionsForDay('d1', 'hash-a')?.source).toBe('groq');
    });

    it('otro hash no la sirve: el contexto que la originó ya no es el actual', () => {
      service.storeSuggestions('d1', 'hash-a', byExercise, 'groq');
      expect(service.suggestionsForDay('d1', 'hash-b')).toBeNull();
    });

    it('una sugerencia de hace dos meses no vale aunque el hash coincida', () => {
      // El hash es estable en el tiempo a propósito (T-815). Lo único que cambia solo con
      // el calendario es el parón, y eso sí invalida: el peso guardado no lo contempla.
      const store = {
        d1: {
          contextHash: 'hash-a',
          byExercise,
          source: 'groq' as const,
          atISO: '2026-01-01T10:00:00.000Z',
        },
      };
      localStorage.setItem(STORAGE_KEYS.nextSuggestions, JSON.stringify(store));
      expect(service.suggestionsForDay('d1', 'hash-a')).toBeNull();
    });

    it('una de anteayer sigue valiendo: no caduca por pasar de medianoche', () => {
      const anteayer = new Date(Date.now() - 2 * 86400000).toISOString();
      const store = {
        d1: { contextHash: 'hash-a', byExercise, source: 'groq' as const, atISO: anteayer },
      };
      localStorage.setItem(STORAGE_KEYS.nextSuggestions, JSON.stringify(store));
      expect(service.suggestionsForDay('d1', 'hash-a')).toBeTruthy();
    });
  });

  describe('suggestionsForToday() con red (T-826)', () => {
    const day = { id: 'd1', name: 'Pecho', exercises: [makeExercise()] };
    const sessionJson = JSON.stringify({ r: [{ e: 1, sets: [{ w: 12.5, r: 10 }], why: 'ok' }] });

    it('con key y allowNetwork, la IA calcula UNA vez y queda guardada por hash', async () => {
      const fetchMock = vi.fn().mockResolvedValue(groqResponse(sessionJson));
      vi.stubGlobal('fetch', fetchMock);

      const first = await service.suggestionsForToday(day, makeSettings({ apiKey: 'k' }), 'es', {
        allowNetwork: true,
      });
      expect(first.source).toBe('groq');
      expect(first.byExercise['ex1'].sets[0].weight).toBe(12.5);

      // Reabrir el tab NO vuelve a llamar: el hash coincide y se sirve lo guardado.
      const second = await service.suggestionsForToday(day, makeSettings({ apiKey: 'k' }), 'es', {
        allowNetwork: true,
      });
      expect(second.source).toBe('groq');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('SIN allowNetwork jamás toca la red, con key y todo: es la garantía de H2', async () => {
      const fetchMock = vi.fn().mockResolvedValue(groqResponse(sessionJson));
      vi.stubGlobal('fetch', fetchMock);

      const out = await service.suggestionsForToday(day, makeSettings({ apiKey: 'k' }), 'es');

      expect(out.source).toBe('local');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('sin key cae al motor local y NO lo guarda: no le tapa el paso a una key futura', async () => {
      const out = await service.suggestionsForToday(day, makeSettings(), 'es', {
        allowNetwork: true,
      });
      expect(out.source).toBe('local');
      expect(localStorage.getItem(STORAGE_KEYS.nextSuggestions)).toBeNull();
    });

    it('dos aperturas simultáneas comparten UNA llamada', async () => {
      const fetchMock = vi.fn().mockResolvedValue(groqResponse(sessionJson));
      vi.stubGlobal('fetch', fetchMock);
      const settings = makeSettings({ apiKey: 'k' });

      const [a, b] = await Promise.all([
        service.suggestionsForToday(day, settings, 'es', { allowNetwork: true }),
        service.suggestionsForToday(day, settings, 'es', { allowNetwork: true }),
      ]);

      expect(a.source).toBe('groq');
      expect(b.source).toBe('groq');
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('si la IA falla, la sesión igual tiene sugerencias (motor local)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('sin red')));
      const out = await service.suggestionsForToday(day, makeSettings({ apiKey: 'k' }), 'es', {
        allowNetwork: true,
      });
      expect(out.source).toBe('local');
      expect(Object.keys(out.byExercise)).toContain('ex1');
    });
  });

  describe('shadow logging (ver specs/ai-shadow-log.md)', () => {
    const settings = makeSettings({ apiKey: 'test-key' });

    const groqSets = (weight = 20) =>
      JSON.stringify({
        sets: [
          { weight, reps: 10 },
          { weight, reps: 10 },
          { weight, reps: 10 },
        ],
        reason: 'ok',
      });

    beforeEach(() => {
      // Restaura el comportamiento real (el beforeEach global lo no-opea para el resto de la suite)
      vi.spyOn(TestBed.inject(AiShadowLogService), 'maybeRecord').mockRestore();
    });

    function fetchModelAware(
      handlers: Record<string, () => Promise<unknown> | unknown>,
    ): ReturnType<typeof vi.fn> {
      return vi.fn().mockImplementation((_url: string, opts: RequestInit) => {
        const model = (JSON.parse(opts.body as string) as { model: string }).model;
        const handler = handlers[model];
        return handler ? handler() : Promise.resolve(groqResponse(groqSets()));
      });
    }

    it('no bloquea la respuesta real aunque el candidato tarde o nunca resuelva', async () => {
      // Solo cuelga el CANDIDATO. El modelo de producción responde: si también colgara, no se
      // estaría midiendo el shadow sino la llamada real.
      const fetchMock = fetchModelAware({
        'qwen/qwen3.6-27b': () => new Promise(() => {}), // nunca resuelve
      });
      vi.stubGlobal('fetch', fetchMock);

      // 1ra llamada: counter=1, no muestreada. 2da: counter=2, muestreada (dispara shadow).
      await service.recommend(settings, makeExercise({ id: 'ex1' }), [], lastSetsAt(20, 10), []);
      const rec = await service.recommend(
        settings,
        makeExercise({ id: 'ex2' }),
        [],
        lastSetsAt(20, 10),
        [],
      );

      expect(rec.source).toBe('groq');
      expect(rec.sets[0].weight).toBe(20);
    });

    it('un candidato que falla no llega al usuario, pero sí queda en el log', async () => {
      const fetchMock = fetchModelAware({
        'qwen/qwen3.6-27b': () =>
          Promise.resolve({ ok: false, status: 500, text: async () => 'boom' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.recommend(settings, makeExercise({ id: 'ex1' }), [], lastSetsAt(20, 10), []);
      const rec = await service.recommend(
        settings,
        makeExercise({ id: 'ex2' }),
        [],
        lastSetsAt(20, 10),
        [],
      );
      // Medir un candidato no puede degradar lo que ve quien entrena.
      expect(rec.source).toBe('groq');
      expect(rec.sets[0].weight).toBe(20);

      await vi.waitFor(() => {
        const log = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiShadowLog) ?? '[]');
        expect(log.length).toBe(1);
      });

      const [entry] = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiShadowLog) ?? '[]');
      const failed = entry.shadowModels.find(
        (m: { name: string }) => m.name === 'qwen/qwen3.6-27b',
      );
      expect(failed.ok).toBe(false);
      expect(failed.error).toBeTruthy();
    });

    it('el modelo de producción NO se mide contra sí mismo', () => {
      // Cuando gpt-oss-120b pasó a producción salió de la lista: compararlo consigo mismo no
      // dice nada y gastaría tokens en cada llamada muestreada.
      expect(SHADOW_MODELS.map(([name]) => name)).not.toContain(GROQ_MODEL);
    });

    it('no dispara shadow cuando la recomendación real no vino de Groq', async () => {
      const cohereOnly = makeSettings({ cohereApiKey: 'cohere-key' });
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ message: { content: [{ text: groqSets() }] } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await service.recommend(cohereOnly, makeExercise({ id: 'ex1' }), [], lastSetsAt(20, 10), []);
      const rec = await service.recommend(
        cohereOnly,
        makeExercise({ id: 'ex2' }),
        [],
        lastSetsAt(20, 10),
        [],
      );

      expect(rec.source).toBe('cohere');
      // Solo las 2 llamadas reales a Cohere — ninguna extra por shadow
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(localStorage.getItem(STORAGE_KEYS.aiShadowLog)).toBeNull();
    });

    it('el log respeta el tope de 150 entradas, descartando las más viejas (FIFO)', async () => {
      const seeded = Array.from({ length: 150 }, (_, i) => ({
        id: `seed-${i}`,
        dateISO: '2026-01-01',
        exerciseId: 'ex1',
        exerciseName: 'Press',
        unit: 'KG',
        context: { objetivo: '', diasDesdeUltimaSesion: null, sesionHoy: [], sesionAnterior: [] },
        currentModel: { name: 'llama-3.3-70b-versatile', sets: [], reason: '' },
        shadowModels: [],
      }));
      localStorage.setItem(STORAGE_KEYS.aiShadowLog, JSON.stringify(seeded));

      const fetchMock = vi.fn().mockResolvedValue(groqResponse(groqSets()));
      vi.stubGlobal('fetch', fetchMock);

      await service.recommend(settings, makeExercise({ id: 'ex1' }), [], lastSetsAt(20, 10), []);
      await service.recommend(settings, makeExercise({ id: 'ex2' }), [], lastSetsAt(20, 10), []);

      // Espera la condición real (que el append async haya ocurrido), no solo length===150
      // — eso ya era true con la data sembrada, antes de que el append asincrónico corra.
      await vi.waitFor(() => {
        const log = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiShadowLog) ?? '[]');
        expect(log.some((e: { exerciseId: string }) => e.exerciseId === 'ex2')).toBe(true);
      });

      const log = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiShadowLog) ?? '[]');
      expect(log.length).toBe(150);
      expect(log.find((e: { id: string }) => e.id === 'seed-0')).toBeUndefined();
      expect(log.at(-1).exerciseId).toBe('ex2');
    });
  });
});
