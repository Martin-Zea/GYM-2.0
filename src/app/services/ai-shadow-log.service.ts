import { Injectable, inject } from '@angular/core';
import { AiRecommendation, SetRecommendation } from '../models/workout.model';
import { AiProviderContext } from './providers/ai-provider';
import { GROQ_MODEL, GroqRequestOverrides, fetchGroqRecommendation } from './providers/groq.provider';
import { StorageService } from './storage.service';
import { STORAGE_KEYS } from './storage-keys';

/**
 * Shadow logging temporal para evaluar candidatos de reemplazo de `llama-3.3-70b-versatile`
 * (deprecado por Groq, decommission 2026-08-16) — ver `specs/ai-shadow-log.md`.
 * Se retira del código una vez tomada la decisión de a qué modelo migrar.
 */
const LOG_CAP = 150;
const REASON_MAX_LEN = 300;
const SAMPLE_RATE = 2; // 1 de cada 2 recomendaciones reales de Groq

/**
 * Ambos candidatos son modelos "de razonamiento" (piensan antes de responder) — sin
 * apagar/reducir ese razonamiento, agotan el presupuesto de tokens antes del JSON final
 * y Groq devuelve 400 "Failed to validate JSON". `max_tokens` sube para dejar margen al
 * razonamiento + la respuesta.
 */
const SHADOW_MODELS: readonly [string, GroqRequestOverrides][] = [
  ['openai/gpt-oss-120b', { reasoning_effort: 'low', reasoning_format: 'hidden', max_tokens: 1000 }],
  ['qwen/qwen3.6-27b', { reasoning_effort: 'none', reasoning_format: 'hidden', max_tokens: 1000 }],
];

export interface AiShadowModelResult {
  name: string;
  ok: boolean;
  sets?: SetRecommendation[];
  reason?: string;
  error?: string;
}

export interface AiShadowLogEntry {
  id: string;
  dateISO: string;
  exerciseId: string;
  exerciseName: string;
  unit: string;
  context: {
    objetivo: string;
    diasDesdeUltimaSesion: number | null;
    sesionHoy: { serie: number; pesoKg: number; reps: number }[];
    sesionAnterior: { serie: number; pesoKg: number; reps: number }[];
  };
  currentModel: {
    name: string;
    sets: SetRecommendation[];
    reason: string;
  };
  shadowModels: AiShadowModelResult[];
}

function isValidEntry(v: unknown): v is AiShadowLogEntry {
  return (
    typeof v === 'object' &&
    v !== null &&
    typeof (v as AiShadowLogEntry).id === 'string' &&
    Array.isArray((v as AiShadowLogEntry).shadowModels)
  );
}

@Injectable({ providedIn: 'root' })
export class AiShadowLogService {
  private readonly storage = inject(StorageService);
  private sampleCounter = 0;

  private shouldSample(): boolean {
    this.sampleCounter++;
    return this.sampleCounter % SAMPLE_RATE === 0;
  }

  /**
   * Dispara los shadow requests en fire-and-forget: nunca lanza, nunca bloquea al
   * caller. Solo debe invocarse cuando la recomendación real efectivamente vino de Groq.
   */
  maybeRecord(ctx: AiProviderContext, apiKey: string, current: AiRecommendation): void {
    if (!this.shouldSample()) return;
    this.record(ctx, apiKey, current).catch(() => {
      // Best-effort: un fallo del shadow logging nunca debe afectar al usuario.
    });
  }

  private async record(
    ctx: AiProviderContext,
    apiKey: string,
    current: AiRecommendation,
  ): Promise<void> {
    const shadowModels = await Promise.all(
      SHADOW_MODELS.map(([model, overrides]) => this.runCandidate(ctx, apiKey, model, overrides)),
    );

    this.append({
      id: this.storage.uid(),
      dateISO: this.storage.todayISO(),
      exerciseId: ctx.exercise.id,
      exerciseName: ctx.exercise.name,
      unit: ctx.exercise.unit,
      context: this.buildContext(ctx),
      currentModel: {
        name: GROQ_MODEL,
        sets: current.sets,
        reason: current.reason.slice(0, REASON_MAX_LEN),
      },
      shadowModels,
    });
  }

  private async runCandidate(
    ctx: AiProviderContext,
    apiKey: string,
    model: string,
    overrides: GroqRequestOverrides,
  ): Promise<AiShadowModelResult> {
    try {
      const rec = await fetchGroqRecommendation(ctx, apiKey, model, overrides);
      return { name: model, ok: true, sets: rec.sets, reason: rec.reason.slice(0, REASON_MAX_LEN) };
    } catch (e) {
      return {
        name: model,
        ok: false,
        error: ((e as Error).message ?? 'error').slice(0, REASON_MAX_LEN),
      };
    }
  }

  private buildContext(ctx: AiProviderContext): AiShadowLogEntry['context'] {
    const { exercise, todaySets, lastSets, lastSessionDate } = ctx;
    const doneSets = todaySets.filter((s) => s?.done && !s.isWarmup);
    return {
      objetivo: `${exercise.defaultSets || 3} series x ${exercise.defaultRepTarget || 10} reps`,
      diasDesdeUltimaSesion: lastSessionDate
        ? Math.round((Date.now() - new Date(lastSessionDate).getTime()) / (1000 * 60 * 60 * 24))
        : null,
      sesionHoy: doneSets.map((s, i) => ({
        serie: i + 1,
        pesoKg: typeof s.weight === 'number' ? s.weight : 0,
        reps: typeof s.reps === 'number' ? s.reps : 0,
      })),
      sesionAnterior: (lastSets ?? []).map((s, i) => ({
        serie: i + 1,
        pesoKg: s.weight,
        reps: s.reps,
      })),
    };
  }

  private readLog(): AiShadowLogEntry[] {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiShadowLog) ?? '[]');
      return Array.isArray(parsed) ? parsed.filter(isValidEntry) : [];
    } catch {
      return [];
    }
  }

  private append(entry: AiShadowLogEntry): void {
    const log = this.readLog();
    log.push(entry);
    const trimmed = log.length > LOG_CAP ? log.slice(log.length - LOG_CAP) : log;
    localStorage.setItem(STORAGE_KEYS.aiShadowLog, JSON.stringify(trimmed));
  }

  hasEntries(): boolean {
    return this.readLog().length > 0;
  }

  async exportLog(): Promise<void> {
    const log = this.readLog();
    const fileName = `gym-ai-shadow-log-${this.storage.todayISO()}.json`;
    const file = new File([JSON.stringify(log, null, 2)], fileName, { type: 'application/json' });

    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GainAI shadow log' });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return;
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  }
}
