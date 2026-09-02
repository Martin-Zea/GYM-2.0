/**
 * Agregados del PANEL de escritorio (T-835).
 *
 * El escritorio no es donde se entrena: es donde se entiende. Estas funciones producen lo
 * que el móvil no puede mostrar —comparaciones contra el periodo anterior, series por grupo
 * muscular a lo largo del tiempo, varias curvas juntas— y viven separadas de la UI para
 * poder probarse sin navegador.
 *
 * Todas reciben el estado ya cargado y devuelven datos puros: ni leen del almacenamiento ni
 * saben de Angular. Es lo que permite que la fase de datos avance sin esperar al diseño.
 */
import { AppState, Exercise, Session, SetRecord } from '../models/workout.model';
import { MuscleGroup } from '../data/exercise-catalog';
import { shiftISO } from './date';
import { weekStartISO } from './stats';
import { tonnageOf, workingSets } from './session';

/** Una métrica del panel, con su comparación honesta contra el periodo anterior. */
export interface Kpi {
  value: number;
  /** Variación porcentual contra el periodo anterior. `null` = no hay con qué comparar. */
  deltaPct: number | null;
}

/** Sesiones reales: ni saltadas ni vacías. Es el filtro que usa todo el panel. */
export function realSessions(sessions: readonly Session[]): Session[] {
  return sessions.filter((s) => !s.skipped && s.sets.length > 0);
}

/** Tope de la variación que se enseña: por encima, el número deja de informar. */
export const MAX_DELTA_PCT = 999;

/**
 * Compara un periodo con el inmediatamente anterior de la misma longitud.
 *
 * `deltaPct` es `null` cuando el periodo anterior está vacío, y NO cero ni infinito: pasar
 * de nada a algo no es "un aumento del 100 %", es que antes no había con qué comparar.
 * Inventar ahí un número es exactamente lo que hace desconfiar de un panel.
 */
export function comparePeriods(current: number, previous: number): Kpi {
  if (previous <= 0) return { value: current, deltaPct: null };

  // Una semana a cero NO es "un −100 %": es que no hay actividad que comparar. El signo es
  // matemáticamente correcto y engañoso — sugiere un desplome cuando lo que hay es un hueco.
  if (current === 0) return { value: 0, deltaPct: null };

  const raw = Math.round(((current - previous) / previous) * 100);
  // Volver de una semana casi vacía produce cifras como "+13.330 %", que no dicen nada:
  // por encima del tope se acota, y quien lo lea entiende "muchísimo más", que es el dato.
  return { value: current, deltaPct: Math.max(-MAX_DELTA_PCT, Math.min(MAX_DELTA_PCT, raw)) };
}

export interface DashboardKpis {
  volumeKg: Kpi;
  sets: Kpi;
  sessions: Kpi;
}

/**
 * Volumen, series y sesiones de los últimos `days` días, contra los `days` anteriores.
 */
export function dashboardKpis(state: AppState, todayISO: string, days = 7): DashboardKpis {
  const all = realSessions(state.sessions);
  const startCurrent = shiftISO(todayISO, -days + 1);
  const startPrevious = shiftISO(todayISO, -days * 2 + 1);

  const inRange = (s: Session, from: string, to: string) => s.dateISO >= from && s.dateISO <= to;

  const current = all.filter((s) => inRange(s, startCurrent, todayISO));
  const previous = all.filter((s) => inRange(s, startPrevious, shiftISO(startCurrent, -1)));

  const volume = (list: Session[]) =>
    list.reduce((sum, s) => sum + tonnageOf(s.sets, state.exercises), 0);
  const setCount = (list: Session[]) =>
    list.reduce((sum, s) => sum + workingSets(s.sets).length, 0);

  return {
    volumeKg: comparePeriods(Math.round(volume(current)), Math.round(volume(previous))),
    sets: comparePeriods(setCount(current), setCount(previous)),
    sessions: comparePeriods(current.length, previous.length),
  };
}

/** Series semanales de un grupo muscular, para dibujar su evolución. */
export interface GroupWeekPoint {
  weekISO: string;
  sets: number;
}

export interface GroupSeries {
  group: MuscleGroup;
  points: GroupWeekPoint[];
  /** Series de la última semana con datos: lo que se compara con el rango recomendado. */
  latest: number;
}

