import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  inject,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { SoundService } from '../../services/sound.service';
import { DEFAULT_BAR_KG, DEFAULT_PLATES_KG, plateBreakdown } from '../../utils/plates';
import {
  REFERENCE_PERCENTS,
  estimateOneRm,
  kgToLb,
  lbToKg,
  percentOfOneRm,
} from '../../utils/one-rm';

/**
 * A6 · Herramientas auxiliares (RF-HER-01).
 *
 * Todas hacen cuentas con lo que el usuario escribe ahí mismo: no tocan su historial ni su
 * rutina. Por eso viven juntas en una hoja aparte y no repartidas por la sesión.
 */
@Component({
  selector: 'app-tools',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './tools.component.html',
  styleUrl: './tools.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ToolsComponent implements OnDestroy {
  private readonly state = inject(StateService);
  protected readonly uiState = inject(UIStateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly sound = inject(SoundService);

  // ── 1RM y porcentajes ──
  protected readonly rmWeight = signal(60);
  protected readonly rmReps = signal(5);
  protected readonly percents = REFERENCE_PERCENTS;

  protected readonly oneRm = computed(() => estimateOneRm(this.rmWeight(), this.rmReps()));

  protected percentWeight(percent: number): number | null {
    const rm = this.oneRm();
    return rm === null ? null : percentOfOneRm(rm, percent);
  }

  // ── Discos ──
  protected readonly plateWeight = signal(60);

  protected readonly plates = computed(() => {
    const s = this.state.settings();
    return plateBreakdown(
      this.plateWeight(),
      s.barWeightKg ?? DEFAULT_BAR_KG,
      s.platesKg ?? DEFAULT_PLATES_KG,
    );
  });

  protected readonly barWeight = computed(
    () => this.state.settings().barWeightKg ?? DEFAULT_BAR_KG,
  );

  // ── Conversor kg ⇄ lb ──
  protected readonly kgValue = signal(20);
  protected readonly lbValue = signal(44.1);

  protected setKg(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(n)) return;
    this.kgValue.set(n);
    this.lbValue.set(kgToLb(n));
  }

  protected setLb(event: Event): void {
    const n = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(n)) return;
    this.lbValue.set(n);
    this.kgValue.set(lbToKg(n));
  }

  // ── Temporizador libre ──
  protected readonly timerSeconds = signal(60);
  protected readonly timerRemaining = signal(0);
  protected readonly timerRunning = signal(false);
  private timerId: ReturnType<typeof setInterval> | null = null;
  private endsAt = 0;

  /**
   * Cronómetro independiente del descanso de la sesión (RF-HER-01).
   *
   * Deliberadamente separado del `RestTimerService`: mezclarlos haría que cronometrar una
   * plancha cancelara el descanso en curso.
   */
  protected startTimer(): void {
    this.stopTimer();
    this.endsAt = Date.now() + this.timerSeconds() * 1000;
    this.timerRemaining.set(this.timerSeconds());
    this.timerRunning.set(true);
    this.timerId = setInterval(() => this.tick(), 250);
  }

  private tick(): void {
    const left = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    this.timerRemaining.set(left);
    if (left <= 0) {
      this.stopTimer();
      if (this.state.settings().sounds) this.sound.playRestBeep();
      if (this.state.settings().haptics && navigator.vibrate) navigator.vibrate([200, 100, 200]);
    }
  }

  protected stopTimer(): void {
    if (this.timerId !== null) clearInterval(this.timerId);
    this.timerId = null;
    this.timerRunning.set(false);
  }

  protected setNumber(
    target: 'rmWeight' | 'rmReps' | 'plateWeight' | 'timerSeconds',
    event: Event,
  ): void {
    const n = Number((event.target as HTMLInputElement).value);
    if (!Number.isFinite(n) || n < 0) return;
    if (target === 'rmWeight') this.rmWeight.set(n);
    else if (target === 'rmReps') this.rmReps.set(n);
    else if (target === 'plateWeight') this.plateWeight.set(n);
    else this.timerSeconds.set(n);
  }

  protected close(): void {
    this.uiState.closeTools();
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }
}
