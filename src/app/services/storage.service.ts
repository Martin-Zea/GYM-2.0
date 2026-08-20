import { Injectable } from '@angular/core';
import {
  AppState,
  Exercise,
  SetRecord,
  Session,
  StoredWorkoutDay,
  TodayDayProgress,
  UserProfile,
  WeightLogEntry,
} from '../models/workout.model';
import { createInitialState } from '../data/initial-data';
import { STORAGE_KEYS } from './storage-keys';
import { IDB_SNAPSHOT_STORE, IDB_STATE_STORE, idbDelete, idbGet, idbKeys, idbPut } from './idb';
import { daysBetweenISO as daysBetween } from '../utils/date';

const STORAGE_KEY = STORAGE_KEYS.appState;
const CURRENT_SCHEMA = 6;

/** Resultado de `save()`: la capa de persistencia reporta el fallo, la UI decide qué mostrar. */
export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'unknown' };

/**
 * Normaliza el nombre de un ejercicio para comparar identidad: sin espacios al
 * borde, minúsculas, sin acentos, espacios colapsados. "Press Banca" === "press  bancá".
 */
export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

export function isValidAppState(x: unknown): boolean {
  if (typeof x !== 'object' || x === null) return false;
  const d = x as Record<string, unknown>;
  if (!Array.isArray(d['days'])) return false;
  if ('sessions' in d && !Array.isArray(d['sessions'])) return false;
  if (
    'todayProgress' in d &&
    (typeof d['todayProgress'] !== 'object' || d['todayProgress'] === null)
  )
    return false;
  return true;
}

export interface HistoryEntry {
  dateISO: string;
  sets: SetRecord[];
  topWeight: number;
  topReps: number;
  totalReps: number;
  volume: number;
}

