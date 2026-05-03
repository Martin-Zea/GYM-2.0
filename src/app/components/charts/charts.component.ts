import { Component, computed, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { HistoryEntry, StorageService } from '../../services/storage.service';
import { Exercise } from '../../models/workout.model';

interface Pt { x: number; y: number; }

interface ChartItem {
  exercise: Exercise;
  history: HistoryEntry[];
  pr: number;
  volLast: number;
  volAvg: number;
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
})
export class ChartsComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly route = inject(ActivatedRoute);

  protected readonly chartItems = computed<ChartItem[]>(() => {
    const s = this.state.state();
    const result: ChartItem[] = [];

    for (const day of s.days) {
      for (const ex of day.exercises) {
        const history = this.storage.historyForExercise(s, ex.id).filter(h => h.topWeight > 0);
        if (history.length < 2) continue;
        const pr = Math.max(...history.map(h => h.topWeight));
        const volLast = history[history.length - 1].volume;
        const volAvg = Math.round(history.reduce((sum, h) => sum + h.volume, 0) / history.length);
        result.push({ exercise: ex, history, pr, volLast, volAvg, ...this.buildChart(history) });
      }
    }

    return result;
  });

  constructor() {
    // Scroll to specific exercise when navigated with fragment
    effect(() => {
      this.chartItems(); // ensure computed runs
      this.route.fragment.subscribe(fragment => {
        if (!fragment) return;
        setTimeout(() => {
          const el = document.getElementById('chart-' + fragment);
          if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);
      });
    });
  }

  private buildChart(history: HistoryEntry[]): Omit<ChartItem, 'exercise' | 'history' | 'pr' | 'volLast' | 'volAvg'> {
    const x0 = 32, x1 = 292, y0 = 8, y1 = 88;
    const pw = x1 - x0, ph = y1 - y0;
    const n = history.length;

    const weights = history.map(h => h.topWeight);
    const minW = Math.min(...weights);
    const maxW = Math.max(...weights);
    const range = maxW - minW || 1;

    const pts: Pt[] = history.map((h, i) => ({
      x: x0 + (i / Math.max(n - 1, 1)) * pw,
      y: y1 - ((h.topWeight - minW) / range) * ph,
    }));

    const points = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
    const areaPath = [
      `M${pts[0].x.toFixed(1)},${y1}`,
      ...pts.map(p => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
      `L${pts[pts.length - 1].x.toFixed(1)},${y1}Z`,
    ].join(' ');

    const yLabels = [
      { value: minW, y: y1 },
      { value: maxW, y: y0 + 6 },
    ];

    const indices = [...new Set([0, Math.floor((n - 1) / 2), n - 1])];
    const xLabels = indices.map(i => ({
      label: history[i].dateISO.slice(5),
      x: pts[i].x,
    }));

    return { pts, points, areaPath, yLabels, xLabels };
  }
}
