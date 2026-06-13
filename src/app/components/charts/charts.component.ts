import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { HistoryEntry, StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { Exercise, WeightLogEntry } from '../../models/workout.model';

interface Pt {
  x: number;
  y: number;
}

type ChartMetric = 'top' | '1rm';
type ChartRange = '3m' | '6m' | 'all';

interface ChartData {
  history: HistoryEntry[];
  pr: number;
  volLast: number;
  weightDelta: number;
  trend: 'up' | 'down' | 'flat';
  pts: Pt[];
  points: string;
  areaPath: string;
  yLabels: { value: number; y: number }[];
  xLabels: { label: string; x: number }[];
}

interface ChartItem {
  exercise: Exercise;
  chart: ChartData | null; // null → menos de 2 sesiones en el rango: tarjeta con estado vacío
}

interface BodyweightChart {
  entries: WeightLogEntry[];
  current: number;
  pts: Pt[];
  points: string;
  areaPath: string;
  yLabels: { value: number; y: number }[];
  xLabels: { label: string; x: number }[];
}

@Component({
  selector: 'app-charts',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './charts.component.html',
  styleUrl: './charts.component.scss',
})
export class ChartsComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly route = inject(ActivatedRoute);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly metric = signal<ChartMetric>('top');
  protected readonly range = signal<ChartRange>('all');

  protected readonly chartItems = computed<ChartItem[]>(() => {
    const s = this.state.state();
    const metric = this.metric();
    const cutoff = this.rangeCutoff(this.range());
    const result: ChartItem[] = [];

    for (const day of s.days) {
      for (const ex of day.exercises) {
        const history = this.storage
          .historyForExercise(s, ex.id)
          .filter((h) => h.topWeight > 0 && (!cutoff || h.dateISO >= cutoff));
        if (history.length < 2) {
          result.push({ exercise: ex, chart: null });
          continue;
        }
        // 1RM (Epley) no aplica a ejercicios por tiempo ni de peso corporal: siempre peso máximo
        const exMetric = ex.unit === 'tiempo' || ex.unit === 'peso corporal' ? 'top' : metric;
        const values = history.map((h) => this.metricValue(h, exMetric));
        // PR sigue la métrica activa (máximo del valor graficado); el volumen (peso × reps)
        // es independiente de la métrica, así que volLast/volAvg quedan sobre los datos reales.
        const pr = Math.max(...values);
        const volLast = history[history.length - 1].volume;
        const n = history.length;
        const weightDelta =
          Math.round((history[n - 1].topWeight - history[n - 2].topWeight) * 10) / 10;
        const trend: 'up' | 'down' | 'flat' =
          weightDelta > 0 ? 'up' : weightDelta < 0 ? 'down' : 'flat';
        result.push({
          exercise: ex,
          chart: { history, pr, volLast, weightDelta, trend, ...this.buildChart(history, values) },
        });
      }
    }

    return result;
  });

  protected readonly bodyweightChart = computed<BodyweightChart | null>(() => {
    const cutoff = this.rangeCutoff(this.range());
    const log = [...this.state.settings().userProfile.weightLog]
      .filter((e) => !cutoff || e.dateISO >= cutoff)
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));
    if (log.length < 2) return null;
    // Adaptar el log al shape de HistoryEntry para reusar buildChart()
    const history: HistoryEntry[] = log.map((e) => ({
      dateISO: e.dateISO,
      sets: [],
      topWeight: e.weightKg,
      topReps: 0,
      totalReps: 0,
      volume: 0,
    }));
    return {
      entries: log,
      current: log[log.length - 1].weightKg,
      ...this.buildChart(
        history,
        history.map((h) => h.topWeight),
      ),
    };
  });

  private readonly fragment = toSignal(this.route.fragment);

  constructor() {
    // Scroll to specific exercise when navigated with fragment
    effect(() => {
      this.chartItems(); // ensure computed runs
      const fragment = this.fragment();
      if (!fragment) return;
      setTimeout(() => {
        const el = document.getElementById('chart-' + fragment);
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    });
  }

  // 1RM estimado con fórmula de Epley: peso × (1 + reps/30), redondeado a 1 decimal
  private metricValue(h: HistoryEntry, metric: ChartMetric): number {
    if (metric === '1rm') return Math.round(h.topWeight * (1 + h.topReps / 30) * 10) / 10;
    return h.topWeight;
  }

  private rangeCutoff(range: ChartRange): string | null {
    if (range === 'all') return null;
    const d = new Date();
    d.setMonth(d.getMonth() - (range === '3m' ? 3 : 6));
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private buildChart(
    history: HistoryEntry[],
    values: number[],
  ): Omit<ChartData, 'history' | 'pr' | 'volLast' | 'weightDelta' | 'trend'> {
    const x0 = 32,
      x1 = 292,
      y0 = 8,
      y1 = 88;
    const pw = x1 - x0,
      ph = y1 - y0;
    const n = history.length;

    const minW = Math.min(...values);
    const maxW = Math.max(...values);
    const range = maxW - minW || 1;

    const pts: Pt[] = values.map((v, i) => ({
      x: x0 + (i / Math.max(n - 1, 1)) * pw,
      y: y1 - ((v - minW) / range) * ph,
    }));

    const points = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = [
      `M${pts[0].x.toFixed(1)},${y1}`,
      ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `L${pts[pts.length - 1].x.toFixed(1)},${y1}Z`,
    ].join(' ');

    const yLabels = [
      { value: minW, y: y1 },
      { value: maxW, y: y0 + 6 },
    ];

    const indices = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    const xLabels = indices.map((i) => ({
      label: history[i].dateISO.slice(5),
      x: pts[i].x,
    }));

    return { pts, points, areaPath, yLabels, xLabels };
  }
}
