import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { HistoryEntry, StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { Exercise } from '../../models/workout.model';
import {
  BuiltChart,
  ChartMetric,
  ChartRange,
  buildChart,
  metricValue,
  rangeCutoff,
} from '../../utils/chart';
import { daysBetweenISO } from '../../utils/date';
import { tonnageOf } from '../../utils/session';
import {
  AGGREGATION_THRESHOLD,
  ImbalanceAlert,
  adherence,
  aggregateWeekly,
  averageDurationMinutes,
  volumeByGroup,
  volumeImbalances,
} from '../../utils/stats';
import { CatalogService } from '../../services/catalog.service';

interface CalDay {
  day: number | null;
  iso: string | null;
  trained: boolean;
  skipped: boolean;
  isToday: boolean;
  /** 0 = sin entrenar; 1–4 = intensidad relativa del tonelaje de ese día (RF-PRO-02). */
  intensity?: number;
  tonnage?: number;
}

interface RoutineDaySummary {
  id: string;
  name: string;
  daysAgo: number | null;
}

interface BigChart extends BuiltChart {
  pr: number;
  volLast: number | null;
  weightDelta: number;
  trend: 'up' | 'down' | 'flat';
  history: HistoryEntry[];
  isBodyweight: boolean;
  /** El trazo está agrupado por semanas (RF-PRO-04). */
  aggregated: boolean;
  /** Sesiones del rango que no registraron esta métrica y por eso NO se dibujan (R-5). */
  missing: number;
}

interface PrRow {
  exerciseName: string;
  weight: number;
  reps: number;
}

const BW = '__bodyweight__';

/**
 * Historial unificado: calendario (mapa de calor + stats) y progresión
 * (selector de ejercicio + UN gráfico grande) en una sola vista.
 */
@Component({
  selector: 'app-history',
  standalone: true,
  imports: [IconComponent, RouterLink],
  templateUrl: './history.component.html',
  styleUrl: './history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HistoryComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly uiState = inject(UIStateService);
  private readonly route = inject(ActivatedRoute);

  // ═══ Calendario ═══

  protected readonly viewDate = signal(new Date());

  private static readonly DOW_BASE = new Date(2024, 0, 1);

  protected readonly DOW = computed(() => {
    const lang = this.tr.lang();
    const fmt = new Intl.DateTimeFormat(lang, { weekday: 'narrow' });
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(HistoryComponent.DOW_BASE);
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
      cells.push({
        day: null,
        iso: null,
        trained: false,
        skipped: false,
        isToday: false,
        intensity: 0,
      });
    }
    const tonnage = this.tonnageByDate();
    const peak = Math.max(1, ...tonnage.values());
    for (let n = 1; n <= daysInMonth; n++) {
      const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
      const dayTonnage = tonnage.get(iso) ?? 0;
      cells.push({
        day: n,
        iso,
        trained: trained.has(iso),
        skipped: !trained.has(iso) && skipped.has(iso),
        isToday: iso === today,
        // Intensidad 1–4 para el heatmap: un día suave y uno de piernas no se ven igual
        intensity: dayTonnage > 0 ? Math.min(4, Math.ceil((dayTonnage / peak) * 4)) : 0,
        tonnage: Math.round(dayTonnage),
      });
    }
    return cells;
  });

  /** Tonelaje por fecha, base del heatmap de asistencia (RF-PRO-02). */
  private readonly tonnageByDate = computed(() => {
    const s = this.state.state();
    const map = new Map<string, number>();
    for (const session of s.sessions) {
      if (session.skipped || !session.sets.length) continue;
      map.set(
        session.dateISO,
        (map.get(session.dateISO) ?? 0) + tonnageOf(session.sets, s.exercises),
      );
    }
    return map;
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

    let prev30 = 0;
    for (let i = 30; i < 60; i++) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      if (trained.has(d.toISOString().slice(0, 10))) prev30++;
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

    return { total: trained.size, last30, delta30: last30 - prev30, streak };
  });

  /**
   * Adherencia: sesiones hechas contra las planificadas (P1 del diseño).
   *
   * El plan sale de cuántos días tiene la rutina activa. Sin rutina no hay plan y devuelve
   * `null`: un porcentaje sobre un objetivo que nadie declaró es un número inventado (R-5).
   */
  protected readonly adherencePct = computed(() => {
    const planned = this.state.days().length;
    return adherence(this.state.sessions(), planned || null, this.storage.todayISO());
  });

  /** Duración media; `null` si ninguna sesión registró marcas de tiempo. */
  protected readonly avgDuration = computed(() => averageDurationMinutes(this.state.sessions()));

  // ── Equilibrio de volumen por grupo muscular (RF-PRO-01/03) ──

  private readonly catalog = inject(CatalogService);

  protected readonly imbalances = computed(() => {
    const today = this.storage.todayISO();
    const from = new Date(`${today}T00:00:00`);
    from.setDate(from.getDate() - 7);
    const volumes = volumeByGroup(
      this.state.state(),
      (ex) => this.catalog.byRef(ex.catalogRef)?.group ?? null,
      from.toISOString().slice(0, 10),
      today,
    );
    return volumeImbalances(volumes);
  });

  protected imbalanceText(alert: ImbalanceAlert): string {
    const group = this.T()[`muscle_${alert.group}` as keyof ReturnType<typeof this.T>] as string;
    return this.tr.tp(alert.kind === 'low' ? 'imbalance_low' : 'imbalance_high', {
      group,
      n: alert.sets,
    });
  }

  protected dayAria(cell: CalDay): string {
    if (!cell.iso) return '';
    const d = new Date(cell.iso + 'T12:00:00Z');
    const label = new Intl.DateTimeFormat(this.tr.lang(), {
      day: 'numeric',
      month: 'long',
    }).format(d);
    const tonnage = cell.tonnage ? ` · ${cell.tonnage} kg` : '';
    return `${label} · ${this.T().cal_trained}${tonnage}`;
  }

  protected onDayClick(cell: CalDay): void {
    if (!cell.trained || !cell.iso) return;
    const sessions = this.state.sessions();
    const session = sessions.find((s) => s.dateISO === cell.iso && !s.skipped);
    if (!session) return;
    const day = this.state.days().find((d) => d.id === session.dayId);
    if (day) this.uiState.openDayHistory(day, cell.iso);
  }

  protected prevMonth(): void {
    this.viewDate.update((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1));
  }

  protected nextMonth(): void {
    this.viewDate.update((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1));
  }

  // ═══ Progresión: selector + un gráfico grande ═══

  protected readonly metric = signal<ChartMetric>('top');
  protected readonly range = signal<ChartRange>('all');
  protected readonly selectedId = signal<string | null>(null);
  protected readonly selectedPoint = signal<number | null>(null);

  /** Ejercicios con al menos 2 sesiones con peso (los graficables). */
  protected readonly chartableExercises = computed<Exercise[]>(() => {
    const s = this.state.state();
    return s.exercises.filter(
      (ex) => this.storage.historyForExercise(s, ex.id).filter((h) => h.topWeight > 0).length >= 2,
    );
  });

  protected readonly hasBodyweight = computed(
    () => this.state.settings().userProfile.weightLog.length >= 2,
  );

  /** Id efectivo: el elegido, o el primero graficable. */
  protected readonly effectiveId = computed<string | null>(() => {
    const chosen = this.selectedId();
    if (chosen === BW && this.hasBodyweight()) return BW;
    if (chosen && this.chartableExercises().some((e) => e.id === chosen)) return chosen;
    return this.chartableExercises()[0]?.id ?? (this.hasBodyweight() ? BW : null);
  });

  protected readonly BW = BW;

  protected readonly selectedExercise = computed(() => {
    const id = this.effectiveId();
    if (!id || id === BW) return null;
    return this.state.exercises().find((e) => e.id === id) ?? null;
  });

  protected readonly bigChart = computed<BigChart | null>(() => {
    const id = this.effectiveId();
    if (!id) return null;
    const cutoff = rangeCutoff(this.range());

    if (id === BW) {
      const log = [...this.state.settings().userProfile.weightLog]
        .filter((e) => !cutoff || e.dateISO >= cutoff)
        .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
      if (log.length < 2) return null;
      const history: HistoryEntry[] = log.map((e) => ({
        dateISO: e.dateISO,
        sets: [],
        topWeight: e.weightKg,
        topReps: 0,
        totalReps: 0,
        volume: 0,
      }));
      const values = history.map((h) => h.topWeight);
      const delta = Math.round((values[values.length - 1] - values[0]) * 10) / 10;
      return {
        pr: Math.max(...values),
        volLast: null,
        weightDelta: delta,
        trend: delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat',
        history,
        isBodyweight: true,
        aggregated: false,
        missing: 0,
        ...buildChart(history, values),
      };
    }

    const s = this.state.state();
    const ex = this.selectedExercise();
    if (!ex) return null;
    const inRange = this.storage
      .historyForExercise(s, ex.id)
      .filter((h) => !cutoff || h.dateISO >= cutoff);
    // Sesiones que no registraron esta métrica: se EXCLUYEN del trazo, no se dibujan en 0,
    // y se avisa de que faltan en vez de fingir una caída (RF-PRO-05, R-5).
    const history = inRange.filter((h) => h.topWeight > 0);
    const missing = inRange.length - history.length;
    if (history.length < 2) return null;
    const exMetric = ex.unit === 'TIME' || ex.unit === 'BODYWEIGHT' ? 'top' : this.metric();
    // Con historiales largos se agrega por semanas antes de dibujar (RF-PRO-04): 800 puntos
    // en un SVG no se leen y bloquean el hilo en un móvil de gama media.
    const aggregated = history.length > AGGREGATION_THRESHOLD;
    const values = history.map((h) => metricValue(h, exMetric));
    const n = history.length;
    const weightDelta = Math.round((history[n - 1].topWeight - history[n - 2].topWeight) * 10) / 10;
    if (aggregated) {
      const weekly = aggregateWeekly(
        history.map((h, i) => ({ dateISO: h.dateISO, value: values[i] })),
      );
      const weeklyHistory = weekly.map((w) => ({
        dateISO: w.weekISO,
        sets: [],
        topWeight: w.value,
        topReps: 0,
        totalReps: 0,
        volume: 0,
      }));
      const weeklyValues = weekly.map((w) => w.value);
      return {
        pr: Math.max(...values),
        volLast: history[n - 1].volume,
        weightDelta,
        trend: weightDelta > 0 ? 'up' : weightDelta < 0 ? 'down' : 'flat',
        history: weeklyHistory,
        isBodyweight: false,
        aggregated: true,
        missing,
        ...buildChart(weeklyHistory, weeklyValues),
      };
    }

    return {
      pr: Math.max(...values),
      volLast: history[n - 1].volume,
      weightDelta,
      trend: weightDelta > 0 ? 'up' : weightDelta < 0 ? 'down' : 'flat',
      history,
      isBodyweight: false,
      aggregated: false,
      missing,
      ...buildChart(history, values),
    };
  });

  protected onExerciseSelect(event: Event): void {
    this.selectedId.set((event.target as HTMLSelectElement).value || null);
    this.selectedPoint.set(null);
  }

  protected togglePoint(index: number): void {
    this.selectedPoint.update((cur) => (cur === index ? null : index));
  }

  protected formatPointDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return new Intl.DateTimeFormat(this.tr.lang(), {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  }

  protected pointAria(iso: string, value: number): string {
    return `${this.formatPointDate(iso)} · ${value} kg`;
  }

  protected openSessionAt(dateISO: string): void {
    const ex = this.selectedExercise();
    if (!ex) return;
    const session = this.state
      .sessions()
      .find(
        (s) => s.dateISO === dateISO && !s.skipped && s.sets.some((x) => x.exerciseId === ex.id),
      );
    if (!session) return;
    const day = this.state.days().find((d) => d.id === session.dayId);
    if (day) this.uiState.openDayHistory(day, dateISO);
  }

  // ═══ PRs top 3 ═══

  protected readonly topPrs = computed<PrRow[]>(() => {
    const s = this.state.state();
    const rows: PrRow[] = [];
    for (const ex of s.exercises) {
      if (ex.unit === 'TIME' || ex.unit === 'BODYWEIGHT') continue;
      const history = this.storage.historyForExercise(s, ex.id);
      let best: HistoryEntry | null = null;
      for (const entry of history) {
        if (!best || entry.topWeight > best.topWeight) best = entry;
      }
      if (best && best.topWeight > 0) {
        rows.push({ exerciseName: ex.name, weight: best.topWeight, reps: best.topReps });
      }
    }
    return rows.sort((a, b) => b.weight - a.weight).slice(0, 3);
  });

  // ═══ Resumen de rutina ═══

  protected readonly routineSummary = computed<RoutineDaySummary[]>(() => {
    const sessions = this.state.sessions();
    const today = this.storage.todayISO();

    return this.state.days().map((day) => {
      const last = sessions
        .filter((s) => s.dayId === day.id && !s.skipped)
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0];

      if (!last) return { id: day.id, name: day.name, daysAgo: null };
      if (last.dateISO === today) return { id: day.id, name: day.name, daysAgo: 0 };

      return { id: day.id, name: day.name, daysAgo: daysBetweenISO(last.dateISO, today) };
    });
  });

  protected daysAgoLabel(daysAgo: number | null): string {
    const t = this.T();
    if (daysAgo === null) return t.cal_no_sessions;
    if (daysAgo === 0) return t.today_ago;
    if (daysAgo === 1) return t.yesterday;
    return this.tr.tp('days_ago_many', { n: daysAgo });
  }

  protected onRoutineRowClick(dayId: string): void {
    const day = this.state.days().find((d) => d.id === dayId);
    if (day) this.uiState.openDayDetail(day);
  }

  // Deep link: /history#exerciseId preselecciona ese ejercicio en el gráfico
  private readonly fragment = toSignal(this.route.fragment);

  constructor() {
    effect(() => {
      const frag = this.fragment();
      if (frag) this.selectedId.set(frag);
    });
  }
}
