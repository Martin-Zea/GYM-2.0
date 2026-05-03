import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { StateService } from './services/state.service';
import { UIStateService } from './services/ui-state.service';
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

  protected readonly theme = computed(() => this.state.settings().theme);

  toggleTheme(): void {
    const s = this.state.settings();
    this.state.saveSettings({ ...s, theme: s.theme === 'dark' ? 'light' : 'dark' });
  }
}
