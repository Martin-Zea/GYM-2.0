import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { ExerciseCardComponent } from '../exercise-card/exercise-card.component';
import { ActiveSetCardComponent } from '../active-set-card/active-set-card.component';
import { HowItWorksComponent } from '../how-it-works/how-it-works.component';
import { ProgressBarComponent } from '../progress-bar/progress-bar.component';
import { SessionSummaryComponent } from '../session-summary/session-summary.component';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { SetLoggingService } from '../../services/set-logging.service';
import { ProgressionService } from '../../services/progression.service';
import { TranslationService } from '../../services/translation.service';
import { STORAGE_KEYS } from '../../services/storage-keys';
import { AiRecommendation, Exercise, Session, WorkoutDay } from '../../models/workout.model';
import { daysBetweenISO, mondayOfISO, shiftISO, weekdayISO } from '../../utils/date';
import { WEEKLY_SET_RANGE, adherence } from '../../utils/stats';
import { dashboardKpis, groupSeriesByWeek, realSessions } from '../../utils/dashboard';
import { sessionDurationMinutes, tonnageOf, workingSets } from '../../utils/session';
import { CatalogService } from '../../services/catalog.service';
import { ViewportService } from '../../services/viewport.service';

type SessionView = 'focused' | 'list';

interface SessionQueueItem {
  exercise: Exercise;
  done: boolean;
  active: boolean;
  doneCount: number;
  total: number;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [
    IconComponent,
    ExerciseCardComponent,
    ActiveSetCardComponent,
    HowItWorksComponent,
    ProgressBarComponent,
    SessionSummaryComponent,
    RouterLink,
  ],
  templateUrl: './home.component.html',
  // Dos hojas por concerns distintos (T-834): el panel es UNA decisión, la sesión es una
  // herramienta a pantalla completa. También reparte el presupuesto de estilos, que se
  // mide por archivo, y prepara el terreno para extraer la sesión a su propio componente.
  styleUrls: ['./home.component.scss', './home-session.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  private readonly progression = inject(ProgressionService);
  private readonly setLogging = inject(SetLoggingService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly catalog = inject(CatalogService);
  protected readonly viewport = inject(ViewportService);

  protected readonly mode = signal<'today' | 'training'>(
    (sessionStorage.getItem('gym_mode') as 'today' | 'training' | null) ?? 'today',
  );

  protected readonly confirmSkip = signal(false);
  protected readonly skipUndoVisible = signal(false);
  private lastSkipSessionId: string | null = null;
  private skipUndoTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly showFinishModal = signal(false);
  protected readonly activeExerciseId = signal<string | null>(null);

  /** Vista de sesión: enfocada (una serie protagonista) o lista (tabla clásica). */
  protected readonly sessionView = signal<SessionView>(
    (localStorage.getItem(STORAGE_KEYS.sessionView) as SessionView | null) ?? 'focused',
  );

  protected readonly aiCache = signal<Partial<Record<string, AiRecommendation>>>({});

  /**
   * Las sugerencias de la sesión ya vienen calculadas del cierre de la anterior (RF-IA-06b),
   * así que aquí NO hay red: se resuelven de una vez para todo el día. La cola de llamadas
   * por ejercicio que había antes hacía 6–8 peticiones por sesión (Art. 5, `audit.md` §6.1).
   */
  private aiLoaded = false;

  constructor() {
    effect(() => {
      const m = this.mode();
      sessionStorage.setItem('gym_mode', m);
      this.uiState.trainingActive.set(m === 'training');
    });

    // Cambió el día activo: las sugerencias del anterior ya no valen.
    // `untracked` corta el bucle reactivo (escribir aiCache dentro del effect que lo lee).
    effect(() => {
      const idx = this.state.activeDayIndex();
      untracked(() => {
        this.aiCache.set({});
        this.aiLoaded = false;
        this.activeExerciseId.set(null);
        if (this.mode() === 'training') {
          const day = this.state.days()[idx];
          if (day) this.initActiveExercise(day.id);
        }
      });
    });

    // Puente desde DayDetailSheet: "Entrenar" se pulsa allí y la sesión arranca aquí.
    effect(() => {
      if (this.uiState.pendingTrainingStart()) {
        untracked(() => {
          this.uiState.pendingTrainingStart.set(false);
          this.mode.set('training');
          const day = this.state.activeDay();
          if (day) {
            this.state.startSession(day.id);
            this.initActiveExercise(day.id);
          }
        });
      }
    });

    // Atajo del manifest ("Empezar entrenamiento"): /?start=1 arranca la sesión directo
    const params = new URLSearchParams(window.location.search);
    if (params.get('start') === '1') {
      history.replaceState(null, '', window.location.pathname);
      if (this.mode() !== 'training' && this.state.days().length) {
        setTimeout(() => this.startTraining());
      }
    }
  }

  /**
   * Día de sesión: el día activo con las sustituciones "solo por hoy" aplicadas.
   * Todo el modo entreno (cola, tarjetas, progreso) lee de aquí, así el sustituto
   * registra bajo SU id y su historial queda correcto.
   */
  protected readonly sessionDay = computed<WorkoutDay | null>(() => {
    const day = this.state.activeDay();
    if (!day) return null;
    const tp = this.state.getTodayProgress(day.id);
    const overrides = tp.overrides ?? {};
    const hidden = new Set(tp.hiddenExerciseIds ?? []);
    const added = tp.addedExerciseIds ?? [];
    if (!Object.keys(overrides).length && !hidden.size && !added.length) return day;
    const catalog = new Map(this.state.exercises().map((e) => [e.id, e]));
    const base = day.exercises
      .filter((ex) => !hidden.has(ex.id))
      .map((ex) => {
        const subId = overrides[ex.id];
        return subId ? (catalog.get(subId) ?? ex) : ex;
      });
    // Los añadidos van al final: se agregan sobre la marcha, cuando el resto ya está en curso
    const extras = added
      .map((id) => catalog.get(id))
      .filter((ex): ex is Exercise => ex !== undefined && !base.some((b) => b.id === ex.id));
    return { ...day, exercises: [...base, ...extras] };
  });

  private setCounts(day: WorkoutDay, ex: Exercise): { done: number; total: number } {
    const tp = this.state.getTodayProgress(day.id);
    const saved = tp.sets[ex.id] ?? [];
    return {
      done: saved.filter((s) => s?.done).length,
      total: this.setLogging.setCountFor(day, ex),
    };
  }

  protected readonly sessionQueue = computed<SessionQueueItem[]>(() => {
    const day = this.sessionDay();
    if (!day) return [];
    const activeId = this.activeSessionExercise()?.id ?? null;
    return day.exercises.map((ex) => {
      const { done, total } = this.setCounts(day, ex);
      return {
        exercise: ex,
        done: total > 0 && done >= total,
        active: ex.id === activeId,
        doneCount: done,
        total,
      };
    });
  });

  /** Ejercicio protagonista en vista enfocada: el elegido, o el primero sin terminar. */
  protected readonly activeSessionExercise = computed<Exercise | null>(() => {
    const day = this.sessionDay();
    if (!day || !day.exercises.length) return null;
    const chosenId = this.activeExerciseId();
    if (chosenId) {
      const chosen = day.exercises.find((e) => e.id === chosenId);
      if (chosen) return chosen;
    }
    for (const ex of day.exercises) {
      const { done, total } = this.setCounts(day, ex);
      if (done < total) return ex;
    }
    return null;
  });

  protected readonly dayProgress = computed(() => {
    const day = this.sessionDay();
    if (!day) return { done: 0, total: 0 };
    let done = 0,
      total = 0;
    for (const ex of day.exercises) {
      const c = this.setCounts(day, ex);
      done += c.done;
      total += c.total;
    }
    return { done, total };
  });

  protected readonly currentDayProgress = computed(() => {
    const day = this.state.currentDay();
    if (!day) return { done: 0, total: 0 };
    let done = 0,
      total = 0;
    for (const ex of day.exercises) {
      const c = this.setCounts(day, ex);
      done += c.done;
      total += c.total;
    }
    return { done, total };
  });

  protected readonly lastTrainedInfo = computed(() => {
    const day = this.state.currentDay();
    const T = this.T();
    if (!day) return null;
    const last = this.state
      .sessions()
      .filter((s) => s.dayId === day.id && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
    if (!last) return null;
    const todayISO = this.storage.todayISO();
    if (last.dateISO === todayISO) return T.last_session_today;
    const days = daysBetweenISO(last.dateISO, todayISO);
    return days === 1 ? T.last_session_days_one : this.tr.tp('last_session_days_many', { n: days });
  });

  protected readonly hasCompletedSessions = computed(() =>
    this.state.sessions().some((s) => !s.skipped),
  );

  // ── Semana: mapa Lun-Dom + total + volumen ──

  /** ISO (YYYY-MM-DD) del lunes de la semana actual, en el calendario LOCAL. */
  private mondayISO(): string {
    return mondayOfISO(this.storage.todayISO());
  }

  protected readonly weekMap = computed<boolean[]>(() => {
    const monday = this.mondayISO();
    const trained = new Set(
      this.state
        .sessions()
        .filter((s) => !s.skipped && s.sets.length)
        .map((s) => s.dateISO),
    );
    return Array.from({ length: 7 }, (_, i) => trained.has(shiftISO(monday, i)));
  });

  protected readonly weekSessionCount = computed(() => this.weekMap().filter(Boolean).length);

  protected readonly weekStatsDisplay = computed(() => {
    const { streak, weeklyVolume } = this.storage.weeklyStats(this.state.state());
    const vol =
      weeklyVolume >= 1000
        ? `${(weeklyVolume / 1000).toFixed(1).replace(/\.0$/, '')}t`
        : `${Math.round(weeklyVolume)}kg`;
    return { streak, vol, isEmpty: streak === 0 && weeklyVolume === 0 };
  });

  /** Iniciales del día de la semana, empezando en lunes. Mismo patrón que el calendario. */
  private static readonly DOW_BASE = new Date(2024, 0, 1); // un lunes
  protected readonly weekDayLabels = computed(() => {
    const fmt = new Intl.DateTimeFormat(this.tr.lang(), { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(HomeComponent.DOW_BASE);
      d.setDate(1 + i);
      return fmt.format(d);
    });
  });

  /** Índice del día de HOY dentro de la semana (0 = lunes), para marcarlo en la franja. */
  protected readonly todayIndex = computed(() => weekdayISO(this.state.todayKey));

  /** Adherencia de las últimas 4 semanas contra los días que declara la rutina activa. */
  protected readonly adherencePct = computed(() =>
    adherence(this.state.sessions(), this.state.days().length || null, this.state.todayKey),
  );

  /**
   * Los dos días que vienen DESPUÉS del de hoy en la rotación.
   *
   * La rotación existía pero era invisible: sabías qué te tocaba hoy y nada más. Ver lo que
   * viene es lo que convierte "una rutina" en "un plan".
   */
  protected readonly upcomingDays = computed(() => {
    const days = this.state.days();
    if (days.length < 2) return [];
    const from = this.state.currentDayIndex();
    return [1, 2].map((offset) => days[(from + offset) % days.length]).filter(Boolean);
  });

  // ══ Panel de escritorio (T-836) ══
  //
  // Misma ruta, otro producto: en el teléfono `/` es UNA decisión; en el escritorio es el
  // sitio donde se entiende qué está pasando. Todo esto se pinta SOLO en escritorio —
  // `@if (viewport.isDesktop())` en la plantilla—, así que un teléfono no construye el
  // DOM de un panel que no va a enseñar.

  /** Volumen, series y sesiones de la semana, comparados con la anterior. */
  protected readonly kpis = computed(() =>
    dashboardKpis(this.state.state(), this.state.todayKey, 7),
  );

  /** Series por grupo muscular en las últimas 4 semanas, contra el rango recomendado. */
  protected readonly groupLoad = computed(() => {
    const to = this.state.todayKey;
    return (
      groupSeriesByWeek(
        this.state.state(),
        (ex) => this.catalog.byRef(ex.catalogRef)?.group ?? null,
        shiftISO(to, -27),
        to,
      )
        // Un grupo cuya última semana está a cero y nunca tuvo nada no es un desequilibrio:
        // es un grupo que este atleta no entrena. Enseñarlo a cero es ruido, no diagnóstico.
        .filter((g) => g.points.some((p) => p.sets > 0))
        .map((g) => ({
          ...g,
          label: this.T()[`muscle_${g.group}` as keyof ReturnType<typeof this.T>] as string,
          pct: Math.min(100, Math.round((g.latest / WEEKLY_SET_RANGE.max) * 100)),
          low: g.latest < WEEKLY_SET_RANGE.min,
        }))
    );
  });

  /** Volumen de la semana en toneladas, con un decimal. */
  protected readonly kpiVolume = computed(() =>
    (this.kpis().volumeKg.value / 1000).toFixed(1).replace(/\.0$/, ''),
  );

  /** El rango recomendado, dibujado detrás del medidor. */
  protected readonly rangeStyle = computed(() => {
    const left = (WEEKLY_SET_RANGE.min / WEEKLY_SET_RANGE.max) * 100;
    return `left:${left}%;right:0`;
  });

  /**
   * El titular del panel: una afirmación, no una etiqueta (T-836).
   *
   * Se construye con lo que HAY. Sin comparación posible dice lo que hay —cuántas sesiones
   * llevás— en vez de inventar un porcentaje: el día 1 no existe una historia que contar, y
   * fingir que sí es lo que hace que un panel deje de creerse.
   */
  protected readonly panelHeadline = computed(() => {
    const { volumeKg, sessions } = this.kpis();

    // Semana sin entrenar: "levantaste un 100 % menos" es técnicamente cierto y una forma
    // pésima de dar la bienvenida. Cuando no hay nada que comparar porque no hay nada, se
    // dice eso — no se convierte una ausencia en un porcentaje.
    if (volumeKg.value === 0) return this.T().panel_headline_idle;

    // Sin semana previa tampoco hay historia: se cuenta lo que hay.
    if (volumeKg.deltaPct === null || volumeKg.deltaPct === 0) {
      // Singular aparte: "llevás 1 sesiones esta semana" es el mismo descuido que ya
      // apareció en el pie del calendario. Un titular con una falta no se cree.
      const key = sessions.value === 1 ? 'panel_headline_neutral_one' : 'panel_headline_neutral';
      return this.tr.tp(key, { n: sessions.value });
    }

    return this.tr.tp(volumeKg.deltaPct > 0 ? 'panel_headline_up' : 'panel_headline_down', {
      pct: Math.abs(volumeKg.deltaPct),
    });
  });

  /** Las últimas sesiones, para la tabla densa que el móvil no puede dar. */
  protected readonly recentSessions = computed(() => {
    const s = this.state.state();
    const byDay = new Map(s.days.map((d) => [d.id, d.name]));
    return realSessions(s.sessions)
      .slice()
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
      .slice(0, 6)
      .map((session) => ({
        id: session.id,
        dateISO: session.dateISO,
        dayName: byDay.get(session.dayId) ?? '—',
        sets: workingSets(session.sets).length,
        minutes: sessionDurationMinutes(session),
        volume: Math.round(tonnageOf(session.sets, s.exercises)),
      }));
  });

  /** Sesiones registradas en el mes en curso (H1 del diseño). */
  protected readonly monthSessionCount = computed(() => {
    const prefix = this.state.todayKey.slice(0, 7);
    return this.state.sessions().filter((s) => !s.skipped && s.dateISO.startsWith(prefix)).length;
  });

  /**
   * Último récord de peso conseguido, para la tarjeta de PR de H1.
   *
   * Se recorre el historial una vez y de más viejo a más nuevo: un récord es superar TODO lo
   * anterior, así que hay que ver el pasado antes de juzgar el presente. Se ignoran las
   * unidades sin peso, donde "más kilos" no significa nada.
   */
  protected readonly lastPr = computed(() => {
    const s = this.state.state();
    const names = new Map(s.exercises.map((e) => [e.id, e]));
    const best = new Map<string, number>();
    let latest: { name: string; weight: number; dateISO: string } | null = null;

    const ordered = [...s.sessions]
      .filter((x) => !x.skipped)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    for (const session of ordered) {
      for (const set of session.sets) {
        const exercise = names.get(set.exerciseId);
        if (!exercise || set.isWarmup || typeof set.weight !== 'number' || set.weight <= 0)
          continue;
        if (exercise.unit === 'TIME' || exercise.unit === 'BODYWEIGHT') continue;
        const prev = best.get(set.exerciseId);
        if (prev === undefined) {
          best.set(set.exerciseId, set.weight);
          continue;
        }
        if (set.weight > prev) {
          best.set(set.exerciseId, set.weight);
          latest = { name: exercise.name, weight: set.weight, dateISO: session.dateISO };
        }
      }
    }
    return latest;
  });

  /** Resumen de la semana pasada — solo lunes/martes, si hubo al menos 1 sesión. */
  protected readonly lastWeekSummary = computed(() => {
    const monday = this.mondayISO();
    if (weekdayISO(this.storage.todayISO()) > 1) return null;
    const from = shiftISO(monday, -7);
    const sessions = this.state
      .sessions()
      .filter((s) => !s.skipped && s.sets.length && s.dateISO >= from && s.dateISO < monday);
    if (!sessions.length) return null;
    let volume = 0;
    for (const s of sessions) {
      for (const set of s.sets) {
        if (!set.isWarmup) volume += (set.weight || 0) * (set.reps || 0);
      }
    }
    const vol =
      volume >= 1000
        ? `${(volume / 1000).toFixed(1).replace(/\.0$/, '')}t`
        : `${Math.round(volume)}kg`;
    return { sessions: sessions.length, vol };
  });

  protected setSessionView(view: SessionView): void {
    this.sessionView.set(view);
    localStorage.setItem(STORAGE_KEYS.sessionView, view);
  }

  protected selectExercise(exerciseId: string): void {
    this.activeExerciseId.set(exerciseId);
    if (this.sessionView() === 'list') {
      this.scrollToExercise(exerciseId);
    }
  }

  protected startTraining(): void {
    const days = this.state.days();
    const currentDay = this.state.currentDay();
    if (!currentDay) return;
    const idx = days.findIndex((d) => d.id === currentDay.id);
    if (idx >= 0) this.state.setActiveDay(idx);
    this.confirmSkip.set(false);
    this.state.startSession(currentDay.id);
    this.mode.set('training');
    this.initActiveExercise(currentDay.id);
  }

  /** Salir sin terminar: sin progreso sale directo; con progreso, confirma. */
  protected async exitSession(): Promise<void> {
    if (this.dayProgress().done > 0) {
      const ok = await this.uiState.requestTrainingExit();
      if (!ok) return;
    }
    this.activeExerciseId.set(null);
    this.mode.set('today');
  }

  /** Sesión cerrada que se está resumiendo en H3; `null` cuando no hay resumen abierto. */
  protected readonly summarySession = signal<Session | null>(null);
  protected readonly summaryDay = signal<WorkoutDay | null>(null);

  protected finishTraining(): void {
    const day = this.state.activeDay();
    const sessionDay = this.sessionDay();
    const finished = day ? this.state.finishSession(day.id, this.state.activeDayIndex()) : null;
    if (!day) this.state.advanceRoutine(this.state.activeDayIndex());

    this.showFinishModal.set(false);
    this.activeExerciseId.set(null);
    this.mode.set('today');

    // Sin series registradas no hay nada que resumir: se vuelve a Inicio sin más.
    if (finished && sessionDay) {
      this.summarySession.set(finished);
      this.summaryDay.set(sessionDay);
      this.precomputeNextSuggestions(sessionDay, finished.dateISO);
    }
  }

  // ── H1: sesión interrumpida y día ya entrenado (RF-SES-01/07) ──

  /**
   * Sesión de hoy empezada y no cerrada (EA-4). Se ofrece reanudar, finalizar o descartar en
   * vez de decidir por el usuario: la app no sabe si dejó el gimnasio o solo cambió de app.
   */
  protected readonly unfinished = computed(() => {
    const session = this.state.unfinishedSession();
    if (!session) return null;
    const day = this.state.days().find((d) => d.id === session.dayId);
    return day ? { session, day } : null;
  });

  /** Ya entrenó hoy y cerró la sesión: hoy toca descansar, no volver a empezar. */
  protected readonly restingToday = computed(() => {
    const today = this.state.todayKey;
    const done = this.state
      .sessions()
      .find((s) => s.dateISO === today && !s.skipped && s.endedAt && s.sets.length > 0);
    if (!done) return null;
    const day = this.state.days().find((d) => d.id === done.dayId);
    return { session: done, dayName: day?.name ?? '' };
  });

  /** El usuario decide entrenar igual pese a haber entrenado ya hoy. */
  protected readonly restOverridden = signal(false);

  protected resumeUnfinished(): void {
    const pending = this.unfinished();
    if (!pending) return;
    const idx = this.state.days().findIndex((d) => d.id === pending.day.id);
    if (idx >= 0) this.state.setActiveDay(idx);
    this.mode.set('training');
    this.initActiveExercise(pending.day.id);
  }

  /** Cierra la sesión interrumpida tal como quedó y muestra su resumen. */
  protected finishUnfinished(): void {
    const pending = this.unfinished();
    if (!pending) return;
    const idx = this.state.days().findIndex((d) => d.id === pending.day.id);
    const finished = this.state.finishSession(pending.day.id, idx >= 0 ? idx : undefined);
    if (finished) {
      this.summarySession.set(finished);
      this.summaryDay.set(pending.day);
      this.precomputeNextSuggestions(pending.day, finished.dateISO);
    }
  }

  protected discardUnfinished(): void {
    const pending = this.unfinished();
    if (!pending) return;
    if (!window.confirm(this.T().resume_discard_confirm)) return;
    this.state.discardSession(pending.day.id);
  }

  protected closeSummary(): void {
    this.summarySession.set(null);
    this.summaryDay.set(null);
  }

  /**
   * Hook de fin de sesión (RF-IA-06b): deja calculadas las sugerencias de la PRÓXIMA sesión.
   *
   * Sin `await` a propósito. El usuario está leyendo su resumen y la app ya cumplió su parte;
   * que la red tarde no puede bloquearle nada. Si falla, la próxima sesión calcula en directo
   * como hasta ahora.
   */
  private precomputeNextSuggestions(day: WorkoutDay, sessionISO: string): void {
    void sessionISO;
    void this.progression.precomputeNextSession(this.state.settings(), day, this.tr.lang(), {
      state: this.state.state(),
    });
  }

  protected onExerciseCompleted(completedExercise: Exercise): void {
    const day = this.sessionDay();
    if (!day) return;
    const exs = day.exercises;
    const completedIdx = exs.findIndex((ex) => ex.id === completedExercise.id);
    for (let offset = 1; offset < exs.length; offset++) {
      const ex = exs[(completedIdx + offset) % exs.length];
      const { done, total } = this.setCounts(day, ex);
      if (done < total) {
        this.activeExerciseId.set(ex.id);
        if (this.sessionView() === 'list') this.scrollToExercise(ex.id);
        return;
      }
    }
    this.activeExerciseId.set(null);
    this.uiState.restTimer.set(null);
  }

  private initActiveExercise(dayId: string): void {
    const day = this.state.days().find((d) => d.id === dayId);
    if (!day) {
      this.activeExerciseId.set(null);
      return;
    }
    const tp = this.state.getTodayProgress(dayId);
    for (const ex of day.exercises) {
      const sets = tp.sets[ex.id] ?? [];
      const allDone = sets.length >= ex.defaultSets && sets.every((s) => s.done);
      if (!allDone) {
        this.activeExerciseId.set(ex.id);
        if (this.sessionView() === 'list') this.scrollToExercise(ex.id);
        // Carga perezosa: NO se precarga todo el día. El card activo pide su recomendación
        // solo (effect sobre isActive) y los siguientes la piden cuando se vuelven activos al
        // completar el anterior, o al expandirlos manualmente. Reparte las llamadas a lo largo
        // del entrenamiento → mucho menos riesgo de chocar el límite de tokens/min de Groq.
        return;
      }
    }
    this.activeExerciseId.set(null);
  }

  protected scrollToExercise(exerciseId: string): void {
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-exercise-id="${exerciseId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected doSkip(): void {
    const sessionId = this.state.skipDay();
    this.confirmSkip.set(false);
    this.lastSkipSessionId = sessionId;
    this.skipUndoVisible.set(true);
    if (this.skipUndoTimer) clearTimeout(this.skipUndoTimer);
    this.skipUndoTimer = setTimeout(() => this.skipUndoVisible.set(false), 6000);
  }

  protected undoSkip(): void {
    if (this.skipUndoTimer) clearTimeout(this.skipUndoTimer);
    this.state.undoSkipDay(this.lastSkipSessionId);
    this.lastSkipSessionId = null;
    this.skipUndoVisible.set(false);
  }

  protected openDayDetail(day: WorkoutDay): void {
    this.uiState.openDayDetail(day);
  }

  protected openDayPicker(): void {
    this.uiState.openDayPicker();
  }

  protected requestAi(exercise: Exercise): void {
    void exercise;
    if (this.aiLoaded) return;
    this.aiLoaded = true;
    void this.loadSessionSuggestions();
  }

  /**
   * Resuelve las sugerencias del día entero de una sola vez.
   *
   * Si hay unas precalculadas cuyo contexto sigue vigente, se usan tal cual; si no, el motor
   * local responde al instante. En ningún caso se llama a la red desde la sesión activa:
   * H2 no puede esperar por nadie (RF-IA-06b, Art. 8).
   */
  private async loadSessionSuggestions(): Promise<void> {
    const day = this.sessionDay();
    if (!day) return;
    const result = await this.progression.suggestionsForToday(
      day,
      this.state.settings(),
      this.tr.lang(),
      { state: this.state.state() },
    );
    this.aiCache.set({ ...result.byExercise });
  }
}
