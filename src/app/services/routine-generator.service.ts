import { Injectable, inject } from '@angular/core';
import { AppSettings, TrainingGoal, TrainingLevel } from '../models/workout.model';
import { Equipment } from '../data/exercise-catalog';
import { ApiKeyService } from './api-key.service';
import { CatalogService } from './catalog.service';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import {
  GROQ_MODEL,
  REASONING_MIN_TOKENS,
  reasoningOverridesFor,
  reasons,
} from './providers/groq.provider';
import { COHERE_MODEL } from './providers/cohere.provider';
import { AuthError, fetchAiWithRateLimit } from './providers/prompt-helpers';
import { parseJsonLoose } from './providers/session-prompt';
import { DEFAULT_TOKEN_BUDGET, isOverBudget, recordUsage } from './providers/ai-usage';
import { estimateTokens } from './providers/session-context';
import {
  DEFAULT_GEN_DAYS,
  DEFAULT_GEN_MINUTES,
  GEN_DAYS,
  GEN_MINUTES,
  snapTo,
} from '../utils/gen-options';

// Se reexportan para que el componente del generador tenga una sola puerta de entrada.
export { DEFAULT_GEN_DAYS, DEFAULT_GEN_MINUTES, GEN_DAYS, GEN_MINUTES, snapTo };

export interface RoutineSpec {
  daysPerWeek: number;
  level: TrainingLevel | null;
  goal: TrainingGoal | null;
  equipment: Equipment[] | null;
  notes: string;
}

/** Por qué no se puede generar ahora mismo. `null` = adelante. */
export type GenBlock = 'no_key' | 'offline' | 'over_budget' | null;

/** Por qué falló una generación que sí llegó a intentarse. */
export type GenFailure = 'budget' | 'offline' | 'no_key' | 'auth' | 'model' | 'empty' | 'failed';

/**
 * Fallo del generador con su motivo.
 *
 * El código va en un campo, no en el mensaje: comparar `e.message === 'budget'` funciona
 * hasta que alguien traduce el texto o le añade contexto. La UI necesita distinguirlos
 * porque "no tenés key" y "se acabó el presupuesto" se arreglan en sitios distintos.
 */
export class GeneratorError extends Error {
  constructor(readonly code: GenFailure) {
    super(code);
  }
}

/** Traduce cualquier cosa que se haya lanzado al motivo que la UI sabe explicar. */
function asGeneratorError(e: unknown): GeneratorError {
  if (e instanceof GeneratorError) return e;
  if (e instanceof AuthError) return new GeneratorError('auth');
  return new GeneratorError('failed');
}

/**
 * El motivo que se puede leer de una respuesta fallida.
 *
 * Un modelo que la key no puede usar se arregla en un sitio concreto —el selector de
 * Ajustes— y merece decirlo, igual que hace el chat.
 */
async function failureFromResponse(resp: Response): Promise<GeneratorError> {
  if (resp.status === 401 || resp.status === 403) return new GeneratorError('auth');
  const body: unknown = await resp.json().catch(() => null);
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (error?.code === 'model_not_found' || /model/i.test(error?.message ?? '')) {
    return new GeneratorError('model');
  }
  return new GeneratorError('failed');
}

export interface GeneratedExercise {
  name: string;
  /** `ref` del catálogo si el nombre se pudo enlazar; si no, será un ejercicio propio. */
  ref: string | null;
  sets: number;
  reps: number;
}

export interface GeneratedDay {
  name: string;
  exercises: GeneratedExercise[];
}

export interface GeneratedRoutine {
  name: string;
  days: GeneratedDay[];
  source: 'groq' | 'cohere';
  /**
   * Días que se pidieron.
   *
   * No se puede rellenar lo que el modelo no mandó, pero sí se puede dejar de ocultarlo:
   * pedir 6 y guardar 4 en silencio es la app decidiendo por su cuenta que cuatro está
   * bien. La revisión compara este número con `days.length` y avisa.
   */
  requestedDays: number;
}

/** Estimación de coste que se muestra ANTES de llamar (RF-RUT-05). */
export interface CostEstimate {
  inputTokens: number;
  outputTokens: number;
  total: number;
  /** El presupuesto del mes no da para esta llamada. */
  overBudget: boolean;
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const COHERE_URL = 'https://api.cohere.com/v2/chat';

/**
 * Generador de rutinas por IA (RF-RUT-05, vista R7).
 *
 * Devuelve una PROPUESTA, nunca una rutina guardada: el usuario la revisa y la edita antes de
 * que toque su estado. Una rutina generada que se guardara sola sería la app decidiendo por
 * él sobre lo que va a hacer durante meses.
 */
@Injectable({ providedIn: 'root' })
export class RoutineGeneratorService {
  private readonly keys = inject(ApiKeyService);
  private readonly catalog = inject(CatalogService);
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);

  /** `true` si hay alguna key configurada; sin ella el generador no se ofrece. */
  canGenerate(settings: AppSettings): boolean {
    return !!(
      this.keys.get('groq') ||
      settings.apiKey ||
      this.keys.get('cohere') ||
      settings.cohereApiKey
    );
  }

