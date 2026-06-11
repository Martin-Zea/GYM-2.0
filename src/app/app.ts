import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service';
import { StorageService } from './services/storage.service';
import { UIStateService } from './services/ui-state.service';
import { TranslationService } from './services/translation.service';
import { AppUpdateService } from './services/app-update.service';
import { IconComponent } from './components/icon/icon.component';
import { RestTimerComponent } from './components/rest-timer/rest-timer.component';
import { DayEditorComponent } from './components/day-editor/day-editor.component';
import { SettingsComponent } from './components/settings/settings.component';
import { DayDetailSheetComponent } from './components/day-detail-sheet/day-detail-sheet.component';
import { DayPickerSheetComponent } from './components/day-picker-sheet/day-picker-sheet.component';
import { DayHistorySheetComponent } from './components/day-history-sheet/day-history-sheet.component';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    RouterOutlet, RouterLink, RouterLinkActive,
    IconComponent, RestTimerComponent, DayEditorComponent, SettingsComponent,
    DayDetailSheetComponent, DayPickerSheetComponent, DayHistorySheetComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly appUpdate = inject(AppUpdateService);
  private readonly storage = inject(StorageService);

  protected readonly theme = computed(() => this.state.settings().theme);
  protected readonly T = this.tr.T;

  constructor() {
    this.checkBackupReminder();
  }

  private checkBackupReminder(): void {
    if (localStorage.getItem('gym_backup_dismissed') === this.storage.todayISO()) return;
    const lastExport = localStorage.getItem('gym_last_export');
    const sessions = this.state.sessions().filter(s => !s.skipped);
    const count = lastExport
      ? sessions.filter(s => s.dateISO > lastExport).length
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
    this.state.saveSettings({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' });
  }

  toggleLang(): void {
    this.tr.setLang(this.tr.lang() === 'es' ? 'en' : 'es');
  }
}
