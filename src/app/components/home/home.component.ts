import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ExerciseCardComponent } from '../exercise-card/exercise-card.component';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { ProgressionService } from '../../services/progression.service';
import { AiRecommendation, Exercise, WorkoutDay } from '../../models/workout.model';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [IconComponent, ExerciseCardComponent],
  templateUrl: './home.component.html',
})
export class HomeComponent {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  private readonly progression = inject(ProgressionService);

  protected readonly mode = signal<'today' | 'training'>(
    (sessionStorage.getItem('gym_mode') as 'today' | 'training' | null) ?? 'today',
  );
  protected readonly confirmSkip = signal(false);
  protected readonly aiCache = signal<Partial<Record<string, AiRecommendation>>>({});

  // Progress for the active training day (tab)
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

  // Progress for the current routine day (today screen)
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

  protected readonly trainedDayIds = computed(() => {
    const today = this.storage.todayISO();
    return new Set(
      this.state.sessions()
        .filter(s => s.dateISO === today && !s.skipped)
        .map(s => s.dayId),
    );
  });

  protected readonly lastTrainedInfo = computed(() => {
    const day = this.state.currentDay();
    if (!day) return null;
    const last = this.state.sessions()
      .filter(s => s.dayId === day.id && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];
    if (!last) return null;
    const todayISO = this.storage.todayISO();
    if (last.dateISO === todayISO) return 'Entrenado hoy';
    const days = Math.floor(
      (new Date(todayISO).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
    );
    return days === 1 ? 'Última sesión: hace 1 día' : `Última sesión: hace ${days} días`;
  });

  // Routine overview: all days with last trained label
  protected readonly routineDays = computed(() => {
    const s = this.state.state();
    const todayISO = this.storage.todayISO();
    return s.days.map((day, i) => {
      const last = this.storage.lastSessionForDay(s, day.id);
      let lastLabel = 'Primera vez';
      if (last) {
        const daysAgo = Math.floor(
          (new Date(todayISO).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
        );
        lastLabel = daysAgo === 0 ? 'Hoy' : daysAgo === 1 ? 'Hace 1 día' : `Hace ${daysAgo} días`;
      }
      return { day, index: i, lastLabel, isCurrent: i === this.state.currentDayIndex() };
    });
  });

  constructor() {
    // Persist mode across navigation
    effect(() => sessionStorage.setItem('gym_mode', this.mode()));

    // Clear AI cache when switching days in training view
    effect(() => {
      this.state.activeDayIndex();
      untracked(() => this.aiCache.set({}));
    });

    // Auto-load recs when today view is shown or current day changes
    effect(() => {
      const day = this.state.currentDay();
      const m = this.mode();
      if (m === 'today' && day) {
        untracked(() => this.loadTodayRecs());
      }
    });

    // Handle training start triggered from DayDetailSheet
    effect(() => {
      if (this.uiState.pendingTrainingStart()) {
        untracked(() => {
          this.uiState.pendingTrainingStart.set(false);
          this.mode.set('training');
        });
      }
    });
  }

  protected youtubeUrl(name: string): string {
    return `https://www.youtube.com/results?search_query=${encodeURIComponent('como hacer ' + name + ' gym')}`;
  }

  protected recLabel(exercise: Exercise): string {
    const rec = this.aiCache()[exercise.id];
    if (!rec) return '';
    if (rec.loading) return '...';
    if (!rec.sets?.length) return '—';
    const first = rec.sets[0];
    const last = rec.sets[rec.sets.length - 1];
    if (exercise.unit === 'peso corporal') return `${first.reps} reps`;
    if (exercise.unit === 'tiempo') return `${first.reps} seg`;
    const suffix = exercise.unit === 'kg por mano' ? 'kg/m' : 'kg';
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
    this.mode.set('training');
  }

  protected finishTraining(): void {
    this.state.advanceRoutine();
    this.mode.set('today');
  }

  protected doSkip(): void {
    this.state.skipDay();
    this.confirmSkip.set(false);
  }

  // Open day detail sheet (last session preview + train option)
  protected openDayDetail(day: WorkoutDay): void {
    this.uiState.dayDetail.set(day);
  }

  // Open day picker sheet (training mode navigation)
  protected openDayPicker(): void {
    this.uiState.showDayPicker.set(true);
  }

  // Open historial from training mode header
  protected openActiveHistory(): void {
    const day = this.state.activeDay();
    if (day) this.uiState.dayDetail.set(day);
  }

  // Called by exercise-card on expand (on-demand rec in training mode)
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

  private async loadTodayRecs(): Promise<void> {
    const day = this.state.currentDay();
    if (!day) return;
    const dayId = day.id;

    const loading: Partial<Record<string, AiRecommendation>> = {};
    for (const ex of day.exercises) {
      loading[ex.id] = { sets: [], reason: '', source: 'local', loading: true };
    }
    this.aiCache.set(loading);

    const s = this.state.state();
    const tp = this.state.getTodayProgress(dayId);

    for (const ex of day.exercises) {
      if (this.state.currentDay()?.id !== dayId) break;
      const todaySets = tp.sets[ex.id] ?? [];
      const lastSets = this.storage.lastSetsForExercise(s, ex.id);
      const history = this.storage.historyForExercise(s, ex.id);
      const rec = await this.progression.recommend(
        this.state.settings(), ex, todaySets, lastSets, history,
      );
      if (this.state.currentDay()?.id !== dayId) break;
      this.aiCache.update(c => ({ ...c, [ex.id]: rec }));
    }
  }
}