  /**
   * Qué impide generar, si algo lo impide. Mismo vocabulario que `CoachChatService.blockedBy()`.
   *
   * El botón deshabilitado sin explicación era un callejón sin salida: la propia respuesta
   * del chat que invita a generar consume presupuesto, así que es perfectamente posible
   * llegar aquí y encontrarse un botón muerto y mudo justo después de gastar.
   */
  blockedBy(settings: AppSettings): GenBlock {
    if (!this.canGenerate(settings)) return 'no_key';
    if (!navigator.onLine) return 'offline';
    if (isOverBudget(settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET)) return 'over_budget';
    return null;
  }

  /**
   * Techo de salida según los días pedidos.
   *
   * 220 por día y no 180: con 180 una rutina de 6 días se quedaba en 1200 tokens y los
   * modelos que razonan gastan parte de eso pensando, así que el JSON llegaba cortado y
   * el fallo salía como "vacío" sin que nadie entendiera por qué.
   */
  private outputBudget(daysPerWeek: number): number {
    return Math.min(1800, 120 + daysPerWeek * 220);
  }

  /**
   * Coste estimado antes de llamar (RF-RUT-05).
   *
   * Aproximado por caracteres/4, igual que el resto de la app. Se muestra para que el usuario
   * decida con una cifra delante, no para facturar.
   */
  estimateCost(spec: RoutineSpec, settings: AppSettings, lang: 'es' | 'en'): CostEstimate {
    const inputTokens = estimateTokens(this.buildPrompt(spec, lang));
    const outputTokens = this.outputBudget(spec.daysPerWeek);
    const budget = settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    return {
      inputTokens,
      outputTokens,
      total: inputTokens + outputTokens,
      overBudget: isOverBudget(budget),
    };
  }

  private buildPrompt(spec: RoutineSpec, lang: 'es' | 'en'): string {
    const equipment = spec.equipment?.length ? spec.equipment.join(', ') : 'any standard gym';
    const known = this.catalog.all.map((e) => e.en).join(', ');
    // Los EJERCICIOS van en inglés porque `refFor()` los enlaza contra el catálogo por
    // nombre; los DÍAS no se enlazan con nada y deben seguir la UI. Sin esta línea el
    // modelo elegía, y una conversación en español terminaba en "Push Day".
    const dayLang = lang === 'en' ? 'English' : 'Spanish';
    return `You are a strength coach. Design a training routine.

CONSTRAINTS:
- ${spec.daysPerWeek} training days per week.
- Athlete level: ${spec.level ?? 'intermediate'}.
- Goal: ${spec.goal ?? 'general strength and hypertrophy'}.
- Available equipment: ${equipment}.
${spec.notes.trim() ? `- Athlete notes: ${spec.notes.trim().slice(0, 200)}\n` : ''}
- Prefer exercises from this list, using these exact English names: ${known}
- 4 to 6 exercises per day, compound movements first.
- Every day must have at least one exercise.
- Write the DAY names in ${dayLang}. Exercise names stay in English.

Reply with JSON only, no markdown:
{"name":"<routine name>","days":[{"name":"<day name>","exercises":[{"name":"<exercise>","sets":<n>,"reps":<n>}]}]}
Exactly ${spec.daysPerWeek} days.`;
  }

  /**
   * Llama al proveedor disponible y devuelve la propuesta ya normalizada.
   *
   * Los nombres se enlazan con el catálogo para heredar unidad y equipo; los que no enlazan
   * se conservan tal cual como ejercicios propios, no se descartan: el modelo puede proponer
   * algo válido que no esté en nuestra lista.
   */
  async generate(
    spec: RoutineSpec,
    settings: AppSettings,
    lang: 'es' | 'en',
  ): Promise<GeneratedRoutine> {
    const budget = settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    if (isOverBudget(budget)) throw new GeneratorError('budget');
    if (!navigator.onLine) throw new GeneratorError('offline');

    const prompt = this.buildPrompt(spec, lang);
    const groqKey = this.keys.get('groq') || settings.apiKey;
    const cohereKey = this.keys.get('cohere') || settings.cohereApiKey;

    if (groqKey) {
      try {
        return await this.callGroq(prompt, groqKey, settings, spec);
      } catch (e) {
        // Sin Cohere detrás, el fallo de Groq ES el resultado. Tragárselo y caer en
        // "no hay key" mandaba al usuario a configurar una key que ya tenía puesta.
        if (!cohereKey) throw asGeneratorError(e);
      }
    }
    if (cohereKey) {
      try {
        return await this.callCohere(prompt, cohereKey, settings, spec);
      } catch (e) {
        throw asGeneratorError(e);
      }
    }
    throw new GeneratorError('no_key');
  }

