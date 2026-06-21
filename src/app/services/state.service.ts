import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AppSettings,
  AppState,
  Exercise,
  SetRecord,
  StoredWorkoutDay,
  TodayDayProgress,
  TodaySetProgress,
  WorkoutDay,
} from '../models/workout.model';
import { StorageService, isValidAppState, normalizeExerciseName } from './storage.service';
import { TranslationService } from './translation.service';
import { createInitialState } from '../data/initial-data';

@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly storage = inject(StorageService);
  private readonly tr = inject(TranslationService);

  readonly state = signal<AppState>(this.storage.load());

  /** Catálogo maestro de ejercicios (fuente de verdad de identidad e historial). */
  readonly exercises = computed(() => this.state().exercises);

  /** Días resueltos: los `exerciseIds` guardados se expanden a objetos `Exercise` del catálogo. */
  readonly days = computed<WorkoutDay[]>(() => {
    const s = this.state();
    const byId = new Map(s.exercises.map((e) => [e.id, e]));
    return s.days.map((d) => ({
      id: d.id,
      name: d.name,
      exercises: d.exerciseIds
        .map((id) => byId.get(id))
        .filter((e): e is Exercise => e !== undefined),
    }));
  });

  readonly sessions = computed(() => this.state().sessions);
  readonly settings = computed(() => this.state().settings);
  readonly activeDayIndex = computed(() => this.state().activeDayIndex);
  readonly activeDay = computed(() => this.days()[this.state().activeDayIndex] ?? null);
  readonly routinePointer = computed(() => this.state().routinePointer);
  readonly currentDayIndex = computed(() => {
    const days = this.state().days;
    if (!days.length) return 0;
    return this.state().routinePointer % days.length;
  });
  readonly currentDay = computed(() => {
    const days = this.days();
    if (!days.length) return null;
    return days[this.state().routinePointer % days.length] ?? null;
  });

  get todayKey(): string {
    return this.storage.todayISO();
  }

  constructor() {
    effect(() => {
      this.storage.save(this.state());
    });

    effect(() => {
      document.documentElement.setAttribute('data-theme', this.state().settings.theme);
    });
  }

  setActiveDay(index: number): void {
    this.state.update((s) => ({ ...s, activeDayIndex: index }));
  }

  /**
   * Persiste un día (forma resuelta del editor) descomponiéndolo en:
   * 1. upserts al catálogo de ejercicios, y
   * 2. un `StoredWorkoutDay` que referencia por id.
   *
   * Identidad: un ejercicio que ya existe (mismo id) actualiza su definición en el
   * catálogo. Un ejercicio "nuevo" cuyo nombre normalizado coincide con uno ya
   * existente reutiliza ese id canónico — así re-tipear un ejercicio que ya hacías
   * reconecta su historial en vez de empezar de cero.
   */
  saveDay(day: WorkoutDay): void {
    this.state.update((s) => {
      const catalog = s.exercises.map((e) => ({ ...e }));
      const byId = new Map(catalog.map((e) => [e.id, e]));
      const byNorm = new Map<string, string>();
      for (const e of catalog) {
        const key = normalizeExerciseName(e.name);
        if (!byNorm.has(key)) byNorm.set(key, e.id);
      }

      const exerciseIds: string[] = [];
      for (const ex of day.exercises) {
        let canonicalId: string;
        const existing = byId.get(ex.id);
        if (existing) {
          Object.assign(existing, ex); // actualiza definición, conserva id
          canonicalId = ex.id;
        } else {
          const matchId = byNorm.get(normalizeExerciseName(ex.name));
          if (matchId) {
            Object.assign(byId.get(matchId)!, ex, { id: matchId }); // reconecta historial
            canonicalId = matchId;
          } else {
            const fresh = { ...ex };
            catalog.push(fresh);
            byId.set(fresh.id, fresh);
            byNorm.set(normalizeExerciseName(fresh.name), fresh.id);
            canonicalId = fresh.id;
          }
        }
        if (!exerciseIds.includes(canonicalId)) exerciseIds.push(canonicalId);
      }

      const stored: StoredWorkoutDay = {
        id: day.id || this.storage.uid(),
        name: day.name,
        exerciseIds,
      };
      const exists = s.days.some((d) => d.id === stored.id);
      const days = exists
        ? s.days.map((d) => (d.id === stored.id ? stored : d))
        : [...s.days, stored];

      return {
        ...s,
        exercises: catalog,
        days,
        activeDayIndex: exists ? s.activeDayIndex : days.length - 1,
      };
    });
  }

  deleteDay(dayId: string): void {
    this.state.update((s) => {
      const days = s.days.filter((d) => d.id !== dayId);
      return {
        ...s,
        days,
        activeDayIndex: Math.min(s.activeDayIndex, Math.max(0, days.length - 1)),
      };
    });
  }

  saveSettings(settings: AppSettings): void {
    this.state.update((s) => ({ ...s, settings }));
  }

  advanceRoutine(fromDayIndex?: number): void {
    this.state.update((s) => {
      const days = s.days.length || 1;
      const base = fromDayIndex !== undefined ? fromDayIndex : s.routinePointer % days;
      const nextIndex = (base + 1) % days;
      const rem = s.routinePointer % days;
      let delta = nextIndex - rem;
      if (delta <= 0) delta += days;
      return {
        ...s,
        routinePointer: s.routinePointer + delta,
        todayProgress: this.pruneTodayProgress(s.todayProgress),
      };
    });
  }

  skipDay(): void {
    const day = this.currentDay();
    if (!day) return;
    const alreadySkipped = this.state().sessions.some(
      (s) => s.dayId === day.id && s.dateISO === this.todayKey && s.skipped,
    );
    if (!alreadySkipped) {
      this.state.update((s) => ({
        ...s,
        sessions: [
          ...s.sessions,
          {
            id: this.storage.uid(),
            dayId: day.id,
            dateISO: this.todayKey,
            sets: [],
            skipped: true,
          },
        ],
      }));
    }
    this.advanceRoutine();
  }

  deleteSession(sessionId: string): void {
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.filter((x) => x.id !== sessionId),
    }));
    this.invalidateAiCache();
  }

  updateSessionSet(
    sessionId: string,
    exerciseId: string,
    setIndex: number,
    patch: Partial<Pick<SetRecord, 'weight' | 'reps'>>,
  ): void {
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((session) =>
        session.id !== sessionId
          ? session
          : {
              ...session,
              sets: session.sets.map((sr) =>
                sr.exerciseId === exerciseId && sr.setIndex === setIndex ? { ...sr, ...patch } : sr,
              ),
            },
      ),
    }));
    this.invalidateAiCache();
  }

  /** El historial cambió: las recomendaciones cacheadas ya no valen */
  private invalidateAiCache(): void {
    localStorage.removeItem('gym_ai_cache_v2');
  }

  getTodayProgress(dayId: string): TodayDayProgress {
    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) {
      return { dateISO: this.todayKey, sets: {} };
    }
    return tp;
  }

  updateSet(
    dayId: string,
    exerciseId: string,
    setIndex: number,
    patch: Partial<TodaySetProgress>,
  ): void {
    this.state.update((s) => {
      const today: TodayDayProgress =
        s.todayProgress[dayId]?.dateISO === this.todayKey
          ? JSON.parse(JSON.stringify(s.todayProgress[dayId]))
          : { dateISO: this.todayKey, sets: {} };

      if (!today.sets[exerciseId]) today.sets[exerciseId] = [];
      const cur = today.sets[exerciseId][setIndex] ?? { weight: '', reps: '', done: false };
      today.sets[exerciseId][setIndex] = { ...cur, ...patch };

      return { ...s, todayProgress: { ...s.todayProgress, [dayId]: today } };
    });
  }

  toggleSetDone(
    dayId: string,
    exercise: Exercise,
    setIndex: number,
  ): 'done' | 'undone' | 'needs_reps' {
    const tp = this.getTodayProgress(dayId);
    const cur = tp.sets[exercise.id]?.[setIndex] ?? { weight: '', reps: '', done: false };

    if (cur.done) {
      this.updateSet(dayId, exercise.id, setIndex, { done: false });
      this.commitSession(dayId);
      return 'undone';
    }

    const reps = Number(cur.reps) || 0;
    if (reps <= 0) return 'needs_reps';

    const weight = Number(cur.weight) || 0;
    this.updateSet(dayId, exercise.id, setIndex, { done: true, weight, reps });
    this.commitSession(dayId);
    return 'done';
  }

  private commitSession(dayId: string): void {
    const day = this.state().days.find((d) => d.id === dayId);
    if (!day) return;

    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) return;

    const hasAnyDone = Object.values(tp.sets).some((arr) => arr.some((s) => s?.done));
    if (!hasAnyDone) return;

    const catalog = this.state().exercises;
    const setsList: SetRecord[] = [];
    Object.entries(tp.sets).forEach(([exId, arr]) => {
      arr.forEach((s, i) => {
        if (s?.done) {
          const ex = catalog.find((e) => e.id === exId);
          setsList.push({
            exerciseId: exId,
            setIndex: i,
            weight: typeof s.weight === 'number' ? s.weight : 0,
            reps: typeof s.reps === 'number' ? s.reps : 0,
            target: ex ? `${ex.defaultSets}x${ex.defaultRepTarget}` : '',
            repTarget: ex?.defaultRepTarget,
            isWarmup: s.isWarmup ?? false,
          });
        }
      });
    });

    const existing = this.state().sessions.find(
      (s) => s.dayId === dayId && s.dateISO === this.todayKey,
    );

    if (existing) {
      if (JSON.stringify(existing.sets) === JSON.stringify(setsList)) return;
      this.state.update((s) => ({
        ...s,
        sessions: s.sessions.map((x) => (x.id === existing.id ? { ...x, sets: setsList } : x)),
      }));
    } else {
      this.state.update((s) => ({
        ...s,
        sessions: [
          ...s.sessions,
          {
            id: this.storage.uid(),
            dayId,
            dateISO: this.todayKey,
            sets: setsList,
          },
        ],
      }));
    }
  }

  /** Elimina entradas de todayProgress que no sean del día actual */
  private pruneTodayProgress(tp: AppState['todayProgress']): AppState['todayProgress'] {
    const today = this.todayKey;
    const pruned: AppState['todayProgress'] = {};
    for (const [dayId, progress] of Object.entries(tp)) {
      if (progress.dateISO === today) pruned[dayId] = progress;
    }
    return pruned;
  }

  async exportData(): Promise<void> {
    const exportState = {
      ...this.state(),
      exportedAt: new Date().toISOString(),
      appVersion: '2.0',
    };
    const fileName = `gym-backup-${this.todayKey}.json`;
    const file = new File([JSON.stringify(exportState, null, 2)], fileName, {
      type: 'application/json',
    });

    if (typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'GainAI backup' });
        localStorage.setItem('gym_last_export', this.todayKey);
        return;
      } catch (e) {
        // El usuario canceló el share: no es un error ni cuenta como export
        if (e instanceof DOMException && e.name === 'AbortError') return;
        // Otro fallo del share: cae al download clásico
      }
    }

    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
    localStorage.setItem('gym_last_export', this.todayKey);
  }

  importData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) {
          resolve();
          return;
        }
        const invalidMsg = this.tr.T().import_invalid_backup;
        try {
          const text = await file.text();
          let data: unknown;
          try {
            data = JSON.parse(text);
          } catch {
            throw new Error(invalidMsg);
          }
          if (!isValidAppState(data)) throw new Error(invalidMsg);
          const validated = this.storage.validateImport(data);
          this.state.set(validated);
          resolve();
        } catch (e) {
          reject(e);
        }
      };
      input.click();
    });
  }

  resetAll(): void {
    this.state.set(createInitialState());
  }
}
