import { AiRecommendation } from '../../models/workout.model';
import { AiProvider, AiProviderContext, AiSessionProvider } from './ai-provider';
import { AiSessionContext, SessionRecommendation } from './session-context';
import { buildSessionPrompt, parseJsonLoose, sessionMaxTokens } from './session-prompt';
import { validateSessionResponse } from './session-response';
import { recordUsage } from './ai-usage';
import {
  buildFeedbackNote,
  buildGoalNote,
  buildHistoryDetail,
  buildPerfilParts,
  buildPrinciplesPrompt,
  buildProfileNote,
  AuthError,
  fetchAiWithRateLimit,
  parseAndNormalizeSets,
  unitPromptLabel,
} from './prompt-helpers';

const COHERE_URL = 'https://api.cohere.com/v2/chat';
export const COHERE_MODEL = 'command-r7b-12-2024';

export class CohereProvider implements AiProvider, AiSessionProvider {
  readonly name = 'cohere' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = COHERE_MODEL,
  ) {}

  /** UNA llamada para toda la sesión (Art. 5). */
  async recommendSession(ctx: AiSessionContext): Promise<SessionRecommendation> {
    const { prompt } = buildSessionPrompt(ctx);
    const resp = await fetchAiWithRateLimit('Cohere', COHERE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: 0,
        max_tokens: sessionMaxTokens(ctx.exercises.length),
        response_format: { type: 'json_object' },
      }),
    });
    if (resp.status === 401 || resp.status === 403) {
      throw new AuthError('Cohere', `Cohere ${resp.status}`);
    }
    if (!resp.ok) {
      throw new Error(`Cohere ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
    }

    const data = await resp.json();
    const parsed = parseJsonLoose(data?.message?.content?.[0]?.text ?? '');
    const validated = validateSessionResponse(parsed, ctx, 'cohere');
    recordUsage('cohere', this.model, data?.usage?.tokens ?? data?.meta?.tokens);
    return { byExercise: validated.byExercise, source: 'cohere', validated };
  }

  async recommend({
    exercise,
    todaySets,
    lastSets,
    history,
    userProfile,
    lastSessionDate,
    lang,
    lastFeel,
    lastNote,
  }: AiProviderContext): Promise<AiRecommendation> {
    const brick = exercise.brick || 2.5;
    const repTarget = exercise.defaultRepTarget || 10;
    const setsTarget = exercise.defaultSets || 3;

    const doneSets = todaySets.filter((s) => s?.done && !s.isWarmup);
    const perfilParts = buildPerfilParts(userProfile);
    const profileNote = buildProfileNote(perfilParts, userProfile);
    const goalNote = buildGoalNote(userProfile.goal, userProfile.aiNotes, userProfile.level);
    const feedbackNote = buildFeedbackNote(lastFeel, lastNote);

    const summary = {
      ejercicio: exercise.name,
      unidad: unitPromptLabel(exercise.unit),
      objetivo: `${setsTarget}x${repTarget}`,
      ladrillo_kg: brick,
      dias_desde_ultima: lastSessionDate
        ? Math.round(
            (new Date().getTime() - new Date(lastSessionDate).getTime()) / (1000 * 60 * 60 * 24),
          )
        : null,
      ...(perfilParts.length && { perfil: perfilParts.join(', ') }),
      hoy: doneSets.map((s, i) => ({
        s: i + 1,
        kg: typeof s.weight === 'number' ? s.weight : 0,
        r: typeof s.reps === 'number' ? s.reps : 0,
      })),
      anterior: (lastSets ?? []).map((s, i) => ({ s: i + 1, kg: s.weight, r: s.reps })),
      historial: buildHistoryDetail(history),
    };

    const langInstruction =
      lang === 'en' ? 'Reason: 1 sentence in English.' : 'Razón: 1 oración español.';

    const prompt = `Entrenador de hipertrofia. Analizá los datos y decidí la recomendación para la próxima sesión.
Datos: ${JSON.stringify(summary)}
${buildPrinciplesPrompt(brick, true)}${goalNote}${feedbackNote}${profileNote}${langInstruction}
JSON EXCLUSIVO (sin markdown): {"sets":[{"weight":<n>,"reps":<n>}...],"reason":"<s>","deload":<bool>}
Sets: EXACTAMENTE ${setsTarget} elementos. "deload" true SOLO si recomendás descarga/back-off intencional (menos reps/segundos o carga que la sesión anterior); si no, false.`;

    const resp = await fetchAiWithRateLimit('Cohere', COHERE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        temperature: 0,
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
      sets: parseAndNormalizeSets(parsed, setsTarget, brick, repTarget, {
        unit: exercise.unit,
        lastSets,
        deload: (parsed as { deload?: boolean }).deload === true,
      }),
      reason: (parsed as { reason?: string }).reason ?? '',
      source: 'cohere',
    };
  }
}
