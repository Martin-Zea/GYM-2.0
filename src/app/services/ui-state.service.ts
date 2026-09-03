import { Injectable, signal } from '@angular/core';
import { Exercise, RestTimerState, WorkoutDay } from '../models/workout.model';
import { STORAGE_KEYS } from './storage-keys';
import { PrKind } from '../utils/pr';

export type EditingDayState = WorkoutDay | 'new' | null;

export interface PrCelebration {
  exerciseName: string;
  unit: string;
  kind: PrKind;
  /** Marca nueva (kg, reps/segundos o e1RM según `kind`). */
  value: number;
  /** Marca anterior superada. */
  previous: number;
  /** Serie que lo consiguió: hace falta para compartir "100 kg × 5". */
  weight: number;
  reps: number;
}

type OverlayName =
  | 'settings'
  | 'editingDay'
  | 'dayDetail'
  | 'dayPicker'
  | 'dayHistory'
  | 'chartSheet'
  | 'tools';

/** Secciones navegables de Ajustes (A3, A4, A5, A7 del diseño). */
export type SettingsSection = 'prefs' | 'ai' | 'data' | 'about' | null;

@Injectable({ providedIn: 'root' })
export class UIStateService {
  readonly showSettings = signal(false);
  /** Sección abierta de Ajustes; `null` muestra todas (ver `openSettings`). */
  readonly settingsSection = signal<SettingsSection>(null);
  /** A6 · hoja de herramientas (RF-HER-01). */
  readonly showTools = signal(false);
  readonly editingDay = signal<EditingDayState>(null);
  readonly restTimer = signal<RestTimerState | null>(null);

  /**
   * El descanso en curso se guarda con su hora de fin absoluta.
   *
   * Android mata las PWA en segundo plano sin avisar, que es justo lo que pasa cuando el
   * usuario deja el móvil y espera: al volver, el descanso tiene que seguir donde estaba
   * en vez de haber desaparecido (RF-SES-04).
   */
  persistRest(endsAt: number): void {
    const timer = this.restTimer();
    if (!timer) {
      this.clearPersistedRest();
      return;
    }
    try {
      localStorage.setItem(STORAGE_KEYS.restTimer, JSON.stringify({ ...timer, endsAt }));
    } catch {
      /* sin espacio: el descanso es efímero, no vale la pena molestar al usuario */
    }
  }

  clearPersistedRest(): void {
    try {
      localStorage.removeItem(STORAGE_KEYS.restTimer);
    } catch {
      /* storage no disponible */
    }
  }

  /** Reanuda el descanso al abrir la app. Uno ya vencido se descarta sin sonar tarde. */
  restoreRest(): void {
    let raw: string | null;
    try {
      raw = localStorage.getItem(STORAGE_KEYS.restTimer);
    } catch {
      return;
    }
    if (!raw) return;
    this.clearPersistedRest();
    try {
      const data = JSON.parse(raw) as Partial<RestTimerState> & { endsAt?: number };
      const remaining = Math.ceil(((data.endsAt ?? 0) - Date.now()) / 1000);
      if (remaining <= 0 || typeof data.exerciseId !== 'string') return;
      this.restTimer.set({
        seconds: remaining,
        exerciseId: data.exerciseId,
        nextLabel: data.nextLabel ?? '',
        nextSetIndex: data.nextSetIndex,
      });
    } catch {
      /* entrada corrupta: se descartó arriba */
    }
  }

  // Day detail sheet: shows last session + option to train
  readonly dayDetail = signal<WorkoutDay | null>(null);

  // Day picker sheet: select a day while in training mode
  readonly showDayPicker = signal(false);

  // Day history sheet: full session history for a day
  readonly dayHistory = signal<WorkoutDay | null>(null);

  // Progression chart sheet: quick look at an exercise's chart without leaving the session
  readonly chartSheet = signal<Exercise | null>(null);
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

  // Set when this tab is not the one authorized to write (another tab owns the state).
  // Drives the "otra pestaña manda, recargá" banner — see TabLockService (RF-STO-09).
  readonly tabConflict = signal(false);

  /** Récord celebrado en vivo (RF-SES-06); `celebratePr()` lo auto-descarta a los 2,5 s. */
  readonly prCelebration = signal<PrCelebration | null>(null);

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

  /**
   * Abre Ajustes acotado a una sección (A3, A4, A5, A7 del diseño).
   *
   * Sin sección se muestra todo, que es como se comportaba antes de que Ajustes tuviera su
   * propio tab: el menú A1 pasa la sección y el sheet deja de ser una lista interminable.
   */
  openSettings(section: SettingsSection = null): void {
    this.settingsSection.set(section);
    this._push('settings');
    this.showSettings.set(true);
  }
  openTools(): void {
    this._push('tools');
    this.showTools.set(true);
  }
  closeTools(): void {
    this._close('tools');
  }
  /**
   * `true` cuando el editor de día lo pinta una PÁGINA y no una hoja (T-839).
   *
   * Existe para que `app.html` no dibuje además su instancia global: si no, el mismo
   * editor sale dos veces, uno dentro del panel de Rutinas y otro encima tapando todo.
   */
  readonly editingDayInline = signal(false);

  /** Abre el editor DENTRO de la página: sin hoja y sin tocar el stack de overlays. */
  openEditingDayInline(day: EditingDayState): void {
    this.editingDayInline.set(true);
    this.editingDay.set(day);
  }

  closeEditingDayInline(): void {
    this.editingDay.set(null);
    this.editingDayInline.set(false);
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
  openChartSheet(exercise: Exercise): void {
    this._push('chartSheet');
    this.chartSheet.set(exercise);
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
  closeChartSheet(): void {
    this._close('chartSheet');
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
      case 'tools':
        this.showTools.set(false);
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
      case 'chartSheet':
        this.chartSheet.set(null);
        break;
    }
  }

  // Exit-training confirmation dialog
  readonly showExitConfirm = signal(false);
  // Mensaje del diálogo; null → la vista usa el texto por defecto (nav_guard_confirm)
  readonly exitConfirmMsg = signal<string | null>(null);
  private _exitResolve: ((v: boolean) => void) | null = null;

  requestTrainingExit(message?: string): Promise<boolean> {
    // Si ya había una confirmación pendiente, resuélvela como cancelada para no dejar
    // su promesa colgada para siempre (await que nunca retorna).
    this._exitResolve?.(false);
    this.exitConfirmMsg.set(message ?? null);
    this.showExitConfirm.set(true);
    return new Promise((resolve) => {
      this._exitResolve = resolve;
    });
  }

  resolveExitConfirm(confirmed: boolean): void {
    this.showExitConfirm.set(false);
    this.exitConfirmMsg.set(null);
    this._exitResolve?.(confirmed);
    this._exitResolve = null;
  }

  celebratePr(pr: PrCelebration): void {
    if (this.prTimeout !== null) clearTimeout(this.prTimeout);
    this.prCelebration.set(pr);
    this.prTimeout = setTimeout(() => this.prCelebration.set(null), 2500);
  }

  stopPrAutoDismiss(): void {
    if (this.prTimeout !== null) {
      clearTimeout(this.prTimeout);
      this.prTimeout = null;
    }
  }
}
