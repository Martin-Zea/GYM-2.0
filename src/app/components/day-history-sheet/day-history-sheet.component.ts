import { Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { Session } from '../../models/workout.model';

interface SetView {
  setIndex: number;
  weight: number;
  reps: number;
}

interface SessionView {
  session: Session;
  dateLabel: string;
  daysAgo: number;
  exercises: { id: string; name: string; unit: string; sets: SetView[] }[];
  totalVolume: number;
}

@Component({
  selector: 'app-day-history-sheet',
  standalone: true,
  imports: [IconComponent, DecimalPipe, FocusTrapDirective],
  templateUrl: './day-history-sheet.component.html',
  styleUrl: './day-history-sheet.component.scss',
})
export class DayHistorySheetComponent {
  protected readonly state = inject(StateService);
  protected readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly day = computed(() => this.uiState.dayHistory());

  protected readonly editingId = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);

  /** Borrador de edición keyed por `${exerciseId}:${setIndex}` */
  private drafts: Record<string, { weight: number; reps: number }> = {};

  protected readonly sessions = computed((): SessionView[] => {
    const d = this.day();
    if (!d) return [];
    const todayISO = this.storage.todayISO();
    // Incluye sesiones skipped (solo eliminables desde acá)
    const allSessions = this.state.sessions()
      .filter(s => s.dayId === d.id)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));

    return allSessions.map(session => {
      const daysAgo = Math.floor(
        (new Date(todayISO).getTime() - new Date(session.dateISO).getTime()) / 86_400_000,
      );
      const dateLabel = daysAgo === 0 ? 'Hoy' : daysAgo === 1 ? 'Ayer' : session.dateISO.slice(5).replace('-', '/');

      const exercises = d.exercises.map(ex => ({
        id: ex.id,
        name: ex.name,
        unit: ex.unit,
        sets: session.sets
          .filter(sr => sr.exerciseId === ex.id)
          .sort((a, b) => a.setIndex - b.setIndex)
          .map(sr => ({ setIndex: sr.setIndex, weight: sr.weight, reps: sr.reps })),
      })).filter(ex => ex.sets.length > 0);

      const totalVolume = session.sets.reduce((sum, sr) => sum + (sr.weight || 0) * (sr.reps || 0), 0);

      return { session, dateLabel, daysAgo, exercises, totalVolume };
    });
  });

  protected close(): void {
    this.uiState.closeDayHistory();
  }

  protected setLabel(weight: number, reps: number, unit: string): string {
    if (unit === 'peso corporal') return `${reps} reps`;
    if (unit === 'tiempo') return `${reps} seg`;
    if (unit === 'kg por mano') return `${weight}kg/m × ${reps}`;
    return `${weight}kg × ${reps}`;
  }

  protected startEdit(sv: SessionView): void {
    this.confirmDeleteId.set(null);
    this.drafts = {};
    for (const ex of sv.exercises) {
      for (const set of ex.sets) {
        this.drafts[`${ex.id}:${set.setIndex}`] = { weight: set.weight, reps: set.reps };
      }
    }
    this.editingId.set(sv.session.id);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.drafts = {};
  }

  protected onDraftInput(exerciseId: string, setIndex: number, field: 'weight' | 'reps', event: Event): void {
    const draft = this.drafts[`${exerciseId}:${setIndex}`];
    if (!draft) return;
    const num = Number((event.target as HTMLInputElement).value);
    draft[field] = Number.isFinite(num) ? num : 0;
  }

  protected saveEdit(sv: SessionView): void {
    for (const ex of sv.exercises) {
      for (const set of ex.sets) {
        const draft = this.drafts[`${ex.id}:${set.setIndex}`];
        if (!draft) continue;
        const patch: Partial<Pick<SetView, 'weight' | 'reps'>> = {};
        if (draft.weight !== set.weight) patch.weight = draft.weight;
        if (draft.reps !== set.reps) patch.reps = draft.reps;
        if (Object.keys(patch).length) {
          this.state.updateSessionSet(sv.session.id, ex.id, set.setIndex, patch);
        }
      }
    }
    this.cancelEdit();
  }

  protected askDelete(sessionId: string): void {
    this.editingId.set(null);
    this.confirmDeleteId.set(sessionId);
  }

  protected confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (id) this.state.deleteSession(id);
    this.confirmDeleteId.set(null);
  }

  protected cancelDelete(): void {
    this.confirmDeleteId.set(null);
  }
}
