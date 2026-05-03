import { Injectable, signal } from '@angular/core';
import { RestTimerState, WorkoutDay } from '../models/workout.model';

export type EditingDayState = WorkoutDay | 'new' | null;

@Injectable({ providedIn: 'root' })
export class UIStateService {
  readonly showSettings = signal(false);
  readonly editingDay = signal<EditingDayState>(null);
  readonly restTimer = signal<RestTimerState | null>(null);
}
