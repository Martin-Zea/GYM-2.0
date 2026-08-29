import { Injectable } from '@angular/core';

/**
 * Envoltorio mínimo de IndexedDB con promesas — sin dependencias.
 * Todas las funciones degradan a null/no-op cuando IDB no está disponible
 * (tests con jsdom, navegadores capados): la app sigue funcionando con localStorage.
 */

const DB_NAME = 'gainai';
const DB_VERSION = 1;

/** Store 'state': clave fija 'current' → { state, savedAt }. */
export const IDB_STATE_STORE = 'state';
/** Store 'snapshots': clave dateISO → { dateISO, savedAt, state }. */
export const IDB_SNAPSHOT_STORE = 'snapshots';

let dbPromise: Promise<IDBDatabase | null> | null = null;

export function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STATE_STORE)) db.createObjectStore(IDB_STATE_STORE);
        if (!db.objectStoreNames.contains(IDB_SNAPSHOT_STORE))
          db.createObjectStore(IDB_SNAPSHOT_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbPut(store: string, key: string, value: unknown): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).put(value, key);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function idbGet<T>(store: string, key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbKeys(store: string): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readonly');
      const req = tx.objectStore(store).getAllKeys();
      req.onsuccess = () => resolve((req.result as string[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function idbDelete(store: string, key: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(store, 'readwrite');
      tx.objectStore(store).delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Fachada inyectable sobre las funciones de arriba.
 *
 * La capa durable se consume a través de este servicio y no importando las funciones
 * sueltas: así puede sustituirse en tests (jsdom no trae IndexedDB) y, llegado el caso,
 * cambiarse de motor sin tocar `StorageService` — la misma interfaz que pide el plan §2.
 */
@Injectable({ providedIn: 'root' })
export class IdbService {
  put(store: string, key: string, value: unknown): Promise<boolean> {
    return idbPut(store, key, value);
  }

  get<T>(store: string, key: string): Promise<T | null> {
    return idbGet<T>(store, key);
  }

  keys(store: string): Promise<string[]> {
    return idbKeys(store);
  }

  delete(store: string, key: string): Promise<void> {
    return idbDelete(store, key);
  }
}