function defaultUserProfile(): UserProfile {
  return {
    weightKg: null,
    heightCm: null,
    age: null,
    sex: null,
    weightLog: [],
    goal: null,
    aiNotes: '',
  };
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  /** Migra estado de schemas anteriores al schema actual (v6), encadenando versiones */
  private migrate(p: Partial<AppState>): Partial<AppState> {
    const version = typeof p.schemaVersion === 'number' ? p.schemaVersion : 1;
    let m: Partial<AppState> = p;
    // v1/v2 → v3: routinePointer se separó de activeDayIndex
    if (version < 3) {
      m = { ...m, routinePointer: m.routinePointer ?? m.activeDayIndex ?? 0 };
    }
    // v3 → v4: userProfile.weightLog; se siembra con el weightKg actual si existe
    if (version < 4 && m.settings?.userProfile) {
      const profile = m.settings.userProfile;
      const weightLog: WeightLogEntry[] =
        profile.weightLog ??
        (typeof profile.weightKg === 'number'
          ? [{ dateISO: this.todayISO(), weightKg: profile.weightKg }]
          : []);
      m = { ...m, settings: { ...m.settings, userProfile: { ...profile, weightLog } } };
    }
    // v4 → v5: catálogo de ejercicios. Los ejercicios dejan de vivir embebidos en
    // cada día y pasan a un catálogo maestro; los días referencian por id. Además
    // sana duplicados históricos: si el mismo ejercicio (nombre normalizado) existía
    // en varios días con ids distintos, se unifica y se remapean sesiones/progreso.
    if (version < 5) {
      m = this.migrateToCatalog(m);
    }
    // v5 → v6: objetivo de entrenamiento y notas para la IA en el perfil de usuario
    if (version < 6 && m.settings?.userProfile) {
      const profile = m.settings.userProfile;
      m = {
        ...m,
        settings: {
          ...m.settings,
          userProfile: {
            ...profile,
            goal: profile.goal ?? null,
            aiNotes: profile.aiNotes ?? '',
          },
        },
      };
    }
    return { ...m, schemaVersion: CURRENT_SCHEMA };
  }

  /** Extrae el catálogo de ejercicios desde días con ejercicios embebidos (pre-v5). */
  private migrateToCatalog(m: Partial<AppState>): Partial<AppState> {
    interface LegacyDay {
      id: string;
      name: string;
      exercises?: Exercise[];
      exerciseIds?: string[];
    }
    const legacyDays = (m.days ?? []) as unknown as LegacyDay[];

    const catalog: Exercise[] = [];
    const byNorm = new Map<string, string>(); // nombre normalizado → id canónico
    const remap = new Map<string, string>(); // id viejo → id canónico
    const days: StoredWorkoutDay[] = [];

    for (const d of legacyDays) {
      // Ya migrado (tiene exerciseIds): preservar tal cual.
      if (d.exerciseIds && !d.exercises) {
        days.push({ id: d.id, name: d.name, exerciseIds: [...d.exerciseIds] });
        continue;
      }
      const exerciseIds: string[] = [];
      for (const ex of d.exercises ?? []) {
        const key = normalizeExerciseName(ex.name);
        let canonical = byNorm.get(key);
        if (!canonical) {
          canonical = ex.id;
          byNorm.set(key, canonical);
          catalog.push({ ...ex, id: canonical });
        }
        remap.set(ex.id, canonical);
        if (!exerciseIds.includes(canonical)) exerciseIds.push(canonical);
      }
      days.push({ id: d.id, name: d.name, exerciseIds });
    }

    // Remapear exerciseId en sesiones (sana historiales que el bug pudo haber partido)
    const sessions: Session[] = (m.sessions ?? []).map((s) => ({
      ...s,
      sets: s.sets.map((set) => ({
        ...set,
        exerciseId: remap.get(set.exerciseId) ?? set.exerciseId,
      })),
    }));

    // Remapear las claves de todayProgress
    const todayProgress: Record<string, TodayDayProgress> = {};
    for (const [dayId, prog] of Object.entries(m.todayProgress ?? {})) {
      const sets: TodayDayProgress['sets'] = {};
      for (const [exId, arr] of Object.entries(prog.sets)) {
        sets[remap.get(exId) ?? exId] = arr;
      }
      todayProgress[dayId] = { ...prog, sets };
    }

    return {
      ...m,
      exercises: [...(m.exercises ?? []), ...catalog],
      days: days as unknown as AppState['days'],
      sessions,
      todayProgress,
    };
  }

  /** Construye un AppState completo a partir de datos parciales/importados */
  private buildState(p: Partial<AppState>): AppState {
    const migrated = this.migrate(p);
    const profile = migrated.settings?.userProfile;
    return {
      schemaVersion: CURRENT_SCHEMA,
      exercises: migrated.exercises ?? [],
      days: migrated.days ?? [],
      sessions: migrated.sessions ?? [],
      activeDayIndex: migrated.activeDayIndex ?? 0,
      routinePointer: migrated.routinePointer ?? migrated.activeDayIndex ?? 0,
      todayProgress: migrated.todayProgress ?? {},
      trash: this.purgeTrash(migrated.trash ?? []),
      settings: {
        apiKey: migrated.settings?.apiKey ?? '',
        cohereApiKey: migrated.settings?.cohereApiKey ?? '',
        defaultRest: migrated.settings?.defaultRest ?? 60,
        sounds: migrated.settings?.sounds ?? true,
        haptics: migrated.settings?.haptics ?? true,
        theme: migrated.settings?.theme ?? 'dark',
        barWeightKg: migrated.settings?.barWeightKg,
        platesKg: migrated.settings?.platesKg,
        userProfile: {
          weightKg: profile?.weightKg ?? null,
          heightCm: profile?.heightCm ?? null,
          age: profile?.age ?? null,
          sex: profile?.sex ?? null,
          weightLog: profile?.weightLog ?? [],
          goal: profile?.goal ?? null,
          aiNotes: profile?.aiNotes ?? '',
        },
      },
    };
  }

  load(): AppState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    try {
      const p: unknown = JSON.parse(raw);
      if (!isValidAppState(p)) {
        console.warn(
          'StorageService.load: estado inválido en localStorage, usando estado inicial.',
        );
        return createInitialState();
      }
      return this.buildState(p as Partial<AppState>);
    } catch {
      console.warn('StorageService.load: JSON inválido en localStorage, usando estado inicial.');
      return createInitialState();
    }
  }

  save(state: AppState): SaveResult {
    const savedAt = Date.now();
    // IndexedDB es la fuente de verdad durable (localStorage es purgable por el SO);
    // el espejo en localStorage sigue siendo la fuente de arranque rápido (sincrónica).
    void this.mirrorToIdb(state, savedAt);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      localStorage.setItem(STORAGE_KEYS.stateSavedAt, String(savedAt));
      return { ok: true };
    } catch (e) {
      console.warn('StorageService.save falló:', e);
      const reason =
        e instanceof DOMException && e.name === 'QuotaExceededError' ? 'quota' : 'unknown';
      return { ok: false, reason };
    }
  }

  // ── IndexedDB: espejo durable + snapshots automáticos ──────────────────────

  private lastSnapshotCheck = 0;

  private async mirrorToIdb(state: AppState, savedAt: number): Promise<void> {
    await idbPut(IDB_STATE_STORE, 'current', { state, savedAt });
    // Snapshot semanal rotativo (máx. 4): red de seguridad contra ediciones destructivas.
    const now = Date.now();
    if (now - this.lastSnapshotCheck < 60_000) return; // chequeo barato, no en cada save
    this.lastSnapshotCheck = now;
    const keys = (await idbKeys(IDB_SNAPSHOT_STORE)).sort();
    const last = keys.at(-1);
    const today = this.todayISO();
    if (!last || daysBetween(last, today) >= 7) {
      await this.writeSnapshot(state, today);
    }
  }

  /** Escribe un snapshot con fecha (usado por el ciclo semanal y antes de un reset). */
  async writeSnapshot(state: AppState, label?: string): Promise<void> {
    const key = label ?? this.todayISO();
    await idbPut(IDB_SNAPSHOT_STORE, key, { dateISO: key, savedAt: Date.now(), state });
    const keys = (await idbKeys(IDB_SNAPSHOT_STORE)).sort();
    for (const stale of keys.slice(0, Math.max(0, keys.length - 4))) {
      await idbDelete(IDB_SNAPSHOT_STORE, stale);
    }
  }

  listSnapshots(): Promise<string[]> {
    return idbKeys(IDB_SNAPSHOT_STORE).then((k) => k.sort().reverse());
  }

  async getSnapshot(key: string): Promise<AppState | null> {
    const entry = await idbGet<{ state: unknown }>(IDB_SNAPSHOT_STORE, key);
    if (!entry || !isValidAppState(entry.state)) return null;
    return this.buildState(entry.state as Partial<AppState>);
  }

  /**
   * Si IndexedDB tiene un estado MÁS NUEVO que el que arrancó de localStorage
   * (p. ej. el SO purgó localStorage), lo devuelve para que StateService lo adopte.
   */
  async loadNewerFromIdb(): Promise<AppState | null> {
    const entry = await idbGet<{ state: unknown; savedAt: number }>(IDB_STATE_STORE, 'current');
    if (!entry || !isValidAppState(entry.state)) return null;
    const lsSavedAt = Number(localStorage.getItem(STORAGE_KEYS.stateSavedAt) ?? 0);
    const lsHasState = localStorage.getItem(STORAGE_KEY) !== null;
    if (lsHasState && entry.savedAt <= lsSavedAt) return null;
    return this.buildState(entry.state as Partial<AppState>);
  }

  /** Marca el origen como persistente para que el navegador no purgue el almacenamiento. */
  requestPersistentStorage(): void {
    try {
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      /* API no disponible */
    }
  }

  /** Purga la papelera: las sesiones borradas hace más de 30 días desaparecen. */
  private purgeTrash(trash: AppState['trash']): NonNullable<AppState['trash']> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    return (trash ?? []).filter((t) => t.deletedISO >= cutoffISO);
  }

  /**
   * Valida y normaliza datos importados desde JSON.
   * Lanza Error con mensaje en español si el formato es inválido.
   */
  validateImport(data: unknown): AppState {
    if (typeof data !== 'object' || data === null) {
      throw new Error('El archivo no contiene un objeto JSON válido.');
    }
    const d = data as Record<string, unknown>;
    if (!Array.isArray(d['days'])) {
      throw new Error('Formato inválido: el campo "days" debe ser un array.');
    }
    if ('sessions' in d && !Array.isArray(d['sessions'])) {
      throw new Error('Formato inválido: el campo "sessions" debe ser un array.');
    }
    if (
      'todayProgress' in d &&
      (typeof d['todayProgress'] !== 'object' || d['todayProgress'] === null)
    ) {
      throw new Error('Formato inválido: el campo "todayProgress" debe ser un objeto.');
    }
    return this.buildState(d as Partial<AppState>);
  }

  todayISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  uid(): string {
    return Math.random().toString(36).slice(2, 9);
  }

  roundToBrick(weight: number, brick: number): number {
    if (!brick || brick <= 0) return Math.round(weight * 2) / 2;
    return Math.round(weight / brick) * brick;
  }

  lastSessionForExercise(state: AppState, exerciseId: string, beforeISO?: string): Session | null {
    const sessions = state.sessions
      .filter((s) => !s.skipped)
      .filter((s) => s.sets.some((set) => set.exerciseId === exerciseId))
      .filter((s) => !beforeISO || s.dateISO < beforeISO)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    return sessions[0] ?? null;
  }

  lastSetsForExercise(state: AppState, exerciseId: string, beforeISO?: string): SetRecord[] | null {
    const session = this.lastSessionForExercise(state, exerciseId, beforeISO);
    if (!session) return null;
    return session.sets.filter((s) => s.exerciseId === exerciseId && !s.isWarmup);
  }

  lastSessionForDay(state: AppState, dayId: string): Session | null {
    return (
      state.sessions
        .filter((s) => s.dayId === dayId && !s.skipped)
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0] ?? null
    );
  }

  allSessionsForDay(state: AppState, dayId: string): Session[] {
    return state.sessions
      .filter((s) => s.dayId === dayId && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  }

  weeklyStats(state: AppState): { streak: number; weeklyVolume: number } {
    const todayISO = this.todayISO();

    // UTC para evitar desfases por zona horaria
    const today = new Date(todayISO + 'T12:00:00Z');
    const dayOfWeek = today.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() + mondayOffset);
    const mondayISO = monday.toISOString().slice(0, 10);

    let weeklyVolume = 0;
    const sessionDates = new Set<string>();
    for (const session of state.sessions) {
      if (session.skipped) continue;
      sessionDates.add(session.dateISO);
      if (session.dateISO >= mondayISO && session.dateISO <= todayISO) {
        for (const set of session.sets) {
          weeklyVolume += (set.weight || 0) * (set.reps || 0);
        }
      }
    }

    // Racha consecutiva hacia atrás desde hoy (UTC)
    let streak = 0;
    const cursor = new Date(todayISO + 'T12:00:00Z');
    while (sessionDates.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return { streak, weeklyVolume };
  }

  historyForExercise(state: AppState, exerciseId: string): HistoryEntry[] {
    const sessions = state.sessions
      .filter((s) => !s.skipped)
      .filter((s) => s.sets.some((set) => set.exerciseId === exerciseId && !set.isWarmup))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return sessions.map((session) => {
      const sets = session.sets.filter((s) => s.exerciseId === exerciseId && !s.isWarmup);
      const topWeight = sets.length ? Math.max(...sets.map((s) => s.weight || 0)) : 0;
      const topReps = sets.length ? Math.max(...sets.map((s) => s.reps || 0)) : 0;
      const totalReps = sets.reduce((sum, s) => sum + (s.reps || 0), 0);
      const volume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
      return { dateISO: session.dateISO, sets, topWeight, topReps, totalReps, volume };
    });
  }
}

export { defaultUserProfile };
