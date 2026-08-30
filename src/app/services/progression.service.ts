import { Injectable, inject, signal } from '@angular/core';
import {
  AiRecommendation,
  AppSettings,
  AppState,
  Exercise,
  Session,
  SetRecord,
  TodaySetProgress,
  TrainingFeel,
  UserProfile,
} from '../models/workout.model';

import { HistoryEntry, StorageService, defaultUserProfile } from './storage.service';
import { AiShadowLogService } from './ai-shadow-log.service';
import { ApiKeyService } from './api-key.service';
import { AiProvider, AiProviderContext } from './providers/ai-provider';
import { CohereProvider } from './providers/cohere.provider';
import { GroqProvider } from './providers/groq.provider';
import { LocalProvider } from './providers/local.provider';
import { AiSessionProvider } from './providers/ai-provider';
import {
  AiSessionContext,
  SessionRecommendation,
  serializeSessionContext,
} from './providers/session-context';
import { DEFAULT_TOKEN_BUDGET, isOverBudget } from './providers/ai-usage';
import { checksumOf } from './backup-format';
import { AuthError, RateLimitError, roundToBrick } from './providers/prompt-helpers';
import { STORAGE_KEYS } from './storage-keys';

const AI_CACHE_KEY = STORAGE_KEYS.aiCache;

interface AiCacheEntry {
  rec: AiRecommendation;
  lastSessionISO: string | null;
  cachedForDate: string;
  profileSig: string;
}

const NEXT_KEY = STORAGE_KEYS.nextSuggestions;

/**
 * Sugerencias de una sesión completa, calculadas al CERRAR la anterior (RF-IA-06b).
 *
 * Se guardan por día y se validan por `contextHash`: si el contexto que las originó ya no es
 * el actual (entrenó otra vez, cambió el perfil, editó historial), la entrada deja de valer
 * sola, sin necesidad de borrarla (RF-IA-06).
 */
interface SessionSuggestionEntry {
  contextHash: string;
  byExercise: Partial<Record<string, AiRecommendation>>;
  source: 'groq' | 'cohere' | 'local';
  atISO: string;
}

@Injectable({ providedIn: 'root' })
export class ProgressionService {
  private readonly storage = inject(StorageService);
  private readonly shadowLog = inject(AiShadowLogService);
  private readonly keys = inject(ApiKeyService);
  private readonly local = new LocalProvider();

