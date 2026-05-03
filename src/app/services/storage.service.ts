import { Injectable } from '@angular/core';
import { AppState, SetRecord, Session, TodaySetProgress } from '../models/workout.model';
import { createInitialState } from '../data/initial-data';

const STORAGE_KEY = 'gym_app_state_v2';

export interface HistoryEntry {
  dateISO: string;
  sets: SetRecord[];
  topWeight: number;
  topReps: number;
  totalReps: number;
  volume: number;
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  load(): AppState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    try {
      const p = JSON.parse(raw) as Partial<AppState>;
      return {
        schemaVersion: 2,
        days: p.days ?? [],
        sessions: p.sessions ?? [],
        activeDayIndex: p.activeDayIndex ?? 0,
        todayProgress: p.todayProgress ?? {},
        settings: {
          apiKey: p.settings?.apiKey ?? '',
          defaultRest: p.settings?.defaultRest ?? 60,
          sounds: p.settings?.sounds ?? true,
          theme: p.settings?.theme ?? 'dark',
          userProfile: {
            weightKg: p.settings?.userProfile?.weightKg ?? null,
            heightCm: p.settings?.userProfile?.heightCm ?? null,
            sex: p.settings?.userProfile?.sex ?? null,
          },
        },
      };
    } catch {
      return createInitialState();
    }
  }

  save(state: AppState): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      console.warn('Failed to save state');
    }
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
      .filter(s => s.sets.some(set => set.exerciseId === exerciseId))
      .filter(s => !beforeISO || s.dateISO < beforeISO)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    return sessions[0] ?? null;
  }

  lastSetsForExercise(state: AppState, exerciseId: string, beforeISO?: string): SetRecord[] | null {
    const session = this.lastSessionForExercise(state, exerciseId, beforeISO);
    if (!session) return null;
    return session.sets.filter(s => s.exerciseId === exerciseId);
  }

  historyForExercise(state: AppState, exerciseId: string): HistoryEntry[] {
    const sessions = state.sessions
      .filter(s => s.sets.some(set => set.exerciseId === exerciseId))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return sessions.map(session => {
      const sets = session.sets.filter(s => s.exerciseId === exerciseId);
      const topWeight = Math.max(...sets.map(s => s.weight || 0));
      const topReps = Math.max(...sets.map(s => s.reps || 0));
      const totalReps = sets.reduce((sum, s) => sum + (s.reps || 0), 0);
      const volume = sets.reduce((sum, s) => sum + (s.weight || 0) * (s.reps || 0), 0);
      return { dateISO: session.dateISO, sets, topWeight, topReps, totalReps, volume };
    });
  }
}
