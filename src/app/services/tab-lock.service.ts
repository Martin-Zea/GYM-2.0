import { Injectable, signal } from '@angular/core';
import { STORAGE_KEYS } from './storage-keys';

/**
 * Elección de pestaña primaria para escritura (RF-STO-09, `audit.md` R-9).
 *
 * Sin esto, dos pestañas abiertas se pisan: la última en guardar gana, y durante una
 * migración de esquema una pestaña puede escribir el formato viejo encima del ya migrado.
 *
 * Mecanismo principal: **Web Locks**. La pestaña que consigue el lock exclusivo
 * `gt_state_write` lo retiene mientras vive y es la única que escribe; las demás quedan
 * encoladas y lo heredan automáticamente cuando la primaria se cierra.
 *
 * Fallback (Safari viejo, contexto inseguro, jsdom): elección por heartbeat en
 * localStorage — un dueño se anuncia en `gt_tab_owner` y refresca su marca de tiempo;
 * si la marca queda vieja, otra pestaña reclama el puesto.
 *
 * Arranque optimista: la pestaña se considera primaria hasta que averigua lo contrario.
 * El caso de una sola pestaña es el 99% y no debe pagar una espera; el caso de dos se
 * resuelve en milisegundos, y el peor escenario de esa ventana es el comportamiento que
 * la app ya tenía antes de esta tarea.
 */

const LOCK_NAME = 'gt_state_write';

/** Cada cuánto la pestaña dueña refresca su marca en el fallback por heartbeat. */
export const HEARTBEAT_MS = 2000;
/** Antigüedad a partir de la cual se considera que el dueño murió y otra puede reclamar. */
export const OWNER_STALE_MS = 6000;

interface TabOwnerRecord {
  id: string;
  ts: number;
}

function parseOwner(raw: string | null): TabOwnerRecord | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { id, ts } = parsed as Partial<TabOwnerRecord>;
    if (typeof id !== 'string' || typeof ts !== 'number') return null;
    return { id, ts };
  } catch {
    return null;
  }
}

@Injectable({ providedIn: 'root' })
export class TabLockService {
  /** Id único de esta pestaña; identifica al dueño en el fallback por heartbeat. */
  readonly tabId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  /** `true` mientras esta pestaña tenga el lock de escritura. */
  readonly isPrimary = signal(true);

  /**
   * Se latchea al perder la primacía y **no se suelta hasta recargar**.
   *
   * Heredar el lock no vuelve segura a una pestaña que estuvo en solo lectura: su copia
   * en memoria quedó vieja mientras la otra escribía, y dejarla guardar volcaría ese
   * estado viejo encima del nuevo. Recargar es lo único que la resincroniza — que es
   * justo lo que el banner le pide al usuario.
   */
  readonly writeBlocked = signal(false);

  /** Se pone en `true` cuando otra pestaña escribió el estado (nuestra vista quedó vieja). */
  readonly externalWrite = signal(false);

  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private releasePrimary: (() => void) | null = null;

  constructor() {
    this.electPrimary();
    this.watchExternalWrites();
  }

  /** ¿Puede esta pestaña escribir el estado ahora mismo? */
  canWrite(): boolean {
    return this.isPrimary() && !this.writeBlocked();
  }

  /**
   * Baja a solo lectura de forma definitiva para esta carga de la página.
   *
   * Deja de competir por la titularidad: una pestaña que ya no puede escribir y aun así
   * retuviera el lock dejaría en solo lectura también a la siguiente que el usuario abra,
   * y nadie podría guardar. Soltarla permite que otra pestaña tome el relevo.
   */
  private demote(): void {
    this.isPrimary.set(false);
    this.writeBlocked.set(true);
    this.stopHeartbeat();
  }