/**
 * Series por grupo muscular y por semana (T-835).
 *
 * `volumeByGroup()` ya daba el reparto de un periodo; esto lo extiende en el tiempo, que es
 * lo que convierte "hago poca pierna" en "llevo tres semanas por debajo". Las semanas sin
 * ninguna serie de ese grupo se rellenan con cero a propósito: un hueco en el trazo se lee
 * como "no hay dato", y aquí el cero ES el dato.
 */
export function groupSeriesByWeek(
  state: AppState,
  groupOf: (exercise: Exercise) => MuscleGroup | null,
  fromISO: string,
  toISO: string,
): GroupSeries[] {
  const byId = new Map(state.exercises.map((e) => [e.id, e]));
  const weeks: string[] = [];
  for (let w = weekStartISO(fromISO); w <= toISO; w = shiftISO(w, 7)) weeks.push(w);
  if (!weeks.length) return [];

  const counts = new Map<MuscleGroup, Map<string, number>>();
  for (const session of realSessions(state.sessions)) {
    if (session.dateISO < fromISO || session.dateISO > toISO) continue;
    const week = weekStartISO(session.dateISO);
    for (const set of workingSets(session.sets)) {
      const exercise = byId.get(set.exerciseId);
      const group = exercise ? groupOf(exercise) : null;
      if (!group) continue;
      if (!counts.has(group)) counts.set(group, new Map());
      const perWeek = counts.get(group)!;
      perWeek.set(week, (perWeek.get(week) ?? 0) + 1);
    }
  }

  return [...counts.entries()]
    .map(([group, perWeek]) => {
      const points = weeks.map((weekISO) => ({ weekISO, sets: perWeek.get(weekISO) ?? 0 }));
      return { group, points, latest: points[points.length - 1]?.sets ?? 0 };
    })
    .sort((a, b) => b.latest - a.latest);
}

/**
 * Índice de series de trabajo por ejercicio, con UN solo barrido del historial.
 *
 * El panel necesita varios ejercicios a la vez, y `historyForExercise()` recorre todas las
 * sesiones por cada uno: con 80 ejercicios y 1000 sesiones eso son 80 barridos completos.
 * Aquí se paga uno y se consulta por id.
 */
export function indexSetsByExercise(
  sessions: readonly Session[],
): Map<string, { dateISO: string; sets: SetRecord[] }[]> {
  const index = new Map<string, { dateISO: string; sets: SetRecord[] }[]>();
  for (const session of realSessions(sessions)) {
    const perExercise = new Map<string, SetRecord[]>();
    for (const set of workingSets(session.sets)) {
      if (!perExercise.has(set.exerciseId)) perExercise.set(set.exerciseId, []);
      perExercise.get(set.exerciseId)!.push(set);
    }
    for (const [exerciseId, sets] of perExercise) {
      if (!index.has(exerciseId)) index.set(exerciseId, []);
      index.get(exerciseId)!.push({ dateISO: session.dateISO, sets });
    }
  }
  for (const entries of index.values()) entries.sort((a, b) => a.dateISO.localeCompare(b.dateISO));
  return index;
}

/** Una curva del gráfico comparado, ya normalizada al mismo eje que las demás. */
export interface Series {
  id: string;
  label: string;
  points: { dateISO: string; value: number }[];
}

export interface MultiChart {
  /** `d` de cada trazo, en el mismo sistema de coordenadas. */
  paths: { id: string; label: string; d: string }[];
  min: number;
  max: number;
}

/**
 * Varias curvas en un mismo par de ejes (T-835).
 *
 * Comparten escala a propósito: dibujar cada una en su propio rango las haría parecer
 * iguales, que es justo lo contrario de comparar. Una serie con menos de dos puntos se
 * descarta — un punto suelto no es una tendencia.
 */
export function buildMultiChart(
  series: readonly Series[],
  width = 640,
  height = 200,
): MultiChart | null {
  const usable = series.filter((s) => s.points.length >= 2);
  if (!usable.length) return null;

  const values = usable.flatMap((s) => s.points.map((p) => p.value));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;

  const dates = [...new Set(usable.flatMap((s) => s.points.map((p) => p.dateISO)))].sort();
  const xOf = (dateISO: string) =>
    dates.length < 2 ? 0 : (dates.indexOf(dateISO) / (dates.length - 1)) * width;
  const yOf = (value: number) => height - ((value - min) / range) * height;

  return {
    min,
    max,
    paths: usable.map((s) => ({
      id: s.id,
      label: s.label,
      d: s.points
        .map((p, i) => `${i ? 'L' : 'M'}${xOf(p.dateISO).toFixed(1)},${yOf(p.value).toFixed(1)}`)
        .join(' '),
    })),
  };
}
