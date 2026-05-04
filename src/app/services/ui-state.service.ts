import { Injectable, signal } from '@angular/core';
import { RestTimerState, WorkoutDay } from '../models/workout.model';

export type EditingDayState = WorkoutDay | 'new' | null;

@Injectable({ providedIn: 'root' })
export class UIStateService {
  readonly showSettings = signal(false);
  readonly editingDay = signal<EditingDayState>(null);
  readonly restTimer = signal<RestTimerState | null>(null);

  // Day detail sheet: shows last session + option to train
  readonly dayDetail = signal<WorkoutDay | null>(null);

  // Day picker sheet: select a day while in training mode
  readonly showDayPicker = signal(false);

  // Day history sheet: full session history for a day
  readonly dayHistory = signal<WorkoutDay | null>(null);

  // Signal set by DayDetailSheet to trigger training start in HomeComponent
  readonly pendingTrainingStart = signal(false);

  // True while a training session is in progress (drives topbar indicator)
  readonly trainingActive = signal(false);

  // Set by rest-timer on completion to auto-focus the next pending set input
  readonly focusSet = signal<{ exerciseId: string; setIndex: number } | null>(null);
}
