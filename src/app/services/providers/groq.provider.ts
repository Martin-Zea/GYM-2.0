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

export const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Overrides del body de chat completions para modelos "de razonamiento" (piensan antes
 * de responder). Sin esto, el `max_tokens` bajo de esta función se agota en tokens de
 * razonamiento antes de llegar al JSON, y Groq devuelve 400 "Failed to validate JSON".
 * `llama-3.3-70b-versatile` no es un modelo de razonamiento y no necesita overrides.
 */
export interface GroqRequestOverrides {
  reasoning_effort?: string;
  reasoning_format?: 'hidden' | 'raw' | 'parsed';
  max_tokens?: number;
}

/**
 * Arma el prompt y pega a la API de Groq con el `model` dado, devolviendo la
 * recomendación normalizada. Parametrizada por modelo para poder reusarla tanto desde
 * `GroqProvider` (modelo de producción) como desde el shadow logging (modelos candidatos
 * a evaluar) sin duplicar el armado del prompt — ver `specs/ai-shadow-log.md`.
 */
export async function fetchGroqRecommendation(
  {
    exercise,
    todaySets,
    lastSets,
    history,
    userProfile,
    lastSessionDate,
    lang,
    lastFeel,
    lastNote,
  }: AiProviderContext,
  apiKey: string,
  model: string,
  overrides: GroqRequestOverrides = {},
): Promise<AiRecommendation> {
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
    objetivo: `${setsTarget} series x ${repTarget} reps`,
    ladrillo_kg: brick,
    dias_desde_ultima_sesion: lastSessionDate
      ? Math.round(
          (new Date().getTime() - new Date(lastSessionDate).getTime()) / (1000 * 60 * 60 * 24),
        )
      : null,
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
    historial_sesiones: buildHistoryDetail(history),
  };

  const langInstruction =
    lang === 'en'
      ? 'The "reason" field must be in English. Maximum 1 sentence, technical and motivating.'
      : 'La razón: máximo 1 oración, español, técnica y motivadora.';

  const prompt = `Sos un entrenador profesional. Analizá los datos reales del atleta y decidí la mejor recomendación para la próxima sesión.

Datos:
${JSON.stringify(summary, null, 2)}

${buildPrinciplesPrompt(brick)}
${goalNote}${feedbackNote}${profileNote}${langInstruction}
Respondé EXCLUSIVAMENTE con JSON válido (sin markdown):
{"sets": [{"weight": <number>, "reps": <number>}, ...], "reason": "<string>", "deload": <boolean>}
El array "sets" debe tener EXACTAMENTE ${setsTarget} elementos.
Poné "deload" en true SOLO cuando recomendás una descarga o back-off intencional (menos reps/segundos o menos carga que la sesión anterior para recuperar). Si no, "deload": false.`;

  const resp = await fetchAiWithRateLimit('Groq', GROQ_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0,
      max_tokens: overrides.max_tokens ?? 300,
      response_format: { type: 'json_object' },
      ...(overrides.reasoning_effort && { reasoning_effort: overrides.reasoning_effort }),
      ...(overrides.reasoning_format && { reasoning_format: overrides.reasoning_format }),
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

  // Cuenta contra el presupuesto igual que una llamada de sesión: el shadow log pasa por
  // aquí y su gasto es tan real como el resto (RF-IA-07, decisión T-001).
  recordUsage('groq', model, data?.usage);

  return {
    sets: parseAndNormalizeSets(parsed, setsTarget, brick, repTarget, {
      unit: exercise.unit,
      lastSets,
      deload: (parsed as { deload?: boolean }).deload === true,
    }),
    reason: (parsed as { reason?: string }).reason ?? '',
    source: 'groq',
  };
}

export class GroqProvider implements AiProvider, AiSessionProvider {
  readonly name = 'groq' as const;

  constructor(
    private readonly apiKey: string,
    private readonly model: string = GROQ_MODEL,
  ) {}

  recommend(ctx: AiProviderContext): Promise<AiRecommendation> {
    return fetchGroqRecommendation(ctx, this.apiKey, this.model);
  }

  /** UNA llamada para toda la sesión (Art. 5). */
  async recommendSession(ctx: AiSessionContext): Promise<SessionRecommendation> {
    const { prompt } = buildSessionPrompt(ctx);
    const resp = await fetchAiWithRateLimit('Groq', GROQ_URL, {
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
      throw new AuthError('Groq', `Groq ${resp.status}`);
    }
    if (!resp.ok) {
      throw new Error(`Groq ${resp.status}: ${(await resp.text()).slice(0, 120)}`);
    }

    const data = await resp.json();
    const parsed = parseJsonLoose(data?.choices?.[0]?.message?.content ?? '');
    const validated = validateSessionResponse(parsed, ctx, 'groq');
    recordUsage('groq', this.model, data?.usage);
    return { byExercise: validated.byExercise, source: 'groq', validated };
  }
}
