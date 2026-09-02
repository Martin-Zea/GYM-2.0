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
  RoutineRequest,
  diffSuggestions,
  layoffFromText,
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

/** Si el JSON llega sin `reply`, algo hay que enseñar: un globo vacío parece un fallo. */
function fallbackReply(lang: 'es' | 'en'): string {
  return lang === 'en' ? 'Noted.' : 'Anotado.';
}

/**
 * Recoge el parón del mensaje del atleta cuando el modelo no lo recogió.
 *
 * El modelo va primero: entiende la frase y nosotros no. Pero cuando se lo salta, el atleta
 * lee "ajustaremos las cargas" y no pasa nada — que es exactamente lo que hace desconfiar de
 * la app. Prometer un cambio y no hacerlo es peor que no ofrecerlo.
 */
function withLayoffFallback(
  proposal: CoachProposal | null,
  userText: string,
): CoachProposal | null {
  if (proposal?.layoffDays !== undefined) return proposal;
  const days = layoffFromText(userText);
  if (days === null) return proposal;
  return { ...(proposal ?? {}), layoffDays: days };
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
  /**
   * Petición de rutina pendiente de ofrecer (T-830).
   *
   * Va aparte de `proposal` porque no es un cambio de contexto: no se acepta ni se guarda,
   * se usa para abrir el generador con la spec puesta. El chat sigue sin crear ni borrar
   * días — quien construye es el generador, y solo cuando el usuario pulsa.
   */
  readonly routineRequest = signal<RoutineRequest | null>(null);
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
      const {
        text: reply,
        proposal,
        routineRequest,
      } = parseCoachReply(await this.ask(settings, lang));
      this.push({ role: 'assistant', text: reply || fallbackReply(lang) });
      // La propuesta NO se aplica: queda esperando confirmación. Que el chat cambie tus
      // números sin que lo veas es justo lo que hace desconfiar de la sugerencia.
      await this.previewProposal(withLayoffFallback(proposal, clean), settings);
      this.routineRequest.set(routineRequest);
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
    this.routineRequest.set(null);
    this.write([]);
  }

  dismissProposal(): void {
    this.pendingApply = null;
    this.proposal.set(null);
    this.proposedWeights.set([]);
  }

  /**
   * Devuelve la petición de rutina y la borra.
   *
   * Se CONSUME, no se lee: si se quedara, volver al chat después de generar y guardar
   * seguiría ofreciendo lo mismo, y un segundo toque crearía una rutina duplicada.
   */
  consumeRoutineRequest(): RoutineRequest | null {
    const req = this.routineRequest();
    this.routineRequest.set(null);
    return req;
  }

  dismissRoutineRequest(): void {
    this.routineRequest.set(null);
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
      // La ventana completa: desde cuándo no entrena Y cuándo lo contó. La segunda fecha es
      // la que deja que una sesión real posterior le gane a la declaración (T-827).
      ...(proposal.layoffDays !== undefined && {
        layoffSinceISO: layoffSinceFrom(this.storage.todayISO(), proposal.layoffDays),
        layoffDeclaredISO: this.storage.todayISO(),
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
          response_format: { type: 'json_object' },
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
        response_format: { type: 'json_object' },
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

    // El contrato es un OBJETO JSON, no texto con un bloque pegado al final. La versión
    // anterior pedía un bloque `<<GT_CONTEXT>>` y el modelo se lo saltaba: contestaba
    // "ajustaremos las cargas" sin mandar un solo dato, y la app no tenía nada que aplicar.
    // Como campo obligatorio de un JSON obligatorio, el dato llega.
    const rules =
      lang === 'en'
        ? [
            'You are a strength coach inside a training app.',
            'ALWAYS answer with a single JSON object, nothing else:',
            '{"reply":"your answer, max 4 sentences, in English"}',
            'Never give medical advice; if they mention pain, tell them to see a professional.',
            'You cannot create or delete routine days.',
            'If they ask you to BUILD a new routine, answer briefly and add:',
            '"routineRequest": {"daysPerWeek": 4, "minutes": 60}',
            '  The app then opens its routine generator with that already filled in.',
            '  Only when they ask for a routine to be built — not when they ask your opinion',
            '  about how many days to train.',
            '',
            'Add these fields ONLY when the athlete states something DURABLE:',
            '"layoffDays": days without training, as a number (2 months = 60).',
            '  Include it WHENEVER they mention time away — the app recalculates loads from it.',
            '"notes": their full updated context, max 200 chars (not just the new part).',
            '"goal": "strength" | "hypertrophy" | "endurance".',
            '"level": "beginner" | "intermediate" | "advanced".',
            '"weights": [{"exercise":"Shoulder Press (Machine)","weight":35,"reps":8}]',
            '  only if asked to adjust loads, using exact names from the list below.',
            '  Loads are clamped against their history afterwards: do not inflate.',
            '',
            'Answering a question is not a context change: send only "reply".',
          ].join(' ')
        : [
            'Sos un entrenador de fuerza dentro de una app de entrenamiento.',
            'Respondé SIEMPRE con un único objeto JSON, nada más:',
            '{"reply":"tu respuesta, máximo 4 frases, en español"}',
            'Nunca des consejo médico; si mencionan dolor, decí que consulten a un profesional.',
            'No podés crear ni borrar días de rutina.',
            'Si te piden ARMAR una rutina nueva, contestá breve y añadí:',
            '"routineRequest": {"daysPerWeek": 4, "minutes": 60}',
            '  La app abre entonces su generador de rutinas con eso ya puesto.',
            '  Solo cuando piden que se les arme una — no cuando preguntan tu opinión sobre',
            '  cuántos días entrenar.',
            '',
            'Añadí estos campos SOLO si el atleta cuenta algo DURADERO:',
            '"layoffDays": días sin entrenar, en número (2 meses = 60).',
            '  Ponelo SIEMPRE que mencione tiempo parado — la app recalcula las cargas con eso.',
            '"notes": su contexto completo ya actualizado, máx 200 caracteres (no solo lo nuevo).',
            '"goal": "strength" | "hypertrophy" | "endurance".',
            '"level": "beginner" | "intermediate" | "advanced".',
            '"weights": [{"exercise":"Press de Hombros (Máquina)","weight":35,"reps":8}]',
            '  solo si te piden ajustar cargas, con los nombres exactos de la lista de abajo.',
            '  El peso se acota luego contra su historial: no infles por si acaso.',
            '',
            'Responder una duda no es un cambio de contexto: mandá solo "reply".',
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
