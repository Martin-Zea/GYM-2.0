import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslationService } from '../../services/translation.service';

/**
 * Barra de progreso única de la app (series hechas / totales).
 * Un solo componente para dashboard, barra de entreno y sheets: misma forma,
 * mismo color de estado (--success) y mismo formato de etiqueta en todos lados.
 */
@Component({
  selector: 'app-progress-bar',
  standalone: true,
  template: `
    <div class="pb" [class.pb--compact]="compact()">
      <div
        class="pb-track"
        role="progressbar"
        [attr.aria-valuenow]="done()"
        [attr.aria-valuemin]="0"
        [attr.aria-valuemax]="total()"
        [attr.aria-label]="label()"
      >
        <div class="pb-fill" [style.width.%]="pct()"></div>
      </div>
      @if (showLabel()) {
        <span class="pb-label">{{ label() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .pb {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: var(--fs-xs);
        color: var(--text-2);
        font-variant-numeric: tabular-nums;
        min-width: 0;
      }
      .pb-track {
        flex: 1;
        max-width: 120px;
        height: 4px;
        border-radius: 2px;
        background: var(--bg-3);
        overflow: hidden;
      }
      .pb--compact .pb-track {
        max-width: 60px;
      }
      .pb-fill {
        height: 100%;
        background: var(--success);
        border-radius: 2px;
        transition: width 0.3s ease;
      }
      .pb-label {
        white-space: nowrap;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProgressBarComponent {
  private readonly tr = inject(TranslationService);

  readonly done = input.required<number>();
  readonly total = input.required<number>();
  readonly compact = input(false);
  readonly showLabel = input(true);

  protected readonly pct = computed(() =>
    this.total() > 0 ? (this.done() / this.total()) * 100 : 0,
  );

  protected readonly label = computed(() =>
    this.tr.tp('sets_progress', { done: this.done(), total: this.total() }),
  );
}
