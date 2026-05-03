import { Component, computed, inject, input, output, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { AiRecommendation, Exercise, TodaySetProgress, WorkoutDay } from '../../models/workout.model';

@Component({
  selector: 'app-exercise-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './exercise-card.component.html',
})
export class ExerciseCardComponent {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly uiState = inject(UIStateService);

  readonly day = input.required<WorkoutDay>();
  readonly exercise = input.required<Exercise>();
  readonly aiRec = input<AiRecommendation | null>(null);
  readonly requestAi = output<void>();

  protected readonly expanded = signal(false);

  protected readonly setsArray = computed((): TodaySetProgress[] => {
    const ex = this.exercise();
    const tp = this.state.getTodayProgress(this.day().id);
    const saved = tp.sets[ex.id] ?? [];
    return Array.from({ length: ex.defaultSets }, (_, i) =>
      saved[i] ?? { weight: '' as number | string, reps: '' as number | string, done: false },
    );
  });

  protected readonly lastSets = computed(() =>
    this.storage.lastSetsForExercise(this.state.state(), this.exercise().id),
  );

  protected readonly doneSetsCount = computed(() =>
    this.setsArray().filter(s => s.done).length,
  );

  protected readonly isDone = computed(() => {
    const arr = this.setsArray();
    return arr.length > 0 && arr.every(s => s.done);
  });

  protected toggle(): void {
    this.expanded.update(v => !v);
  }

  protected updateWeight(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const weight = val === '' ? ('' as unknown as number) : Number(val);
    this.state.updateSet(this.day().id, this.exercise().id, i, { weight });
  }

  protected updateReps(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const reps = val === '' ? ('' as unknown as number) : Number(val);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps });
  }

  protected toggleDone(setIndex: number): void {
    const result = this.state.toggleSetDone(this.day().id, this.exercise(), setIndex);
    if (result === 'done') {
      const ex = this.exercise();
      const restSecs = ex.restSeconds || this.state.settings().defaultRest;
      const arr = this.setsArray();
      const nextIdx = arr.findIndex((s, i) => i > setIndex && !s.done);
      const nextLabel = nextIdx >= 0 ? `Serie ${nextIdx + 1}` : 'Siguiente ejercicio';
      this.uiState.restTimer.set({ seconds: restSecs, exerciseId: ex.id, nextLabel });
    }
  }

  protected onRequestAi(): void {
    this.requestAi.emit();
  }
}
