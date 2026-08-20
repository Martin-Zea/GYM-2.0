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
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { ProgressionService } from '../../services/progression.service';
import { TranslationService } from '../../services/translation.service';
import { STORAGE_KEYS } from '../../services/storage-keys';
import { AiRecommendation, Exercise, WorkoutDay } from '../../models/workout.model';
import { daysBetweenISO } from '../../utils/date';

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
    RouterLink,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  private readonly progression = inject(ProgressionService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

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

  // Cola de llamadas a IA (concurrencia 1): TODO pedido — prefetch del día, card activo,
  // expandir, botón manual — pasa por requestAi() y se serializa para no disparar una ráfaga
  // de fetch concurrentes contra el límite de tokens/min de Groq. aiInFlight deduplica pedidos
  // del mismo ejercicio ya encolados o en curso.
  private readonly aiQueue: Exercise[] = [];
  private readonly aiInFlight = new Set<string>();
  private aiDraining = false;

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
    if (!Object.keys(overrides).length) return day;
    const catalog = new Map(this.state.exercises().map((e) => [e.id, e]));
    return {
      ...day,
      exercises: day.exercises.map((ex) => {
        const subId = overrides[ex.id];
        return subId ? (catalog.get(subId) ?? ex) : ex;
      }),
    };
  });

  private setCounts(day: WorkoutDay, ex: Exercise): { done: number; total: number } {
    const tp = this.state.getTodayProgress(day.id);
    const saved = tp.sets[ex.id] ?? [];
    return {
      done: saved.filter((s) => s?.done).length,
      total: Math.max(ex.defaultSets, saved.length),
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

  /** ISO (YYYY-MM-DD) del lunes de la semana actual. */
  private mondayISO(): string {
    const now = new Date();
    const dow = (now.getDay() + 6) % 7; // 0 = lunes
    now.setDate(now.getDate() - dow);
    return now.toISOString().slice(0, 10);
  }

  protected readonly weekMap = computed<boolean[]>(() => {
    const monday = new Date(this.mondayISO() + 'T12:00:00Z');
    const trained = new Set(
      this.state
        .sessions()
        .filter((s) => !s.skipped && s.sets.length)
        .map((s) => s.dateISO),
    );
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(d.getDate() + i);
      return trained.has(d.toISOString().slice(0, 10));
    });
  });

  protected readonly weekSessionCount = computed(
    () => this.weekMap().filter(Boolean).length,
  );

  protected readonly weekStatsDisplay = computed(() => {
    const { streak, weeklyVolume } = this.storage.weeklyStats(this.state.state());
    const vol =
      weeklyVolume >= 1000
        ? `${(weeklyVolume / 1000).toFixed(1).replace(/\.0$/, '')}t`
        : `${Math.round(weeklyVolume)}kg`;
    return { streak, vol, isEmpty: streak === 0 && weeklyVolume === 0 };
  });

  /** Resumen de la semana pasada — solo lunes/martes, si hubo al menos 1 sesión. */
  protected readonly lastWeekSummary = computed(() => {
    const dow = (new Date().getDay() + 6) % 7;
    if (dow > 1) return null;
    const monday = this.mondayISO();
    const prevMonday = new Date(monday + 'T12:00:00Z');
    prevMonday.setDate(prevMonday.getDate() - 7);
    const from = prevMonday.toISOString().slice(0, 10);
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

  protected readonly routineExpanded = signal(false);

  protected readonly routineDays = computed(() => {
    const s = this.state.state();
    const T = this.T();
    const todayISO = this.storage.todayISO();
    return this.state.days().map((day, i) => {
      const last = this.storage.lastSessionForDay(s, day.id);
      let lastLabel = T.first_time_label;
      if (last) {
        const daysAgo = daysBetweenISO(last.dateISO, todayISO);
        lastLabel =
          daysAgo === 0
            ? T.today_ago
            : daysAgo === 1
              ? T.days_ago_one
              : this.tr.tp('days_ago_many', { n: daysAgo });
      }
      const trainedToday = !!last && last.dateISO === todayISO;
      return {
        day,
        index: i,
        lastLabel,
        isCurrent: i === this.state.currentDayIndex(),
        trainedToday,
      };
    });
  });

  constructor() {
    effect(() => {
      const m = this.mode();
      sessionStorage.setItem('gym_mode', m);
      this.uiState.trainingActive.set(m === 'training');
    });

    effect(() => {
      const idx = this.state.activeDayIndex();
      untracked(() => {
        this.aiCache.set({});
        // Cambió el día: descarta los pedidos pendientes del día anterior. El que ya está
        // corriendo termina solo; su delete sobre el Set vacío es no-op.
        this.aiQueue.length = 0;
        this.aiInFlight.clear();
        this.activeExerciseId.set(null);
        if (this.mode() === 'training') {
          const day = this.state.days()[idx];
          if (day) this.initActiveExercise(day.id);
        }
      });
    });

    effect(() => {
      if (this.uiState.pendingTrainingStart()) {
        untracked(() => {
          this.uiState.pendingTrainingStart.set(false);
          this.mode.set('training');
          const day = this.state.activeDay();
          if (day) this.initActiveExercise(day.id);
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

  protected finishTraining(): void {
    this.state.advanceRoutine(this.state.activeDayIndex());
    this.showFinishModal.set(false);
    this.activeExerciseId.set(null);
    this.mode.set('today');
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
    // Deduplica: ya encolado o en curso → no agendar de nuevo.
    if (this.aiInFlight.has(exercise.id)) return;
    this.aiInFlight.add(exercise.id);

    // Estado de carga inmediato (spinner) aunque el fetch espere su turno en la cola.
    this.aiCache.update((c) => ({
      ...c,
      [exercise.id]: { sets: [], reason: '', source: 'local', loading: true },
    }));

    this.aiQueue.push(exercise);
    void this.drainAiQueue();
  }

  private async drainAiQueue(): Promise<void> {
    if (this.aiDraining) return;
    this.aiDraining = true;
    try {
      while (this.aiQueue.length) {
        const exercise = this.aiQueue.shift()!;
        try {
          await this.runAiRequest(exercise);
        } finally {
          this.aiInFlight.delete(exercise.id);
        }
      }
    } finally {
      this.aiDraining = false;
    }
  }

  private async runAiRequest(exercise: Exercise): Promise<void> {
    const day = this.state.activeDay();
    if (!day) return;

    const s = this.state.state();
    const tp = this.state.getTodayProgress(day.id);
    const todaySets = tp.sets[exercise.id] ?? [];
    const lastSets = this.storage.lastSetsForExercise(s, exercise.id);
    const history = this.storage.historyForExercise(s, exercise.id);
    const lastSession = this.storage.lastSessionForExercise(s, exercise.id);

    const rec = await this.progression.recommend(
      this.state.settings(),
      exercise,
      todaySets,
      lastSets,
      history,
      this.tr.lang(),
      lastSession?.dateISO ?? null,
    );

    this.aiCache.update((c) => ({ ...c, [exercise.id]: rec }));
  }
}
