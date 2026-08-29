import { TestBed } from '@angular/core/testing';
import { OWNER_STALE_MS, TabLockService } from './tab-lock.service';
import { STORAGE_KEYS } from './storage-keys';

/**
 * jsdom no implementa Web Locks, así que estos tests ejercitan el **fallback por
 * heartbeat**: justo la ruta que corre en los navegadores viejos donde el riesgo
 * multi-pestaña (R-9) es real. La ruta de Web Locks la cubre el navegador.
 */
describe('TabLockService (fallback sin Web Locks)', () => {
  const owner = (): { id: string; ts: number } | null => {
    const raw = localStorage.getItem(STORAGE_KEYS.tabOwner);
    return raw ? (JSON.parse(raw) as { id: string; ts: number }) : null;
  };

  let created: TabLockService[] = [];

  /** Crea una instancia "pestaña" con su propio inyector. */
  const newTab = (): TabLockService => {
    const instance = TestBed.inject(TabLockService);
    created.push(instance);
    TestBed.resetTestingModule();
    return instance;
  };

  beforeEach(() => {
    localStorage.clear();
    created = [];
    expect(navigator.locks).toBeUndefined();
  });

  afterEach(() => {
    for (const tab of created) tab.releaseForTest();
  });

  it('la primera pestaña se declara primaria y publica su titularidad', () => {
    const tab = newTab();

    expect(tab.isPrimary()).toBe(true);
    expect(tab.canWrite()).toBe(true);
    expect(owner()?.id).toBe(tab.tabId);
  });

  it('una segunda pestaña con dueño vivo queda en solo lectura', () => {
    const first = newTab();
    const second = newTab();

    expect(first.canWrite()).toBe(true);
    expect(second.canWrite()).toBe(false);
    // La titularidad no cambió de manos
    expect(owner()?.id).toBe(first.tabId);
  });

  it('reclama la titularidad cuando la marca del dueño anterior venció', () => {
    localStorage.setItem(
      STORAGE_KEYS.tabOwner,
      JSON.stringify({ id: 'pestaña-muerta', ts: Date.now() - OWNER_STALE_MS - 1000 }),
    );

    const tab = newTab();

    expect(tab.canWrite()).toBe(true);
    expect(owner()?.id).toBe(tab.tabId);
  });

  it('un registro de dueño corrupto no deja la app en solo lectura', () => {
    localStorage.setItem(STORAGE_KEYS.tabOwner, '{ esto no es json');

    const tab = newTab();

    expect(tab.canWrite()).toBe(true);
    expect(owner()?.id).toBe(tab.tabId);
  });

  it('una pestaña degradada NO recupera la escritura sola: exige recargar', () => {
    const first = newTab();
    const second = newTab();
    expect(second.canWrite()).toBe(false);

    // La primaria se va y deja la titularidad vencida
    localStorage.setItem(
      STORAGE_KEYS.tabOwner,
      JSON.stringify({ id: first.tabId, ts: Date.now() - OWNER_STALE_MS - 1000 }),
    );

    // Aunque el puesto quede libre, la secundaria sigue con la copia vieja en memoria:
    // dejarla guardar volcaría estado viejo sobre el nuevo.
    expect(second.canWrite()).toBe(false);
    expect(second.writeBlocked()).toBe(true);
  });

  it('una pestaña degradada suelta el puesto para que una nueva pueda escribir', () => {
    newTab();
    const second = newTab();
    expect(second.canWrite()).toBe(false);

    // El dueño original se fue; su marca vence
    localStorage.setItem(
      STORAGE_KEYS.tabOwner,
      JSON.stringify({ id: 'pestaña-cerrada', ts: Date.now() - OWNER_STALE_MS - 1000 }),
    );

    // Una pestaña nueva debe poder tomar el relevo (si la degradada retuviera el puesto,
    // nadie podría guardar nunca más).
    const third = newTab();
    expect(third.canWrite()).toBe(true);
  });

  it('marca externalWrite cuando otra pestaña escribe el estado', () => {
    const tab = newTab();
    expect(tab.externalWrite()).toBe(false);

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.appState }));

    expect(tab.externalWrite()).toBe(true);
  });

  it('ignora escrituras de claves ajenas al estado', () => {
    const tab = newTab();

    window.dispatchEvent(new StorageEvent('storage', { key: STORAGE_KEYS.lang }));

    expect(tab.externalWrite()).toBe(false);
  });

  it('withExclusiveLock no ejecuta en una pestaña secundaria', async () => {
    newTab();
    const second = newTab();
    const fn = vi.fn(() => 'migrado');

    const result = await second.withExclusiveLock(fn);

    expect(result).toBeNull();
    expect(fn).not.toHaveBeenCalled();
  });

  it('withExclusiveLock ejecuta en la pestaña primaria', async () => {
    const tab = newTab();

    await expect(tab.withExclusiveLock(() => 'migrado')).resolves.toBe('migrado');
  });
});
