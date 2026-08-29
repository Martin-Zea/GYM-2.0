import { Injectable } from '@angular/core';

/**
 * Adapter de almacenamiento con commit atómico multi-clave (RF-STO-01/03, `audit.md` R-1).
 *
 * **El problema.** Hoy todo el estado vive en un único `setItem`, así que es atómico por
 * accidente. Al repartirlo en las claves `gt_*` del plan §3 esa garantía desaparece: un
 * corte de energía o un fallo de cuota a mitad de la secuencia deja claves nuevas
 * conviviendo con claves viejas — sesiones que referencian ejercicios que no se
 * escribieron. Incoherencia silenciosa, sin backend del que rehidratar.
 *
 * **La solución: journal (write-ahead log).** `localStorage` no tiene rename ni
 * transacciones, pero sí una operación atómica: un `setItem` individual. El commit se
 * apoya en eso:
 *
 * ```
 * 1. escribir cada clave nueva en su temporal  gt_x__tmp
 * 2. releer y validar TODOS los temporales
 * 3. ── PUNTO DE COMMIT ── un solo setItem de gt_meta con { pending }
 * 4. promover temporal → definitiva, borrando cada temporal
 * 5. gt_meta sin pending, con la nueva generación
 * ```
 *
 * Un corte antes del paso 3 no dejó rastro: `recover()` borra los temporales y todo sigue
 * como estaba (**rollback**). Un corte después del paso 3 tiene los datos completos y
 * validados en los temporales: `recover()` termina la promoción (**roll-forward**). No hay
 * ventana en la que se pierda información: o vale el estado viejo entero, o el nuevo entero.
 */

/** Claves del modelo particionado (plan §3). Todas con prefijo `gt_` (RF-STO-01). */
export const GT_KEYS = {
  meta: 'gt_meta',
  profile: 'gt_profile',
  settings: 'gt_settings',
  exercises: 'gt_exercises_custom',
  routines: 'gt_routines',
  sessions: 'gt_sessions',
  body: 'gt_body',
  ai: 'gt_ai',
} as const;

export type GtDataKey = Exclude<(typeof GT_KEYS)[keyof typeof GT_KEYS], 'gt_meta'>;

/** Sufijo de los temporales del journal. */
export const TMP_SUFFIX = '__tmp';

const tmpOf = (key: string): string => `${key}${TMP_SUFFIX}`;

/**
 * `gt_meta` versiona el **conjunto**, no cada clave por separado: una generación parcial
 * no significa nada, y tener una versión por clave permitiría justamente la incoherencia
 * que este diseño evita.
 */
export interface GtMeta {
  schemaVersion: number;
  /** Sube en cada commit exitoso. Identifica el conjunto completo. */
  generation: number;
  /**
   * Banderas de arranque (onboarding completado, legal aceptado). Viven acá y no en
   * claves sueltas para que el estado del usuario sea UN conjunto versionado (plan §3).
   */
  flags?: Record<string, string>;
  /** Presente solo entre el punto de commit y el fin de la promoción. */
  pending?: { generation: number; keys: string[] };
}

export type CommitResult =
  | { ok: true; generation: number }
  | { ok: false; reason: 'quota' | 'invalid' | 'unknown'; detail?: string };

export type RecoveryOutcome = 'none' | 'rolled-forward' | 'rolled-back';

/** Validación opcional del conjunto completo antes de comprometerlo (paso 2). */
export type SetValidator = (entries: Record<string, unknown>) => string | null;

@Injectable({ providedIn: 'root' })
export class StorageAdapter {
  // ── Lectura ────────────────────────────────────────────────────────────────