  /**
   * Ejecuta `fn` con exclusión mutua real entre pestañas. Lo usa la migración de esquema
   * (T-102): ninguna otra pestaña debe escribir mientras el almacenamiento se reparticiona.
   *
   * Con Web Locks toma un lock exclusivo dedicado y espera su turno. Sin Web Locks se
   * apoya en la elección por heartbeat: si esta pestaña no es la dueña, no ejecuta y
   * devuelve `null` — el llamador decide (la migración simplemente no arranca).
   */
  async withExclusiveLock<T>(fn: () => Promise<T> | T): Promise<T | null> {
    if (this.writeBlocked()) return null;
    const locks = navigator.locks;
    if (locks) {
      return locks.request(`${LOCK_NAME}_exclusive`, { mode: 'exclusive' }, async () => fn());
    }
    if (!this.canWrite()) return null;
    return fn();
  }

  // ── Elección de la pestaña primaria ────────────────────────────────────────

  private electPrimary(): void {
    const locks = navigator.locks;
    if (locks) {
      this.electViaWebLocks(locks);
      return;
    }
    this.electViaHeartbeat();
  }

  private electViaWebLocks(locks: LockManager): void {
    // Primer intento sin bloquear: dice de inmediato si alguien más ya es primaria.
    void locks
      .request(LOCK_NAME, { mode: 'exclusive', ifAvailable: true }, (lock) => {
        if (!lock) {
          // Otra pestaña manda. No nos encolamos para heredar el lock: esta pestaña ya
          // quedó en solo lectura hasta recargar, y retener el lock solo serviría para
          // bloquear a la próxima pestaña que el usuario abra.
          this.demote();
          return;
        }
        return this.holdPrimary();
      })
      .catch(() => {
        // Web Locks presente pero inutilizable: no dejamos la app en solo lectura.
        this.isPrimary.set(true);
      });
  }

  /** Retiene el lock (y con él la condición de primaria) hasta que la pestaña se cierre. */
  private holdPrimary(): Promise<void> {
    this.isPrimary.set(true);
    return new Promise<void>((resolve) => {
      this.releasePrimary = resolve;
      window.addEventListener('pagehide', () => resolve(), { once: true });
    });
  }

  private electViaHeartbeat(): void {
    this.claimIfFree();
    this.heartbeat = setInterval(() => this.claimIfFree(), HEARTBEAT_MS);
    window.addEventListener('pagehide', () => this.stopHeartbeat(), { once: true });
  }

  /**
   * Reclama la titularidad si está libre o vencida; la refresca si ya es nuestra.
   * Publicar y volver a leer resuelve el empate cuando dos pestañas reclaman a la vez:
   * la última escritura es la que queda, y la otra se ve a sí misma como secundaria.
   */
  private claimIfFree(): void {
    if (this.writeBlocked()) return;
    try {
      const owner = parseOwner(localStorage.getItem(STORAGE_KEYS.tabOwner));
      const mine = owner?.id === this.tabId;
      const stale = !owner || Date.now() - owner.ts > OWNER_STALE_MS;

      if (!mine && !stale) {
        this.demote();
        return;
      }

      const record: TabOwnerRecord = { id: this.tabId, ts: Date.now() };
      localStorage.setItem(STORAGE_KEYS.tabOwner, JSON.stringify(record));
      const confirmed = parseOwner(localStorage.getItem(STORAGE_KEYS.tabOwner));
      if (confirmed?.id === this.tabId) this.isPrimary.set(true);
      else this.demote();
    } catch {
      // Sin localStorage utilizable no hay elección posible: no bloqueamos al usuario.
      this.isPrimary.set(true);
    }
  }

  private stopHeartbeat(): void {
    if (this.heartbeat === null) return;
    clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  // ── Detección de escrituras de otras pestañas ──────────────────────────────

  private watchExternalWrites(): void {
    window.addEventListener('storage', (e) => {
      // `key === null` es un `localStorage.clear()` desde otra pestaña.
      if (e.key !== null && e.key !== STORAGE_KEYS.appState && e.key !== STORAGE_KEYS.stateSavedAt)
        return;
      this.externalWrite.set(true);
    });
  }

  /** Solo para tests: libera el lock/heartbeat y deja el servicio inerte. */
  releaseForTest(): void {
    this.stopHeartbeat();
    this.releasePrimary?.();
    this.releasePrimary = null;
  }
}
