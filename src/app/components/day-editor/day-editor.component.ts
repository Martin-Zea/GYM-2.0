import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
  archived: boolean; // está en el catálogo pero ya no en ninguna rutina
}

@Component({
  selector: 'app-day-editor',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-editor.component.html',
  styles: [
    `
      .ex-suggest {
        margin: -2px 0 10px;
        border: 1px solid var(--border);
        border-radius: var(--radius-lg);
        background: var(--bg-1);
        overflow: hidden;
      }
      .ex-suggest-label {
        font-size: 11px;
        color: var(--text-3);
        padding: 8px 12px 4px;
      }
      .ex-suggest-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        width: 100%;
        padding: 11px 12px;
        background: none;
        border: none;
        border-top: 1px solid var(--border);
        color: var(--text-0);
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      .ex-suggest-item:active {
        background: var(--bg-hover);
      }
      .ex-suggest-main {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
      }
      .ex-suggest-name {
        font-weight: 600;
        font-size: 14px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .ex-suggest-tag {
        flex: none;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        color: var(--text-2);
        border: 1px solid var(--border);
        border-radius: 999px;
        padding: 1px 7px;
      }
      .ex-suggest-hint {
        font-size: 12px;
        color: var(--color-accent);
        font-family: 'JetBrains Mono', monospace;
        white-space: nowrap;
      }
    `,
  ],
})
export class DayEditorComponent implements OnInit {
  private readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly dayName = signal('');
  protected readonly exercises = signal<Exercise[]>([]);
  /** Índice de la fila cuyo input de nombre está enfocado (o null). */
  protected readonly activeNameField = signal<number | null>(null);

  /**
   * Sugerencias del catálogo para la fila activa: ejercicios cuyo nombre normalizado
   * contiene lo tipeado y que no están ya en este día. Ordenadas por más historial
   * primero. Elegir una reusa su id → reconecta el historial en vez de duplicar.
   */
  protected readonly activeSuggestions = computed<ExerciseSuggestion[]>(() => {
    const i = this.activeNameField();
    if (i === null) return [];
    const row = this.exercises()[i];
    if (!row) return [];
    const query = normalizeExerciseName(row.name);
    if (!query) return [];
    const usedIds = new Set(this.exercises().map((e) => e.id));
    const appState = this.state.state();
    // Ids referenciados por alguna rutina: los que no estén acá están "archivados".
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
    this.activeNameField.set(i);
  }

  protected focusName(i: number): void {
    this.activeNameField.set(i);
  }

  /** Oculta el dropdown tras un respiro para que un tap en una sugerencia alcance a registrarse. */
  protected blurName(): void {
    setTimeout(() => this.activeNameField.set(null), 120);
  }

  /** Adopta la definición completa del catálogo (incluido su id → reconecta historial). */
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
