import { TestBed } from '@angular/core/testing';
import { FLAGS, PREMIGRATION_KEY, StorageService } from './storage.service';
import { GT_KEYS, StorageAdapter } from './storage-adapter';
import { STORAGE_KEYS } from './storage-keys';
import { TabLockService } from './tab-lock.service';
import { AppState } from '../models/workout.model';

/** Estado v6 tal como lo tendría hoy un usuario real, con unidades en español. */
function legacyV6(): Record<string, unknown> {
  return {
    schemaVersion: 6,
    exercises: [
      {
        id: 'e1',
        name: 'Press Banca',
        brick: 2.5,
        defaultSets: 4,
        defaultRepTarget: 8,
        restSeconds: 120,
        unit: 'kg',
        notes: '',
      },
      {
        id: 'e2',
        name: 'Remo Unilateral',
        brick: 2.5,
        defaultSets: 3,
        defaultRepTarget: 10,
        restSeconds: 90,
        unit: 'kg por brazo',
        notes: '',
      },
      {
        id: 'e3',
        name: 'Plancha',
        brick: 0,
        defaultSets: 3,
        defaultRepTarget: 45,
        restSeconds: 60,
        unit: 'tiempo',
        notes: '',
      },
      {
        id: 'e4',
        name: 'Dominadas',
        brick: 0,
        defaultSets: 4,
        defaultRepTarget: 6,
        restSeconds: 120,
        unit: 'peso corporal',
        notes: '',
      },
    ],
    days: [{ id: 'd1', name: 'Pecho', exerciseIds: ['e1', 'e2', 'e3', 'e4'] }],
    sessions: [
      {
        id: 's1',
        dayId: 'd1',
        dateISO: '2026-08-20',
        sets: [{ exerciseId: 'e1', setIndex: 0, weight: 80, reps: 8 }],
      },
    ],
    activeDayIndex: 0,
    routinePointer: 3,
    todayProgress: {},
    settings: {
      apiKey: 'gsk-secreta',
      cohereApiKey: 'co-secreta',
      defaultRest: 90,
      sounds: true,
      haptics: false,
      theme: 'dark',
      barWeightKg: 20,
      platesKg: [20, 10, 5],
      userProfile: {
        weightKg: 78,
        heightCm: 180,
        age: 34,
        sex: 'male',
        weightLog: [{ dateISO: '2026-08-01', weightKg: 79 }],
        goal: 'hypertrophy',
        aiNotes: 'hombro derecho sensible',
      },
    },
  };
}

