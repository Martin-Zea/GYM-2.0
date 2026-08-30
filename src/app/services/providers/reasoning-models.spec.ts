import { REASONING_MIN_TOKENS, reasoningOverridesFor, reasons } from './groq.provider';

/**
 * El catálogo de Groq dejó de ofrecer los Llama de chat a todas las cuentas, así que el
 * modelo que elija el usuario casi seguro razona. Si no se detecta, la llamada de sesión se
 * queda sin tokens a mitad del razonamiento y Groq devuelve 400.
 */
describe('reasoningOverridesFor() — modelos que razonan (T-808)', () => {
  it('gpt-oss razona con esfuerzo bajo y el razonamiento oculto', () => {
    expect(reasoningOverridesFor('openai/gpt-oss-120b')).toEqual({
      reasoning_effort: 'low',
      reasoning_format: 'hidden',
    });
    expect(reasoningOverridesFor('openai/gpt-oss-20b').reasoning_format).toBe('hidden');
  });

  it('en qwen3 el razonamiento se apaga: aquí no aporta y se paga en cada llamada', () => {
    expect(reasoningOverridesFor('qwen/qwen3.8-27b')).toEqual({
      reasoning_effort: 'none',
      reasoning_format: 'hidden',
    });
    expect(reasoningOverridesFor('qwen/qwen3.6-27b').reasoning_effort).toBe('none');
  });

  it('un modelo que no razona no lleva overrides: mandarlos sería un 400', () => {
    expect(reasoningOverridesFor('llama-3.3-70b-versatile')).toEqual({});
    expect(reasoningOverridesFor('groq/compound')).toEqual({});
  });

  it('el razonamiento SIEMPRE va oculto: si se cuela en el cuerpo, rompe el JSON', () => {
    for (const model of ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b']) {
      expect(reasoningOverridesFor(model).reasoning_format).toBe('hidden');
    }
  });
});

describe('reasons()', () => {
  it('distingue los que necesitan más margen de salida', () => {
    expect(reasons('openai/gpt-oss-120b')).toBe(true);
    expect(reasons('qwen/qwen3.8-27b')).toBe(true);
    expect(reasons('llama-3.3-70b-versatile')).toBe(false);
  });

  it('el suelo de tokens deja terminar el razonamiento y el JSON', () => {
    expect(REASONING_MIN_TOKENS).toBeGreaterThanOrEqual(1000);
  });
});
