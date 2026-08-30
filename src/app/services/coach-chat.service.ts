import { Injectable, computed, inject, signal } from '@angular/core';
import { AppSettings } from '../models/workout.model';
import { StorageService } from './storage.service';
import { StateService } from './state.service';
import { ApiKeyService } from './api-key.service';
import { STORAGE_KEYS } from './storage-keys';
import {
  DEFAULT_TOKEN_BUDGET,
  isOverBudget,
  recordUsage,
  totalTokens,
  usageForMonth,
} from './providers/ai-usage';
import { AuthError, fetchAiWithRateLimit } from './providers/prompt-helpers';
import { GROQ_MODEL } from './providers/groq.provider';
import { COHERE_MODEL } from './providers/cohere.provider';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  text: string;
  atISO: string;
}

/** Por qué el chat no está disponible ahora mismo. `null` = se puede usar. */
export type ChatBlock = 'no_key' | 'offline' | 'over_budget' | null;

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const COHERE_URL = 'https://api.cohere.com/v2/chat';

/** Mensajes que se reenvían como contexto de la conversación. */
const HISTORY_WINDOW = 6;
/** Tope de mensajes guardados: el historial es una conveniencia, no un archivo. */
const HISTORY_CAP = 60;
/** Techo de la respuesta. Un coach que contesta un ensayo no se lee entre series. */
const MAX_TOKENS = 400;

/**
 * Chat con el coach (C2, RF-IA-10).
 *
 * ## Por qué esto no rompe el Art. 5
 *
 * El Art. 5 —UNA llamada por sesión— gobierna las llamadas AUTOMÁTICAS de progresión: las
 * que la app hace por su cuenta mientras el atleta entrena. Ahí el techo es lo que impide
 * que abrir la sesión dispare ocho peticiones.
 *
 * El chat es otra cosa: cada llamada la pide una persona escribiendo y pulsando enviar, y
 * ve el coste antes. Aun así no se deja suelto, porque "lo pidió el usuario" no es un
 * cheque en blanco:
 *
 * - una llamada por mensaje, nunca reintentos automáticos;
 * - solo se reenvían los últimos {@link HISTORY_WINDOW} mensajes, así una conversación
 *   larga no crece el coste sin límite;
 * - la respuesta está acotada a {@link MAX_TOKENS};
 * - consume el MISMO presupuesto mensual que la progresión y se corta al agotarlo. Si el
 *   chat tuviera bolsa propia, el presupuesto dejaría de significar nada.
 *
 * El historial vive en localStorage y no viaja en los backups: es conversación, no dato de
 * entrenamiento, y restaurar una copia no debería resucitar charlas viejas.
 */
@Injectable({ providedIn: 'root' })
export class CoachChatService {
  private readonly storage = inject(StorageService);
  private readonly state = inject(StateService);
  private readonly keys = inject(ApiKeyService);

  readonly messages = signal<ChatMessage[]>(this.read());
  readonly sending = signal(false);
  readonly error = signal<string | null>(null);

  readonly usage = signal(usageForMonth());

  readonly budget = computed(() => this.state.settings().aiTokenBudget ?? DEFAULT_TOKEN_BUDGET);

  readonly tokensUsed = computed(() => totalTokens(this.usage()));

  /** Qué impide usar el chat, si algo lo impide. */
  blockedBy(settings: AppSettings): ChatBlock {
    if (!this.resolveKey(settings)) return 'no_key';
    if (!navigator.onLine) return 'offline';
    if (isOverBudget(settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET)) return 'over_budget';
    return null;
  }

  async send(text: string, settings: AppSettings, lang: 'es' | 'en'): Promise<void> {
    const clean = text.trim();
    if (!clean || this.sending()) return;
    if (this.blockedBy(settings) !== null) return;

    this.error.set(null);
    this.push({ role: 'user', text: clean });
    this.sending.set(true);

    try {
      const reply = await this.ask(settings, lang);
      this.push({ role: 'assistant', text: reply });
    } catch (e) {
      this.error.set(e instanceof AuthError ? 'auth' : 'failed');
    } finally {
      this.usage.set(usageForMonth());
      this.sending.set(false);
    }
  }

  clear(): void {
    this.messages.set([]);
    this.write([]);
  }

  // ── Llamada ──

