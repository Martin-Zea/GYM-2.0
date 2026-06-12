import { Component, computed, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { Session } from '../../models/workout.model';

@Component({
  selector: 'app-day-detail-sheet',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-detail-sheet.component.html',
  styleUrl: './day-detail-sheet.component.scss',
})
export class DayDetailSheetComponent {
  protected readonly state = inject(StateService);
  protected readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly T = inject(TranslationService).T;

  protected readonly day = computed(() => this.uiState.dayDetail());

  protected readonly lastSession = computed((): Session | null => {
    const d = this.day();
    if (!d) return null;
    return this.storage.lastSessionForDay(this.state.state(), d.id);
  });

  protected readonly exerciseSets = computed(() => {
    const d = this.day();
    const session = this.lastSession();
    if (!d || !session) return [];
    return d.exercises.map((ex) => ({
      exercise: ex,
      sets: session.sets
        .filter((s) => s.exerciseId === ex.id)
        .sort((a, b) => a.setIndex - b.setIndex),
    }));
  });

  protected readonly sessionDateLabel = computed(() => {
    const session = this.lastSession();
    if (!session) return null;
    const todayISO = this.storage.todayISO();
    const days = Math.floor(
      (new Date(todayISO).getTime() - new Date(session.dateISO).getTime()) / 86_400_000,
    );
    if (days === 0) return 'Hoy';
    if (days === 1) return 'Hace 1 día';
    return `Hace ${days} días`;
  });

  protected close(): void {
    this.uiState.closeDayDetail();
  }

  protected openHistory(): void {
    const d = this.day();
    if (!d) return;
    // Open dayHistory first (pushState), then close dayDetail (history.back via skip).
    // Net history delta = 0: one overlay swaps for another without changing depth.
    this.uiState.openDayHistory(d);
    this.uiState.closeDayDetail();
  }

  protected trainDay(): void {
    const d = this.day();
    if (!d) return;
    const idx = this.state.days().findIndex((day) => day.id === d.id);
    if (idx >= 0) this.state.setActiveDay(idx);
    this.uiState.pendingTrainingStart.set(true);
    this.uiState.closeDayDetail();
  }

  protected setLabel(weight: number, reps: number, unit: string): string {
    if (unit === 'peso corporal') return `${reps} reps`;
    if (unit === 'tiempo') return `${reps} seg`;
    if (unit === 'kg por mano') return `${weight}kg/m × ${reps}`;
    return `${weight}kg × ${reps}`;
  }
}