describe('Migración del blob v6 al conjunto gt_* (T-102)', () => {
  let storage: StorageService;
  let adapter: StorageAdapter;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    storage = TestBed.inject(StorageService);
    adapter = TestBed.inject(StorageAdapter);
  });

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
    vi.restoreAllMocks();
  });

  const seedLegacy = (state: Record<string, unknown> = legacyV6()): void => {
    localStorage.setItem(STORAGE_KEYS.appState, JSON.stringify(state));
  };

  it('detecta que hay estado viejo por migrar', () => {
    expect(storage.needsPartitionMigration()).toBe(false);
    seedLegacy();
    expect(storage.needsPartitionMigration()).toBe(true);
  });

  it('reparte el estado en las particiones gt_* sin perder nada', async () => {
    seedLegacy();
    const before = storage.load();

    expect(await storage.runPartitionMigration(before)).toBe('migrated');

    const after = storage.load();
    expect(after.days).toEqual(before.days);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.exercises).toEqual(before.exercises);
    expect(after.routinePointer).toBe(3);
    expect(after.settings.defaultRest).toBe(90);
    expect(after.settings.platesKg).toEqual([20, 10, 5]);
    expect(after.settings.userProfile.weightKg).toBe(78);
    expect(after.settings.userProfile.weightLog).toEqual([{ dateISO: '2026-08-01', weightKg: 79 }]);
    expect(after.settings.userProfile.aiNotes).toBe('hombro derecho sensible');
    expect(after.settings.apiKey).toBe('gsk-secreta');
    expect(after.settings.cohereApiKey).toBe('co-secreta');
  });

  it('cada dato queda en su partición: el peso corporal en gt_body, las keys en gt_ai', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());

    expect(adapter.read(GT_KEYS.body)).toEqual({
      weightLog: [{ dateISO: '2026-08-01', weightKg: 79 }],
    });
    expect(adapter.read(GT_KEYS.ai)).toEqual({
      keys: { groq: 'gsk-secreta', cohere: 'co-secreta' },
    });
    // Las keys NO se duplican en gt_settings: una sola fuente por dato (RF-STO-05b/T-407)
    expect(JSON.stringify(adapter.read(GT_KEYS.settings))).not.toContain('gsk-secreta');
  });

  it('R-4: convierte las unidades al enum neutro conservando el significado', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());

    const units = storage.load().exercises.map((e) => e.unit);
    expect(units).toEqual(['KG', 'KG_PER_ARM', 'TIME', 'BODYWEIGHT']);
  });

  it('R-3: los ejercicios conservan su id, así el historial no se desancla', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());

    const state = storage.load();
    expect(state.exercises.map((e) => e.id)).toEqual(['e1', 'e2', 'e3', 'e4']);
    expect(state.sessions[0].sets[0].exerciseId).toBe('e1');
    expect(state.days[0].exerciseIds).toEqual(['e1', 'e2', 'e3', 'e4']);
  });

  it('deja una copia pre-migración antes de tocar nada', async () => {
    const original = JSON.stringify(legacyV6());
    localStorage.setItem(STORAGE_KEYS.appState, original);

    await storage.runPartitionMigration(storage.load());

    expect(localStorage.getItem(PREMIGRATION_KEY)).toBe(original);
  });

  it('sin copia posible NO migra: mejor no migrar que migrar sin red', async () => {
    seedLegacy();
    const state = storage.load();
    // Ni IndexedDB (ausente en jsdom) ni localStorage aceptan la copia
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('lleno', 'QuotaExceededError');
    });

    expect(await storage.runPartitionMigration(state)).toBe('no-backup');

    vi.restoreAllMocks();
    // El blob viejo sigue siendo la verdad y nada se escribió en gt_*
    expect(localStorage.getItem(STORAGE_KEYS.appState)).not.toBeNull();
    expect(adapter.hasData()).toBe(false);
  });

  it('R-7: invalida la caché de IA, que indexa por exerciseId', async () => {
    seedLegacy();
    localStorage.setItem(STORAGE_KEYS.aiCache, JSON.stringify({ e1: { rec: {} } }));

    await storage.runPartitionMigration(storage.load());

    expect(localStorage.getItem(STORAGE_KEYS.aiCache)).toBeNull();
  });

  it('mueve las banderas de onboarding y legal a gt_meta', async () => {
    seedLegacy();
    localStorage.setItem(STORAGE_KEYS.onboardingDone, '1');
    localStorage.setItem(STORAGE_KEYS.legalAccepted, '1');

    await storage.runPartitionMigration(storage.load());

    expect(adapter.readMeta()?.flags).toEqual({ onboardingDone: '1', legalAccepted: '1' });
    expect(localStorage.getItem(STORAGE_KEYS.onboardingDone)).toBeNull();
    // Y se siguen leyendo igual desde la app
    expect(storage.getFlag(FLAGS.onboardingDone, STORAGE_KEYS.onboardingDone)).toBe(true);
  });

  it('el blob viejo deja de ser la verdad una vez migrado', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());

    expect(localStorage.getItem(STORAGE_KEYS.appState)).toBeNull();
    expect(storage.needsPartitionMigration()).toBe(false);
  });

  it('correr la migración dos veces no duplica ni pisa nada', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());
    const afterFirst = storage.load();

    expect(await storage.runPartitionMigration(afterFirst)).toBe('skipped');
    expect(storage.load()).toEqual(afterFirst);
  });

  it('tras migrar, guardar escribe en gt_* y no resucita el blob viejo', async () => {
    seedLegacy();
    await storage.runPartitionMigration(storage.load());

    const state: AppState = { ...storage.load(), routinePointer: 9 };
    expect(storage.save(state)).toEqual({ ok: true });

    expect(localStorage.getItem(STORAGE_KEYS.appState)).toBeNull();
    expect(storage.load().routinePointer).toBe(9);
    expect(adapter.readMeta()?.generation).toBeGreaterThan(1);
  });

  it('antes de migrar, guardar sigue escribiendo el blob viejo (nada se pierde)', () => {
    seedLegacy();
    const state: AppState = { ...storage.load(), routinePointer: 5 };

    expect(storage.save(state)).toEqual({ ok: true });

    expect(localStorage.getItem(STORAGE_KEYS.appState)).not.toBeNull();
    expect(storage.load().routinePointer).toBe(5);
  });
});
