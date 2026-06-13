import { AiRecommendation } from '../../models/workout.model';
import { AiProvider, AiProviderContext } from './ai-provider';
import {
  buildPerfilParts,
  buildProfileNote,
  fetchWithTimeout,
  HISTORY_SESSIONS,
  parseAndNormalizeSets,
} from './prompt-helpers';

const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

export class GroqProvider implements AiProvider {
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
      historial_ultimas_sesiones: history.slice(-HISTORY_SESSIONS).map((h) => ({
        fecha: h.dateISO,
        peso_top_kg: h.topWeight,
        reps_top: h.topReps,
        volumen_total: h.volume,
      })),
    };

    const langInstruction =
      lang === 'en'
        ? 'The "reason" field must be in English. Maximum 1 sentence, technical and motivating.'
        : 'La razón: máximo 1 oración, español, técnica y motivadora.';

    const prompt = `Sos un entrenador profesional de hipertrofia muscular. Analizá los datos y devolvé la recomendación serie por serie para la próxima sesión.

Datos:
${JSON.stringify(summary, null, 2)}

Reglas (aplicar en orden):
1. Si completó 100% del objetivo (${setsTarget}×${repTarget}): las primeras ${setsTarget - 2} series mantienen el peso base, las últimas 2 series suben 1 ladrillo (${brick}kg).
2. Si completó 80-99%: mismo peso y reps en todas las series (está cerca).
3. Si completó 50-79%: mismo peso, mismo rep target (consolidar técnica).
4. Si completó menos del 50%: bajá 1 ladrillo en todas las series, aumentá reps (~30% más).
5. Patrón de fallo 2-3 sesiones seguidas: sugerí deload u otro enfoque.

El peso debe ser múltiplo de ${brick}kg. ${langInstruction}
${profileNote}Respondé EXCLUSIVAMENTE con JSON válido (sin markdown):
{"sets": [{"weight": <number>, "reps": <number>}, ...], "reason": "<string>"}
El array "sets" debe tener EXACTAMENTE ${setsTarget} elementos.`;

    const resp = await fetchWithTimeout(GROQ_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
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
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error('Respuesta IA no válida');
      parsed = JSON.parse(m[0]);
    }

    return {
      sets: parseAndNormalizeSets(parsed, setsTarget, brick, repTarget),
      reason: (parsed as { reason?: string }).reason ?? '',
      source: 'groq',
    };
  }
}
