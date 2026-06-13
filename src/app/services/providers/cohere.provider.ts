import { AiRecommendation } from '../../models/workout.model';
import { AiProvider, AiProviderContext } from './ai-provider';
import {
  buildPerfilParts,
  buildProfileNote,
  fetchWithTimeout,
  HISTORY_SESSIONS,
  parseAndNormalizeSets,
} from './prompt-helpers';

const COHERE_URL = 'https://api.cohere.com/v2/chat';

export class CohereProvider implements AiProvider {
  constructor(private readonly apiKey: string) {}

  async recommend({
    exercise,
    todaySets,
    lastSets,
    history,
    userProfile,
    lang,
  }: AiProviderContext): Promise<AiRecommendation> {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;

    const doneSets = todaySets.filter((s) => s?.done);
    const perfilParts = buildPerfilParts(userProfile);
    const profileNote = buildProfileNote(perfilParts, userProfile);

    const summary = {
      ejercicio: exercise.name,
      unidad: exercise.unit,
      objetivo: `${setsTarget}x${repTarget}`,
      ladrillo_kg: brick,
      ...(perfilParts.length && { perfil: perfilParts.join(', ') }),
      hoy: doneSets.map((s, i) => ({
        s: i + 1,
        kg: typeof s.weight === 'number' ? s.weight : 0,
        r: typeof s.reps === 'number' ? s.reps : 0,
      })),
      anterior: (lastSets ?? []).map((s, i) => ({ s: i + 1, kg: s.weight, r: s.reps })),
      historial: history
        .slice(-HISTORY_SESSIONS)
        .map((h) => ({ f: h.dateISO, kg: h.topWeight, r: h.topReps, v: h.volume })),
    };

    const langInstruction =
      lang === 'en' ? 'Reason: 1 sentence in English.' : 'Razón: 1 oración español.';

    const prompt = `Entrenador de hipertrofia. Datos: ${JSON.stringify(summary)}
Reglas: 100%→últimas 2 series +${brick}kg; 80-99%→mismo peso; 50-79%→consolidar; <50%→-${brick}kg +30%reps; fallo 2-3 sesiones→deload.
Peso múltiplo de ${brick}kg. ${langInstruction}
${profileNote}JSON EXCLUSIVO (sin markdown): {"sets":[{"weight":<n>,"reps":<n>}...],"reason":"<s>"}
Array sets: EXACTAMENTE ${setsTarget} elementos.`;

    const resp = await fetchWithTimeout(COHERE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Respuesta Cohere no válida');
      parsed = JSON.parse(m[0]);
    }

    return {
      sets: parseAndNormalizeSets(parsed, setsTarget, brick, repTarget),
      reason: (parsed as { reason?: string }).reason ?? '',
      source: 'cohere',
    };
  }
}
