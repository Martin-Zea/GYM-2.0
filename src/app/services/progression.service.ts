import { Injectable, inject } from '@angular/core';
import {
  AiRecommendation,
  AppSettings,
  Exercise,
  SetRecord,
  TodaySetProgress,
  UserProfile,
} from '../models/workout.model';

import { HistoryEntry, StorageService } from './storage.service';
import { AiProvider, AiProviderContext } from './providers/ai-provider';
import { CohereProvider } from './providers/cohere.provider';
import { GroqProvider } from './providers/groq.provider';
import { LocalProvider } from './providers/local.provider';
import { roundToBrick } from './providers/prompt-helpers';

const AI_CACHE_KEY = 'gym_ai_cache_v2';

interface AiCacheEntry {
  rec: AiRecommendation;
  lastSessionISO: string | null;
  cachedForDate: string;
  doneSig: string;
  profileSig: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly storage = inject(StorageService);
  private readonly local = new LocalProvider();

  private readCache(): Partial<Record<string, AiCacheEntry>> {
    try {
      return JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}');
    } catch {
      return {};
    }
  }

  private doneSig(todaySets: TodaySetProgress[]): string {
    return todaySets
      .filter((s) => s.done)
      .map((s) => `${s.weight}x${s.reps}`)
      .join(',');
  }

  private profileSig(profile: UserProfile): string {
    const noteHash = profile.aiNotes
      ? String(profile.aiNotes.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0))
      : '';
    return `${profile.goal ?? ''}:${noteHash}`;
  }

  private getCached(
    exerciseId: string,
    lastSessionISO: string | null,
    todaySets: TodaySetProgress[],
    profile: UserProfile,
  ): AiRecommendation | null {
    const entry = this.readCache()[exerciseId];
    if (!entry) return null;
    if (entry.cachedForDate !== this.storage.todayISO()) return null;
    if (entry.lastSessionISO !== lastSessionISO) return null;
    if (entry.profileSig !== this.profileSig(profile)) return null;
    if (navigator.onLine && entry.doneSig !== this.doneSig(todaySets)) return null;
    return entry.rec;
  }

  private setCached(
    exerciseId: string,
    lastSessionISO: string | null,
    todaySets: TodaySetProgress[],
    rec: AiRecommendation,
    profile: UserProfile,
  ): void {
    const cache = this.readCache();
    cache[exerciseId] = {
      rec,
      lastSessionISO,
      cachedForDate: this.storage.todayISO(),
      doneSig: this.doneSig(todaySets),
      profileSig: this.profileSig(profile),
    };
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
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
      exercise.unit === 'tiempo' ||
      exercise.unit === 'peso corporal'
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
    userProfile: UserProfile = {
      weightKg: null,
      heightCm: null,
      age: null,
      sex: null,
      weightLog: [],
      goal: null,
      aiNotes: '',
    },
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
  ): Promise<AiRecommendation> {
    const hasDoneOrHistory = lastSets?.length || todaySets.some((s) => s?.done);
    const providers = this.buildProviders(settings);

    console.log(`[progression.recommend] "${exercise.name}"`, {
      hasDoneOrHistory,
      providers: providers.map((p) => p.constructor.name),
      hasApiKey: !!settings.apiKey,
      hasCohereKey: !!settings.cohereApiKey,
    });

    if (!providers.length || !hasDoneOrHistory) {
      console.log(`[progression.recommend] → LOCAL (sin providers o sin historial)`);
      return this.localRecommendation(
        exercise,
        todaySets,
        lastSets,
        history,
        settings.userProfile,
        lastSessionDate,
        lang,
      );
    }

    const lastSessionISO = history.at(-1)?.dateISO ?? null;
    const cached = this.getCached(exercise.id, lastSessionISO, todaySets, settings.userProfile);
    if (cached) {
      console.log(`[progression.recommend] → CACHE HIT`, cached);
      return cached;
    }
    console.log(`[progression.recommend] cache miss, lastSessionISO=${lastSessionISO}`);

    if (!navigator.onLine) {
      console.log(`[progression.recommend] → LOCAL (offline)`);
      const local = this.localRecommendation(
        exercise,
        todaySets,
        lastSets,
        history,
        settings.userProfile,
        lastSessionDate,
        lang,
      );
      local.reason += lang === 'en' ? ' (offline mode)' : ' (modo offline)';
      return local;
    }

    const ctx: AiProviderContext = {
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile: settings.userProfile,
      lang,
      lastSessionDate,
    };

    for (const provider of providers) {
      try {
        console.log(`[progression.recommend] → llamando ${provider.constructor.name}`);
        const rec = await provider.recommend(ctx);
        console.log(`[progression.recommend] ← ${provider.constructor.name} respondió`, rec);
        const adjusted = this.applyLongRestAdjustment(
          rec,
          exercise,
          lastSets,
          lastSessionDate,
          lang,
        );
        console.log(`[progression.recommend] ajuste por descanso largo`, adjusted);
        this.setCached(exercise.id, lastSessionISO, todaySets, adjusted, settings.userProfile);
        return adjusted;
      } catch (e) {
        console.info(`${provider.constructor.name} falló:`, (e as Error).message);
      }
    }

    console.log(`[progression.recommend] → LOCAL (todos los providers fallaron)`);
    const local = this.localRecommendation(
      exercise,
      todaySets,
      lastSets,
      history,
      settings.userProfile,
      lastSessionDate,
      lang,
    );
    local.reason +=
      lang === 'en' ? ' (API unavailable, offline mode)' : ' (API no disponible, modo offline)';
    return local;
  }
}
