import { Injectable, signal } from '@angular/core';
import { RestTimerState, WorkoutDay } from '../models/workout.model';

export type EditingDayState = WorkoutDay | 'new' | null;

type OverlayName = 'settings' | 'editingDay' | 'dayDetail' | 'dayPicker' | 'dayHistory';

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
  // When set, DayHistorySheet shows only the session for this ISO date
  readonly dayHistoryFilterISO = signal<string | null>(null);

  // Signal set by DayDetailSheet to trigger training start in HomeComponent
  readonly pendingTrainingStart = signal(false);

  // True while a training session is in progress (drives topbar indicator)
  readonly trainingActive = signal(false);

  // Set by rest-timer on completion to auto-focus the next pending set input
  readonly focusSet = signal<{ exerciseId: string; setIndex: number } | null>(null);

  // Set when localStorage save fails (quota exceeded or similar)
  readonly saveError = signal<string | null>(null);

  // Set when the service worker has a new app version ready
  readonly updateAvailable = signal(false);

  // Set at startup when there are too many sessions since the last export
  readonly backupReminder = signal(false);

  // Personal record celebration toast — auto-dismissed by celebratePr()
  readonly prCelebration = signal<{ exerciseName: string; weight: number; unit: string } | null>(
    null,
  );

  private prTimeout: ReturnType<typeof setTimeout> | null = null;

  // --- Overlay stack for Android back-button handling ---
  // Each open* call pushes a history entry; each close* call pops it via history.back().
  // closeTopOverlay() is called by the AppComponent popstate handler (back button path).
  private readonly _stack: OverlayName[] = [];
  // Counter that lets the popstate handler skip events it triggered itself (via history.back()).
  private _skipPopstate = 0;

  get hasOpenOverlay(): boolean {
    return this._stack.length > 0;
  }

  consumeSkipPopstate(): boolean {
    if (this._skipPopstate > 0) {
      this._skipPopstate--;
      return true;
    }
    return false;
  }

  // --- Open methods: push to stack + push history entry ---

  openSettings(): void {
    this._push('settings');
    this.showSettings.set(true);
  }
  openEditingDay(day: EditingDayState): void {
    this._push('editingDay');
    this.editingDay.set(day);
  }
  openDayDetail(day: WorkoutDay): void {
    this._push('dayDetail');
    this.dayDetail.set(day);
  }
  openDayPicker(): void {
    this._push('dayPicker');
    this.showDayPicker.set(true);
  }
  openDayHistory(day: WorkoutDay, filterISO?: string): void {
    this._push('dayHistory');
    this.dayHistory.set(day);
    this.dayHistoryFilterISO.set(filterISO ?? null);
  }

  // --- Close methods: pop from stack + pop history entry ---

  closeSettings(): void {
    this._close('settings');
  }
  closeEditingDay(): void {
    this._close('editingDay');
  }
  closeDayDetail(): void {
    this._close('dayDetail');
  }
  closeDayPicker(): void {
    this._close('dayPicker');
  }
  closeDayHistory(): void {
    this._close('dayHistory');
  }

  // Called by the AppComponent popstate handler when the user pressed back.
  // The browser already popped the history entry, so we only close the signal.
  closeTopOverlay(): void {
    const name = this._stack.pop();
    if (name) this._applyClose(name);
  }

  private _push(name: OverlayName): void {
    this._stack.push(name);
    history.pushState({ gymOverlay: name }, '');
  }

  private _close(name: OverlayName): void {
    const idx = this._stack.lastIndexOf(name);
    if (idx >= 0) {
      this._stack.splice(idx, 1);
      this._skipPopstate++;
      history.back(); // async — fires popstate; consumeSkipPopstate() will absorb it
    }
    this._applyClose(name);
  }

  private _applyClose(name: OverlayName): void {
    switch (name) {
      case 'settings':
        this.showSettings.set(false);
        break;
      case 'editingDay':
        this.editingDay.set(null);
        break;
      case 'dayDetail':
        this.dayDetail.set(null);
        break;
      case 'dayPicker':
        this.showDayPicker.set(false);
        break;
      case 'dayHistory':
        this.dayHistory.set(null);
        this.dayHistoryFilterISO.set(null);
        break;
    }
  }

  celebratePr(exerciseName: string, weight: number, unit: string): void {
    if (this.prTimeout !== null) clearTimeout(this.prTimeout);
    this.prCelebration.set({ exerciseName, weight, unit });
    this.prTimeout = setTimeout(() => this.prCelebration.set(null), 2500);
  }

  stopPrAutoDismiss(): void {
    if (this.prTimeout !== null) {
      clearTimeout(this.prTimeout);
      this.prTimeout = null;
    }
  }
}
