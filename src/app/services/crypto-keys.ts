import { Injectable } from '@angular/core';
import { IDB_STATE_STORE, idbGet, idbPut } from './idb';

/** Valor cifrado tal como se guarda en el estado. */
export interface SealedValue {
  v: 1;
  iv: string;
  ct: string;
}

const IDB_KEY = 'gt_vault_key';

function toB64(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

function fromB64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export function isSealed(value: unknown): value is SealedValue {
  const v = value as SealedValue | null;
  return (
    typeof v === 'object' &&
    v !== null &&
    v.v === 1 &&
    typeof v.iv === 'string' &&
    typeof v.ct === 'string'
  );
}

/**
 * Cifrado local de credenciales (Art. 4, RF-IA-08).
 *
 * QUÉ PROTEGE Y QUÉ NO, sin adornos: la clave AES vive en IndexedDB como `CryptoKey` **no
 * extraíble**, así que su material nunca existe como string y no puede leerse ni copiarse
 * desde JS ni volcando el almacenamiento. Eso saca la API key en claro de localStorage, de
 * los volcados de IDB, de las herramientas de sincronización y de cualquier captura del
 * estado. NO protege contra código malicioso ejecutándose en el propio origen: ese puede
 * pedirle al vault que descifre. Contra eso no hay defensa en el cliente, y prometerla sería
 * mentir.
 */
@Injectable({ providedIn: 'root' })
export class KeyVault {
  private keyPromise: Promise<CryptoKey | null> | null = null;

  /** `true` si el navegador tiene WebCrypto e IndexedDB para sostener el vault. */
  get available(): boolean {
    return typeof crypto !== 'undefined' && !!crypto.subtle && typeof indexedDB !== 'undefined';
  }

  private async getKey(): Promise<CryptoKey | null> {
    if (!this.available) return null;
    this.keyPromise ??= (async () => {
      try {
        const existing = await idbGet<CryptoKey>(IDB_STATE_STORE, IDB_KEY);
        if (existing) return existing;
        // `extractable: false`: ni siquiera nosotros podemos exportarla después
        const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, [
          'encrypt',
          'decrypt',
        ]);
        await idbPut(IDB_STATE_STORE, IDB_KEY, key);
        return key;
      } catch {
        return null;
      }
    })();
    return this.keyPromise;
  }

  /** Cifra un texto. Devuelve `null` si el navegador no puede: el llamador decide qué hacer. */
  async seal(plain: string): Promise<SealedValue | null> {
    const key = await this.getKey();
    if (!key || !plain) return null;
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv.buffer as ArrayBuffer },
        key,
        new TextEncoder().encode(plain).buffer as ArrayBuffer,
      );
      return { v: 1, iv: toB64(iv.buffer as ArrayBuffer), ct: toB64(ct) };
    } catch {
      return null;
    }
  }

  /**
   * Descifra. Devuelve `''` si no se puede — por ejemplo si el usuario borró los datos del
   * sitio y la clave del vault se fue con ellos. Ahí la key es irrecuperable y hay que
   * volver a pegarla, que es preferible a fingir que sigue ahí.
   */
  async open(sealed: SealedValue | null | undefined): Promise<string> {
    if (!isSealed(sealed)) return '';
    const key = await this.getKey();
    if (!key) return '';
    try {
      const plain = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: fromB64(sealed.iv).buffer as ArrayBuffer },
        key,
        fromB64(sealed.ct).buffer as ArrayBuffer,
      );
      return new TextDecoder().decode(plain);
    } catch {
      return '';
    }
  }
}
