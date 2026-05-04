import { Injectable, inject } from '@angular/core';
import { AiRecommendation, AppSettings, Exercise, SetRecommendation, SetRecord, TodaySetProgress, UserProfile } from '../models/workout.model';
import { HistoryEntry, StorageService } from './storage.service';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const AI_CACHE_KEY = 'gym_ai_cache_v1';

interface AiCacheEntry {
  rec: AiRecommendation;
  lastSessionISO: string | null;
  cachedForDate: string;
  doneSig: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly storage = inject(StorageService);

  private readCache(): Partial<Record<string, AiCacheEntry>> {
    try { return JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}'); }
    catch { return {}; }
  }

  private doneSig(todaySets: TodaySetProgress[]): string {
    return todaySets.filter(s => s.done).map(s => `${s.weight}x${s.reps}`).join(',');
  }

  private getCached(exerciseId: string, lastSessionISO: string | null, todaySets: TodaySetProgress[]): AiRecommendation | null {
    const entry = this.readCache()[exerciseId];
    if (!entry) return null;
    if (entry.cachedForDate !== this.storage.todayISO()) return null;
    if (entry.lastSessionISO !== lastSessionISO) return null;
    if (entry.doneSig !== this.doneSig(todaySets)) return null;
    return entry.rec;
  }

  private setCached(exerciseId: string, lastSessionISO: string | null, todaySets: TodaySetProgress[], rec: AiRecommendation): void {
    const cache = this.readCache();
    cache[exerciseId] = { rec, lastSessionISO, cachedForDate: this.storage.todayISO(), doneSig: this.doneSig(todaySets) };
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  }

  private roundToBrick(weight: number, brick: number): number {
    if (!brick || brick <= 0) return Math.round(weight * 2) / 2;
    return Math.round(weight / brick) * brick;
  }

