import { Injectable, computed, inject, signal } from '@angular/core';
import { AppSettings, UserProfile } from '../models/workout.model';
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
import {
  GROQ_MODEL,
  REASONING_MIN_TOKENS,
  reasoningOverridesFor,
  reasons,
} from './providers/groq.provider';
import { COHERE_MODEL } from './providers/cohere.provider';
import {
  CoachProposal,
  ResolvedWeight,
  diffSuggestions,
  layoffSinceFrom,
  parseCoachReply,
  resolveWeightProposal,
} from './coach-proposal';
import { ProgressionService } from './progression.service';
import { AiSessionContext } from './providers/session-context';
import { AiRecommendation } from '../models/workout.model';

export type ChatRole = 'user' | 'assistant';

/**
 * El modelo configurado no existe o la key no tiene acceso a él.
 *
 * Merece su propio tipo porque es el único fallo de la lista que el usuario puede arreglar
 * solo, y en un sitio concreto: el selector de modelo de Ajustes.
 */
export class ModelError extends Error {}

async function modelAwareError(provider: string, resp: Response): Promise<Error> {
  const body: unknown = await resp.json().catch(() => null);
  const error = (body as { error?: { code?: string; message?: string } } | null)?.error;
  if (error?.code === 'model_not_found' || /model/i.test(error?.message ?? '')) {
    return new ModelError(error?.message ?? 'model_not_found');
  }
  return new Error(`${provider} ${resp.status}`);
}