  readMeta(): GtMeta | null {
    const raw = this.getItem(GT_KEYS.meta);
    if (raw === null) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null) return null;
      const meta = parsed as Partial<GtMeta>;
      if (typeof meta.schemaVersion !== 'number' || typeof meta.generation !== 'number') {
        return null;
      }
      return meta as GtMeta;
    } catch {
      return null;
    }
  }

  /** Lee y parsea una clave del conjunto. Devuelve `null` si falta o no parsea. */
  read<T>(key: GtDataKey): T | null {
    const raw = this.getItem(key);
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  /** ¿Hay un conjunto `gt_*` escrito? Si no, la app todavía vive en el formato viejo. */
  hasData(): boolean {
    return this.readMeta() !== null;
  }

  // ── Escritura atómica ──────────────────────────────────────────────────────

  /**
   * Escribe todas las entradas como una sola unidad. O quedan todas, o ninguna.
   * `entries` mapea clave `gt_*` → valor serializable.
   */
  commit(
    entries: Partial<Record<GtDataKey, unknown>>,
    opts: { schemaVersion: number; flags?: Record<string, string>; validate?: SetValidator },
  ): CommitResult {
    const keys = Object.keys(entries) as GtDataKey[];
    if (!keys.length) return { ok: false, reason: 'invalid', detail: 'commit sin entradas' };

    // Paso 1a: serializar en memoria. Un valor con ciclos falla acá, antes de tocar disco.
    const serialized = new Map<GtDataKey, string>();
    for (const key of keys) {
      try {
        serialized.set(key, JSON.stringify(entries[key] ?? null));
      } catch (e) {
        return { ok: false, reason: 'invalid', detail: `${key}: ${(e as Error).message}` };
      }
    }

    // Paso 1b: volcar a los temporales.
    try {
      for (const [key, value] of serialized) this.setItem(tmpOf(key), value);
    } catch (e) {
      this.cleanupTmps(keys);
      return { ok: false, reason: this.failureReason(e), detail: (e as Error).message };
    }

    // Paso 2: releer los temporales y validar el conjunto. Releer, y no confiar en lo que
    // acabamos de escribir, es lo que detecta una escritura truncada o silenciosamente
    // descartada por el navegador.
    const readBack: Record<string, unknown> = {};
    for (const key of keys) {
      const raw = this.getItem(tmpOf(key));
      if (raw !== serialized.get(key)) {
        this.cleanupTmps(keys);
        return { ok: false, reason: 'invalid', detail: `${key}: el temporal no coincide` };
      }
      try {
        readBack[key] = JSON.parse(raw);
      } catch {
        this.cleanupTmps(keys);
        return { ok: false, reason: 'invalid', detail: `${key}: el temporal no parsea` };
      }
    }
    const validationError = opts.validate?.(readBack);
    if (validationError) {
      this.cleanupTmps(keys);
      return { ok: false, reason: 'invalid', detail: validationError };
    }

    // Paso 3: PUNTO DE COMMIT. Un único setItem: o la app arranca viendo el estado viejo,
    // o ve el pending y termina la promoción sola.
    const current = this.readMeta();
    const generation = (current?.generation ?? 0) + 1;
    const flags = opts.flags ?? current?.flags;
    const pendingMeta: GtMeta = {
      schemaVersion: opts.schemaVersion,
      generation: current?.generation ?? 0,
      ...(flags && { flags }),
      pending: { generation, keys },
    };
    try {
      this.setItem(GT_KEYS.meta, JSON.stringify(pendingMeta));
    } catch (e) {
      this.cleanupTmps(keys);
      return { ok: false, reason: this.failureReason(e), detail: (e as Error).message };
    }

    // Pasos 4 y 5: ya comprometido. Si algo falla acá, `recover()` lo termina al arrancar.
    try {
      this.promote(keys);
      this.writeMeta({ schemaVersion: opts.schemaVersion, generation, ...(flags && { flags }) });
    } catch (e) {
      return { ok: false, reason: this.failureReason(e), detail: (e as Error).message };
    }

    return { ok: true, generation };
  }

  /**
   * Completa o descarta un commit interrumpido. Debe llamarse al arrancar, ANTES de leer.
   */
  recover(): RecoveryOutcome {
    const meta = this.readMeta();

    if (!meta?.pending) {
      // Sin punto de commit: cualquier temporal es basura de un intento abortado.
      const strays = this.strayTmpKeys();
      if (!strays.length) return 'none';
      for (const tmp of strays) this.removeItem(tmp);
      return 'rolled-back';
    }

    // Con punto de commit: los datos válidos están en los temporales (o ya promovidos).
    this.promote(meta.pending.keys as GtDataKey[]);
    this.writeMeta({
      schemaVersion: meta.schemaVersion,
      generation: meta.pending.generation,
      ...(meta.flags && { flags: meta.flags }),
    });
    return 'rolled-forward';
  }

  // ── Banderas ───────────────────────────────────────────────────────────────

  readFlag(name: string): string | null {
    return this.readMeta()?.flags?.[name] ?? null;
  }

  /**
   * Escribe una bandera. Es un único `setItem` de `gt_meta`, así que ya es atómico y no
   * necesita el journal. Funciona incluso antes del primer commit (crea el meta).
   */
  writeFlag(name: string, value: string, schemaVersion: number): void {
    const meta = this.readMeta() ?? { schemaVersion, generation: 0 };
    this.writeMeta({ ...meta, flags: { ...meta.flags, [name]: value } });
  }

  private writeMeta(meta: GtMeta): void {
    this.setItem(GT_KEYS.meta, JSON.stringify(meta));
  }

  /** Borra todo el conjunto `gt_*`, temporales incluidos (usado por reset y por tests). */
  clearAll(): void {
    for (const key of Object.values(GT_KEYS)) {
      this.removeItem(key);
      this.removeItem(tmpOf(key));
    }
  }

  // ── Internos ───────────────────────────────────────────────────────────────

  /**
   * Temporal → definitiva. Idempotente a propósito: si un temporal ya no está, esa clave
   * se promovió en el intento anterior y no hay nada que hacer. Eso es lo que permite
   * reanudar una promoción cortada por la mitad sin llevar más contabilidad.
   */
  private promote(keys: GtDataKey[]): void {
    for (const key of keys) {
      const value = this.getItem(tmpOf(key));
      if (value === null) continue;
      this.setItem(key, value);
      this.removeItem(tmpOf(key));
    }
  }

  private cleanupTmps(keys: GtDataKey[]): void {
    for (const key of keys) this.removeItem(tmpOf(key));
  }

  private strayTmpKeys(): string[] {
    return Object.values(GT_KEYS)
      .map(tmpOf)
      .filter((tmp) => this.getItem(tmp) !== null);
  }

  private failureReason(e: unknown): 'quota' | 'unknown' {
    return e instanceof DOMException && e.name === 'QuotaExceededError' ? 'quota' : 'unknown';
  }

  // Envoltorios finos: aíslan el acceso a localStorage para poder instrumentarlo.
  private getItem(key: string): string | null {
    return localStorage.getItem(key);
  }

  private setItem(key: string, value: string): void {
    localStorage.setItem(key, value);
  }

  private removeItem(key: string): void {
    localStorage.removeItem(key);
  }
}
