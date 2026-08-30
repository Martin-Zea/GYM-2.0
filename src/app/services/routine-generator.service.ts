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

export interface RoutineSpec {
  daysPerWeek: number;
  level: TrainingLevel | null;
  goal: TrainingGoal | null;
  equipment: Equipment[] | null;
  notes: string;
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
   * Coste estimado antes de llamar (RF-RUT-05).
   *
   * Aproximado por caracteres/4, igual que el resto de la app. Se muestra para que el usuario
   * decida con una cifra delante, no para facturar.
   */
  estimateCost(spec: RoutineSpec, settings: AppSettings): CostEstimate {
    const inputTokens = estimateTokens(this.buildPrompt(spec));
    const outputTokens = Math.min(1800, 120 + spec.daysPerWeek * 180);
    const budget = settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    return {
      inputTokens,
      outputTokens,
      total: inputTokens + outputTokens,
      overBudget: isOverBudget(budget),
    };
  }

  private buildPrompt(spec: RoutineSpec): string {
    const equipment = spec.equipment?.length ? spec.equipment.join(', ') : 'any standard gym';
    const known = this.catalog.all.map((e) => e.en).join(', ');
    return `You are a strength coach. Design a training routine.

CONSTRAINTS:
- ${spec.daysPerWeek} training days per week.
- Athlete level: ${spec.level ?? 'intermediate'}.
- Goal: ${spec.goal ?? 'general strength and hypertrophy'}.
- Available equipment: ${equipment}.
${spec.notes.trim() ? `- Athlete notes: ${spec.notes.trim().slice(0, 200)}\n` : ''}
- Prefer exercises from this list, using these exact English names: ${known}
- 4 to 6 exercises per day, compound movements first.

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
  async generate(spec: RoutineSpec, settings: AppSettings): Promise<GeneratedRoutine> {
    const budget = settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    if (isOverBudget(budget)) throw new Error('budget');
    if (!navigator.onLine) throw new Error('offline');

    const prompt = this.buildPrompt(spec);
    const groqKey = this.keys.get('groq') || settings.apiKey;
    const cohereKey = this.keys.get('cohere') || settings.cohereApiKey;

    if (groqKey) {
      try {
        return await this.callGroq(prompt, groqKey, settings, spec);
      } catch (e) {
        if (e instanceof AuthError && !cohereKey) throw e;
      }
    }
    if (cohereKey) return this.callCohere(prompt, cohereKey, settings, spec);
    throw new Error('no-key');
  }

  private async callGroq(
    prompt: string,
    key: string,
    settings: AppSettings,
    spec: RoutineSpec,
  ): Promise<GeneratedRoutine> {
    const model = settings.groqModel ?? GROQ_MODEL;
    const budget = Math.min(1800, 120 + spec.daysPerWeek * 180);
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
    if (resp.status === 401 || resp.status === 403) throw new AuthError('Groq');
    if (!resp.ok) throw new Error(`Groq ${resp.status}`);
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
        max_tokens: Math.min(1800, 120 + spec.daysPerWeek * 180),
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.status === 401 || resp.status === 403) throw new AuthError('Cohere');
    if (!resp.ok) throw new Error(`Cohere ${resp.status}`);
    const data = await resp.json();
    recordUsage('cohere', settings.cohereModel ?? COHERE_MODEL, data?.usage?.tokens);
    return this.normalize(parseJsonLoose(data?.message?.content?.[0]?.text ?? ''), spec, 'cohere');
  }

  /** Normaliza y acota la respuesta: nada de lo que llegue se usa tal cual. */
  private normalize(raw: unknown, spec: RoutineSpec, source: 'groq' | 'cohere'): GeneratedRoutine {
    const obj = raw as { name?: unknown; days?: unknown };
    const rawDays = Array.isArray(obj?.days) ? obj.days : [];
    const days: GeneratedDay[] = rawDays.slice(0, spec.daysPerWeek).map((d, i) => {
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
    });

    if (!days.length) throw new Error('empty');

    return {
      name: typeof obj?.name === 'string' && obj.name.trim() ? obj.name.trim().slice(0, 40) : '',
      days,
      source,
    };
  }

  /**
   * Guarda la propuesta como rutina nueva, tras la revisión del usuario (RF-RUT-05).
   *
   * Los ejercicios enlazados heredan unidad y descanso del catálogo; los que no, se crean con
   * valores conservadores y el usuario los ajusta en el editor.
   */
  save(routine: GeneratedRoutine, fallbackName: string, lang: 'es' | 'en'): string {
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

    const routineId = this.state.importTemplate(template as never, lang, this.catalog);

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