  private async ask(settings: AppSettings, lang: 'es' | 'en'): Promise<string> {
    const key = this.resolveKey(settings);
    if (!key) throw new Error('sin key');

    const history = this.messages()
      .slice(-HISTORY_WINDOW)
      .map((m) => ({ role: m.role, content: m.text }));
    const system = this.systemPrompt(lang);

    if (key.provider === 'groq') {
      const resp = await fetchAiWithRateLimit('Groq', GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.value}` },
        body: JSON.stringify({
          model: settings.groqModel || GROQ_MODEL,
          messages: [{ role: 'system', content: system }, ...history],
          temperature: 0.3,
          max_tokens: MAX_TOKENS,
        }),
      });
      if (resp.status === 401 || resp.status === 403) throw new AuthError('Groq', 'auth');
      if (!resp.ok) throw new Error(`Groq ${resp.status}`);
      const data = await resp.json();
      recordUsage('groq', settings.groqModel || GROQ_MODEL, data?.usage);
      return String(data?.choices?.[0]?.message?.content ?? '').trim();
    }

    const resp = await fetchAiWithRateLimit('Cohere', COHERE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.value}` },
      body: JSON.stringify({
        model: COHERE_MODEL,
        messages: [{ role: 'system', content: system }, ...history],
        temperature: 0.3,
        max_tokens: MAX_TOKENS,
      }),
    });
    if (resp.status === 401 || resp.status === 403) throw new AuthError('Cohere', 'auth');
    if (!resp.ok) throw new Error(`Cohere ${resp.status}`);
    const data = await resp.json();
    recordUsage('cohere', COHERE_MODEL, data?.meta?.tokens);
    const parts: unknown[] = data?.message?.content ?? [];
    return parts
      .map((p) =>
        typeof p === 'object' && p !== null ? String((p as { text?: string }).text ?? '') : '',
      )
      .join('')
      .trim();
  }

  /**
   * Contexto del atleta en pocas líneas.
   *
   * Deliberadamente CORTO: se manda entero en cada mensaje, así que cada línea de más se
   * paga en todos los turnos de la conversación, no una sola vez.
   */
  private systemPrompt(lang: 'es' | 'en'): string {
    const s = this.state.state();
    const p = s.settings.userProfile;
    const routine = this.state.activeRoutine();
    const days = this.state.days();
    const recent = s.sessions.filter((x) => !x.skipped).slice(-3);

    const facts = [
      p.level ? `nivel=${p.level}` : null,
      p.goal ? `objetivo=${p.goal}` : null,
      p.weightKg ? `peso=${p.weightKg}kg` : null,
      p.equipment?.length ? `equipo=${p.equipment.join(',')}` : null,
      p.aiNotes ? `notas=${p.aiNotes}` : null,
      routine ? `rutina=${routine.name} (${days.length} días)` : null,
      recent.length ? `ultimas_sesiones=${recent.map((x) => x.dateISO).join(',')}` : null,
    ].filter(Boolean);

    const rules =
      lang === 'en'
        ? 'You are a strength coach inside a training app. Answer briefly (max 4 sentences), in English. Never give medical advice; if the user mentions pain, tell them to see a professional. You cannot modify the app: if they ask for a change, explain where to do it.'
        : 'Sos un entrenador de fuerza dentro de una app de entrenamiento. Respondé breve (máximo 4 frases), en español. Nunca des consejo médico; si mencionan dolor, decí que consulten a un profesional. No podés modificar la app: si piden un cambio, explicá dónde hacerlo.';

    return `${rules}\n\nDatos del atleta: ${facts.join(' · ')}`;
  }

  private resolveKey(settings: AppSettings): { provider: 'groq' | 'cohere'; value: string } | null {
    const groq = this.keys.get('groq') || settings.apiKey;
    if (groq) return { provider: 'groq', value: groq };
    const cohere = this.keys.get('cohere') || settings.cohereApiKey;
    if (cohere) return { provider: 'cohere', value: cohere };
    return null;
  }

  // ── Persistencia ──

  private push(msg: Pick<ChatMessage, 'role' | 'text'>): void {
    const full: ChatMessage = {
      id: this.storage.uid(),
      atISO: new Date().toISOString(),
      ...msg,
    };
    const next = [...this.messages(), full].slice(-HISTORY_CAP);
    this.messages.set(next);
    this.write(next);
  }

  private read(): ChatMessage[] {
    try {
      const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEYS.coachChat) ?? '[]');
      return Array.isArray(raw) ? (raw as ChatMessage[]) : [];
    } catch {
      return [];
    }
  }

  private write(messages: ChatMessage[]): void {
    try {
      localStorage.setItem(STORAGE_KEYS.coachChat, JSON.stringify(messages));
    } catch {
      /* sin espacio: la conversación no vale una alerta ni bloquear el envío */
    }
  }
}
