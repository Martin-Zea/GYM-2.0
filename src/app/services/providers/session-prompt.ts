import { AiSessionContext, CONTEXT_DICTIONARY, fitToBudget } from './session-context';

/**
 * Prompt de sesión (RF-IA-03, Art. 5): un solo mensaje para todos los ejercicios del día.
 *
 * El contexto va en formato abreviado y neutro; el idioma solo se pide para el campo `why`,
 * de modo que cambiar de idioma no cambie el contexto ni invalide la caché.
 */
export function buildSessionPrompt(ctx: AiSessionContext): {
  prompt: string;
  tokens: number;
  droppedExercises: number;
} {
  const fitted = fitToBudget(ctx);
  const count = ctx.exercises.length - fitted.droppedExercises;
  const langName = ctx.lang === 'en' ? 'English' : 'Spanish';

  const prompt = `You are a strength coach. Decide the next session's working sets for each exercise.

DICTIONARY: ${CONTEXT_DICTIONARY}
Sessions are listed oldest first. Weights are kg.

DATA:
${fitted.text}

RULES:
- Never increase a working weight more than 10% over the athlete's last top set.
- Never suggest a weight of 0 or less for a loaded exercise.
- Round weights to the exercise's increment.
- If a feel is H (hard) or a note reports pain for that exercise, do not increase the load.
- Respect the exercise's set count.
- The "why" field: ONE short sentence in ${langName}.

Reply with JSON only, no markdown:
{"r":[{"e":<exercise index>,"sets":[{"w":<kg>,"r":<reps>}],"why":"<one sentence>"}]}
Include exactly ${count} entries in "r", one per exercise index from 1 to ${count}.`;

  return { prompt, tokens: fitted.text.length / 4, droppedExercises: fitted.droppedExercises };
}

/** Extrae el JSON de una respuesta que puede venir envuelta en markdown o texto. */
export function parseJsonLoose(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) throw new Error('Respuesta IA no válida');
    return JSON.parse(match[0]);
  }
}

/**
 * Techo de salida: ~70 tokens por ejercicio más margen para el JSON.
 *
 * Un `max_tokens` fijo y bajo cortaba la respuesta a mitad en días de 8 ejercicios, y una
 * respuesta truncada no es JSON válido: se perdía la llamada entera.
 */
export function sessionMaxTokens(exerciseCount: number): number {
  return Math.min(1500, 120 + exerciseCount * 70);
}
