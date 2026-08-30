import { AiSessionProvider } from './ai-provider';
import { AiSessionContext, SessionRecommendation } from './session-context';
import { buildSessionPrompt, parseJsonLoose, sessionMaxTokens } from './session-prompt';
import { validateSessionResponse } from './session-response';
import { recordUsage } from './ai-usage';
import { AuthError, fetchAiWithRateLimit } from './prompt-helpers';

const COHERE_URL = 'https://api.cohere.com/v2/chat';
export const COHERE_MODEL = 'command-r7b-12-2024';

export class CohereProvider implements AiSessionProvider {
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
}
