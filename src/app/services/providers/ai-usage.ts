import { STORAGE_KEYS } from '../storage-keys';

/**
 * Contador de consumo de la capa IA (RF-IA-07, EA-6).
 *
 * Vive fuera del estado de la app a propósito: no es dato del usuario, no viaja en los
 * backups y perderlo no rompe nada. Se guarda por mes natural, que es como facturan los
 * proveedores y como el usuario piensa su presupuesto.
 */
export interface MonthUsage {
  month: string;
  inputTokens: number;
  outputTokens: number;
  calls: number;
}

/** Presupuesto mensual por defecto. Generoso para el uso normal, techo ante un bucle. */
export const DEFAULT_TOKEN_BUDGET = 200_000;

type UsageStore = Partial<Record<string, MonthUsage>>;

export function currentMonth(date = new Date()): string {
  return date.toISOString().slice(0, 7);
}

function read(): UsageStore {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.aiUsage) ?? '{}');
    return typeof parsed === 'object' && parsed !== null ? (parsed as UsageStore) : {};
  } catch {
    return {};
  }
}

function write(store: UsageStore): void {
  try {
    localStorage.setItem(STORAGE_KEYS.aiUsage, JSON.stringify(store));
  } catch {
    /* sin espacio: el contador es informativo, no vale una alerta */
  }
}

export function usageForMonth(month = currentMonth()): MonthUsage {
  return read()[month] ?? { month, inputTokens: 0, outputTokens: 0, calls: 0 };
}

interface RawUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Registra el `usage` que devuelven las APIs. Groq lo manda como `prompt_tokens` y Cohere
 * dentro de `meta.tokens`; ambos se normalizan aquí.
 *
 * Hasta F4 este dato llegaba en cada respuesta y se descartaba, así que no había forma de
 * saber cuánto gastaba la app (`audit.md` §6.4).
 */
export function recordUsage(
  provider: 'groq' | 'cohere',
  model: string,
  raw: unknown,
  month = currentMonth(),
): MonthUsage {
  const u = (raw ?? {}) as RawUsage;
  const input = u.prompt_tokens ?? u.input_tokens ?? 0;
  const output = u.completion_tokens ?? u.output_tokens ?? 0;

  const store = read();
  const entry = store[month] ?? { month, inputTokens: 0, outputTokens: 0, calls: 0 };
  const updated: MonthUsage = {
    month,
    inputTokens: entry.inputTokens + (Number.isFinite(input) ? input : 0),
    outputTokens: entry.outputTokens + (Number.isFinite(output) ? output : 0),
    calls: entry.calls + 1,
  };
  store[month] = updated;
  write(store);
  void provider;
  void model;
  return updated;
}

export function totalTokens(usage: MonthUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/**
 * `true` cuando el mes en curso agotó el presupuesto (EA-6).
 *
 * El corte es automático y cae al motor local: la app sigue funcionando entera, solo deja de
 * gastar. Un presupuesto de 0 desactiva la capa IA sin tener que borrar la key.
 */
export function isOverBudget(budget = DEFAULT_TOKEN_BUDGET, month = currentMonth()): boolean {
  if (budget <= 0) return true;
  return totalTokens(usageForMonth(month)) >= budget;
}

/** Borra el contador (para pruebas y para el botón de reinicio de Ajustes). */
export function resetUsage(): void {
  write({});
}
