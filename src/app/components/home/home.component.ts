import { Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { ExerciseCardComponent } from '../exercise-card/exercise-card.component';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { ProgressionService } from '../../services/progression.service';
import { AiRecommendation, Exercise } from '../../models/workout.model';

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

  protected readonly aiCache = signal<Partial<Record<string, AiRecommendation>>>({});

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

  protected readonly trainedDayIds = computed(() => {
    const today = this.storage.todayISO();
    return new Set(this.state.sessions().filter(s => s.dateISO === today).map(s => s.dayId));
  });

  constructor() {
    effect(() => {
      this.state.activeDayIndex();
      untracked(() => this.aiCache.set({}));
    });
  }

  protected async requestAi(exercise: Exercise): Promise<void> {
    const day = this.state.activeDay();
    if (!day) return;

    this.aiCache.update(c => ({
      ...c,
      [exercise.id]: { weight: 0, reps: 0, reason: '', source: 'local', loading: true },
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
