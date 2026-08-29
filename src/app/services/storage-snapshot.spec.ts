import { TestBed } from '@angular/core/testing';
import { StorageService } from './storage.service';
import { IdbService } from './idb';
import { STORAGE_KEYS } from './storage-keys';
import { TabLockService } from './tab-lock.service';

/**
 * jsdom no trae IndexedDB, así que se sustituye `IdbService` por un almacén en memoria.
 * Sin esto no se puede probar lo que más importa de R-7: restaurar un snapshot escrito
 * por una versión anterior del esquema sin revertir el esquema en silencio.
 */
class FakeIdb extends IdbService {
  readonly store = new Map<string, unknown>();

  override put(s: string, k: string, v: unknown): Promise<boolean> {
    this.store.set(`${s}/${k}`, v);
    return Promise.resolve(true);
  }

  override get<T>(s: string, k: string): Promise<T | null> {
    return Promise.resolve((this.store.get(`${s}/${k}`) as T) ?? null);
  }

  override keys(s: string): Promise<string[]> {
    return Promise.resolve(
      [...this.store.keys()].filter((k) => k.startsWith(`${s}/`)).map((k) => k.slice(s.length + 1)),
    );
  }

  override delete(s: string, k: string): Promise<void> {
    this.store.delete(`${s}/${k}`);
    return Promise.resolve();
  }
}

/** Snapshot tal como lo habría escrito la app antes de v7: unidades en español. */
function snapshotV6(): Record<string, unknown> {
  return {
    schemaVersion: 6,
    exercises: [
      {
        id: 'e1',
        name: 'Remo',
        brick: 2.5,
        defaultSets: 3,
        defaultRepTarget: 10,
        restSeconds: 90,
        unit: 'kg por brazo',
        notes: '',
      },
    ],
    days: [{ id: 'd1', name: 'Espalda', exerciseIds: ['e1'] }],
    sessions: [
      {
        id: 's1',
        dayId: 'd1',
        dateISO: '2026-07-15',
        sets: [{ exerciseId: 'e1', setIndex: 0, weight: 30, reps: 10 }],
      },
    ],
    activeDayIndex: 0,
    routinePointer: 1,
    todayProgress: {},
    settings: {
      apiKey: '',
      cohereApiKey: '',
      defaultRest: 60,
      sounds: true,
      haptics: true,
      theme: 'dark',
      userProfile: {
        weightKg: null,
        heightCm: null,
        age: null,
        sex: null,
        weightLog: [],
        goal: null,
        aiNotes: '',
      },
    },
  };
}

describe('Snapshots entre versiones de esquema (T-106, audit.md R-7)', () => {
  let storage: StorageService;
  let idb: FakeIdb;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    TestBed.configureTestingModule({ providers: [{ provide: IdbService, useClass: FakeIdb }] });
    idb = TestBed.inject(IdbService) as FakeIdb;
    storage = TestBed.inject(StorageService);
  });

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
    vi.restoreAllMocks();
  });

  it('un snapshot v6 restaurado en v7 pasa por migrate() antes de adoptarse', async () => {
    idb.store.set('snapshots/2026-07-15', {
      dateISO: '2026-07-15',
      savedAt: Date.now(),
      state: snapshotV6(),
    });

    const restored = await storage.getSnapshot('2026-07-15');

    expect(restored).not.toBeNull();
    // Sin la migración, restaurar revertiría el esquema en silencio
    expect(restored!.schemaVersion).toBe(7);
    expect(restored!.exercises[0].unit).toBe('KG_PER_ARM');
    expect(restored!.sessions[0].sets[0].weight).toBe(30);
  });

  it('un snapshot corrupto se rechaza en vez de adoptarse', async () => {
    idb.store.set('snapshots/roto', {
      dateISO: 'roto',
      savedAt: Date.now(),
      state: { days: 'nope' },
    });

    expect(await storage.getSnapshot('roto')).toBeNull();
  });

  it('writeSnapshot informa si realmente escribió', async () => {
    await expect(storage.writeSnapshot(storage.load(), 'x')).resolves.toBe(true);
  });

  it('la migración a gt_* deja su snapshot previo antes de tocar nada', async () => {
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(snapshotV6()));
    const before = storage.load();

    expect(await storage.runPartitionMigration(before)).toBe('migrated');

    const snapshots = await storage.listSnapshots();
    expect(snapshots.some((k) => k.endsWith('-pre-v7'))).toBe(true);
  });

  it('con IndexedDB disponible, el snapshot es condición suficiente para migrar', async () => {
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(snapshotV6()));
    const before = storage.load();
    // Aunque la copia en localStorage no entre, el snapshot ya es red de seguridad
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      if (k === 'gt_premigration_v6') throw new DOMException('lleno', 'QuotaExceededError');
      real.call(this, k, v);
    });

    expect(await storage.runPartitionMigration(before)).toBe('migrated');
  });
});
