import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { ExerciseCardComponent } from '../exercise-card/exercise-card.component';
import { HowItWorksComponent } from '../how-it-works/how-it-works.component';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { ProgressionService } from '../../services/progression.service';
import { TranslationService } from '../../services/translation.service';
import { AiRecommendation, Exercise, WorkoutDay } from '../../models/workout.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IconComponent, ExerciseCardComponent, HowItWorksComponent, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
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
  protected readonly showDayMenu = signal(false);
  protected readonly showTrainingMenu = signal(false);
  protected readonly showFinishModal = signal(false);
  protected readonly activeExerciseId = signal<string | null>(null);

  protected readonly aiCache = signal<Partial<Record<string, AiRecommendation>>>({});

  protected readonly exerciseDoneCounts = computed((): Partial<Record<string, { done: number; total: number }>> => {
    const day = this.state.activeDay();
    if (!day) return {};
    const tp = this.state.getTodayProgress(day.id);
    const result: Partial<Record<string, { done: number; total: number }>> = {};
    for (const ex of day.exercises) {
      result[ex.id] = {
        done: (tp.sets[ex.id] ?? []).filter(s => s?.done).length,
        total: ex.defaultSets,
      };
    }
    return result;
  });

  protected readonly weekStatsDisplay = computed(() => {
    const { streak, weeklyVolume } = this.storage.weeklyStats(this.state.state());
    const vol = weeklyVolume >= 1000
      ? `${(weeklyVolume / 1000).toFixed(1).replace(/\.0$/, '')}t`
      : `${Math.round(weeklyVolume)}kg`;
    return { streak, vol, isEmpty: streak === 0 && weeklyVolume === 0 };
  });

  protected readonly dayProgress = computed(() => {
    const day = this.state.activeDay();
    if (!day) return { done: 0, total: 0 };
    const tp = this.state.getTodayProgress(day.id);
    let done = 0, total = 0;
    for (const ex of day.exercises) {
      total += ex.defaultSets;
      done += (tp.sets[ex.id] ?? []).filter(s => s?.done).length;
    }
    return { done, total };
  });

  protected readonly currentDayProgress = computed(() => {
    const day = this.state.currentDay();
    if (!day) return { done: 0, total: 0 };
    const tp = this.state.getTodayProgress(day.id);
    let done = 0, total = 0;
    for (const ex of day.exercises) {
      total += ex.defaultSets;
      done += (tp.sets[ex.id] ?? []).filter(s => s?.done).length;
    }
    return { done, total };
  });

  protected readonly lastTrainedInfo = computed(() => {
    const day = this.state.currentDay();
    const T = this.T();
    if (!day) return null;
    const last = this.state.sessions()
      .filter(s => s.dayId === day.id && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
    if (!last) return null;
    const todayISO = this.storage.todayISO();
    if (last.dateISO === todayISO) return T.last_session_today;
    const days = Math.floor(
      (new Date(todayISO).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
    );
    return days === 1
      ? T.last_session_days_one
      : this.tr.tp('last_session_days_many', { n: days });
  });

  protected readonly routineDays = computed(() => {
    const s = this.state.state();
    const T = this.T();
    const todayISO = this.storage.todayISO();
    return s.days.map((day, i) => {
      const last = this.storage.lastSessionForDay(s, day.id);
      let lastLabel = T.first_time_label;
      if (last) {
        const daysAgo = Math.floor(
          (new Date(todayISO).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
        );
        lastLabel = daysAgo === 0
          ? T.today_ago
          : daysAgo === 1
            ? T.days_ago_one
            : this.tr.tp('days_ago_many', { n: daysAgo });
      }
      const trainedToday = !!last && last.dateISO === todayISO;
      return { day, index: i, lastLabel, isCurrent: i === this.state.currentDayIndex(), trainedToday };
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
  }

  protected isRecLoading(exercise: Exercise): boolean {
    return this.aiCache()[exercise.id]?.loading === true;
  }

  protected recSource(exercise: Exercise): 'groq' | 'cohere' | 'local' | null {
    const rec = this.aiCache()[exercise.id];
    if (!rec || rec.loading) return null;
    return rec.source ?? null;
  }

  protected recLabel(exercise: Exercise): string {
    const rec = this.aiCache()[exercise.id];
    if (!rec || rec.loading) return '';
    if (!rec.sets?.length) return '';
    const first = rec.sets[0];
    const last = rec.sets[rec.sets.length - 1];
    if (exercise.unit === 'peso corporal') return `${first.reps} reps`;
    if (exercise.unit === 'tiempo') return `${first.reps} seg`;
    const suffix = exercise.unit === 'kg por mano' ? 'kg/m' : exercise.unit === 'kg por brazo' ? 'kg/b' : 'kg';
    if (last.weight > first.weight) {
      return `${first.weight}${suffix} → ${last.weight}${suffix}`;
    }
    return `${first.weight}${suffix} × ${first.reps} reps`;
  }

  protected startTraining(): void {
    const days = this.state.days();
    const currentDay = this.state.currentDay();
    if (!currentDay) return;
    const idx = days.findIndex(d => d.id === currentDay.id);
    if (idx >= 0) this.state.setActiveDay(idx);
    this.confirmSkip.set(false);
    this.showDayMenu.set(false);
    this.mode.set('training');
    this.initActiveExercise(currentDay.id);
  }

  protected finishTraining(): void {
    this.state.advanceRoutine(this.state.activeDayIndex());
    this.showFinishModal.set(false);
    this.showTrainingMenu.set(false);
    this.activeExerciseId.set(null);
    this.mode.set('today');
  }

  protected onExerciseCompleted(completedExercise: Exercise): void {
    const day = this.state.activeDay();
    if (!day) return;
    const tp = this.state.getTodayProgress(day.id);
    const exs = day.exercises;
    const completedIdx = exs.findIndex(ex => ex.id === completedExercise.id);
    for (let offset = 1; offset < exs.length; offset++) {
      const ex = exs[(completedIdx + offset) % exs.length];
      const sets = tp.sets[ex.id] ?? [];
      const allDone = sets.length >= ex.defaultSets && sets.every(s => s.done);
      if (!allDone) {
        this.activeExerciseId.set(ex.id);
        return;
      }
    }
    this.activeExerciseId.set(null);
  }

  private initActiveExercise(dayId: string): void {
    const day = this.state.days().find(d => d.id === dayId);
    if (!day) { this.activeExerciseId.set(null); return; }
    const tp = this.state.getTodayProgress(dayId);
    for (const ex of day.exercises) {
      const sets = tp.sets[ex.id] ?? [];
      const allDone = sets.length >= ex.defaultSets && sets.every(s => s.done);
      if (!allDone) {
        this.activeExerciseId.set(ex.id);
        // Scroll to active card after Angular renders it
        requestAnimationFrame(() => {
          const el = document.querySelector(`[data-exercise-id="${ex.id}"]`);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        });
        return;
      }
    }
    this.activeExerciseId.set(null);
  }

  protected scrollToExercise(exerciseId: string): void {
    this.activeExerciseId.set(exerciseId);
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-exercise-id="${exerciseId}"]`);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  protected doSkip(): void {
    this.state.skipDay();
    this.confirmSkip.set(false);
    this.showDayMenu.set(false);
  }

  protected openDayDetail(day: WorkoutDay): void {
    this.uiState.openDayDetail(day);
  }

  protected openDayPicker(): void {
    this.uiState.openDayPicker();
  }

  protected openActiveHistory(): void {
    const day = this.state.activeDay();
    if (day) this.uiState.openDayDetail(day);
  }

  protected async requestAi(exercise: Exercise): Promise<void> {
    const day = this.state.activeDay();
    if (!day) return;

    this.aiCache.update(c => ({
      ...c,
      [exercise.id]: { sets: [], reason: '', source: 'local', loading: true },
    }));

    const s = this.state.state();
    const tp = this.state.getTodayProgress(day.id);
    const todaySets = tp.sets[exercise.id] ?? [];
    const lastSets = this.storage.lastSetsForExercise(s, exercise.id);
    const history = this.storage.historyForExercise(s, exercise.id);

    const rec = await this.progression.recommend(
      this.state.settings(), exercise, todaySets, lastSets, history,
    );
    this.aiCache.update(c => ({ ...c, [exercise.id]: rec }));
  }


}