  private async callGroq(
    prompt: string,
    key: string,
    settings: AppSettings,
    spec: RoutineSpec,
  ): Promise<GeneratedRoutine> {
    const model = settings.groqModel ?? GROQ_MODEL;
    const budget = this.outputBudget(spec.daysPerWeek);
    const resp = await fetchAiWithRateLimit('Groq', GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: reasons(model) ? Math.max(REASONING_MIN_TOKENS, budget) : budget,
        response_format: { type: 'json_object' },
        ...reasoningOverridesFor(model),
      }),
    });
    if (!resp.ok) throw await failureFromResponse(resp);
    const data = await resp.json();
    recordUsage('groq', settings.groqModel ?? GROQ_MODEL, data?.usage);
    return this.normalize(parseJsonLoose(data?.choices?.[0]?.message?.content ?? ''), spec, 'groq');
  }

  private async callCohere(
    prompt: string,
    key: string,
    settings: AppSettings,
    spec: RoutineSpec,
  ): Promise<GeneratedRoutine> {
    const resp = await fetchAiWithRateLimit('Cohere', COHERE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: settings.cohereModel ?? COHERE_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: this.outputBudget(spec.daysPerWeek),
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) throw await failureFromResponse(resp);
    const data = await resp.json();
    recordUsage('cohere', settings.cohereModel ?? COHERE_MODEL, data?.usage?.tokens);
    return this.normalize(parseJsonLoose(data?.message?.content?.[0]?.text ?? ''), spec, 'cohere');
  }

  /** Normaliza y acota la respuesta: nada de lo que llegue se usa tal cual. */
  private normalize(raw: unknown, spec: RoutineSpec, source: 'groq' | 'cohere'): GeneratedRoutine {
    const obj = raw as { name?: unknown; days?: unknown };
    const rawDays = Array.isArray(obj?.days) ? obj.days : [];
    const days: GeneratedDay[] = rawDays
      .slice(0, spec.daysPerWeek)
      .map((d, i) => {
        const day = d as { name?: unknown; exercises?: unknown };
        const rawExercises = Array.isArray(day?.exercises) ? day.exercises : [];
        return {
          name:
            typeof day?.name === 'string' && day.name.trim()
              ? day.name.trim().slice(0, 40)
              : `Día ${i + 1}`,
          exercises: rawExercises
            .slice(0, 8)
            .map((e) => {
              const ex = e as { name?: unknown; sets?: unknown; reps?: unknown };
              const name = typeof ex?.name === 'string' ? ex.name.trim().slice(0, 60) : '';
              if (!name) return null;
              const sets = Number(ex?.sets);
              const reps = Number(ex?.reps);
              return {
                name,
                ref: this.catalog.refFor(name),
                sets: Number.isFinite(sets) ? Math.min(8, Math.max(1, Math.round(sets))) : 3,
                reps: Number.isFinite(reps) ? Math.min(60, Math.max(1, Math.round(reps))) : 10,
              };
            })
            .filter((e): e is GeneratedExercise => e !== null),
        };
      })
      // Un día sin ejercicios no es un día: es una fila que no se puede entrenar. Llegaba
      // hasta el estado como un `StoredWorkoutDay` con `exerciseIds: []`.
      .filter((d) => d.exercises.length > 0);

    if (!days.length) throw new GeneratorError('empty');

    return {
      name: typeof obj?.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 40) : '',
      days,
      source,
      requestedDays: spec.daysPerWeek,
    };
  }

  /**
   * Guarda la propuesta como rutina nueva, tras la revisión del usuario (RF-RUT-05).
   *
   * Los ejercicios enlazados heredan unidad y descanso del catálogo; los que no, se crean con
   * valores conservadores y el usuario los ajusta en el editor.
   */
  save(
    routine: GeneratedRoutine,
    fallbackName: string,
    lang: 'es' | 'en',
    opts: { activate?: boolean } = {},
  ): string {
    const template = {
      id: 'generated',
      es: routine.name || fallbackName,
      en: routine.name || fallbackName,
      daysPerWeek: routine.days.length,
      levels: [],
      equipment: [],
      days: routine.days.map((d, i) => ({
        key: String(i),
        es: d.name,
        en: d.name,
        refs: d.exercises.map((e) => e.ref).filter((r): r is string => r !== null),
      })),
    };

    const routineId = this.state.importTemplate(template as never, lang, this.catalog, {
      activate: opts.activate ?? true,
    });

    // Los ejercicios sin `ref` no están en el catálogo estático: se crean a mano y se
    // añaden a su día, para no perder lo que el modelo propuso.
    const days = this.state.state().routines.find((r) => r.id === routineId)?.dayIds ?? [];
    routine.days.forEach((d, i) => {
      const dayId = days[i];
      if (!dayId) return;
      for (const ex of d.exercises) {
        if (ex.ref) continue;
        const id = this.state.upsertExercise({
          id: this.storage.uid(),
          name: ex.name,
          brick: 2.5,
          defaultSets: ex.sets,
          defaultRepTarget: ex.reps,
          restSeconds: 90,
          unit: 'KG',
          notes: '',
        });
        this.state.addExerciseToDay(dayId, id);
      }
    });

    return routineId;
  }
}
