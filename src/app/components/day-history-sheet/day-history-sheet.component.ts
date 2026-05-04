import { Component, computed, inject } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { Session } from '../../models/workout.model';

interface SessionView {
  session: Session;
  dateLabel: string;
  daysAgo: number;
  exercises: { name: string; unit: string; sets: { weight: number; reps: number }[] }[];
  totalVolume: number;
}

@Component({
  selector: 'app-day-history-sheet',
  standalone: true,
  imports: [IconComponent, DecimalPipe],
  templateUrl: './day-history-sheet.component.html',
  styleUrl: './day-history-sheet.component.scss',
})
export class DayHistorySheetComponent {
  protected readonly state = inject(StateService);
  protected readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);

  protected readonly day = computed(() => this.uiState.dayHistory());

  protected readonly sessions = computed((): SessionView[] => {
    const d = this.day();
    if (!d) return [];
    const s = this.state.state();
    const todayISO = this.storage.todayISO();
    const allSessions = this.storage.allSessionsForDay(s, d.id);

    return allSessions.map(session => {
      const daysAgo = Math.floor(
        (new Date(todayISO).getTime() - new Date(session.dateISO).getTime()) / 86_400_000,
      );
      const dateLabel = daysAgo === 0 ? 'Hoy' : daysAgo === 1 ? 'Ayer' : session.dateISO.slice(5).replace('-', '/');

      const exercises = d.exercises.map(ex => ({
        name: ex.name,
        unit: ex.unit,
        sets: session.sets
          .filter(sr => sr.exerciseId === ex.id)
          .sort((a, b) => a.setIndex - b.setIndex)
          .map(sr => ({ weight: sr.weight, reps: sr.reps })),
      })).filter(ex => ex.sets.length > 0);

      const totalVolume = session.sets.reduce((sum, sr) => sum + (sr.weight || 0) * (sr.reps || 0), 0);

      return { session, dateLabel, daysAgo, exercises, totalVolume };
    });
  });

  protected close(): void {
    this.uiState.dayHistory.set(null);
  }

  protected setLabel(weight: number, reps: number, unit: string): string {
    if (unit === 'peso corporal') return `${reps} reps`;
    if (unit === 'tiempo') return `${reps} seg`;
    if (unit === 'kg por mano') return `${weight}kg/m × ${reps}`;
    return `${weight}kg × ${reps}`;
  }
}
