import { Injectable, inject } from '@angular/core';
import {
  AiRecommendation,
  AppSettings,
  Exercise,
  SetRecord,
  TodaySetProgress,
  UserProfile,
} from '../models/workout.model';

import { HistoryEntry, StorageService, defaultUserProfile } from './storage.service';
import { AiShadowLogService } from './ai-shadow-log.service';
import { AiProvider, AiProviderContext } from './providers/ai-provider';
import { CohereProvider } from './providers/cohere.provider';
import { GroqProvider } from './providers/groq.provider';
import { LocalProvider } from './providers/local.provider';
import { RateLimitError, roundToBrick } from './providers/prompt-helpers';
import { STORAGE_KEYS } from './storage-keys';

const AI_CACHE_KEY = STORAGE_KEYS.aiCache;

interface AiCacheEntry {
  rec: AiRecommendation;
  lastSessionISO: string | null;
  cachedForDate: string;
  profileSig: string;
}

const NEXT_KEY = STORAGE_KEYS.nextSuggestions;

/**
 * Sugerencia calculada al CERRAR una sesión, para la siguiente (RF-IA-06b).
 *
 * `afterSessionISO` es la fecha de la sesión que la originó: mientras el ejercicio no vuelva
 * a entrenarse, la sugerencia sigue siendo la buena. En cuanto hay una sesión más nueva, deja
 * de valer sola, sin necesidad de borrarla.
 */
interface NextSuggestionEntry {
  rec: AiRecommendation;
  afterSessionISO: string;
  profileSig: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly storage = inject(StorageService);
  private readonly shadowLog = inject(AiShadowLogService);
  private readonly local = new LocalProvider();

