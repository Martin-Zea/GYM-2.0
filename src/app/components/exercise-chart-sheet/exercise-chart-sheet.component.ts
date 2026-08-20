import { ChangeDetectionStrategy, Component, computed, HostListener, inject } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { buildChart, BuiltChart } from '../../utils/chart';

interface SheetChart extends BuiltChart {
  pr: number;
  lastLines: { dateISO: string; line: string }[];
}

/**
 * Sheet de progresión rápida: mirar cómo venís en un ejercicio SIN salir de la
 * sesión (antes el icono de gráfico navegaba a /charts y disparaba el guard).
 */
@Component({
  selector: 'app-exercise-chart-sheet',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './exercise-chart-sheet.component.html',
  styleUrl: './exercise-chart-sheet.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExerciseChartSheetComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  protected readonly exercise = computed(() => this.uiState.chartSheet());

  protected readonly chart = computed<SheetChart | null>(() => {
    const ex = this.exercise();
    if (!ex) return null;
    const s = this.state.state();
    const history = this.storage.historyForExercise(s, ex.id).filter((h) => h.topWeight > 0);
    if (history.length < 2) return null;
    const values = history.map((h) => h.topWeight);
    const lastLines = history
      .slice(-3)
      .reverse()
      .map((h) => ({
        dateISO: h.dateISO,
        line: h.sets
          .filter((x) => !x.isWarmup)
          .map((x) => `${x.weight}×${x.reps}`)
          .join(' / '),
      }));
    return { pr: Math.max(...values), lastLines, ...buildChart(history, values) };
  });

  protected formatDate(iso: string): string {
    const d = new Date(iso + 'T12:00:00Z');
    return new Intl.DateTimeFormat(this.tr.lang(), { day: 'numeric', month: 'short' }).format(d);
  }

  @HostListener('document:keydown.escape')
  protected close(): void {
    this.uiState.closeChartSheet();
  }
}
