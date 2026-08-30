import {
  AppState,
  Exercise,
  Session,
  StoredWorkoutDay,
  WeightLogEntry,
} from '../models/workout.model';
import { normalizeExerciseName } from './storage.service';

/**
 * Fusión de un backup con el estado local (RF-STO-05, EA-5, `audit.md` R-6).
 *
 * **Por qué no se fusiona por id.** `uid()` genera 7 caracteres aleatorios sin espacio de
 * nombres. Dentro de un dispositivo la colisión es improbable, pero fusionar une dos
 * universos de ids generados por la misma función: que dos ejercicios DISTINTOS compartan
 * id es un escenario real, y fusionarlos mezclaría el historial de uno dentro del otro.
 * Corrupción silenciosa, la peor clase.
 *
 * Por eso la identidad es semántica: los ejercicios se reconocen por nombre normalizado y
 * las sesiones por (día, fecha). Los ids del backup entrante se remapean a los locales
 * cuando coinciden semánticamente, y se sustituyen por ids nuevos cuando chocan con un
 * id local que designa otra cosa.
 *
 * Ante la duda, gana lo local: fusionar nunca pisa datos del dispositivo.
 */

export interface MergeSummary {
  exercisesAdded: number;
  exercisesMatched: number;
  daysAdded: number;
  daysMatched: number;
  sessionsAdded: number;
  /** Sesiones del backup que ya existían localmente (mismo día y fecha). */
  sessionsSkipped: number;
  weightEntriesAdded: number;
  /** Ids del backup que chocaban con un id local distinto y hubo que renombrar. */
  idsRemapped: number;
}

export interface MergeResult {
  state: AppState;
  summary: MergeSummary;
}

/** Clave de identidad de una sesión: el mismo día entrenado la misma fecha es la misma. */
const sessionKey = (dayId: string, dateISO: string): string => `${dayId}@${dateISO}`;

