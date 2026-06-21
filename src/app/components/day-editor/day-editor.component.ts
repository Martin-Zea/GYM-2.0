import { Component, OnInit, computed, inject, signal } from '@angular/core';
import {
  CdkDragDrop,
  CdkDrag,
  CdkDropList,
  moveItemInArray,
  CdkDragHandle,
  CdkDragPlaceholder,
} from '@angular/cdk/drag-drop';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { UIStateService } from '../../services/ui-state.service';
import { StorageService, normalizeExerciseName } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { Exercise, ExerciseUnit, WorkoutDay } from '../../models/workout.model';

interface ExerciseSuggestion {
  ex: Exercise;
  sessions: number;
  archived: boolean;
}

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [
    IconComponent,
    FocusTrapDirective,
    CdkDrag,
    CdkDropList,
    CdkDragHandle,
    CdkDragPlaceholder,
  ],
  templateUrl: './day-editor.component.html',
  styleUrl: './day-editor.component.scss',
})
export class DayEditorComponent implements OnInit {
  private readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly dayName = signal('');
  protected readonly exercises = signal<Exercise[]>([]);
  protected readonly activeNameField = signal<number | null>(null);
  protected readonly expandedIndices = signal<Set<number>>(new Set<number>());
  protected readonly confirmDeleteExIndex = signal<number | null>(null);
  protected readonly confirmDeleteDay = signal(false);

  protected readonly activeSuggestions = computed<ExerciseSuggestion[]>(() => {
    const i = this.activeNameField();
    if (i === null) return [];
    const row = this.exercises()[i];
    if (!row) return [];
    const query = normalizeExerciseName(row.name);
    if (!query) return [];
    const usedIds = new Set(this.exercises().map((e) => e.id));
    const appState = this.state.state();
    const activeIds = new Set(appState.days.flatMap((d) => d.exerciseIds));
    const out: ExerciseSuggestion[] = [];
    for (const ex of this.state.exercises()) {
      if (usedIds.has(ex.id)) continue;
      if (!normalizeExerciseName(ex.name).includes(query)) continue;
      out.push({
        ex,
        sessions: this.storage.historyForExercise(appState, ex.id).length,
        archived: !activeIds.has(ex.id),
      });
    }
    out.sort((a, b) => b.sessions - a.sessions || a.ex.name.localeCompare(b.ex.name));
    return out.slice(0, 5);
  });

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
      this.expandedIndices.set(new Set([0]));
    } else if (editing) {
      const day = editing as WorkoutDay;
      this.dayName.set(day.name);
      this.exercises.set(JSON.parse(JSON.stringify(day.exercises)));
      this.expandedIndices.set(new Set());
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
    this.expandedIndices.update((s) => {
      const next = new Set(s);
      next.add(this.exercises().length - 1);
      return next;
    });
  }

  protected requestDeleteExercise(i: number): void {
    this.confirmDeleteExIndex.set(i);
  }

  protected cancelDeleteExercise(): void {
    this.confirmDeleteExIndex.set(null);
  }

  protected confirmRemoveExercise(i: number): void {
    this.confirmDeleteExIndex.set(null);
    this.exercises.update((arr) => arr.filter((_, idx) => idx !== i));
    this.expandedIndices.update((s) => {
      const next = new Set<number>();
      for (const idx of s) {
        if (idx < i) next.add(idx);
        else if (idx > i) next.add(idx - 1);
      }
      return next;
    });
  }

  protected requestDeleteDay(): void {
    this.confirmDeleteDay.set(true);
  }

  protected cancelDeleteDay(): void {
    this.confirmDeleteDay.set(false);
  }

  protected onDrop(event: CdkDragDrop<Exercise[]>): void {
    const from = event.previousIndex;
    const to = event.currentIndex;
    if (from === to) return;

    const old = this.expandedIndices();
    const next = new Set<number>();
    for (const idx of old) {
      if (idx === from) {
        next.add(to);
      } else if (from < to && idx > from && idx <= to) {
        next.add(idx - 1);
      } else if (from > to && idx >= to && idx < from) {
        next.add(idx + 1);
      } else {
        next.add(idx);
      }
    }

    const arr = [...this.exercises()];
    moveItemInArray(arr, from, to);
    this.exercises.set(arr);
    this.expandedIndices.set(next);
    this.confirmDeleteExIndex.set(null);
  }

  protected toggleExpand(i: number): void {
    this.confirmDeleteExIndex.set(null);
    this.expandedIndices.update((s) => {
      const next = new Set(s);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  protected isExpanded(i: number): boolean {
    return this.expandedIndices().has(i);
  }

  protected setDayName(event: Event): void {
    this.dayName.set((event.target as HTMLInputElement).value);
  }

  protected setExName(i: number, event: Event): void {
    this.patch(i, { name: (event.target as HTMLInputElement).value });
    this.activeNameField.set(i);
  }

  protected focusName(i: number): void {
    this.activeNameField.set(i);
  }

  protected blurName(): void {
    setTimeout(() => this.activeNameField.set(null), 120);
  }

  protected selectSuggestion(i: number, ex: Exercise): void {
    this.exercises.update((arr) => arr.map((row, idx) => (idx === i ? { ...ex } : row)));
    this.activeNameField.set(null);
  }

  protected sessionsLabel(n: number): string {
    return n === 1 ? this.T().exercise_sessions_one : this.tr.tp('exercise_sessions_many', { n });
  }

  protected setExNum(
    i: number,
    key: 'defaultSets' | 'defaultRepTarget' | 'brick' | 'restSeconds',
    event: Event,
  ): void {
    this.patch(i, { [key]: Number((event.target as HTMLInputElement).value) });
  }

  protected setExBrick(i: number, event: Event): void {
    const raw = (event.target as HTMLInputElement).value.replace(',', '.');
    const num = parseFloat(raw);
    if (!isNaN(num) && num > 0) {
      this.patch(i, { brick: num });
    } else {
      (event.target as HTMLInputElement).value = String(this.exercises()[i].brick);
    }
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
