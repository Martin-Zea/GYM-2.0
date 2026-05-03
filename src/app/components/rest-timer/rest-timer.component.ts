import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { UIStateService } from '../../services/ui-state.service';

@Component({
  selector: 'app-rest-timer',
  standalone: true,
  imports: [],
  templateUrl: './rest-timer.component.html',
})
export class RestTimerComponent implements OnInit, OnDestroy {
  protected readonly uiState = inject(UIStateService);

  protected readonly remaining = signal(0);
  private readonly total = signal(0);
  private timerId: ReturnType<typeof setInterval> | null = null;

  protected readonly progress = computed(() => {
    const t = this.total();
    return t ? this.remaining() / t : 0;
  });

  protected readonly C = 596.9; // 2π × 95

  ngOnInit(): void {
    const t = this.uiState.restTimer()!;
    this.remaining.set(t.seconds);
    this.total.set(t.seconds);
    this.timerId = setInterval(() => {
      const next = this.remaining() - 1;
      if (next <= 0) {
        this.remaining.set(0);
        this.stopTimer();
        this.onDone();
      } else {
        this.remaining.set(next);
      }
    }, 1000);
  }

  ngOnDestroy(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private onDone(): void {
    this.playBeep();
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    setTimeout(() => this.uiState.restTimer.set(null), 1500);
  }

  protected skip(): void {
    this.stopTimer();
    this.uiState.restTimer.set(null);
  }

  protected adjust(delta: number): void {
    const newVal = Math.max(0, this.remaining() + delta);
    this.remaining.set(newVal);
    this.total.update(t => Math.max(t + delta, newVal));
  }

  private playBeep(): void {
    try {
      const ctx = new AudioContext();
      const play = (freq: number, when: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.3, when);
        gain.gain.exponentialRampToValueAtTime(0.001, when + 0.2);
        osc.start(when);
        osc.stop(when + 0.25);
      };
      play(880, ctx.currentTime);
      play(1320, ctx.currentTime + 0.25);
    } catch { /* AudioContext unavailable */ }
  }
}
