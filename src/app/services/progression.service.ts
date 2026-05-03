import { Injectable } from '@angular/core';
import { AiRecommendation, AppSettings, Exercise, SetRecord, TodaySetProgress, UserProfile } from '../models/workout.model';
import { HistoryEntry } from './storage.service';

const GEMINI_MODEL = 'gemini-2.0-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

@Injectable({ providedIn: 'root' })
export class ProgressionService {
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
    const repBottom = Math.max(repTarget - 3, 6);

    const doneSets = todaySets.filter(s => s?.done).map(s => ({
      exerciseId: exercise.id,
      setIndex: 0,
      weight: typeof s.weight === 'number' ? s.weight : 0,
      reps: typeof s.reps === 'number' ? s.reps : 0,
    }));
    const baseSets: SetRecord[] = doneSets.length > 0 ? doneSets : (lastSets ?? []);

    if (baseSets.length === 0) {
      return {
        weight: 0, reps: repTarget,
        reason: 'Primera sesión: definí un peso inicial y completá para que la IA te guíe.',
        source: 'local',
      };
    }

    const topWeight = Math.max(...baseSets.map(s => s.weight || 0));
    const setsAtTop = baseSets.filter(s => (s.weight || 0) === topWeight);
    const minRepsAtTop = Math.min(...setsAtTop.map(s => s.reps || 0));
    const maxRepsAtTop = Math.max(...setsAtTop.map(s => s.reps || 0));
    const allComplete = baseSets.length >= (exercise.defaultSets || 3) &&
                        baseSets.every(s => (s.reps || 0) >= repTarget);

    let weight = topWeight;
    let reps = repTarget;
    let reason = '';

    if (allComplete) {
      weight = this.roundToBrick(topWeight + brick, brick);
      reps = repBottom;
      reason = `Completaste ${exercise.defaultSets}×${repTarget} con ${topWeight}kg. Subimos ${brick}kg y reiniciamos a ${repBottom} reps.`;
    } else if (minRepsAtTop >= repBottom) {
      reps = Math.min(maxRepsAtTop + 1, repTarget);
      weight = topWeight;
      reason = `Buen trabajo con ${topWeight}kg. Apuntá a ${reps} reps — cuando llegués a ${repTarget} en todas las series, subimos peso.`;
    } else {
      weight = topWeight;
      reps = Math.max(repBottom, minRepsAtTop + 1);
      reason = `Mantenemos ${topWeight}kg para consolidar. Apuntá a ${reps} reps.`;
    }

    return { weight: this.roundToBrick(weight, brick), reps, reason, source: 'local' };
  }

  private async geminiRecommendation(
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
    if (userProfile.weightKg) perfilParts.push(`peso ${userProfile.weightKg}kg`);
    if (userProfile.heightCm) perfilParts.push(`altura ${userProfile.heightCm}cm`);
    if (userProfile.sex) perfilParts.push(`sexo ${userProfile.sex === 'male' ? 'masculino' : userProfile.sex === 'female' ? 'femenino' : 'otro'}`);

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
        serie: i + 1, peso_kg: s.weight, reps: s.reps,
      })),
      historial_top_pesos: history.slice(-6).map(h => ({
        fecha: h.dateISO, peso_top_kg: h.topWeight, reps_top: h.topReps,
      })),
    };

    const profileNote = perfilParts.length
      ? `- Tené en cuenta el perfil del usuario para sugerencias personalizadas.\n` : '';

    const prompt = `Sos un coach de entrenamiento. Analizá los datos y devolvé un JSON estricto con la recomendación para la próxima sesión.

Datos:
${JSON.stringify(summary, null, 2)}

Reglas:
- Siempre buscar progreso.
- Si completó todas las series al tope del rango (${repTarget} reps), subí el peso 1 ladrillo (${brick}kg) y bajá las reps al inicio del rango.
- Si las reps están por debajo del tope, mantené el peso y subí 1 rep como objetivo.
- Si falló (reps debajo del rango), mantené el peso para consolidar.
- El peso final debe ser múltiplo de ${brick}kg.
- Razón: máximo 1 oración, en español, motivadora pero técnica.
${profileNote}
Respondé EXCLUSIVAMENTE con JSON válido (sin markdown, sin texto extra):
{"weight": <number>, "reps": <number>, "reason": "<string>"}`;

    const resp = await fetch(`${GEMINI_URL}?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4, topP: 0.9,
          maxOutputTokens: 200,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Gemini ${resp.status}: ${errText.slice(0, 120)}`);
    }

    const data = await resp.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    let parsed: { weight: number; reps: number; reason: string };
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Respuesta IA no válida');
      parsed = JSON.parse(m[0]);
    }

    if (typeof parsed.weight !== 'number' || typeof parsed.reps !== 'number') {
      throw new Error('JSON IA incompleto');
    }

    return {
      weight: this.roundToBrick(parsed.weight, brick),
      reps: Math.max(1, Math.round(parsed.reps)),
      reason: parsed.reason,
      source: 'gemini',
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

    if (settings.apiKey && hasDoneOrHistory) {
      try {
        return await this.geminiRecommendation(
          settings.apiKey, exercise, todaySets, lastSets, history, settings.userProfile,
        );
      } catch (e) {
        console.info('Gemini falló, usando fallback local:', (e as Error).message);
        const local = this.localRecommendation(exercise, todaySets, lastSets);
        local.reason += ' (modo offline)';
        return local;
      }
    }

    return this.localRecommendation(exercise, todaySets, lastSets);
  }
}
