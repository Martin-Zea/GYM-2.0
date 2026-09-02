import { AppState, Exercise, Session, SetRecord } from '../models/workout.model';
import { MuscleGroup } from '../data/exercise-catalog';
import { e1rm } from './pr';
import { sessionDurationMinutes, tonnageOf, workingSets } from './session';
import { daysBetweenISO, mondayOfISO, shiftISO } from './date';

/**
 * Métricas locales de progreso (RF-PRO-01).
 *
 * Todo se calcula en el cliente a partir del estado. Ninguna función imputa valores: lo que
 * una sesión no registró se OMITE del agregado, nunca se cuenta como cero (RF-PRO-05, R-5).
 */

/** Mejor 1RM estimado de una sesión para un ejercicio. */
export function bestE1rm(sets: readonly SetRecord[]): number {
  const values = workingSets([...sets]).map((s) => e1rm(s.weight || 0, s.reps || 0));
  return values.length ? Math.max(...values) : 0;
}

export interface WeeklyPoint {
  /** Lunes de la semana, en ISO. */
  weekISO: string;
  value: number;
  /** Cuántas sesiones aportaron al punto: 0 significa "sin dato", no "cero". */
  sessions: number;
}

/** Lunes de la semana de una fecha ISO. */
export function weekStartISO(dateISO: string): string {
  return mondayOfISO(dateISO);
}

/**
 * Agrega una serie temporal por semanas (RF-PRO-04).
 *
 * Se usa cuando hay más de 200 puntos: dibujar dos años de sesiones punto a punto no aporta
 * nada legible y sí bloquea el hilo en un móvil de gama media.
 */
export function aggregateWeekly(
  points: readonly { dateISO: string; value: number }[],
): WeeklyPoint[] {
  const byWeek = new Map<string, { total: number; sessions: number }>();
  for (const p of points) {
    const week = weekStartISO(p.dateISO);
    const acc = byWeek.get(week) ?? { total: 0, sessions: 0 };
    acc.total += p.value;
    acc.sessions += 1;
    byWeek.set(week, acc);
  }
  return [...byWeek.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([weekISO, acc]) => ({
      weekISO,
      value: Math.round(acc.total / acc.sessions),
      sessions: acc.sessions,
    }));
}

/** Umbral a partir del cual una gráfica se agrega por semanas (RF-PRO-04). */
export const AGGREGATION_THRESHOLD = 200;

export interface GroupVolume {
  group: MuscleGroup | 'unknown';
  tonnage: number;
  sets: number;
}

/**
 * Volumen por grupo muscular en un rango de fechas (RF-PRO-01).
 *
 * Los ejercicios sin enlace al catálogo caen en `unknown` en vez de repartirse a ojo: decir
 * "hiciste 3 series de pecho" cuando no sabemos qué es ese ejercicio sería inventar.
 */
export function volumeByGroup(
  state: AppState,
  groupOf: (exercise: Exercise) => MuscleGroup | null,
  fromISO: string,
  toISO: string,
): GroupVolume[] {
  const catalog = state.exercises;
  const byId = new Map(catalog.map((e) => [e.id, e]));
  const totals = new Map<string, GroupVolume>();

  for (const session of state.sessions) {
    if (session.skipped || session.dateISO < fromISO || session.dateISO > toISO) continue;
    for (const set of workingSets(session.sets)) {
      const exercise = byId.get(set.exerciseId);
      const group = (exercise && groupOf(exercise)) ?? 'unknown';
      const entry = totals.get(group) ?? { group: group as MuscleGroup, tonnage: 0, sets: 0 };
      entry.tonnage += exercise ? tonnageOf([set], catalog) : 0;
      entry.sets += 1;
      totals.set(group, entry);
    }
  }

  return [...totals.values()].sort((a, b) => b.tonnage - a.tonnage);
}

/**
 * Series semanales por grupo consideradas suficientes.
 *
 * Referencia habitual en la literatura de hipertrofia (10–20 series por grupo y semana). Es
 * una guía para señalar desequilibrios, no una prescripción.
 */
export const WEEKLY_SET_RANGE = { min: 10, max: 20 } as const;

export interface ImbalanceAlert {
  group: MuscleGroup | 'unknown';
  sets: number;
  kind: 'low' | 'high';
}

/**
 * Grupos fuera del rango objetivo en la última semana (RF-PRO-03).
 *
 * Solo se avisa de grupos que el usuario SÍ entrena: señalar que no hace gemelos cuando nunca
 * los ha hecho no es una alerta, es ruido.
 */
export function volumeImbalances(volumes: readonly GroupVolume[]): ImbalanceAlert[] {
  return volumes
    .filter((v) => v.group !== 'unknown' && v.sets > 0)
    .filter((v) => v.sets < WEEKLY_SET_RANGE.min || v.sets > WEEKLY_SET_RANGE.max)
    .map((v) => ({
      group: v.group,
      sets: v.sets,
      kind: v.sets < WEEKLY_SET_RANGE.min ? ('low' as const) : ('high' as const),
    }));
}

/**
 * Adherencia: sesiones hechas frente a las planificadas en las últimas `weeks` semanas.
 *
 * Sin días por semana declarados devuelve `null`: sin plan no hay nada con lo que comparar, y
 * un porcentaje inventado sobre un plan que el usuario no fijó no significa nada.
 */
export function adherence(
  sessions: readonly Session[],
  daysPerWeek: number | null,
  todayISO: string,
  weeks = 4,
): number | null {
  if (!daysPerWeek || daysPerWeek <= 0) return null;
  const real = sessions.filter((s) => !s.skipped && s.sets.length > 0);
  if (!real.length) return null;

  // La ventana no puede empezar ANTES de la primera sesión (T-834). Con 4 semanas fijas,
  // quien acaba de instalar la app se da de bruces con un 25 %: se le exigen 20 sesiones
  // planificadas en un periodo en el que ni siquiera existía. No es una adherencia mala,
  // es una división contra un plan que nadie tuvo ocasión de cumplir.
  const primera = real.reduce((a, s) => (s.dateISO < a ? s.dateISO : a), real[0].dateISO);
  const diasDesdeLaPrimera = daysBetweenISO(primera, todayISO) + 1;
  const semanas = Math.min(weeks, Math.max(1, Math.ceil(diasDesdeLaPrimera / 7)));

  const fromISO = shiftISO(todayISO, -semanas * 7);
  const done = real.filter((s) => s.dateISO >= fromISO && s.dateISO <= todayISO).length;
  const planned = daysPerWeek * semanas;
  return Math.min(100, Math.round((done / planned) * 100));
}

/**
 * Duración media de sesión, o `null` si ninguna la registró (RF-PRO-05).
 *
 * Las sesiones sin marcas de tiempo se saltan; NO cuentan como sesiones de cero minutos, que
 * hundirían la media de cualquiera que venga de antes de la migración.
 */
export function averageDurationMinutes(sessions: readonly Session[]): number | null {
  const durations = sessions
    .map((s) => sessionDurationMinutes(s))
    .filter((d): d is number => d !== null);
  if (!durations.length) return null;
  return Math.round(durations.reduce((a, b) => a + b, 0) / durations.length);
}
