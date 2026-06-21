import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { daysBetweenISO } from '../../utils/date';

@Component({
  selector: 'app-day-picker-sheet',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './day-picker-sheet.component.html',
  styleUrl: './day-picker-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DayPickerSheetComponent {
  protected readonly state = inject(StateService);
  protected readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  private readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly dayItems = computed(() => {
    const s = this.state.state();
    const todayISO = this.storage.todayISO();
    const T = this.T();
    return this.state.days().map((day, i) => {
      const last = this.storage.lastSessionForDay(s, day.id);
      let label = T.first_time_label;
      if (last) {
        const days = daysBetweenISO(last.dateISO, todayISO);
        label =
          days === 0
            ? T.today_ago
            : days === 1
              ? T.days_ago_one
              : this.tr.tp('days_ago_many', { n: days });
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
