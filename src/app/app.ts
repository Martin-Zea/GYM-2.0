import { Component, computed, inject, signal } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service';
import { StorageService } from './services/storage.service';
import { UIStateService } from './services/ui-state.service';
import { TranslationService } from './services/translation.service';
import { AppUpdateService } from './services/app-update.service';
import { ErrorService } from './services/error.service';
import { ShareService } from './services/share.service';
import { IconComponent } from './components/icon/icon.component';
import { RestTimerComponent } from './components/rest-timer/rest-timer.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DayDetailSheetComponent } from './components/day-detail-sheet/day-detail-sheet.component';
import { DayPickerSheetComponent } from './components/day-picker-sheet/day-picker-sheet.component';
import { DayHistorySheetComponent } from './components/day-history-sheet/day-history-sheet.component';
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
    BottomNavComponent,
    OnboardingComponent,
    LegalGateComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly appUpdate = inject(AppUpdateService);
  protected readonly errorService = inject(ErrorService);
  private readonly storage = inject(StorageService);
  private readonly shareService = inject(ShareService);

  protected readonly theme = computed(() => this.state.settings().theme);
  protected readonly T = this.tr.T;

  protected readonly showOnboarding = signal(
    localStorage.getItem('gym_onboarding_done_v1') !== '1',
  );

  protected readonly showLegalGate = signal(localStorage.getItem('gym_legal_accepted_v1') !== '1');

  constructor() {
    this.checkBackupReminder();
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
    if (localStorage.getItem('gym_backup_dismissed') === this.storage.todayISO()) return;
    const lastExport = localStorage.getItem('gym_last_export');
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
    void this.state.exportData();
  }

  dismissBackupReminder(): void {
    localStorage.setItem('gym_backup_dismissed', this.storage.todayISO());
    this.uiState.backupReminder.set(false);
  }

  toggleTheme(): void {
    const s = this.state.settings();
    const next = s.theme === 'dark' ? 'light' : s.theme === 'light' ? 'high-contrast' : 'dark';
    this.state.saveSettings({ ...s, theme: next });
  }

  toggleLang(): void {
    this.tr.setLang(this.tr.lang() === 'es' ? 'en' : 'es');
  }

  sharePrFromToast(): void {
    const pr = this.uiState.prCelebration();
    if (!pr) return;
    this.uiState.stopPrAutoDismiss();
    void this.shareService.share(pr.exerciseName, pr.weight, pr.unit, this.storage.todayISO());
  }

  completeOnboarding(): void {
    localStorage.setItem('gym_onboarding_done_v1', '1');
    this.showOnboarding.set(false);
  }

  acceptLegal(): void {
    localStorage.setItem('gym_legal_accepted_v1', '1');
    this.showLegalGate.set(false);
  }
}
