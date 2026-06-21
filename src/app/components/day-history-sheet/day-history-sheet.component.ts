import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { Session } from '../../models/workout.model';
import { daysBetweenISO } from '../../utils/date';
import { formatSetLine } from '../../utils/rec-label';

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
  isIncomplete: boolean;
  volumeDelta: number | null; // % change vs previous session; null if no prior
}

@Component({
  selector: 'app-day-history-sheet',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-history-sheet.component.html',
  styleUrl: './day-history-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
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
    const lang = this.tr.lang();
    const filterISO = this.uiState.dayHistoryFilterISO();
    // Incluye sesiones skipped (solo eliminables desde acá)
    const allSessions = this.state
      .sessions()
      .filter((s) => s.dayId === d.id && (!filterISO || s.dateISO === filterISO))
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));

    const views = allSessions.map((session) => {
      const daysAgo = daysBetweenISO(session.dateISO, todayISO);
      const dateLabel = this.formatDateLabel(session.dateISO, daysAgo, lang);

      const exercises = d.exercises
        .map((ex) => ({
          id: ex.id,
          name: ex.name,
          unit: ex.unit,
          sets: session.sets
            .filter((sr) => sr.exerciseId === ex.id)
            .sort((a, b) => a.setIndex - b.setIndex)
            .map((sr) => ({ setIndex: sr.setIndex, weight: sr.weight, reps: sr.reps })),
        }))
        .filter((ex) => ex.sets.length > 0);

      const totalVolume = session.sets.reduce(
        (sum, sr) => sum + (sr.weight || 0) * (sr.reps || 0),
        0,
      );

      const isIncomplete = !session.skipped && exercises.length < d.exercises.length;

      return {
        session,
        dateLabel,
        daysAgo,
        exercises,
        totalVolume,
        isIncomplete,
        volumeDelta: null as number | null,
      };
    });

    // Compute volume delta vs. previous session (array is sorted desc, so next index = older)
    for (let i = 0; i < views.length - 1; i++) {
      const prev = views[i + 1].totalVolume;
      if (prev > 0 && !views[i].session.skipped && !views[i + 1].session.skipped) {
        views[i].volumeDelta = Math.round(((views[i].totalVolume - prev) / prev) * 100);
      }
    }

    return views;
  });

  private readonly MONTHS_ES = [
    'ene',
    'feb',
    'mar',
    'abr',
    'may',
    'jun',
    'jul',
    'ago',
    'sep',
    'oct',
    'nov',
    'dic',
  ];
  private readonly MONTHS_EN = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];

  private formatDateLabel(dateISO: string, daysAgo: number, lang: string): string {
    const T = this.tr.T();
    if (daysAgo === 0) return T.today_ago;
    if (daysAgo === 1) return T.yesterday;
    if (daysAgo <= 6) return this.tr.tp('days_ago_many', { n: daysAgo });
    const [year, month, day] = dateISO.split('-').map(Number);
    const monthLabel = lang === 'es' ? this.MONTHS_ES[month - 1] : this.MONTHS_EN[month - 1];
    const currentYear = new Date().getFullYear();
    return year === currentYear ? `${day} ${monthLabel}` : `${day} ${monthLabel} ${year}`;
  }

  protected formatVolume(vol: number): string {
    return vol.toLocaleString(this.tr.lang() === 'es' ? 'es-AR' : 'en-US', {
      maximumFractionDigits: 0,
    });
  }

  protected close(): void {
    this.uiState.closeDayHistory();
  }

  protected setLabel(weight: number, reps: number, unit: string): string {
    return formatSetLine(weight, reps, unit);
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

  protected onDraftInput(
    exerciseId: string,
    setIndex: number,
    field: 'weight' | 'reps',
    event: Event,
  ): void {
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