export function mergeStates(local: AppState, incoming: AppState): MergeResult {
  const summary: MergeSummary = {
    exercisesAdded: 0,
    exercisesMatched: 0,
    daysAdded: 0,
    daysMatched: 0,
    sessionsAdded: 0,
    sessionsSkipped: 0,
    weightEntriesAdded: 0,
    idsRemapped: 0,
  };

  const usedIds = new Set<string>([
    ...local.exercises.map((e) => e.id),
    ...local.days.map((d) => d.id),
    ...local.sessions.map((s) => s.id),
  ]);

  /** Da un id libre. Solo entra en juego cuando el id entrante ya designa otra cosa. */
  const freshId = (): string => {
    let id: string;
    do {
      id = Math.random().toString(36).slice(2, 9);
    } while (usedIds.has(id));
    usedIds.add(id);
    return id;
  };

  // ── Ejercicios: identidad por nombre normalizado ───────────────────────────
  const exercises = [...local.exercises];
  const byName = new Map(exercises.map((e) => [normalizeExerciseName(e.name), e.id]));
  const exerciseRemap = new Map<string, string>();

  for (const incomingEx of incoming.exercises) {
    const key = normalizeExerciseName(incomingEx.name);
    const localId = byName.get(key);

    if (localId) {
      // Mismo ejercicio: se conserva la versión local y su id, para no desanclar historial.
      exerciseRemap.set(incomingEx.id, localId);
      if (incomingEx.id !== localId) summary.idsRemapped++;
      summary.exercisesMatched++;
      continue;
    }

    // Ejercicio nuevo. Si su id ya lo ocupa otra cosa acá, se le da uno libre.
    const id = usedIds.has(incomingEx.id) ? freshId() : incomingEx.id;
    if (id !== incomingEx.id) summary.idsRemapped++;
    usedIds.add(id);
    const added: Exercise = { ...incomingEx, id };
    exercises.push(added);
    byName.set(key, id);
    exerciseRemap.set(incomingEx.id, id);
    summary.exercisesAdded++;
  }

  const mapEx = (id: string): string => exerciseRemap.get(id) ?? id;

  // ── Días: identidad por nombre normalizado ─────────────────────────────────
  const days = local.days.map((d) => ({ ...d, exerciseIds: [...d.exerciseIds] }));
  const dayByName = new Map(days.map((d) => [normalizeExerciseName(d.name), d]));
  const dayRemap = new Map<string, string>();

  for (const incomingDay of incoming.days) {
    const key = normalizeExerciseName(incomingDay.name);
    const existing = dayByName.get(key);

    if (existing) {
      dayRemap.set(incomingDay.id, existing.id);
      if (incomingDay.id !== existing.id) summary.idsRemapped++;
      // Los ejercicios que el backup tenía y acá no, se suman al final del día.
      for (const exId of incomingDay.exerciseIds.map(mapEx)) {
        if (!existing.exerciseIds.includes(exId)) existing.exerciseIds.push(exId);
      }
      summary.daysMatched++;
      continue;
    }

    const id = usedIds.has(incomingDay.id) ? freshId() : incomingDay.id;
    if (id !== incomingDay.id) summary.idsRemapped++;
    usedIds.add(id);
    const added: StoredWorkoutDay = {
      id,
      name: incomingDay.name,
      exerciseIds: incomingDay.exerciseIds.map(mapEx),
    };
    days.push(added);
    dayByName.set(key, added);
    dayRemap.set(incomingDay.id, id);
    summary.daysAdded++;
  }

  const mapDay = (id: string): string => dayRemap.get(id) ?? id;

  // ── Sesiones: identidad por (día, fecha) ───────────────────────────────────
  const sessions = [...local.sessions];
  const seen = new Set(sessions.map((s) => sessionKey(s.dayId, s.dateISO)));

  for (const incomingSession of incoming.sessions) {
    const dayId = mapDay(incomingSession.dayId);
    const key = sessionKey(dayId, incomingSession.dateISO);

    if (seen.has(key)) {
      // Ya entrenamos ese día en esa fecha: gana lo local, no se duplica (EA-5).
      summary.sessionsSkipped++;
      continue;
    }

    const id = usedIds.has(incomingSession.id) ? freshId() : incomingSession.id;
    if (id !== incomingSession.id) summary.idsRemapped++;
    usedIds.add(id);

    const merged: Session = {
      ...incomingSession,
      id,
      dayId,
      sets: incomingSession.sets.map((set) => ({ ...set, exerciseId: mapEx(set.exerciseId) })),
      ...(incomingSession.feelings && { feelings: remapKeys(incomingSession.feelings, mapEx) }),
      ...(incomingSession.notes && { notes: remapKeys(incomingSession.notes, mapEx) }),
    };
    sessions.push(merged);
    seen.add(key);
    summary.sessionsAdded++;
  }

  // ── Peso corporal: unión por fecha, gana lo local ──────────────────────────
  const weightLog: WeightLogEntry[] = [...local.settings.userProfile.weightLog];
  const weightDates = new Set(weightLog.map((w) => w.dateISO));
  for (const entry of incoming.settings.userProfile.weightLog) {
    if (weightDates.has(entry.dateISO)) continue;
    weightLog.push(entry);
    weightDates.add(entry.dateISO);
    summary.weightEntriesAdded++;
  }
  weightLog.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1));

  // Un día fusionado que no cuelgue de ninguna rutina sería invisible: `days()` resuelve
  // solo la rutina activa. Se adoptan en la activa, que es donde el usuario los espera.
  const claimed = new Set((local.routines ?? []).flatMap((r) => r.dayIds));
  const orphans = days.map((d) => d.id).filter((id) => !claimed.has(id));
  const routines = (local.routines ?? []).map((r) =>
    r.id === local.activeRoutineId ? { ...r, dayIds: [...r.dayIds, ...orphans] } : r,
  );

  return {
    state: {
      ...local,
      exercises,
      days,
      routines,
      sessions: sessions.sort((a, b) => (a.dateISO < b.dateISO ? -1 : 1)),
      settings: {
        // Preferencias, keys y perfil: se conservan las locales. Fusionar ajustes no
        // significa nada y sorprendería al usuario (¿qué tema gana?).
        ...local.settings,
        userProfile: { ...local.settings.userProfile, weightLog },
      },
    },
    summary,
  };
}

function remapKeys<T>(record: Record<string, T>, map: (id: string) => string): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(record)) out[map(k)] = v;
  return out;
}
