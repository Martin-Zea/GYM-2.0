import { Injectable, computed, inject, signal } from '@angular/core';
import { StateService } from './state.service';
import { KeyVault } from './crypto-keys';
import { GROQ_MODEL } from './providers/groq.provider';
import { COHERE_MODEL } from './providers/cohere.provider';
import { AI_TIMEOUT_MS } from './providers/prompt-helpers';

export type AiProviderName = 'groq' | 'cohere';

export type ConnectionResult =
  | { ok: true }
  | { ok: false; reason: 'auth' | 'network' | 'empty' | 'other'; detail?: string };

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
      return { ok: false, reason: 'other', detail: String(resp.status) };
    } catch (e) {
      return { ok: false, reason: 'network', detail: (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
}
