import { Component, computed, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';

@Component({
  selector: 'app-day-picker-sheet',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-picker-sheet.component.html',
  styleUrl: './day-picker-sheet.component.scss',
})
export class DayPickerSheetComponent {
  protected readonly state = inject(StateService);
  protected readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly T = inject(TranslationService).T;

  protected readonly dayItems = computed(() => {
    const s = this.state.state();
    const todayISO = this.storage.todayISO();
    return s.days.map((day, i) => {
      const last = this.storage.lastSessionForDay(s, day.id);
      let label = 'Primera vez';
      if (last) {
        const days = Math.floor(
          (new Date(todayISO).getTime() - new Date(last.dateISO).getTime()) / 86_400_000,
        );
        label = days === 0 ? 'Hoy' : days === 1 ? 'Hace 1 día' : `Hace ${days} días`;
      }
      return { day, index: i, lastLabel: label };
    });
  });

  protected select(index: number): void {
    this.state.setActiveDay(index);
    this.uiState.closeDayPicker();
  }

  protected close(): void {
    this.uiState.closeDayPicker();
  }
}
