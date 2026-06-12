import { Component, OnInit, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { Exercise, ExerciseUnit, WorkoutDay } from '../../models/workout.model';

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-editor.component.html',
})
export class DayEditorComponent implements OnInit {
  private readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly dayName = signal('');
  protected readonly exercises = signal<Exercise[]>([]);
  protected readonly units: ExerciseUnit[] = [
    'kg',
    'kg por mano',
    'kg por brazo',
    'tiempo',
    'peso corporal',
  ];

  protected get isNew(): boolean {
    return this.uiState.editingDay() === 'new';
  }

  ngOnInit(): void {
    const editing = this.uiState.editingDay();
    if (editing === 'new') {
      this.dayName.set('');
      this.exercises.set([this.makeExercise()]);
    } else if (editing) {
      const day = editing as WorkoutDay;
      this.dayName.set(day.name);
      this.exercises.set(JSON.parse(JSON.stringify(day.exercises)));
    }
  }

  private makeExercise(): Exercise {
    return {
      id: this.storage.uid(),
      name: '',
      brick: 2.5,
      defaultSets: 3,
      defaultRepTarget: 10,
      restSeconds: 90,
      unit: 'kg',
      notes: '',
    };
  }

  protected addExercise(): void {
    this.exercises.update((arr) => [...arr, this.makeExercise()]);
  }

  protected removeExercise(i: number): void {
    this.exercises.update((arr) => arr.filter((_, idx) => idx !== i));
  }

  protected moveUp(i: number): void {
    if (i <= 0) return;
    this.exercises.update((arr) => {
      const copy = [...arr];
      [copy[i - 1], copy[i]] = [copy[i], copy[i - 1]];
      return copy;
    });
  }

  protected moveDown(i: number): void {
    this.exercises.update((arr) => {
      if (i >= arr.length - 1) return arr;
      const copy = [...arr];
      [copy[i], copy[i + 1]] = [copy[i + 1], copy[i]];
      return copy;
    });
  }

  protected setDayName(event: Event): void {
    this.dayName.set((event.target as HTMLInputElement).value);
  }

  protected setExName(i: number, event: Event): void {
    this.patch(i, { name: (event.target as HTMLInputElement).value });
  }

  protected setExNum(
    i: number,
    key: 'defaultSets' | 'defaultRepTarget' | 'brick' | 'restSeconds',
    event: Event,
  ): void {
    this.patch(i, { [key]: Number((event.target as HTMLInputElement).value) });
  }

  protected setExUnit(i: number, event: Event): void {
    this.patch(i, { unit: (event.target as HTMLSelectElement).value as ExerciseUnit });
  }

  private patch(i: number, p: Partial<Exercise>): void {
    this.exercises.update((arr) => arr.map((ex, idx) => (idx === i ? { ...ex, ...p } : ex)));
  }

  protected save(): void {
    const name = this.dayName().trim();
    if (!name) return;
    const editing = this.uiState.editingDay();
    const day: WorkoutDay = {
      id: editing === 'new' ? this.storage.uid() : (editing as WorkoutDay).id,
      name,
      exercises: this.exercises().filter((e) => e.name.trim()),
    };
    this.state.saveDay(day);
    this.uiState.closeEditingDay();
  }

  protected deleteDay(): void {
    const editing = this.uiState.editingDay();
    if (editing && editing !== 'new') {
      this.state.deleteDay((editing as WorkoutDay).id);
    }
    this.uiState.closeEditingDay();
  }

  protected close(): void {
    this.uiState.closeEditingDay();
  }
}
