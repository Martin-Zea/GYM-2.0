import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service';
import { FLAGS, StorageService } from './services/storage.service';
import { PrCelebration, UIStateService } from './services/ui-state.service';
import { TranslationService } from './services/translation.service';
import { AppUpdateService } from './services/app-update.service';
import { ErrorService } from './services/error.service';
import { ShareService } from './services/share.service';
import { ApiKeyService } from './services/api-key.service';
import { BackupService } from './services/backup.service';
import { ThemeService } from './services/theme.service';
import { WakeLockService } from './services/wake-lock.service';
import { STORAGE_KEYS } from './services/storage-keys';
import { ExerciseUnit } from './models/workout.model';
import { IconComponent } from './components/icon/icon.component';
import { RestTimerComponent } from './components/rest-timer/rest-timer.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { SettingsComponent } from './components/settings/settings.component';
import { ToolsComponent } from './components/tools/tools.component';
import { DayDetailSheetComponent } from './components/day-detail-sheet/day-detail-sheet.component';
import { DayPickerSheetComponent } from './components/day-picker-sheet/day-picker-sheet.component';
import { DayHistorySheetComponent } from './components/day-history-sheet/day-history-sheet.component';
import { ExerciseChartSheetComponent } from './components/exercise-chart-sheet/exercise-chart-sheet.component';
import { BottomNavComponent } from './components/bottom-nav/bottom-nav.component';
import { SectionRailComponent } from './components/section-rail/section-rail.component';
import { ViewportService } from './services/viewport.service';
import {
  OnboardingComponent,
  OnboardingResult,
} from './components/onboarding/onboarding.component';
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
    ToolsComponent,
    DayDetailSheetComponent,
    DayPickerSheetComponent,
    DayHistorySheetComponent,
    ExerciseChartSheetComponent,
    BottomNavComponent,
    SectionRailComponent,
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
  protected readonly viewport = inject(ViewportService);
  protected readonly tr = inject(TranslationService);
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly errorService = inject(ErrorService);
  private readonly storage = inject(StorageService);
  private readonly shareService = inject(ShareService);
  private readonly apiKeys = inject(ApiKeyService);
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
    // Descifra las keys a memoria y sella las que quedaran en claro de versiones anteriores.
    void this.apiKeys.init();
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

  /**
   * Cierra el onboarding: guarda el perfil que haya dado y prepara su primera rutina (O6).
   *
   * Lo que dejó en blanco se guarda como `null`, no como un valor por defecto: la app tiene
   * que poder distinguir "soy principiante" de "no lo dijo" (RF-PER-01).
   */
  completeOnboarding(result: OnboardingResult): void {
    this.storage.setFlag(FLAGS.onboardingDone, STORAGE_KEYS.onboardingDone);
    this.showOnboarding.set(false);

    const settings = this.state.settings();
    this.state.saveSettings({
      ...settings,
      units: result.units,
      userProfile: { ...settings.userProfile, ...result.profile },
    });

    // La plantilla solo se aplica si el usuario aún no tiene datos propios (el onboarding
    // solo aparece en el primer arranque, pero por si acaso).
    const hasRealData = this.state
      .sessions()
      .some((s) => !s.skipped && s.dateISO >= this.storage.todayISO());
    if (hasRealData) return;

    if (result.choice === 'template' || result.choice === 'ai') {
      // Ambas rutas terminan en la pantalla de rutinas de Inicio, donde el usuario elige
      // plantilla o lanza el generador viendo el coste antes (RF-RUT-03/05).
      const days = Math.min(5, Math.max(3, result.daysPerWeek)) as 3 | 4 | 5;
      this.state.applyTemplate(days);
      return;
    }
    if (result.choice === 'manual') {
      this.state.applyTemplate(3);
      return;
    }
    // 'later': se queda con el estado vacío guiado, sin inventarle una rutina
  }

  acceptLegal(): void {
    this.storage.setFlag(FLAGS.legalAccepted, STORAGE_KEYS.legalAccepted);
    this.showLegalGate.set(false);
  }
}
