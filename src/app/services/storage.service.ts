import { Injectable } from '@angular/core';
import { AppState, SetRecord, Session } from '../models/workout.model';
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
        schemaVersion: 3,
        days: p.days ?? [],
        sessions: p.sessions ?? [],
        activeDayIndex: p.activeDayIndex ?? 0,
        routinePointer: p.routinePointer ?? p.activeDayIndex ?? 0,
        todayProgress: p.todayProgress ?? {},
        settings: {
          apiKey: p.settings?.apiKey ?? '',
          cohereApiKey: p.settings?.cohereApiKey ?? '',
          defaultRest: p.settings?.defaultRest ?? 60,
          sounds: p.settings?.sounds ?? true,
          theme: p.settings?.theme ?? 'dark',
          userProfile: {
            weightKg: p.settings?.userProfile?.weightKg ?? null,
            heightCm: p.settings?.userProfile?.heightCm ?? null,
            age: p.settings?.userProfile?.age ?? null,
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
      .filter(s => !s.skipped)
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

  lastSessionForDay(state: AppState, dayId: string): Session | null {
    return state.sessions
      .filter(s => s.dayId === dayId && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0] ?? null;
  }

  allSessionsForDay(state: AppState, dayId: string): Session[] {
    return state.sessions
      .filter(s => s.dayId === dayId && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  }

  weeklyStats(state: AppState): { streak: number; weeklyVolume: number } {
    const todayISO = this.todayISO();

    // Monday of current week
    const today = new Date(todayISO + 'T12:00:00');
    const dayOfWeek = today.getDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setDate(today.getDate() + mondayOffset);
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

    // Consecutive-day streak going back from today
    let streak = 0;
    const cursor = new Date(todayISO + 'T12:00:00');
    while (sessionDates.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    return { streak, weeklyVolume };
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
