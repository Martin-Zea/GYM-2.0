import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';

interface CalDay {
  day: number | null;
  iso: string | null;
  trained: boolean;
  skipped: boolean;
  isToday: boolean;
}

interface RoutineDaySummary {
  id: string;
  name: string;
  daysAgo: number | null;
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './calendar.component.html',
  styleUrl: './calendar.component.scss',
})
export class CalendarComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly uiState = inject(UIStateService);

  protected readonly viewDate = signal(new Date());

  // Jan 1 2024 is a Monday — use it to generate locale-aware weekday abbreviations Mon–Sun
  private static readonly DOW_BASE = new Date(2024, 0, 1);

  protected readonly DOW = computed(() => {
    const lang = this.tr.lang();
    const fmt = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(CalendarComponent.DOW_BASE);
      d.setDate(1 + i);
      return fmt.format(d);
    });
  });

  protected readonly monthLabel = computed(() => {
    const d = this.viewDate();
    const lang = this.tr.lang();
    return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric' }).format(d);
  });

  private readonly realTrainedIsos = computed(
    () =>
      new Set(
        this.state
          .sessions()
          .filter((s) => !s.skipped)
          .map((s) => s.dateISO),
      ),
  );

  private readonly skippedIsos = computed(
    () =>
      new Set(
        this.state
          .sessions()
          .filter((s) => s.skipped)
          .map((s) => s.dateISO),
      ),
  );

  protected readonly calDays = computed<CalDay[]>(() => {
    const d = this.viewDate();
    const year = d.getFullYear();
    const month = d.getMonth();
    const today = this.storage.todayISO();
    const trained = this.realTrainedIsos();
    const skipped = this.skippedIsos();

    const firstDow = (new Date(year, month, 1).getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const cells: CalDay[] = [];
    for (let i = 0; i < firstDow; i++) {
      cells.push({ day: null, iso: null, trained: false, skipped: false, isToday: false });
    }
    for (let n = 1; n <= daysInMonth; n++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      cells.push({
        day: n,
        iso,
        trained: trained.has(iso),
        skipped: !trained.has(iso) && skipped.has(iso),
        isToday: iso === today,
      });
    }
    return cells;
  });

  protected readonly stats = computed(() => {
    const trained = this.realTrainedIsos();
    const now = new Date();

    let last30 = 0;
    for (let i = 0; i < 30; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (trained.has(d.toISOString().slice(0, 10))) last30++;
    }

    const todayISO = this.storage.todayISO();
    const startOffset = trained.has(todayISO) ? 0 : 1;
    let streak = 0;
    for (let i = startOffset; i < 366; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (trained.has(d.toISOString().slice(0, 10))) streak++;
      else break;
    }

    return { total: trained.size, last30, streak };
  });

  protected readonly routineSummary = computed<RoutineDaySummary[]>(() => {
    const sessions = this.state.sessions();
    const today = this.storage.todayISO();

    return this.state.days().map((day) => {
      const last = sessions
        .filter((s) => s.dayId === day.id && !s.skipped)
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];

      if (!last) return { id: day.id, name: day.name, daysAgo: null };
      if (last.dateISO === today) return { id: day.id, name: day.name, daysAgo: 0 };

      const diff = Math.floor(
        (new Date(today).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
      );
      return { id: day.id, name: day.name, daysAgo: diff };
    });
  });

  protected daysAgoLabel(daysAgo: number | null): string {
    const t = this.T();
    if (daysAgo === null) return t.cal_no_sessions;
    if (daysAgo === 0) return t.today_ago;
    if (daysAgo === 1) return t.yesterday;
    return this.tr.tp('days_ago_many', { n: daysAgo });
  }

  protected onDayClick(cell: CalDay): void {
    if (!cell.trained || !cell.iso) return;
    const sessions = this.state.sessions();
    const session = sessions.find((s) => s.dateISO === cell.iso && !s.skipped);
    if (!session) return;
    const day = this.state.days().find((d) => d.id === session.dayId);
    if (day) this.uiState.openDayHistory(day, cell.iso);
  }

  protected onRoutineRowClick(dayId: string): void {
    const day = this.state.days().find((d) => d.id === dayId);
    if (day) this.uiState.openDayDetail(day);
  }

  protected prevMonth(): void {
    this.viewDate.update((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    this.viewDate.update((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
}