/** El peso tope y las reps de cada sugerencia: el "antes" contra el que se compara. */
function topsOf(
  byExercise: Partial<Record<string, AiRecommendation>>,
): Partial<Record<string, { weight: number; reps: number }>> {
  const out: Partial<Record<string, { weight: number; reps: number }>> = {};
  for (const [id, rec] of Object.entries(byExercise)) {
    if (!rec?.sets.length) continue;
    out[id] = { weight: Math.max(...rec.sets.map((s) => s.weight)), reps: rec.sets[0].reps };
  }
  return out;
}

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
  private readonly progression = inject(ProgressionService);

  readonly messages = signal<ChatMessage[]>(this.read());
  readonly sending = signal(false);
  /** Cambio de contexto que el coach propone y el atleta todavía no confirmó (T-811). */
  readonly proposal = signal<CoachProposal | null>(null);
  /** Los pesos de la propuesta ya resueltos contra la sesión y acotados (T-813). */
  readonly proposedWeights = signal<ResolvedWeight[]>([]);
  readonly error = signal<string | null>(null);

  /**
   * Las sugerencias completas que se guardarán si acepta, tal como se enseñaron.
   *
   * No es una señal porque nadie la pinta: es el compromiso entre lo que se previsualizó y
   * lo que se escribe. Se calcula al recibir la propuesta y se descarta si la rechaza.
   */
  private pendingApply: {
    dayId: string;
    byExercise: Partial<Record<string, AiRecommendation>>;
  } | null = null;

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
      const { text: reply, proposal } = parseCoachReply(await this.ask(settings, lang));
      this.push({ role: 'assistant', text: reply });
      // La propuesta NO se aplica: queda esperando confirmación. Que el chat cambie tus
      // números sin que lo veas es justo lo que hace desconfiar de la sugerencia.
      await this.previewProposal(proposal, settings);
    } catch (e) {
      if (e instanceof AuthError) this.error.set('auth');
      else if (e instanceof ModelError) this.error.set('model');
      else this.error.set('failed');
    } finally {
      this.usage.set(usageForMonth());
      this.sending.set(false);
    }
  }

  clear(): void {
    this.messages.set([]);
    this.dismissProposal();
    this.write([]);
  }

  dismissProposal(): void {
    this.pendingApply = null;
    this.proposal.set(null);
    this.proposedWeights.set([]);
  }

  /**
   * Deja una propuesta lista para enseñar, sin aplicar nada.
   *
   * Es el paso que `send()` da con lo que devuelve el modelo. Está expuesto aparte porque es
   * el punto en el que se decide QUÉ se va a guardar: poder ejercitarlo sin red es lo que
   * permite comprobar que lo aceptado y lo previsualizado son el mismo número.
   */
  async previewProposal(proposal: CoachProposal | null, settings: AppSettings): Promise<void> {
    this.proposal.set(proposal);
    this.proposedWeights.set(proposal ? await this.previewChanges(proposal, settings) : []);
  }

  /**
   * Aplica la propuesta: guarda el contexto y fija las sugerencias que ya se enseñaron.
   *
   * Se guarda EXACTAMENTE lo previsualizado. Recalcular aquí daría un número más "fresco",
   * pero aceptarías 32,5 y te quedaría 30: lo que confirmás tiene que ser lo que te queda.
   */
  async acceptProposal(): Promise<void> {
    const proposal = this.proposal();
    if (!proposal) return;
    const settings = this.state.settings();
    const pending = this.pendingApply;

    this.state.saveSettings({ ...settings, userProfile: this.profileWith(proposal, settings) });

    // El perfil va PRIMERO: cambia el hash, y las sugerencias van contra el nuevo.
    const ctx = pending ? this.sessionContext() : null;
    if (pending && ctx && ctx.dayId === pending.dayId) {
      this.progression.storeSuggestions(
        pending.dayId,
        this.progression.contextHash(ctx),
        pending.byExercise,
        'local',
      );
    }

    this.pendingApply = null;
    this.proposal.set(null);
    this.proposedWeights.set([]);
  }

  /** El perfil con la propuesta aplicada. No se guarda: sirve para previsualizar. */
  private profileWith(proposal: CoachProposal, settings: AppSettings): UserProfile {
    return {
      ...settings.userProfile,
      ...(proposal.notes !== undefined && { aiNotes: proposal.notes }),
      ...(proposal.goal !== undefined && { goal: proposal.goal }),
      ...(proposal.level !== undefined && { level: proposal.level }),
      ...(proposal.layoffDays !== undefined && {
        layoffSinceISO: layoffSinceFrom(this.storage.todayISO(), proposal.layoffDays),
      }),
    };
  }

  /**
   * Qué cambiaría si aceptás, calculado ANTES de aceptar nada.
   *
   * El contexto propuesto se aplica a un perfil de mentira, se le pide al motor la sesión con
   * ese perfil y se compara con la que hay. De ahí sale la tarjeta: "Press de Hombros,
   * 45 → 32,5. ¿Aceptás?". **El modelo aporta el DATO —dos meses parado—, el motor pone el
   * NÚMERO.** Por eso la propuesta aparece siempre que el contexto mueva algo, y no solo
   * cuando el modelo se acuerda de mandar pesos.
   *
   * Si además propuso pesos concretos, esos mandan sobre el motor para su ejercicio, pero
   * solo tras pasar por `resolveWeightProposal`, que los acota igual que a la IA.
   */
  private async previewChanges(
    proposal: CoachProposal,
    settings: AppSettings,
  ): Promise<ResolvedWeight[]> {
    this.pendingApply = null;
    const day = this.state.currentDay();
    if (!day) return [];

    const proposed: AppSettings = {
      ...settings,
      userProfile: this.profileWith(proposal, settings),
    };
    const live = this.state.state();
    const current = await this.progression.suggestionsForToday(day, settings, 'es', {
      state: live,
    });
    const ctx = this.progression.buildSessionContext(day, proposed, 'es', {
      beforeISO: this.storage.todayISO(),
      state: live,
    });
    const next = await this.progression.localSessionSuggestions(ctx);

    const byExercise: Partial<Record<string, AiRecommendation>> = { ...next.byExercise };
    const rows = new Map<string, ResolvedWeight>();
    for (const row of diffSuggestions(current.byExercise, next.byExercise, day.exercises)) {
      rows.set(row.exerciseId, row);
    }

    for (const w of resolveWeightProposal(
      proposal.weights ?? [],
      ctx,
      topsOf(current.byExercise),
    )) {
      rows.set(w.exerciseId, w);
      const setCount = day.exercises.find((e) => e.id === w.exerciseId)?.defaultSets || 3;
      byExercise[w.exerciseId] = {
        sets: Array.from({ length: setCount }, () => ({ weight: w.to, reps: w.reps })),
        reason: this.reasonFor(w),
        source: 'local',
      };
    }

    const resolved = [...rows.values()];
    if (resolved.length) this.pendingApply = { dayId: day.id, byExercise };
    return resolved;
  }

  /**
   * Contexto de la sesión que viene: lo que el chat necesita para hablar de pesos.
   *
   * Se le pasa el estado VIVO. `buildSessionContext` lo relee del almacenamiento si no se lo
   * dan, y eso deja al chat trabajando sobre lo último persistido en vez de sobre lo que el
   * atleta acaba de hacer.
   */
  private sessionContext(settings = this.state.settings()): AiSessionContext | null {
    const day = this.state.currentDay();
    if (!day) return null;
    return this.progression.buildSessionContext(day, settings, 'es', {
      beforeISO: this.storage.todayISO(),
      state: this.state.state(),
    });
  }

  /** El motivo deja claro de dónde salió el número: lo pediste vos en el chat. */
  private reasonFor(w: ResolvedWeight): string {
    const base = `Ajustado desde el chat: ${w.from} → ${w.to} kg.`;
    return w.clamped ? `${base} Se recortó al máximo seguro para tu historial.` : base;
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
      const model = settings.groqModel || GROQ_MODEL;
      const resp = await fetchAiWithRateLimit('Groq', GROQ_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key.value}` },
        body: JSON.stringify({
          model,
          // Un modelo que razona gasta tokens antes de escribir: sin margen extra la
          // respuesta llega cortada o vacía.
          max_tokens: reasons(model) ? Math.max(REASONING_MIN_TOKENS, MAX_TOKENS) : MAX_TOKENS,
          messages: [{ role: 'system', content: system }, ...history],
          temperature: 0.3,
          ...reasoningOverridesFor(model),
        }),
      });
      if (resp.status === 401 || resp.status === 403) throw new AuthError('Groq', 'auth');
      if (!resp.ok) throw await modelAwareError('Groq', resp);
      const data = await resp.json();
      recordUsage('groq', model, data?.usage);
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
    if (!resp.ok) throw await modelAwareError('Cohere', resp);
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

    // La próxima sesión con lo que se levantó por última vez en cada ejercicio. Sin esto el
    // coach no puede hablar de pesos: no sabe qué toca ni desde dónde.
    const ctx = this.sessionContext();
    const session = ctx
      ? ctx.exercises
          .map((ec) => {
            const sets = ec.lastSets?.filter((x) => !x.isWarmup) ?? [];
            const top = sets.length ? Math.max(...sets.map((x) => x.weight || 0)) : 0;
            const days = ec.lastSessionDate
              ? Math.round((Date.parse(ctx.todayISO) - Date.parse(ec.lastSessionDate)) / 86400000)
              : null;
            return `${ec.exercise.name}: ${top || '-'}kg${days === null ? '' : ` (hace ${days}d)`}`;
          })
          .join(' · ')
      : '';

    const rules =
      lang === 'en'
        ? [
            'You are a strength coach inside a training app. Answer briefly (max 4 sentences),',
            'in English. Never give medical advice; if the user mentions pain, tell them to see',
            'a professional. You cannot create or delete routine days.',
            '',
            'If the athlete states something DURABLE about their context (a new sport, an injury,',
            'a layoff, a change of goal or level), append this exact block at the END of your',
            'reply, with the FULL updated notes text (not just the new part):',
            '<<GT_CONTEXT>>{"notes":"...","goal":"strength|hypertrophy|endurance","level":"beginner|intermediate|advanced","layoffDays":60}<<END>>',
            'Include only the fields that change. Max 200 characters in notes.',
            'ALWAYS include "layoffDays" when they mention time away from training, as a',
            'number of days (2 months = 60). The app recalculates the loads from it.',
            '',
            'If asked to adjust loads, add a "weights" field in that same block with the',
            'exercises from the next session to change, using their exact name:',
            '"weights":[{"exercise":"Shoulder Press (Machine)","weight":35,"reps":8}]',
            'Only exercises from the list below. Weights are clamped against history',
            'afterwards, so propose what you believe is right and do not inflate.',
            'No block if you merely answered a question: that is not a context change.',
          ].join(' ')
        : [
            'Sos un entrenador de fuerza dentro de una app de entrenamiento. Respondé breve',
            '(máximo 4 frases), en español. Nunca des consejo médico; si mencionan dolor, decí',
            'que consulten a un profesional. No podés crear ni borrar días de rutina.',
            '',
            'Si el atleta cuenta algo DURADERO sobre su contexto (un deporte nuevo, una lesión,',
            'un parón, un cambio de objetivo o de nivel), añadí al FINAL de tu respuesta este',
            'bloque exacto, con el texto de notas COMPLETO ya actualizado (no solo lo nuevo):',
            '<<GT_CONTEXT>>{"notes":"...","goal":"strength|hypertrophy|endurance","level":"beginner|intermediate|advanced","layoffDays":60}<<END>>',
            'Incluí solo los campos que cambian. Máximo 200 caracteres en notes.',
            'Poné SIEMPRE "layoffDays" si menciona tiempo sin entrenar, en número de días',
            '(2 meses = 60). La app recalcula las cargas a partir de ese dato.',
            '',
            'Si te piden ajustar las cargas, añadí en ese mismo bloque un campo "weights" con',
            'los ejercicios de la próxima sesión que haya que cambiar, usando su nombre exacto:',
            '"weights":[{"exercise":"Press de Hombros (Máquina)","weight":35,"reps":8}]',
            'Solo ejercicios de la lista de abajo. El peso se acota luego contra el historial,',
            'así que proponé lo que creas correcto y no infles por si acaso.',
            'Nada de bloque si solo respondiste una duda: no es un cambio de contexto.',
          ].join(' ');

    const sessionLine = session
      ? `

Próxima sesión: ${session}`
      : '';
    return `${rules}\n\nDatos del atleta: ${facts.join(' · ')}${sessionLine}`;
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
