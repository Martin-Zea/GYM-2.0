import { TestBed } from '@angular/core/testing';
import { KeyVault } from './crypto-keys';
import { IdbService } from './idb';

/** IndexedDB de mentira con el comportamiento que pida cada test. */
class FakeIdb {
  readonly store = new Map<string, unknown>();
  /** Si es `false`, put finge fallar; si es `'miente'`, dice ok pero no guarda. */
  putMode: true | false | 'miente' = true;

  async put(_store: string, key: string, value: unknown): Promise<boolean> {
    if (this.putMode === false) return false;
    if (this.putMode === 'miente') return true;
    this.store.set(key, value);
    return true;
  }
  async get<T>(_store: string, key: string): Promise<T | null> {
    return (this.store.get(key) as T) ?? null;
  }
  async keys(): Promise<string[]> {
    return [...this.store.keys()];
  }
  async delete(_store: string, key: string): Promise<void> {
    this.store.delete(key);
  }
}

function vaultWith(idb: FakeIdb): KeyVault {
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ providers: [{ provide: IdbService, useValue: idb }] });
  return TestBed.inject(KeyVault);
}

/**
 * El vault contra un IndexedDB que falla o miente (T-824).
 *
 * El reporte: "cargo el JSON con las keys y al presionar F5 las pierdo". El vault generaba
 * su clave, `idbPut` fallaba EN SILENCIO (el booleano se ignoraba) y sellaba igual con una
 * clave que solo existía en memoria: la key funcionaba toda la sesión y el blob quedaba
 * indescifrable para siempre en la primera recarga.
 */
describe('KeyVault — la clave tiene que SOBREVIVIR, no solo existir (T-824)', () => {
  beforeEach(() => {
    // jsdom no trae indexedDB; `available` solo mira que el global exista
    vi.stubGlobal('indexedDB', {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('con IDB sana: sella, y otra instancia (una "recarga") lo abre', async () => {
    const idb = new FakeIdb();

    const antes = vaultWith(idb);
    const sealed = await antes.seal('gsk_secreta');
    expect(sealed).not.toBeNull();
    expect(antes.healthy()).toBe(true);

    // "F5": vault nuevo, la MISMA IndexedDB — la clave persistida abre el blob
    const despues = vaultWith(idb);
    expect(await despues.open(sealed)).toBe('gsk_secreta');
  });

  it('si el put FALLA, sellar devuelve null: mejor en claro que indescifrable', async () => {
    const idb = new FakeIdb();
    idb.putMode = false;

    const vault = vaultWith(idb);
    expect(await vault.seal('gsk_secreta')).toBeNull();
    expect(vault.healthy()).toBe(false);
  });

  it('si el put dice ok pero la relectura no encuentra nada, tampoco sella', async () => {
    // Un almacenamiento que acepta la escritura y la descarta es el peor mentiroso.
    const idb = new FakeIdb();
    idb.putMode = 'miente';

    const vault = vaultWith(idb);
    expect(await vault.seal('gsk_secreta')).toBeNull();
    expect(vault.healthy()).toBe(false);
  });

  it('el escenario del reporte, de punta a punta: una IDB rota ya no fabrica blobs huérfanos', async () => {
    const rota = new FakeIdb();
    rota.putMode = false;
    const enLaSesion = vaultWith(rota);

    // Antes: esto devolvía un blob sellado con una clave efímera. Ahora, nada que perder.
    expect(await enLaSesion.seal('gsk_importada')).toBeNull();

    // Y un blob viejo huérfano se abre a '' sin reventar el arranque.
    const trasF5 = vaultWith(new FakeIdb());
    expect(await trasF5.open({ v: 1, iv: 'aXY=', ct: 'Y3Q=' })).toBe('');
  });

  it('healthy arranca en null: sin key configurada no hay nada que avisar', () => {
    expect(vaultWith(new FakeIdb()).healthy()).toBeNull();
  });
});
