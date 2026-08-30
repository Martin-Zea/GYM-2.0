import { TestBed } from '@angular/core/testing';
import { ProgressionService, effectiveLastSession } from './progression.service';
import { AppSettings, Exercise, SetRecord, TodaySetProgress } from '../models/workout.model';
import { AiShadowLogService, SHADOW_MODELS } from './ai-shadow-log.service';
import { GROQ_MODEL, fetchGroqRecommendation } from './providers/groq.provider';
import { LocalProvider } from './providers/local.provider';
import { AiProviderContext } from './providers/ai-provider';
import { STORAGE_KEYS } from './storage-keys';

/**
 * El motor de reglas, probado donde vive.
 *
 * Antes se llegaba a él por `ProgressionService.localRecommendation()`, un paso directo a
 * `compute()` que colgaba de la ruta por ejercicio (retirada: la progresión va por sesión,
 * Art. 5). Los casos son los mismos; solo cambia la puerta.
 */
const engine = new LocalProvider();

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

  describe('motor local (LocalProvider.compute)', () => {
    it('sin historial sugiere un peso estimado (no cero con perfil) o cero sin perfil', () => {
      const rec = engine.compute(makeExercise(), [], null);
      expect(rec.source).toBe('local');
      // Sin userProfile.weightKg devuelve brick*4 = 10
      expect(rec.sets.length).toBe(3);
      expect(rec.sets.every((s) => s.reps === 10)).toBe(true);
    });

    it('objetivo cumplido (primera vez): sube 1 brick solo en las últimas 2 series', () => {
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 10));
      expect(rec.sets).toEqual([
        { weight: 20, reps: 10 },
        { weight: 22.5, reps: 10 },
        { weight: 22.5, reps: 10 },
      ]);
    });

    it('el peso recomendado queda redondeado al brick', () => {
      // top 21kg + brick 2.5 = 23.5 → redondea a 22.5 (múltiplo de 2.5)
      const rec = engine.compute(makeExercise(), [], lastSetsAt(21, 10));
      for (const s of rec.sets.slice(1)) {
        expect(s.weight % 2.5).toBe(0);
      }
      expect(rec.sets[2].weight).toBe(22.5);
    });

    it('completion < 50%: baja 1 brick y sube reps ~30%', () => {
      // 3 reps de 30 posibles → ratio 0.1
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 1));
      expect(rec.sets.every((s) => s.weight === 17.5)).toBe(true);
      expect(rec.sets.every((s) => s.reps === 13)).toBe(true); // round(10 * 1.3)
    });

    it('completion 80-99%: repite el mismo peso con el rep target', () => {
      // 24 reps de 30 posibles → ratio 0.8
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 8));
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
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 10), history);
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

      const rec = engine.compute(makeExercise(), [], lastSetsAt(top, 10), history);

      expect(rec.reason).toContain('descarga');
      expect(rec.sets[0].weight).toBeLessThan(top);
    });

    it('super-completado: salta 2 ladrillos cuando reps >= 150% del objetivo', () => {
      const lastSets: SetRecord[] = [
        { exerciseId: 'ex1', setIndex: 0, weight: 25, reps: 10 },
        { exerciseId: 'ex1', setIndex: 1, weight: 25, reps: 10 },
        { exerciseId: 'ex1', setIndex: 2, weight: 25, reps: 18 }, // 180% del target (10)
      ];
      const rec = engine.compute(makeExercise(), [], lastSets);
      expect(rec.sets[0].weight).toBe(30); // +2 ladrillos (25 + 2×2.5)
      expect(rec.sets.every((s) => s.weight === 30)).toBe(true);
      expect(rec.reason).toMatch(/liviano|light/i);
    });

    it('sesión espaciada >14 días: reduce un brick', () => {
      const lastDate = new Date();
      lastDate.setDate(lastDate.getDate() - 20);
      const lastSessionDate = lastDate.toISOString().slice(0, 10);
      const rec = engine.compute(
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

  /**
   * Normalización de la respuesta de Groq para UN ejercicio.
   *
   * Se prueba contra `fetchGroqRecommendation()`, que es donde vive el prompt y el parseo.
   * Antes se llegaba por `ProgressionService.recommend()`, la cascada por ejercicio que se
   * retiró (la progresión va por sesión, Art. 5); esta función sigue viva porque el shadow
   * log compara modelos candidatos ejercicio a ejercicio.
   *
   * Los dos casos degenerados ya no "caen al motor local" aquí: la función LANZA y quien la
   * llama decide. El fallback al motor local se prueba en `suggestionsForToday()`.
   */
  describe('normalización de la respuesta de Groq (fetchGroqRecommendation)', () => {
    function makeCtx(overrides: Partial<AiProviderContext> = {}): AiProviderContext {
      return {
        exercise: makeExercise(),
        todaySets: [],
        lastSets: lastSetsAt(20, 10),
        history: [],
        userProfile: makeSettings().userProfile,
        lang: 'es',
        lastSessionDate: null,
        ...overrides,
      };
    }

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

      const rec = await fetchGroqRecommendation(makeCtx(), 'test-key', GROQ_MODEL);
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

      const rec = await fetchGroqRecommendation(makeCtx(), 'test-key', GROQ_MODEL);
      expect(rec.source).toBe('groq');
      expect(rec.sets).toEqual([
        { weight: 25, reps: 8 },
        { weight: 25, reps: 8 },
        { weight: 25, reps: 8 },
      ]);
    });

    it('ante JSON inválido lanza en vez de inventar una recomendación', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('esto no es JSON')));

      await expect(fetchGroqRecommendation(makeCtx(), 'test-key', GROQ_MODEL)).rejects.toThrow(
        'Respuesta IA no válida',
      );
    });

    it('ante respuesta sin ningún set válido lanza', async () => {
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

      await expect(fetchGroqRecommendation(makeCtx(), 'test-key', GROQ_MODEL)).rejects.toThrow(
        'Sets sin valores numéricos',
      );
    });
  });

  describe('motor local — casos de ratio 50-79%', () => {
    it('50-79%: repite el mismo peso con el rep target y mensaje de consolidación', () => {
      // 3 sets × 5 reps = 15 / (3 × 10) = 0.5 → rama consolidar
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 5));
      expect(rec.sets.every((s) => s.weight === 20 && s.reps === 10)).toBe(true);
      expect(rec.reason).toContain('consolidando');
    });

    it('70%: también cae en la rama 50-79% (no baja peso)', () => {
      // 3 sets × 7 reps = 21 / 30 = 0.7
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 7));
      expect(rec.sets.every((s) => s.weight === 20)).toBe(true);
      expect(rec.sets.every((s) => s.reps === 10)).toBe(true);
    });
  });

  describe('motor local — prioridad todaySets sobre lastSets', () => {
    it('si todaySets tiene sets hechos, los usa en lugar de lastSets', () => {
      // todaySets: completó 3 series a 30kg (100% objetivo)
      const todaySets = [makeDoneSet(30, 10), makeDoneSet(30, 10), makeDoneSet(30, 10)];
      // lastSets: sesión previa a 20kg (no debe usarse como base)
      const rec = engine.compute(makeExercise(), todaySets, lastSetsAt(20, 10));
      // La base es 30kg → sube brick (sin doble progresión confirmada, últimas 2 series)
      expect(rec.sets[rec.sets.length - 1].weight).toBe(32.5);
    });

    it('si todaySets está vacío, cae en lastSets normalmente', () => {
      const rec = engine.compute(makeExercise(), [], lastSetsAt(20, 10));
      // Completó al 100% → sube las últimas 2 series a 22.5
      expect(rec.sets[rec.sets.length - 1].weight).toBe(22.5);
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

  /**
   * Shadow logging (ver specs/ai-shadow-log.md).
   *
   * Se dispara desde la ruta viva —`suggestionsForToday(..., allowNetwork)` →
   * `recommendSession()` → `sampleShadowLog()`—, no desde la cascada por ejercicio, que ya
   * no existe. Cada día es un contexto distinto, así que dos días seguidos son dos llamadas
   * reales: la segunda cae en el muestreo (SAMPLE_RATE = 2).
   *
   * El fetch se reparte por modelo: el de producción contesta en formato de SESIÓN y los
   * candidatos del shadow en formato por EJERCICIO, que es como los pide
   * `fetchGroqRecommendation()`.
   */
  describe('shadow logging (ver specs/ai-shadow-log.md)', () => {
    const settings = makeSettings({ apiKey: 'test-key' });
    const day1 = { id: 'd1', name: 'Pecho', exercises: [makeExercise({ id: 'ex1' })] };
    const day2 = { id: 'd2', name: 'Espalda', exercises: [makeExercise({ id: 'ex2' })] };

    /** Respuesta de SESIÓN: la que devuelve el modelo de producción. */
    const sessionJson = JSON.stringify({
      r: [{ e: 1, sets: [{ w: 20, r: 10 }], why: 'ok' }],
    });

    /** Respuesta por EJERCICIO: la que consumen los candidatos del shadow log. */
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
        if (handler) return handler();
        // Producción responde en formato de sesión; cualquier otro modelo es un candidato.
        return Promise.resolve(groqResponse(model === GROQ_MODEL ? sessionJson : groqSets()));
      });
    }

    const ask = (day: typeof day1, s = settings) =>
      service.suggestionsForToday(day, s, 'es', { allowNetwork: true });

    it('no bloquea la respuesta real aunque el candidato tarde o nunca resuelva', async () => {
      // Solo cuelga el CANDIDATO. El modelo de producción responde: si también colgara, no se
      // estaría midiendo el shadow sino la llamada real.
      const fetchMock = fetchModelAware({
        'qwen/qwen3.6-27b': () => new Promise(() => {}), // nunca resuelve
      });
      vi.stubGlobal('fetch', fetchMock);

      // 1ra llamada: counter=1, no muestreada. 2da: counter=2, muestreada (dispara shadow).
      await ask(day1);
      const out = await ask(day2);

      expect(out.source).toBe('groq');
      expect(out.byExercise['ex2'].sets[0].weight).toBe(20);
    });

    it('un candidato que falla no llega al usuario, pero sí queda en el log', async () => {
      const fetchMock = fetchModelAware({
        'qwen/qwen3.6-27b': () =>
          Promise.resolve({ ok: false, status: 500, text: async () => 'boom' }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await ask(day1);
      const out = await ask(day2);
      // Medir un candidato no puede degradar lo que ve quien entrena.
      expect(out.source).toBe('groq');
      expect(out.byExercise['ex2'].sets[0].weight).toBe(20);

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
        json: async () => ({ message: { content: [{ text: sessionJson }] } }),
      });
      vi.stubGlobal('fetch', fetchMock);

      await ask(day1, cohereOnly);
      const out = await ask(day2, cohereOnly);

      expect(out.source).toBe('cohere');
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

      vi.stubGlobal('fetch', fetchModelAware({}));

      await ask(day1);
      await ask(day2);

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
