import { HistoryEntry } from '../services/storage.service';

export interface ChartPt {
  x: number;
  y: number;
}

export type ChartMetric = 'top' | '1rm';
export type ChartRange = '3m' | '6m' | 'all';

export interface BuiltChart {
  pts: ChartPt[];
  points: string;
  areaPath: string;
  yLabels: { value: number; y: number }[];
  xLabels: { label: string; x: number }[];
}

/** 1RM estimado con fórmula de Epley: peso × (1 + reps/30), redondeado a 1 decimal */
export function metricValue(h: HistoryEntry, metric: ChartMetric): number {
  if (metric === '1rm') return Math.round(h.topWeight * (1 + h.topReps / 30) * 10) / 10;
  return h.topWeight;
}

export function rangeCutoff(range: ChartRange): string | null {
  if (range === 'all') return null;
  const d = new Date();
  d.setMonth(d.getMonth() - (range === '3m' ? 3 : 6));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Geometría de un gráfico de línea sobre viewBox 0 0 300 110.
 * Compartida entre la vista Historial y el sheet de progresión en sesión.
 */
export function buildChart(history: HistoryEntry[], values: number[]): BuiltChart {
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

  const pts: ChartPt[] = values.map((v, i) => ({
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
