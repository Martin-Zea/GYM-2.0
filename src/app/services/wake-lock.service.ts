import { Injectable, effect, inject } from '@angular/core';
import { UIStateService } from './ui-state.service';

/**
 * Mantiene la pantalla despierta durante TODA la sesión de entrenamiento
 * (el rest-timer ya pedía el suyo durante el descanso; esto cubre el resto).
 * Se re-adquiere al volver a primer plano — el SO lo suelta al ir a background.
 */
@Injectable({ providedIn: 'root' })
export class WakeLockService {
  private readonly uiState = inject(UIStateService);
  private sentinel: WakeLockSentinel | null = null;

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState === 'visible' && this.uiState.trainingActive()) {
      void this.acquire();
    }
  };

  constructor() {
    effect(() => {
      if (this.uiState.trainingActive()) {
        void this.acquire();
        document.addEventListener('visibilitychange', this.onVisibilityChange);
      } else {
        this.release();
        document.removeEventListener('visibilitychange', this.onVisibilityChange);
      }
    });
  }

  private async acquire(): Promise<void> {
    try {
      if (!('wakeLock' in navigator) || this.sentinel) return;
      this.sentinel = await navigator.wakeLock.request('screen');
      this.sentinel.addEventListener('release', () => {
        this.sentinel = null;
      });
    } catch {
      /* no disponible (iOS viejo, sin HTTPS, batería baja) */
    }
  }

  private release(): void {
    try {
      void this.sentinel?.release().catch(() => {});
    } catch {
      /* ya liberado */
    }
    this.sentinel = null;
  }
}