  private readCache(): Partial<Record<string, AiCacheEntry>> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}');
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Partial<Record<string, AiCacheEntry>>)
        : {};
    } catch {
      return {};
    }
  }

  private profileSig(profile: UserProfile): string {
    const noteHash = profile.aiNotes
      ? String(profile.aiNotes.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0))
      : '';
    return `${profile.goal ?? ''}:${noteHash}`;
  }

  // La recomendación del día es ESTABLE: una vez emitida para (ejercicio, fecha, última
  // sesión, perfil) no cambia aunque el usuario marque series — un número que baila sin
  // datos nuevos destruye la confianza. La adaptación llega vía feedback explícito.
  private getCached(
    exerciseId: string,
    lastSessionISO: string | null,
    profile: UserProfile,
  ): AiRecommendation | null {
    const entry = this.readCache()[exerciseId];
    // Descarta entradas corruptas (caché de una versión vieja o JSON manipulado)
    if (!entry || !entry.rec || !Array.isArray(entry.rec.sets)) return null;
    if (entry.cachedForDate !== this.storage.todayISO()) return null;
    if (entry.lastSessionISO !== lastSessionISO) return null;
    if (entry.profileSig !== this.profileSig(profile)) return null;
    return entry.rec;
  }

  private setCached(
    exerciseId: string,
    lastSessionISO: string | null,
    rec: AiRecommendation,
    profile: UserProfile,
  ): void {
    const cache = this.readCache();
    cache[exerciseId] = {
      rec,
      lastSessionISO,
      cachedForDate: this.storage.todayISO(),
      profileSig: this.profileSig(profile),
    };
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  }

  private readNextStore(): Partial<Record<string, NextSuggestionEntry>> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(NEXT_KEY) ?? '{}');
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Partial<Record<string, NextSuggestionEntry>>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Sugerencia ya calculada para la próxima sesión de este ejercicio, si sigue vigente.
   *
   * Vigente = se calculó justo después de la última sesión registrada y con el mismo perfil.
   * Así H2 nunca espera a la red: el trabajo se hizo al cerrar la sesión anterior.
   */
  private getPrecomputed(
    exerciseId: string,
    lastSessionISO: string | null,
    profile: UserProfile,
  ): AiRecommendation | null {
    const entry = this.readNextStore()[exerciseId];
    if (!entry || !entry.rec || !Array.isArray(entry.rec.sets)) return null;
    if (!lastSessionISO || entry.afterSessionISO !== lastSessionISO) return null;
    if (entry.profileSig !== this.profileSig(profile)) return null;
    return entry.rec;
  }

  /**
   * Calcula y guarda las sugerencias de la PRÓXIMA sesión de un día recién cerrado.
   *
   * Se lanza sin esperarla (`void`): el usuario está mirando su resumen, no puede quedarse
   * bloqueado por la red (RF-IA-06b). Si falla, no pasa nada — la próxima vez se calcula
   * en directo como hasta ahora.
   *
   * NOTA: hoy hace una llamada por ejercicio, igual que el flujo actual, pero fuera del
   * camino crítico. T-400 las colapsa en UNA por sesión (Art. 5).
   */
  async precomputeNextSession(
    settings: AppSettings,
    exercises: readonly Exercise[],
    afterSessionISO: string,
    lang: 'es' | 'en' = 'es',
  ): Promise<void> {
    const store = this.readNextStore();
    for (const exercise of exercises) {
      try {
        const state = this.storage.load();
        const history = this.storage.historyForExercise(state, exercise.id);
        const lastSets = this.storage.lastSetsForExercise(state, exercise.id);
        const rec = await this.recommend(
          settings,
          exercise,
          [],
          lastSets,
          history,
          lang,
          history.at(-1)?.dateISO ?? null,
          { skipPrecomputed: true },
        );
        if (rec.loading) continue;
        store[exercise.id] = {
          rec,
          afterSessionISO,
          profileSig: this.profileSig(settings.userProfile),
        };
      } catch {
        /* una sugerencia que no sale no rompe el cierre de la sesión */
      }
    }
    try {
      localStorage.setItem(NEXT_KEY, JSON.stringify(store));
    } catch {
      /* sin espacio: se calculará en directo */
    }
  }

  private applyLongRestAdjustment(
    rec: AiRecommendation,
    exercise: Exercise,
    lastSets: SetRecord[] | null,
    lastSessionDate: string | null,
    lang: 'es' | 'en',
  ): AiRecommendation {
    if (
      !lastSessionDate ||
      !lastSets?.length ||
      exercise.unit === 'TIME' ||
      exercise.unit === 'BODYWEIGHT'
    ) {
      return rec;
    }
    const days = Math.round(
      (Date.now() - new Date(lastSessionDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    let factor = 1;
    if (days > 28) factor = 0.85;
    else if (days > 14) factor = 0.9;
    if (factor === 1) return rec;

    const brick = exercise.brick || 2.5;
    const topWeight = Math.max(...lastSets.map((s) => s.weight));
    const maxWeight = roundToBrick(topWeight * factor, brick);

    if (rec.sets.every((s) => s.weight <= maxWeight)) return rec;

    const note =
      lang === 'en'
        ? ` (weight capped for ${days}-day break)`
        : ` (peso limitado por ${days} días sin entrenar)`;

    return {
      ...rec,
      sets: rec.sets.map((s) => ({ ...s, weight: Math.min(s.weight, maxWeight) })),
      reason: rec.reason + note,
    };
  }

  private buildProviders(settings: AppSettings): AiProvider[] {
    const providers: AiProvider[] = [];
    if (settings.apiKey) providers.push(new GroqProvider(settings.apiKey));
    if (settings.cohereApiKey) providers.push(new CohereProvider(settings.cohereApiKey));
    return providers;
  }

  localRecommendation(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[] = [],
    userProfile: UserProfile = defaultUserProfile(),
    lastSessionDate: string | null = null,
    lang: 'es' | 'en' = 'es',
  ): AiRecommendation {
    return this.local.compute(
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile,
      lastSessionDate,
      lang,
    );
  }

  async recommend(
    settings: AppSettings,
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
    lang: 'es' | 'en' = 'es',
    lastSessionDate: string | null = null,
    opts: { skipPrecomputed?: boolean } = {},
  ): Promise<AiRecommendation> {
    const hasDoneOrHistory = lastSets?.length || todaySets.some((s) => s?.done);
    const providers = this.buildProviders(settings);

    // Fallback local con nota opcional — evita repetir la llamada de 7 argumentos.
    const local = (note = ''): AiRecommendation => {
      const rec = this.localRecommendation(
        exercise,
        todaySets,
        lastSets,
        history,
        settings.userProfile,
        lastSessionDate,
        lang,
      );
      if (note) rec.reason += note;
      return rec;
    };

    if (!providers.length || !hasDoneOrHistory) return local();

    const lastSessionISO = history.at(-1)?.dateISO ?? null;
    const cached = this.getCached(exercise.id, lastSessionISO, settings.userProfile);
    if (cached) return cached;

    if (!opts.skipPrecomputed) {
      const ready = this.getPrecomputed(exercise.id, lastSessionISO, settings.userProfile);
      if (ready) {
        this.setCached(exercise.id, lastSessionISO, ready, settings.userProfile);
        return ready;
      }
    }

    if (!navigator.onLine) {
      return local(lang === 'en' ? ' (offline mode)' : ' (modo offline)');
    }

    const lastSessionObj = this.storage.lastSessionForExercise(this.storage.load(), exercise.id);
    const ctx: AiProviderContext = {
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile: settings.userProfile,
      lang,
      lastSessionDate,
      lastFeel: lastSessionObj?.feelings?.[exercise.id] ?? null,
      lastNote: lastSessionObj?.notes?.[exercise.id] ?? null,
    };

    for (const provider of providers) {
      try {
        const rec = await provider.recommend(ctx);
        const adjusted = this.applyLongRestAdjustment(
          rec,
          exercise,
          lastSets,
          lastSessionDate,
          lang,
        );
        this.setCached(exercise.id, lastSessionISO, adjusted, settings.userProfile);
        if (adjusted.source === 'groq') {
          this.shadowLog.maybeRecord(ctx, settings.apiKey, adjusted);
        }
        return adjusted;
      } catch (e) {
        const label = e instanceof RateLimitError ? 'rate limit' : 'falló';
        console.info(`${provider.constructor.name} ${label}:`, (e as Error).message);
      }
    }

    return local(
      lang === 'en' ? ' (API unavailable, offline mode)' : ' (API no disponible, modo offline)',
    );
  }
}
