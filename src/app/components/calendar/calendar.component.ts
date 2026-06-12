import { Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';

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
  protected readonly T = inject(TranslationService).T;

  protected readonly viewDate = signal(new Date());
  protected readonly DOW = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  private static readonly MONTHS = [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ];

  protected readonly monthLabel = computed(() => {
    const d = this.viewDate();
    return `${CalendarComponent.MONTHS[d.getMonth()]} ${d.getFullYear()}`;
  });

  private readonly realTrainedIsos = computed(() =>
    new Set(this.state.sessions().filter(s => !s.skipped).map(s => s.dateISO)),
  );

  private readonly skippedIsos = computed(() =>
    new Set(this.state.sessions().filter(s => s.skipped).map(s => s.dateISO)),
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

    return this.state.days().map(day => {
      const last = sessions
        .filter(s => s.dayId === day.id && !s.skipped)
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
    if (daysAgo === null) return 'Sin sesiones';
    if (daysAgo === 0) return 'Hoy';
    if (daysAgo === 1) return 'Ayer';
    return `Hace ${daysAgo} días`;
  }

  protected prevMonth(): void {
    this.viewDate.update(d => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    this.viewDate.update(d => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }
}
