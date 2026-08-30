import { Injectable, computed, inject, signal } from '@angular/core';
import { StateService } from './state.service';
import { KeyVault } from './crypto-keys';
import { GROQ_MODEL } from './providers/groq.provider';
import { COHERE_MODEL } from './providers/cohere.provider';
import { AI_TIMEOUT_MS } from './providers/prompt-helpers';

export type AiProviderName = 'groq' | 'cohere';

export type ConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'auth' | 'network' | 'empty' | 'model' | 'other'; detail?: string };

/**
 * Custodia de las API keys (RF-IA-08, Art. 4).
 *
 * En el estado persistido solo hay texto cifrado; el texto plano existe únicamente en memoria
 * y solo mientras la pestaña está abierta. Los proveedores lo piden aquí en el momento de
 * llamar, que siempre es asíncrono, así que nada obliga a exponerlo de forma sincrónica.
 */
@Injectable({ providedIn: 'root' })
export class ApiKeyService {
  private readonly state = inject(StateService);
  private readonly vault = inject(KeyVault);

  private readonly plain = signal<Record<AiProviderName, string>>({ groq: '', cohere: '' });

  /** `true` cuando hay al menos una key configurada (para la UI, sin revelar su valor). */
  readonly hasAnyKey = computed(() => !!this.plain().groq || !!this.plain().cohere);

  readonly ready = signal(false);

  /**
   * Carga las keys al arrancar y, si encuentra alguna en claro de una versión anterior, la
   * cifra y borra el original del estado.
   *
   * La migración va aquí y no en `migrate()` porque cifrar es asíncrono y las migraciones de
   * esquema son sincrónicas por diseño (tienen que resolverse antes del primer render).
   */
  async init(): Promise<void> {
    const settings = this.state.settings();
    const next = { groq: '', cohere: '' };

    next.groq = settings.apiKey || (await this.vault.open(settings.apiKeySealed));
    next.cohere = settings.cohereApiKey || (await this.vault.open(settings.cohereApiKeySealed));
    this.plain.set(next);
    this.ready.set(true);

    // Key en claro heredada: se sella y se limpia del estado en el mismo guardado
    if (settings.apiKey || settings.cohereApiKey) {
      const sealedGroq = next.groq ? await this.vault.seal(next.groq) : null;
      const sealedCohere = next.cohere ? await this.vault.seal(next.cohere) : null;
      // Sin vault disponible no se borra el texto plano: perder la key del usuario para
      // "protegerla" sería peor que dejarla como estaba.
      if (!this.vault.available) return;
      this.state.saveSettings({
        ...this.state.settings(),
        apiKey: '',
        cohereApiKey: '',
        apiKeySealed: sealedGroq ?? undefined,
        cohereApiKeySealed: sealedCohere ?? undefined,
      });
    }
  }

  get(provider: AiProviderName): string {
    return this.plain()[provider];
  }

  /** Guarda una key: en memoria en claro, en el estado cifrada. */
  async set(provider: AiProviderName, value: string): Promise<void> {
    const trimmed = value.trim();
    this.plain.update((p) => ({ ...p, [provider]: trimmed }));

    const settings = this.state.settings();
    const sealed = trimmed ? await this.vault.seal(trimmed) : null;
    const field = provider === 'groq' ? 'apiKeySealed' : 'cohereApiKeySealed';
    const plainField = provider === 'groq' ? 'apiKey' : 'cohereApiKey';

    this.state.saveSettings({
      ...settings,
      [field]: sealed ?? undefined,
      // Sin WebCrypto se guarda en claro, como antes, pero el usuario lo sabe: la UI avisa.
      [plainField]: sealed ? '' : trimmed,
    });
  }

  /**
   * Prueba la conexión con una llamada mínima (RF-IA-08).
   *
   * Distingue "key inválida" de "no hay red": son dos problemas distintos y el usuario solo
   * puede arreglar el primero.
   */
  async testConnection(provider: AiProviderName): Promise<ConnectionResult> {
    const key = this.get(provider);
    if (!key) return { ok: false, reason: 'empty' };

    const url =
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1/chat/completions'
        : 'https://api.cohere.com/v2/chat';
    const model =
      provider === 'groq'
        ? (this.state.settings().groqModel ?? GROQ_MODEL)
        : (this.state.settings().cohereModel ?? COHERE_MODEL);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify({
          model,
          messages: [{ role: 'user', content: 'ping' }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      if (resp.ok) return { ok: true };
      if (resp.status === 401 || resp.status === 403) return { ok: false, reason: 'auth' };
      // Un modelo retirado o fuera del plan de la key devuelve 400/404 con `model_not_found`.
      // Sin distinguirlo, el usuario ve "error 400" y no puede saber que basta con elegir otro.
      const body: unknown = await resp.json().catch(() => null);
      if (isModelError(body)) return { ok: false, reason: 'model', detail: model };
      return { ok: false, reason: 'other', detail: String(resp.status) };
    } catch (e) {
      return { ok: false, reason: 'network', detail: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Modelos que ESTA key puede usar de verdad (RF-IA-08).
   *
   * Se pregunta al proveedor en vez de mantener una lista en el código: los catálogos cambian
   * y el acceso depende del plan de cada cuenta, así que una constante quemada acaba
   * apuntando a un modelo que existe en la documentación pero no para quien la usa.
   */
  async listModels(provider: AiProviderName): Promise<string[]> {
    const key = this.get(provider);
    if (!key) return [];

    const url =
      provider === 'groq'
        ? 'https://api.groq.com/openai/v1/models'
        : 'https://api.cohere.com/v1/models';

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
    try {
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${key}` },
        signal: controller.signal,
      });
      if (!resp.ok) return [];
      const data: unknown = await resp.json();
      return extractModelIds(data, provider);
    } catch {
      return [];
    } finally {
      clearTimeout(timer);
    }
  }
}

export function isModelError(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: { code?: string; message?: string } }).error;
  const code = error?.code ?? '';
  const message = error?.message ?? '';
  return code === 'model_not_found' || /model/i.test(message);
}

/**
 * Groq responde `{ data: [{ id }] }` (formato OpenAI) y Cohere `{ models: [{ name }] }`.
 * Los de audio y embeddings se descartan: aquí solo sirven los de chat.
 */
export function extractModelIds(data: unknown, provider: AiProviderName): string[] {
  if (typeof data !== 'object' || data === null) return [];
  const rows: unknown[] =
    provider === 'groq'
      ? ((data as { data?: unknown[] }).data ?? [])
      : ((data as { models?: unknown[] }).models ?? []);
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => {
      if (typeof row !== 'object' || row === null) return '';
      const r = row as { id?: string; name?: string };
      return r.id ?? r.name ?? '';
    })
    .filter((id) => id && !/whisper|tts|embed|rerank|guard/i.test(id))
    .sort();
}
