import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { UIStateService } from '../../services/ui-state.service';
import { StateService } from '../../services/state.service';
import { TranslationService } from '../../services/translation.service';
import { SoundService } from '../../services/sound.service';

@Component({
  selector: 'app-rest-timer',
  standalone: true,
  imports: [],
  templateUrl: './rest-timer.component.html',
  styleUrl: './rest-timer.component.scss',
})
export class RestTimerComponent implements OnInit, OnDestroy {
  protected readonly uiState = inject(UIStateService);
  private readonly state = inject(StateService);
  private readonly tr = inject(TranslationService);
  private readonly sound = inject(SoundService);

  protected readonly remaining = signal(0);
  private readonly total = signal(0);
  private endsAt = 0;
  private finished = false;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private wakeLock: WakeLockSentinel | null = null;

  // Ask for notification permission at most once per app session
  private static notificationAsked = false;

  protected readonly progress = computed(() => {
    const t = this.total();
    return t ? this.remaining() / t : 0;
  });

  protected readonly C = 596.9; // 2π × 95

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== 'visible') return;
    // Background tabs throttle/pause setInterval — resync from the wall clock
    this.tick();
    if (!this.finished) void this.requestWakeLock();
  };

  ngOnInit(): void {
    const t = this.uiState.restTimer()!;
    this.remaining.set(t.seconds);
    this.total.set(t.seconds);
    this.endsAt = Date.now() + t.seconds * 1000;
    this.timerId = setInterval(() => this.tick(), 500);
    document.addEventListener('visibilitychange', this.onVisibilityChange);
    this.requestNotificationPermissionOnce();
    void this.requestWakeLock();
  }

  ngOnDestroy(): void {
    this.stopTimer();
    document.removeEventListener('visibilitychange', this.onVisibilityChange);
    this.releaseWakeLock();
  }

  /** Remaining time is derived from endsAt, so a paused interval can't drift */
  private tick(): void {
    if (this.finished) return;
    const next = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    this.remaining.set(next);
    if (next <= 0) {
      this.finished = true;
      this.stopTimer();
      this.onDone();
    }
  }

  private stopTimer(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private onDone(): void {
    if (this.state.settings().sounds) this.sound.playRestBeep();
    void this.triggerAlert();
    this.releaseWakeLock();

    // Trigger auto-scroll + focus on next pending set
    const timer = this.uiState.restTimer();
    if (timer && timer.nextSetIndex !== undefined && timer.nextSetIndex >= 0) {
      this.uiState.focusSet.set({
        exerciseId: timer.exerciseId,
        setIndex: timer.nextSetIndex,
      });
    }

    setTimeout(() => this.uiState.restTimer.set(null), 1500);
  }

  protected skip(): void {
    this.stopTimer();
    this.releaseWakeLock();
    this.uiState.restTimer.set(null);
  }

  protected adjust(delta: number): void {
    if (this.finished) return;
    this.endsAt += delta * 1000;
    const newVal = Math.max(0, Math.ceil((this.endsAt - Date.now()) / 1000));
    this.remaining.set(newVal);
    this.total.update(t => Math.max(t + delta, newVal));
    if (newVal <= 0) {
      this.finished = true;
      this.stopTimer();
      this.onDone();
    }
  }

  private requestNotificationPermissionOnce(): void {
    if (RestTimerComponent.notificationAsked) return;
    RestTimerComponent.notificationAsked = true;
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Promise.resolve(Notification.requestPermission()).catch(() => {});
      }
    } catch { /* Notification API unavailable */ }
  }

  /** Vibrates and notifies. When the screen is locked, uses a SW notification so the
   *  vibration fires through the system (navigator.vibrate is blocked on locked screens). */
  private async triggerAlert(): Promise<void> {
    const pattern: VibratePattern = [300, 100, 300, 100, 500];

    if (document.hidden) {
      try {
        if (!('serviceWorker' in navigator) || Notification.permission !== 'granted') return;
        const timer = this.uiState.restTimer();
        const base = this.tr.T().rest_done_notification;
        const body = timer?.nextLabel ? `${base} — ${timer.nextLabel}` : base;
        const reg = await navigator.serviceWorker.ready;
        const opts = { body, vibrate: pattern, tag: 'rest-timer', renotify: true, silent: true } as NotificationOptions;
        await reg.showNotification('GainAI', opts);
        setTimeout(async () => {
          const notes = await reg.getNotifications({ tag: 'rest-timer' });
          notes.forEach(n => n.close());
        }, 4000);
      } catch { /* SW or Notification unavailable */ }
    } else {
      if (navigator.vibrate) navigator.vibrate(pattern);
    }
  }

  private async requestWakeLock(): Promise<void> {
    try {
      if (!('wakeLock' in navigator)) return;
      this.wakeLock = await navigator.wakeLock.request('screen');
    } catch { /* wake lock unavailable (iOS, no HTTPS, low battery) */ }
  }

  private releaseWakeLock(): void {
    try {
      void this.wakeLock?.release().catch(() => {});
    } catch { /* already released */ }
    this.wakeLock = null;
  }
}
