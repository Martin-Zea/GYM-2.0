import { TestBed } from '@angular/core/testing';
import { ApiKeyService } from './api-key.service';
import { KeyVault, SealedValue } from './crypto-keys';
import { StateService } from './state.service';
import { TabLockService } from './tab-lock.service';

/**
 * El arranque de la custodia de keys (T-823).
 *
 * El caso que importa es el vault ROTO EN RUNTIME: `available` dice true (el navegador
 * tiene WebCrypto e IndexedDB) pero sellar devuelve null (IDB bloqueado, clave que no
 * persiste). Antes ese estado borraba la key en claro creyendo que ya estaba sellada.
 */
describe('ApiKeyService.init() — migrar sin destruir (T-823)', () => {
  function setup(vault: Partial<KeyVault>): { keys: ApiKeyService; state: StateService } {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [{ provide: KeyVault, useValue: { available: true, ...vault } }],
    });
    const state = TestBed.inject(StateService);
    return { keys: TestBed.inject(ApiKeyService), state };
  }

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
  });

  it('con el vault sano, la key en claro se sella y desaparece del estado', async () => {
    const sealed: SealedValue = { v: 1, iv: 'aXY=', ct: 'Y3Q=' };
    const { keys, state } = setup({
      open: async () => '',
      seal: async () => sealed,
    });
    state.saveSettings({ ...state.settings(), apiKey: 'gsk_legacy' });

    await keys.init();

    expect(state.settings().apiKey).toBe('');
    expect(state.settings().apiKeySealed).toEqual(sealed);
    expect(keys.get('groq')).toBe('gsk_legacy'); // en memoria sigue usable
  });

  it('con el vault ROTO, la key en claro se CONSERVA: proteger no puede destruir', async () => {
    // `available: true` pero seal devuelve null — el estado exacto que antes borraba la key.
    const { keys, state } = setup({
      open: async () => '',
      seal: async () => null,
    });
    state.saveSettings({ ...state.settings(), apiKey: 'gsk_legacy' });

    await keys.init();

    expect(state.settings().apiKey).toBe('gsk_legacy');
    expect(keys.get('groq')).toBe('gsk_legacy');
  });

  it('si solo sella una de las dos, borra en claro SOLO esa', async () => {
    const sealed: SealedValue = { v: 1, iv: 'aXY=', ct: 'Y3Q=' };
    const { keys, state } = setup({
      open: async () => '',
      // Groq se sella; Cohere falla (simula un fallo intermitente a mitad del arranque)
      seal: async (plain: string) => (plain === 'gsk_g' ? sealed : null),
    });
    state.saveSettings({ ...state.settings(), apiKey: 'gsk_g', cohereApiKey: 'co_c' });

    await keys.init();

    expect(state.settings().apiKey).toBe('');
    expect(state.settings().apiKeySealed).toEqual(sealed);
    expect(state.settings().cohereApiKey).toBe('co_c'); // la que no se pudo sellar, intacta
  });

  it('set() con el vault roto guarda en claro: la key del backup sobrevive al F5', async () => {
    // El camino del import: adoptCredentials → set(). Si sellar falla, el claro va al
    // estado (localStorage) en vez de a un blob indescifrable.
    const { keys, state } = setup({ open: async () => '', seal: async () => null });

    await keys.set('groq', 'gsk_importada');

    expect(state.settings().apiKey).toBe('gsk_importada');
    expect(state.settings().apiKeySealed).toBeUndefined();
    expect(keys.get('groq')).toBe('gsk_importada');
  });

  it('una key sellada se abre al arrancar y queda disponible en memoria', async () => {
    const sealed: SealedValue = { v: 1, iv: 'aXY=', ct: 'Y3Q=' };
    const { keys, state } = setup({
      open: async (s: SealedValue | null | undefined) => (s === sealed ? 'gsk_abierta' : ''),
      seal: async () => sealed,
    });
    state.saveSettings({ ...state.settings(), apiKeySealed: sealed });

    await keys.init();

    expect(keys.get('groq')).toBe('gsk_abierta');
    expect(keys.ready()).toBe(true);
  });

  it('un vault que no puede abrir deja la key vacía, nunca revienta el arranque', async () => {
    const { keys } = setup({
      open: async () => '',
      seal: async () => null,
    });
    await keys.init();
    expect(keys.get('groq')).toBe('');
    expect(keys.ready()).toBe(true);
  });
});