  localRecommendation(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
  ): AiRecommendation {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;

    const doneSets = todaySets
      .filter(s => s?.done)
      .map(s => ({
        exerciseId: exercise.id,
        setIndex: 0,
        weight: typeof s.weight === 'number' ? s.weight : 0,
        reps: typeof s.reps === 'number' ? s.reps : 0,
      }));

    const baseSets: SetRecord[] = doneSets.length > 0 ? doneSets : (lastSets ?? []);

    if (baseSets.length === 0) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: 0, reps: repTarget })),
        reason: 'Primera sesión: definí un peso inicial y completá para que la IA te guíe.',
        source: 'local',
      };
    }

    const topWeight = Math.max(...baseSets.map(s => s.weight || 0));
    const totalRepsAtTop = baseSets
      .filter(s => (s.weight || 0) === topWeight)
      .reduce((sum, s) => sum + (s.reps || 0), 0);
    const maxPossibleReps = setsTarget * repTarget;
    const completionRatio = maxPossibleReps > 0 ? totalRepsAtTop / maxPossibleReps : 0;

    // 100% → últimas 2 series suben 1 ladrillo, el resto mantiene
    if (completionRatio >= 1) {
      const newWeight = this.roundToBrick(topWeight + brick, brick);
      const challengeFrom = Math.max(0, setsTarget - 2);
      const sets: SetRecommendation[] = Array.from({ length: setsTarget }, (_, i) => ({
        weight: i >= challengeFrom ? newWeight : topWeight,
        reps: repTarget,
      }));
      return {
        sets,
        reason: `Objetivo cumplido con ${topWeight}kg. Las últimas 2 series suben a ${newWeight}kg.`,
        source: 'local',
      };
    }

    // 80–99% → mismo peso todas las series
    if (completionRatio >= 0.8) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: `Muy cerca del objetivo con ${topWeight}kg. Repetís este peso para cerrar.`,
        source: 'local',
      };
    }

    // 50–79% → consolidar
    if (completionRatio >= 0.5) {
      return {
        sets: Array.from({ length: setsTarget }, () => ({ weight: topWeight, reps: repTarget })),
        reason: `Seguimos consolidando ${topWeight}kg. Enfocate en la técnica.`,
        source: 'local',
      };
    }

    // < 50% → bajar peso + más reps
    const prevWeight = this.roundToBrick(Math.max(topWeight - brick, 0), brick);
    const higherReps = Math.round(repTarget * 1.3);
    return {
      sets: Array.from({ length: setsTarget }, () => ({ weight: prevWeight, reps: higherReps })),
      reason: `El peso fue excesivo. Bajamos a ${prevWeight}kg con más reps para mantener el estímulo.`,
      source: 'local',
    };
  }

  private async groqRecommendation(
    apiKey: string,
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
    userProfile: UserProfile,
  ): Promise<AiRecommendation> {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;

    const doneSets = todaySets.filter(s => s?.done);
    const perfilParts: string[] = [];
    if (userProfile.weightKg) perfilParts.push(`peso corporal ${userProfile.weightKg}kg`);
    if (userProfile.heightCm) perfilParts.push(`altura ${userProfile.heightCm}cm`);
    if (userProfile.age) perfilParts.push(`edad ${userProfile.age} años`);
    if (userProfile.sex) {
      perfilParts.push(`sexo ${userProfile.sex === 'male' ? 'masculino' : userProfile.sex === 'female' ? 'femenino' : 'otro'}`);
    }

    const summary = {
      ejercicio: exercise.name,
      unidad: exercise.unit,
      objetivo: `${setsTarget} series x ${repTarget} reps`,
      ladrillo_kg: brick,
      ...(perfilParts.length && { perfil_usuario: perfilParts.join(', ') }),
      sesion_hoy: doneSets.map((s, i) => ({
        serie: i + 1,
        peso_kg: typeof s.weight === 'number' ? s.weight : 0,
        reps: typeof s.reps === 'number' ? s.reps : 0,
      })),
      sesion_anterior: (lastSets ?? []).map((s, i) => ({
        serie: i + 1,
        peso_kg: s.weight,
        reps: s.reps,
      })),
      historial_ultimas_sesiones: history.slice(-6).map(h => ({
        fecha: h.dateISO,
        peso_top_kg: h.topWeight,
        reps_top: h.topReps,
        volumen_total: h.volume,
      })),
    };

    const profileNote = perfilParts.length
      ? `- Considerá el perfil del usuario (${perfilParts.join(', ')}) para personalizar.\n`
      : '';

    const prompt = `Sos un entrenador profesional de hipertrofia muscular. Analizá los datos y devolvé la recomendación serie por serie para la próxima sesión.

Datos:
${JSON.stringify(summary, null, 2)}

Reglas (aplicar en orden):
1. Si completó 100% del objetivo (${setsTarget}×${repTarget}): las primeras ${setsTarget - 2} series mantienen el peso base, las últimas 2 series suben 1 ladrillo (${brick}kg).
2. Si completó 80-99%: mismo peso y reps en todas las series (está cerca).
3. Si completó 50-79%: mismo peso, mismo rep target (consolidar técnica).
4. Si completó menos del 50%: bajá 1 ladrillo en todas las series, aumentá reps (~30% más).
5. Patrón de fallo 2-3 sesiones seguidas: sugerí deload u otro enfoque.

El peso debe ser múltiplo de ${brick}kg. La razón: máximo 1 oración, español, técnica y motivadora.
${profileNote}Respondé EXCLUSIVAMENTE con JSON válido (sin markdown):
{"sets": [{"weight": <number>, "reps": <number>}, ...], "reason": "<string>"}
El array "sets" debe tener EXACTAMENTE ${setsTarget} elementos.`;

    const resp = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        max_tokens: 300,
        response_format: { type: 'json_object' },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Groq ${resp.status}: ${errText.slice(0, 120)}`);
    }

    const data = await resp.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    let parsed: { sets: { weight: number; reps: number }[]; reason: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Respuesta IA no válida');
      parsed = JSON.parse(m[0]);
    }

    if (!Array.isArray(parsed.sets) || parsed.sets.length === 0) {
      throw new Error('JSON IA incompleto');
    }

    // Normalizar a setsTarget elementos
    const normalizedSets: { weight: number; reps: number }[] = Array.from(
      { length: setsTarget },
      (_, i) => parsed.sets[i] ?? parsed.sets[parsed.sets.length - 1],
    );

    return {
      sets: normalizedSets.map(s => ({
        weight: this.roundToBrick(s.weight || 0, brick),
        reps: Math.max(1, Math.round(s.reps || repTarget)),
      })),
      reason: parsed.reason,
      source: 'groq',
    };
  }

  private async cohereRecommendation(
    apiKey: string,
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
    userProfile: UserProfile,
  ): Promise<AiRecommendation> {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;

    const doneSets = todaySets.filter(s => s?.done);
    const perfilParts: string[] = [];
    if (userProfile.weightKg) perfilParts.push(`peso corporal ${userProfile.weightKg}kg`);
    if (userProfile.heightCm) perfilParts.push(`altura ${userProfile.heightCm}cm`);
    if (userProfile.age) perfilParts.push(`edad ${userProfile.age} años`);
    if (userProfile.sex) {
      perfilParts.push(`sexo ${userProfile.sex === 'male' ? 'masculino' : userProfile.sex === 'female' ? 'femenino' : 'otro'}`);
    }

    const summary = {
      ejercicio: exercise.name,
      unidad: exercise.unit,
      objetivo: `${setsTarget}x${repTarget}`,
      ladrillo_kg: brick,
      ...(perfilParts.length && { perfil: perfilParts.join(', ') }),
      hoy: doneSets.map((s, i) => ({ s: i + 1, kg: typeof s.weight === 'number' ? s.weight : 0, r: typeof s.reps === 'number' ? s.reps : 0 })),
      anterior: (lastSets ?? []).map((s, i) => ({ s: i + 1, kg: s.weight, r: s.reps })),
      historial: history.slice(-3).map(h => ({ f: h.dateISO, kg: h.topWeight, r: h.topReps, v: h.volume })),
    };

    const prompt = `Entrenador de hipertrofia. Datos: ${JSON.stringify(summary)}
Reglas: 100%→últimas 2 series +${brick}kg; 80-99%→mismo peso; 50-79%→consolidar; <50%→-${brick}kg +30%reps; fallo 2-3 sesiones→deload.
Peso múltiplo de ${brick}kg. Razón: 1 oración español.
JSON EXCLUSIVO (sin markdown): {"sets":[{"weight":<n>,"reps":<n>}...],"reason":"<s>"}
Array sets: EXACTAMENTE ${setsTarget} elementos.`;

    const resp = await fetch('https://api.cohere.com/v2/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'command-r7b-12-2024',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0.3,
        max_tokens: 300,
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Cohere ${resp.status}: ${errText.slice(0, 120)}`);
    }

    const data = await resp.json();
    const text: string = data?.message?.content?.[0]?.text ?? '';
    let parsed: { sets: { weight: number; reps: number }[]; reason: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Respuesta Cohere no válida');
      parsed = JSON.parse(m[0]);
    }

    if (!Array.isArray(parsed.sets) || parsed.sets.length === 0) throw new Error('JSON Cohere incompleto');

    const normalizedSets = Array.from({ length: setsTarget }, (_, i) => parsed.sets[i] ?? parsed.sets[parsed.sets.length - 1]);
    return {
      sets: normalizedSets.map(s => ({
        weight: this.roundToBrick(s.weight || 0, brick),
        reps: Math.max(1, Math.round(s.reps || repTarget)),
      })),
      reason: parsed.reason,
      source: 'cohere',
    };
  }

  async recommend(
    settings: AppSettings,
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
  ): Promise<AiRecommendation> {
    const hasDoneOrHistory = lastSets?.length || todaySets.some(s => s?.done);
    const hasAnyKey = settings.apiKey || settings.cohereApiKey;

    if (hasAnyKey && hasDoneOrHistory) {
      const lastSessionISO = history.at(-1)?.dateISO ?? null;
      const cached = this.getCached(exercise.id, lastSessionISO, todaySets);
      if (cached) return cached;

      // Priority: Groq → Cohere → local
      if (settings.apiKey) {
        try {
          const rec = await this.groqRecommendation(settings.apiKey, exercise, todaySets, lastSets, history, settings.userProfile);
          this.setCached(exercise.id, lastSessionISO, todaySets, rec);
          return rec;
        } catch (e) {
          console.info('Groq falló, intentando Cohere:', (e as Error).message);
        }
      }

      if (settings.cohereApiKey) {
        try {
          const rec = await this.cohereRecommendation(settings.cohereApiKey, exercise, todaySets, lastSets, history, settings.userProfile);
          this.setCached(exercise.id, lastSessionISO, todaySets, rec);
          return rec;
        } catch (e) {
          console.info('Cohere falló, usando fallback local:', (e as Error).message);
        }
      }

      const local = this.localRecommendation(exercise, todaySets, lastSets);
      local.reason += ' (modo offline)';
      return local;
    }

    return this.localRecommendation(exercise, todaySets, lastSets);
  }
}
