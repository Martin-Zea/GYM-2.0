import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service';
import { FLAGS, StorageService } from './services/storage.service';
import { PrCelebration, UIStateService } from './services/ui-state.service';
import { TranslationService } from './services/translation.service';
import { AppUpdateService } from './services/app-update.service';
import { ErrorService } from './services/error.service';
import { ShareService } from './services/share.service';
import { BackupService } from './services/backup.service';
import { ThemeService } from './services/theme.service';
import { WakeLockService } from './services/wake-lock.service';
import { STORAGE_KEYS } from './services/storage-keys';
import { ExerciseUnit } from './models/workout.model';
import { IconComponent } from './components/icon/icon.component';
import { RestTimerComponent } from './components/rest-timer/rest-timer.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DayDetailSheetComponent } from './components/day-detail-sheet/day-detail-sheet.component';
import { DayPickerSheetComponent } from './components/day-picker-sheet/day-picker-sheet.component';
import { DayHistorySheetComponent } from './components/day-history-sheet/day-history-sheet.component';
import { ExerciseChartSheetComponent } from './components/exercise-chart-sheet/exercise-chart-sheet.component';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { OnboardingComponent } from './components/onboarding/onboarding.component';
import { LegalGateComponent } from './components/legal-gate/legal-gate.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet,
    IconComponent,
    RestTimerComponent,
    DayEditorComponent,
    SettingsComponent,
    DayDetailSheetComponent,
    DayPickerSheetComponent,
    DayHistorySheetComponent,
    ExerciseChartSheetComponent,
    BottomNavComponent,
    OnboardingComponent,
    LegalGateComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly errorService = inject(ErrorService);
  private readonly storage = inject(StorageService);
  private readonly shareService = inject(ShareService);
  private readonly backup = inject(BackupService);
  // Inyectado para activar el efecto que aplica el tema al <html>
  private readonly themeService = inject(ThemeService);
  // Inyectado para mantener la pantalla despierta durante la sesión
  private readonly wakeLock = inject(WakeLockService);

  protected readonly theme = computed(() => this.state.settings().theme);
  protected readonly T = this.tr.T;

  /** Estado ilegible apartado: la app está en solo lectura hasta que el usuario decida. */
  protected readonly quarantine = this.storage.quarantine;

  // Las banderas viven en `gt_meta` desde v7; `getFlag` cae a la clave suelta mientras
  // la migración no haya corrido (T-102).
  protected readonly showOnboarding = signal(
    !this.storage.getFlag(FLAGS.onboardingDone, STORAGE_KEYS.onboardingDone),
  );

  protected readonly showLegalGate = signal(
    !this.storage.getFlag(FLAGS.legalAccepted, STORAGE_KEYS.legalAccepted),
  );

  constructor() {
    this.checkBackupReminder();
    // Un descanso que seguía corriendo cuando el SO mató la app se retoma donde estaba.
    this.uiState.restoreRest();
    // Capture-phase popstate: intercept back button before Angular's router listener.
    // When an overlay is open, close it instead of navigating. The URL never changes
    // for overlay entries (pushState with empty string), so Angular's URL state stays
    // in sync and the training guard still fires when no overlays are open.
    window.addEventListener('popstate', this._onPopstate, true);
  }

  private readonly _onPopstate = (e: PopStateEvent): void => {
    if (this.uiState.consumeSkipPopstate()) return;
    if (this.uiState.hasOpenOverlay) {
      e.stopImmediatePropagation();
      this.uiState.closeTopOverlay();
    }
  };

  private checkBackupReminder(): void {
    if (localStorage.getItem(STORAGE_KEYS.backupDismissed) === this.storage.todayISO()) return;
    const lastExport = localStorage.getItem(STORAGE_KEYS.lastExport);
    const sessions = this.state.sessions().filter((s) => !s.skipped);
    const count = lastExport
      ? sessions.filter((s) => s.dateISO > lastExport).length
      : sessions.length;
    if (count >= (lastExport ? 8 : 10)) {
      this.uiState.backupReminder.set(true);
    }
  }

  exportBackup(): void {
    this.uiState.backupReminder.set(false);
    void this.backup.exportData();
  }

  dismissBackupReminder(): void {
    localStorage.setItem(STORAGE_KEYS.backupDismissed, this.storage.todayISO());
    this.uiState.backupReminder.set(false);
  }

  /** Otra pestaña es la dueña de la escritura: recargar adopta su estado (RF-STO-09). */
  reloadForTabConflict(): void {
    location.reload();
  }

  /** Descarga el estado apartado tal cual estaba, sin interpretarlo (RF-STO-04). */
  downloadQuarantined(key: string): void {
    const raw = this.storage.readQuarantined(key);
    if (raw === null) return;
    const file = new File([raw], `gym-datos-ilegibles-${this.storage.todayISO()}.json`, {
      type: 'application/json',
    });
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Descartar es destructivo e irreversible: se confirma antes (Art. 7, G4). */
  discardQuarantine(): void {
    if (!confirm(this.T().quarantine_discard_confirm)) return;
    this.storage.discardQuarantine();
    location.reload();
  }

  toggleTheme(): void {
    const s = this.state.settings();
    const next = s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'high-contrast' : 'dark';
    this.state.saveSettings({ ...s, theme: next });
  }

  toggleLang(): void {
    this.tr.setLang(this.tr.lang() === 'es' ? 'en' : 'es');
  }

  /** Texto del toast según el tipo de récord: "más peso" y "una rep más" no se dicen igual. */
  prMessage(pr: PrCelebration): string {
    const params = {
      exercise: pr.exerciseName,
      value: String(pr.value),
      weight: String(pr.weight),
      previous: String(pr.previous),
    };
    switch (pr.kind) {
      case 'weight':
        return this.tr.tp('pr_celebration', { ...params, weight: String(pr.value) });
      case 'reps_at_weight':
        return this.tr.tp('pr_celebration_reps_at_weight', params);
      case 'e1rm':
        return this.tr.tp('pr_celebration_e1rm', params);
      case 'reps':
        return this.tr.tp(
          pr.unit === 'TIME' ? 'pr_celebration_time' : 'pr_celebration_reps',
          params,
        );
    }
  }

  sharePrFromToast(): void {
    const pr = this.uiState.prCelebration();
    if (!pr) return;
    this.uiState.stopPrAutoDismiss();
    // La imagen compartida muestra un número grande y una unidad: cada tipo de récord tiene
    // los suyos, o un PR de repeticiones saldría anunciando "0 kg".
    const t = this.T();
    const unit =
      pr.kind === 'e1rm'
        ? t.pr_share_unit_e1rm
        : pr.kind === 'reps_at_weight'
          ? this.tr.tp('pr_share_unit_reps_at', { weight: String(pr.weight) })
          : pr.kind === 'reps'
            ? pr.unit === 'TIME'
              ? t.pr_share_unit_seconds
              : t.pr_share_unit_reps
            : this.tr.unitLabel(pr.unit as ExerciseUnit);
    void this.shareService.share(pr.exerciseName, pr.value, unit, this.storage.todayISO());
  }

  completeOnboarding(days: 3 | 4 | 5): void {
    this.storage.setFlag(FLAGS.onboardingDone, STORAGE_KEYS.onboardingDone);
    this.showOnboarding.set(false);
    // Aplica la plantilla elegida solo si el usuario aún no tiene datos propios
    // (el onboarding solo aparece en el primer arranque, pero por si acaso).
    const hasRealData = this.state
      .sessions()
      .some((s) => !s.skipped && s.dateISO >= this.storage.todayISO());
    if (!hasRealData) this.state.applyTemplate(days);
  }

  acceptLegal(): void {
    this.storage.setFlag(FLAGS.legalAccepted, STORAGE_KEYS.legalAccepted);
    this.showLegalGate.set(false);
  }
}
