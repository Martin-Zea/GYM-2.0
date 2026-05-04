import { Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  AppSettings,
  AppState,
  Exercise,
  SetRecord,
  TodayDayProgress,
  TodaySetProgress,
  WorkoutDay,
} from '../models/workout.model';
import { StorageService } from './storage.service';
import { createInitialState } from '../data/initial-data';

@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly storage = inject(StorageService);

  readonly state = signal<AppState>(this.storage.load());

  readonly days = computed(() => this.state().days);
  readonly sessions = computed(() => this.state().sessions);
  readonly settings = computed(() => this.state().settings);
  readonly activeDayIndex = computed(() => this.state().activeDayIndex);
  readonly activeDay = computed(() => this.state().days[this.state().activeDayIndex] ?? null);
  readonly routinePointer = computed(() => this.state().routinePointer);
  readonly currentDayIndex = computed(() => {
    const days = this.state().days;
    if (!days.length) return 0;
    return this.state().routinePointer % days.length;
  });
  readonly currentDay = computed(() => {
    const days = this.state().days;
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
    this.state.update(s => ({ ...s, activeDayIndex: index }));
  }

  saveDay(day: WorkoutDay): void {
    this.state.update(s => {
      const exists = s.days.find(d => d.id === day.id);
      let days: WorkoutDay[];
      if (exists) {
        days = s.days.map(d => d.id === day.id ? day : d);
      } else {
        days = [...s.days, { ...day, id: day.id || this.storage.uid() }];
      }
      return { ...s, days, activeDayIndex: exists ? s.activeDayIndex : days.length - 1 };
    });
  }

  deleteDay(dayId: string): void {
    this.state.update(s => {
      const days = s.days.filter(d => d.id !== dayId);
      return { ...s, days, activeDayIndex: Math.min(s.activeDayIndex, Math.max(0, days.length - 1)) };
    });
  }

  saveSettings(settings: AppSettings): void {
    this.state.update(s => ({ ...s, settings }));
  }

  advanceRoutine(): void {
    this.state.update(s => ({ ...s, routinePointer: s.routinePointer + 1 }));
  }

  skipDay(): void {
    const day = this.currentDay();
    if (!day) return;
    const alreadySkipped = this.state().sessions.some(
      s => s.dayId === day.id && s.dateISO === this.todayKey && s.skipped,
    );
    if (!alreadySkipped) {
      this.state.update(s => ({
        ...s,
        sessions: [...s.sessions, {
          id: this.storage.uid(),
          dayId: day.id,
          dateISO: this.todayKey,
          sets: [],
          skipped: true,
        }],
      }));
    }
    this.advanceRoutine();
  }

  getTodayProgress(dayId: string): TodayDayProgress {
    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) {
      return { dateISO: this.todayKey, sets: {} };
    }
    return tp;
  }

  updateSet(dayId: string, exerciseId: string, setIndex: number, patch: Partial<TodaySetProgress>): void {
    this.state.update(s => {
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

  toggleSetDone(dayId: string, exercise: Exercise, setIndex: number): 'done' | 'undone' | 'needs_reps' {
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
    const day = this.state().days.find(d => d.id === dayId);
    if (!day) return;

    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) return;

    const hasAnyDone = Object.values(tp.sets).some(arr => arr.some(s => s?.done));
    if (!hasAnyDone) return;

    const setsList: SetRecord[] = [];
    Object.entries(tp.sets).forEach(([exId, arr]) => {
      arr.forEach((s, i) => {
        if (s?.done) {
          const ex = day.exercises.find(e => e.id === exId);
          setsList.push({
            exerciseId: exId,
            setIndex: i,
            weight: typeof s.weight === 'number' ? s.weight : 0,
            reps: typeof s.reps === 'number' ? s.reps : 0,
            target: ex ? `${ex.defaultSets}x${ex.defaultRepTarget}` : '',
          });
        }
      });
    });

    const existing = this.state().sessions.find(
      s => s.dayId === dayId && s.dateISO === this.todayKey,
    );

    if (existing) {
      if (JSON.stringify(existing.sets) === JSON.stringify(setsList)) return;
      this.state.update(s => ({
        ...s,
        sessions: s.sessions.map(x => x.id === existing.id ? { ...x, sets: setsList } : x),
      }));
    } else {
      this.state.update(s => ({
        ...s,
        sessions: [...s.sessions, {
          id: this.storage.uid(),
          dayId,
          dateISO: this.todayKey,
          sets: setsList,
        }],
      }));
    }
  }

  exportData(): void {
    const blob = new Blob([JSON.stringify(this.state(), null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `gym-${this.todayKey}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  importData(): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'application/json';
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) { resolve(); return; }
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (!data.days) throw new Error('Formato inválido');
          this.state.update(() => ({
            schemaVersion: 3,
            days: data.days ?? [],
            sessions: data.sessions ?? [],
            activeDayIndex: data.activeDayIndex ?? 0,
            routinePointer: data.routinePointer ?? data.activeDayIndex ?? 0,
            todayProgress: data.todayProgress ?? {},
            settings: {
              apiKey: data.settings?.apiKey ?? '',
              cohereApiKey: data.settings?.cohereApiKey ?? '',
              defaultRest: data.settings?.defaultRest ?? 60,
              sounds: data.settings?.sounds ?? true,
              theme: data.settings?.theme ?? 'dark',
              userProfile: data.settings?.userProfile ?? { weightKg: null, heightCm: null, sex: null },
            },
          }));
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