  private readCache(): Partial<Record<string, AiCacheEntry>> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(AI_CACHE_KEY) ?? '{}');
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Partial<Record<string, AiCacheEntry>>)
        : {};
    } catch {
      return {};
    }
  }

  private profileSig(profile: UserProfile): string {
    const noteHash = profile.aiNotes
      ? String(profile.aiNotes.split('').reduce((a, c) => ((a << 5) - a + c.charCodeAt(0)) | 0, 0))
      : '';
    return `${profile.goal ?? ''}:${noteHash}`;
  }

  // La recomendación del día es ESTABLE: una vez emitida para (ejercicio, fecha, última
  // sesión, perfil) no cambia aunque el usuario marque series — un número que baila sin
  // datos nuevos destruye la confianza. La adaptación llega vía feedback explícito.
  private getCached(
    exerciseId: string,
    lastSessionISO: string | null,
    profile: UserProfile,
  ): AiRecommendation | null {
    const entry = this.readCache()[exerciseId];
    // Descarta entradas corruptas (caché de una versión vieja o JSON manipulado)
    if (!entry || !entry.rec || !Array.isArray(entry.rec.sets)) return null;
    if (entry.cachedForDate !== this.storage.todayISO()) return null;
    if (entry.lastSessionISO !== lastSessionISO) return null;
    if (entry.profileSig !== this.profileSig(profile)) return null;
    return entry.rec;
  }

  private setCached(
    exerciseId: string,
    lastSessionISO: string | null,
    rec: AiRecommendation,
    profile: UserProfile,
  ): void {
    const cache = this.readCache();
    cache[exerciseId] = {
      rec,
      lastSessionISO,
      cachedForDate: this.storage.todayISO(),
      profileSig: this.profileSig(profile),
    };
    localStorage.setItem(AI_CACHE_KEY, JSON.stringify(cache));
  }

  private readNextStore(): Partial<Record<string, SessionSuggestionEntry>> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(NEXT_KEY) ?? '{}');
      return typeof parsed === 'object' && parsed !== null
        ? (parsed as Partial<Record<string, SessionSuggestionEntry>>)
        : {};
    } catch {
      return {};
    }
  }

  /**
   * Sugerencias ya calculadas para este día, si el contexto sigue siendo el mismo.
   *
   * Es lo que hace que H2 nunca espere a la red: el trabajo se hizo al cerrar la sesión
   * anterior. Si el hash no coincide NO se pide nada en directo — se cae al motor local, que
   * es instantáneo (RF-IA-06b, Art. 8).
   */
  suggestionsForDay(dayId: string, contextHash: string): SessionSuggestionEntry | null {
    const entry = this.readNextStore()[dayId];
    if (!entry || entry.contextHash !== contextHash) return null;
    return entry;
  }

  /**
   * Fija las sugerencias de un día, pisando lo precalculado (T-813).
   *
   * Lo usa el chat cuando el atleta ACEPTA un cambio de pesos. Se guarda con el hash del
   * contexto actual para que siga valiendo lo mismo que el resto: si después entrena o
   * cambia el perfil, el hash deja de coincidir y estas sugerencias caducan solas, igual que
   * las que calcula la IA. No hay una vía paralela que sobreviva a sus datos.
   */
  storeSuggestions(
    dayId: string,
    contextHash: string,
    byExercise: Partial<Record<string, AiRecommendation>>,
    source: 'groq' | 'cohere' | 'local',
  ): void {
    try {
      const store = this.readNextStore();
      store[dayId] = { contextHash, byExercise, source, atISO: new Date().toISOString() };
      localStorage.setItem(NEXT_KEY, JSON.stringify(store));
    } catch {
      /* sin espacio: la sugerencia se recalcula, no vale una alerta */
    }
  }

  /** Hash del contexto serializado: la clave de caché de RF-IA-06. */
  contextHash(ctx: AiSessionContext): string {
    return checksumOf(serializeSessionContext(ctx));
  }

  /**
   * Arma el contexto de una sesión a partir del estado (RF-IA-03).
   *
   * Vive aquí y no en el componente para que el hash de caché lo produzca siempre el mismo
   * código: dos formas de construir el contexto son dos claves distintas para el mismo dato.
   */
  buildSessionContext(
    day: { id: string; name: string; exercises: readonly Exercise[] },
    settings: AppSettings,
    lang: 'es' | 'en',
    opts: { beforeISO?: string; state?: AppState } = {},
  ): AiSessionContext {
    const state = opts.state ?? this.storage.load();
    const before = opts.beforeISO;
    return {
      dayId: day.id,
      dayName: day.name,
      userProfile: settings.userProfile,
      lang,
      todayISO: this.storage.todayISO(),
      exercises: day.exercises.map((exercise) => {
        const all = this.storage.historyForExercise(state, exercise.id);
        const history = before ? all.filter((h) => h.dateISO < before) : all;
        const lastSession = this.storage.lastSessionForExercise(state, exercise.id, before);
        return {
          exercise,
          history,
          lastSets: this.storage.lastSetsForExercise(state, exercise.id, before),
          lastSessionDate: lastSession?.dateISO ?? null,
          lastFeel: lastSession?.feelings?.[exercise.id] ?? null,
          lastNote: lastSession?.notes?.[exercise.id] ?? null,
          // El feedback pasado entra en el prompt: si el atleta rechazó subir dos veces,
          // insistir es la mejor forma de que deje de mirar las sugerencias (RF-IA-05).
          feedback: (state.aiFeedback ?? [])
            .filter((f) => f.exerciseId === exercise.id)
            .slice(-3)
            .reverse()
            .map((f) => f.action),
        };
      }),
    };
  }

  /**
   * Sugerencias listas para la sesión de HOY, sin tocar la red (RF-IA-06b/06c, Art. 8).
   *
   * El contexto se arma EXCLUYENDO lo de hoy a propósito: es el mismo contexto con el que se
   * calcularon al cerrar la sesión anterior, así que registrar series durante el día no
   * cambia el hash ni, por tanto, la sugerencia. Un número que baila sin datos nuevos mata
   * la confianza.
   */
  async suggestionsForToday(
    day: { id: string; name: string; exercises: readonly Exercise[] },
    settings: AppSettings,
    lang: 'es' | 'en',
  ): Promise<SessionRecommendation> {
    const ctx = this.buildSessionContext(day, settings, lang, {
      beforeISO: this.storage.todayISO(),
    });
    const stored = this.suggestionsForDay(day.id, this.contextHash(ctx));
    if (stored) {
      return {
        byExercise: stored.byExercise as Record<string, AiRecommendation>,
        source: stored.source,
      };
    }
    return this.local.recommendSession(ctx);
  }

  /**
   * UNA llamada por sesión (Art. 5, RF-IA-06): cascada Groq → Cohere → local.
   *
   * Un fallo de red o una respuesta ilegible pasan al siguiente proveedor; una key rechazada
   * corta la cascada para ese proveedor y se registra, porque reintentar con la misma key
   * solo gasta tiempo. Los ejercicios que el modelo no cubrió se completan con el motor
   * local, así la sesión nunca queda a medias (EA-3).
   */
  async recommendSession(
    settings: AppSettings,
    ctx: AiSessionContext,
  ): Promise<SessionRecommendation> {
    const budget = settings.aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const providers = this.buildSessionProviders(settings);

    if (!providers.length || !navigator.onLine || isOverBudget(budget)) {
      return this.local.recommendSession(ctx);
    }

    for (const provider of providers) {
      // RF-IA-04: un reintento por proveedor. La segunda respuesta ilegible ya no es ruido.
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const result = await provider.recommendSession(ctx);
          const filled = await this.fillMissingLocally(result, ctx);
          if (filled.source === 'groq') this.sampleShadowLog(ctx, settings, filled);
          return filled;
        } catch (e) {
          if (e instanceof AuthError && provider.name !== 'local') {
            this.authError.set(provider.name);
            break;
          }
          const label = e instanceof RateLimitError ? 'rate limit' : 'falló';
          console.info(`${provider.name} ${label} (intento ${attempt + 1}):`, (e as Error).message);
          if (e instanceof RateLimitError) break;
        }
      }
    }

    return this.local.recommendSession(ctx);
  }

  /**
   * Manda UN ejercicio de la sesión al shadow log, si está activado.
   *
   * Uno solo y con muestreo: el shadow log existe para comparar modelos, no para duplicar el
   * gasto de cada sesión. Sus llamadas cuentan contra el presupuesto como cualquier otra
   * (decisión T-001, RF-IA-07).
   */
  private sampleShadowLog(
    ctx: AiSessionContext,
    settings: AppSettings,
    result: SessionRecommendation,
  ): void {
    const ec = ctx.exercises[0];
    const rec = ec && result.byExercise[ec.exercise.id];
    if (!ec || !rec) return;
    this.shadowLog.maybeRecord(
      {
        exercise: ec.exercise,
        todaySets: [],
        lastSets: ec.lastSets,
        history: ec.history,
        userProfile: ctx.userProfile,
        lang: ctx.lang,
        lastSessionDate: ec.lastSessionDate,
        lastFeel: ec.lastFeel,
        lastNote: ec.lastNote,
      },
      this.resolveKeys(settings).groq,
      rec,
    );
  }

  /** Proveedor cuya key rechazó la API; la UI lo muestra para que el usuario la corrija. */
  readonly authError = signal<'groq' | 'cohere' | null>(null);

  /**
   * Completa con el motor local los ejercicios que la respuesta no cubrió.
   *
   * Es la red de seguridad de EA-3: el usuario ve una sugerencia para cada ejercicio o no ve
   * ninguna, nunca una lista con huecos que parecen un error de la app.
   */
  private async fillMissingLocally(
    result: SessionRecommendation,
    ctx: AiSessionContext,
  ): Promise<SessionRecommendation> {
    const missing = result.validated?.missing ?? [];
    if (!missing.length) return result;
    const local = await this.local.recommendSession(ctx);
    const byExercise = { ...result.byExercise };
    missing.forEach((id) => {
      if (local.byExercise[id]) byExercise[id] = local.byExercise[id];
    });
    return { ...result, byExercise };
  }

  /**
   * Calcula y guarda las sugerencias de la PRÓXIMA sesión de un día recién cerrado.
   *
   * Se lanza sin esperarla: el usuario está mirando su resumen y no puede quedarse bloqueado
   * por la red (RF-IA-06b). Un candado por día evita que dos disparos —cerrar y volver a
   * entrar, por ejemplo— hagan dos llamadas para lo mismo (RF-IA-06).
   */
  async precomputeNextSession(
    settings: AppSettings,
    day: { id: string; name: string; exercises: readonly Exercise[] },
    lang: 'es' | 'en' = 'es',
  ): Promise<void> {
    if (this.inFlight.has(day.id)) return this.inFlight.get(day.id);

    const run = (async () => {
      try {
        const ctx = this.buildSessionContext(day, settings, lang);
        const hash = this.contextHash(ctx);
        if (this.suggestionsForDay(day.id, hash)) return;

        const result = await this.recommendSession(settings, ctx);
        const store = this.readNextStore();
        store[day.id] = {
          contextHash: hash,
          byExercise: result.byExercise,
          source: result.source,
          atISO: new Date().toISOString(),
        };
        localStorage.setItem(NEXT_KEY, JSON.stringify(store));
      } catch {
        /* una sugerencia que no sale no rompe el cierre de la sesión */
      } finally {
        this.inFlight.delete(day.id);
      }
    })();

    this.inFlight.set(day.id, run);
    return run;
  }

  /** Candado anti doble-tap: una llamada en vuelo por día (RF-IA-06). */
  private readonly inFlight = new Map<string, Promise<void>>();

  /**
   * Cadena de proveedores. Las keys se piden al vault, nunca al estado: en el estado solo hay
   * texto cifrado desde F4 (Art. 4, RF-IA-08).
   */
  private buildSessionProviders(settings: AppSettings): AiSessionProvider[] {
    const providers: AiSessionProvider[] = [];
    const { groq, cohere } = this.resolveKeys(settings);
    if (groq) providers.push(new GroqProvider(groq, settings.groqModel));
    if (cohere) providers.push(new CohereProvider(cohere, settings.cohereModel));
    return providers;
  }

  private applyLongRestAdjustment(
    rec: AiRecommendation,
    exercise: Exercise,
    lastSets: SetRecord[] | null,
    lastSessionDate: string | null,
    lang: 'es' | 'en',
  ): AiRecommendation {
    if (
      !lastSessionDate ||
      !lastSets?.length ||
      exercise.unit === 'TIME' ||
      exercise.unit === 'BODYWEIGHT'
    ) {
      return rec;
    }
    const days = Math.round(
      (Date.now() - new Date(lastSessionDate).getTime()) / (1000 * 60 * 60 * 24),
    );
    let factor = 1;
    if (days > 28) factor = 0.85;
    else if (days > 14) factor = 0.9;
    if (factor === 1) return rec;

    const brick = exercise.brick || 2.5;
    const topWeight = Math.max(...lastSets.map((s) => s.weight));
    const maxWeight = roundToBrick(topWeight * factor, brick);

    if (rec.sets.every((s) => s.weight <= maxWeight)) return rec;

    const note =
      lang === 'en'
        ? ` (weight capped for ${days}-day break)`
        : ` (peso limitado por ${days} días sin entrenar)`;

    return {
      ...rec,
      sets: rec.sets.map((s) => ({ ...s, weight: Math.min(s.weight, maxWeight) })),
      reason: rec.reason + note,
    };
  }

  private buildProviders(settings: AppSettings): AiProvider[] {
    const providers: AiProvider[] = [];
    const { groq, cohere } = this.resolveKeys(settings);
    if (groq) providers.push(new GroqProvider(groq, settings.groqModel));
    if (cohere) providers.push(new CohereProvider(cohere, settings.cohereModel));
    return providers;
  }

  /**
   * Las keys, vengan de donde vengan.
   *
   * Lo normal es que estén en el vault, descifradas al arrancar. Pero hay dos momentos
   * legítimos en que siguen en el estado: antes de que `ApiKeyService.init()` termine, y en
   * navegadores sin WebCrypto, donde nunca llegan a cifrarse. Leer solo el vault dejaría a
   * esos usuarios sin IA sin explicación.
   */
  private resolveKeys(settings: AppSettings): { groq: string; cohere: string } {
    return {
      groq: this.keys.get('groq') || settings.apiKey,
      cohere: this.keys.get('cohere') || settings.cohereApiKey,
    };
  }

  localRecommendation(
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[] = [],
    userProfile: UserProfile = defaultUserProfile(),
    lastSessionDate: string | null = null,
    lang: 'es' | 'en' = 'es',
    opts: { lastFeel?: TrainingFeel | null } = {},
  ): AiRecommendation {
    return this.local.compute(
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile,
      lastSessionDate,
      lang,
      opts,
    );
  }

  /**
   * Recomendación de UN ejercicio.
   *
   * Ya no es el camino de la app —desde F4 la unidad es la sesión (Art. 5)—, pero se conserva
   * porque el shadow log compara modelos candidatos ejercicio a ejercicio y porque es la
   * forma más directa de probar la cascada.
   */
  async recommend(
    settings: AppSettings,
    exercise: Exercise,
    todaySets: TodaySetProgress[],
    lastSets: SetRecord[] | null,
    history: HistoryEntry[],
    lang: 'es' | 'en' = 'es',
    lastSessionDate: string | null = null,
  ): Promise<AiRecommendation> {
    const hasDoneOrHistory = lastSets?.length || todaySets.some((s) => s?.done);
    const providers = this.buildProviders(settings);

    // La sensación de la última vez la usan tanto el motor local (bloquea la subida si costó)
    // como el prompt. Se resuelve perezosamente: leer el estado entero no es gratis y la
    // mayoría de las llamadas se resuelven antes de necesitarla.
    let cachedLastSession: Session | null | undefined;
    const lastSessionObj = (): Session | null => {
      if (cachedLastSession === undefined) {
        cachedLastSession = this.storage.lastSessionForExercise(this.storage.load(), exercise.id);
      }
      return cachedLastSession;
    };
    const lastFeel = (): TrainingFeel | null => lastSessionObj()?.feelings?.[exercise.id] ?? null;

    // Fallback local con nota opcional — evita repetir la llamada de 7 argumentos.
    const local = (note = ''): AiRecommendation => {
      const rec = this.localRecommendation(
        exercise,
        todaySets,
        lastSets,
        history,
        settings.userProfile,
        lastSessionDate,
        lang,
        { lastFeel: lastFeel() },
      );
      if (note) rec.reason += note;
      return rec;
    };

    if (!providers.length || !hasDoneOrHistory) return local();

    const lastSessionISO = history.at(-1)?.dateISO ?? null;
    const cached = this.getCached(exercise.id, lastSessionISO, settings.userProfile);
    if (cached) return cached;

    if (!navigator.onLine) {
      return local(lang === 'en' ? ' (offline mode)' : ' (modo offline)');
    }

    const ctx: AiProviderContext = {
      exercise,
      todaySets,
      lastSets,
      history,
      userProfile: settings.userProfile,
      lang,
      lastSessionDate,
      lastFeel: lastFeel(),
      lastNote: lastSessionObj()?.notes?.[exercise.id] ?? null,
    };

    for (const provider of providers) {
      try {
        const rec = await provider.recommend(ctx);
        const adjusted = this.applyLongRestAdjustment(
          rec,
          exercise,
          lastSets,
          lastSessionDate,
          lang,
        );
        this.setCached(exercise.id, lastSessionISO, adjusted, settings.userProfile);
        if (adjusted.source === 'groq') {
          this.shadowLog.maybeRecord(ctx, this.resolveKeys(settings).groq, adjusted);
        }
        return adjusted;
      } catch (e) {
        const label = e instanceof RateLimitError ? 'rate limit' : 'falló';
        console.info(`${provider.constructor.name} ${label}:`, (e as Error).message);
      }
    }

    return local(
      lang === 'en' ? ' (API unavailable, offline mode)' : ' (API no disponible, modo offline)',
    );
  }
}
