import {
  DEFAULT_TOKEN_BUDGET,
  currentMonth,
  isOverBudget,
  recordUsage,
  resetUsage,
  totalTokens,
  usageForMonth,
} from './ai-usage';

describe('Contador de consumo de IA (RF-IA-07, EA-6)', () => {
  beforeEach(() => {
    localStorage.clear();
    resetUsage();
  });

  it('empieza en cero', () => {
    expect(totalTokens(usageForMonth())).toBe(0);
  });

  it('acumula el usage de Groq (prompt/completion)', () => {
    recordUsage('groq', 'llama', { prompt_tokens: 800, completion_tokens: 200 });
    recordUsage('groq', 'llama', { prompt_tokens: 100, completion_tokens: 50 });

    const usage = usageForMonth();
    expect(usage.inputTokens).toBe(900);
    expect(usage.outputTokens).toBe(250);
    expect(usage.calls).toBe(2);
  });

  it('acepta el formato de Cohere (input/output)', () => {
    recordUsage('cohere', 'command', { input_tokens: 300, output_tokens: 100 });
    expect(totalTokens(usageForMonth())).toBe(400);
  });

  it('un usage ausente o corrupto cuenta la llamada pero no inventa tokens', () => {
    recordUsage('groq', 'llama', undefined);
    recordUsage('groq', 'llama', { prompt_tokens: NaN });

    expect(usageForMonth().calls).toBe(2);
    expect(totalTokens(usageForMonth())).toBe(0);
  });

  it('cada mes cuenta por separado', () => {
    recordUsage('groq', 'llama', { prompt_tokens: 500 }, '2026-07');
    recordUsage('groq', 'llama', { prompt_tokens: 100 }, '2026-08');

    expect(totalTokens(usageForMonth('2026-07'))).toBe(500);
    expect(totalTokens(usageForMonth('2026-08'))).toBe(100);
  });

  it('corta al llegar al presupuesto', () => {
    expect(isOverBudget(1000)).toBe(false);
    recordUsage('groq', 'llama', { prompt_tokens: 1000 });
    expect(isOverBudget(1000)).toBe(true);
  });

  it('un presupuesto de 0 apaga la IA sin tener que borrar la key', () => {
    expect(isOverBudget(0)).toBe(true);
  });

  it('el presupuesto por defecto no corta a la primera sesión', () => {
    recordUsage('groq', 'llama', { prompt_tokens: 1200, completion_tokens: 400 });
    expect(isOverBudget(DEFAULT_TOKEN_BUDGET)).toBe(false);
  });

  it('el mes actual tiene formato AAAA-MM', () => {
    expect(currentMonth(new Date('2026-08-29T10:00:00Z'))).toBe('2026-08');
  });
});
