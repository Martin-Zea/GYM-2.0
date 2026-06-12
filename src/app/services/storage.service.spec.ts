import { TestBed } from '@angular/core/testing';
import { StorageService, isValidAppState } from './storage.service';
import { UIStateService } from './ui-state.service';
import { AppState, Session, SetRecord } from '../models/workout.model';

const STORAGE_KEY = 'gym_app_state_v2';

function baseState(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 4,
    days: [],
    sessions: [],
    activeDayIndex: 0,
    routinePointer: 0,
    todayProgress: {},
    settings: {
      apiKey: '',
      cohereApiKey: '',
      defaultRest: 60,
      sounds: true,
      theme: 'dark',
      userProfile: { weightKg: null, heightCm: null, age: null, sex: null, weightLog: [] },
    },
    ...overrides,
  };
}

function makeSet(exerciseId: string, setIndex: number, weight: number, reps: number): SetRecord {
  return { exerciseId, setIndex, weight, reps };
}

function makeSession(id: string, dayId: string, dateISO: string, sets: SetRecord[], skipped = false): Session {
  return skipped ? { id, dayId, dateISO, sets, skipped: true } : { id, dayId, dateISO, sets };
}

describe('StorageService', () => {
  let service: StorageService;
  let uiState: UIStateService;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(StorageService);
    uiState = TestBed.inject(UIStateService);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('validateImport()', () => {
    it('lanza Error si data no es un objeto', () => {
      expect(() => service.validateImport(null)).toThrow();
      expect(() => service.validateImport('texto')).toThrow();
      expect(() => service.validateImport(42)).toThrow();
    });

    it('lanza Error si days no es un array', () => {
      expect(() => service.validateImport({})).toThrow(/days/);
      expect(() => service.validateImport({ days: 'no-array' })).toThrow(/days/);
    });

    it('lanza Error si sessions existe y no es un array', () => {
      expect(() => service.validateImport({ days: [], sessions: {} })).toThrow(/sessions/);
    });

    it('lanza Error si todayProgress existe y no es un objeto', () => {
      expect(() => service.validateImport({ days: [], todayProgress: 'x' })).toThrow(/todayProgress/);
      expect(() => service.validateImport({ days: [], todayProgress: null })).toThrow(/todayProgress/);
    });

    it('acepta un estado válido mínimo y rellena defaults', () => {
      const result = service.validateImport({ days: [] });
      expect(result.schemaVersion).toBe(4);
      expect(result.days).toEqual([]);
      expect(result.sessions).toEqual([]);
      expect(result.todayProgress).toEqual({});
      expect(result.settings).toEqual({
        apiKey: '',
        cohereApiKey: '',
        defaultRest: 60,
        sounds: true,
        theme: 'dark',
        userProfile: { weightKg: null, heightCm: null, age: null, sex: null, weightLog: [] },
      });
    });

    it('preserva userProfile.age cuando viene en el JSON', () => {
      const result = service.validateImport({
        days: [],
        settings: { userProfile: { age: 34 } },
      });
      expect(result.settings.userProfile.age).toBe(34);
      expect(result.settings.userProfile.weightKg).toBeNull();
      expect(result.settings.userProfile.heightCm).toBeNull();
      expect(result.settings.userProfile.sex).toBeNull();
    });
  });

  describe('migración de schema (via validateImport)', () => {
    const days = [{ id: 'd1', name: 'Día 1', exercises: [] }];
    const sessions = [makeSession('s1', 'd1', '2026-06-01', [makeSet('e1', 0, 20, 10)])];

    it('migra schemaVersion 1 a 4 sin perder days ni sessions', () => {
      const result = service.validateImport({ schemaVersion: 1, days, sessions, activeDayIndex: 2 });
      expect(result.schemaVersion).toBe(4);
      expect(result.days).toEqual(days);
      expect(result.sessions).toEqual(sessions);
      // v1 no tenía routinePointer: se deriva de activeDayIndex
      expect(result.routinePointer).toBe(2);
    });

    it('migra schemaVersion 2 a 4 sin perder days ni sessions', () => {
      const result = service.validateImport({ schemaVersion: 2, days, sessions, activeDayIndex: 1 });
      expect(result.schemaVersion).toBe(4);
      expect(result.days).toEqual(days);
      expect(result.sessions).toEqual(sessions);
      expect(result.routinePointer).toBe(1);
    });

    it('v3 → v4: siembra weightLog con el peso actual y la fecha de hoy', () => {
      vi.spyOn(service, 'todayISO').mockReturnValue('2026-06-10');
      const result = service.validateImport({
        schemaVersion: 3,
        days,
        settings: {
          apiKey: '', cohereApiKey: '', defaultRest: 60, sounds: true, theme: 'dark',
          userProfile: { weightKg: 78.5, heightCm: 175, age: 34, sex: 'male' },
        },
      });
      expect(result.schemaVersion).toBe(4);
      expect(result.settings.userProfile.weightKg).toBe(78.5);
      expect(result.settings.userProfile.weightLog).toEqual([
        { dateISO: '2026-06-10', weightKg: 78.5 },
      ]);
    });

    it('v3 → v4: un JSON v3 sin weightLog ni weightKg queda con weightLog vacío', () => {
      const result = service.validateImport({
        schemaVersion: 3,
        days,
        settings: {
          apiKey: '', cohereApiKey: '', defaultRest: 60, sounds: true, theme: 'dark',
          userProfile: { weightKg: null, heightCm: null, age: null, sex: null },
        },
      });
      expect(result.schemaVersion).toBe(4);
      expect(result.settings.userProfile.weightLog).toEqual([]);
    });

    it('v1 → v4 encadena migraciones: routinePointer derivado y weightLog sembrado', () => {
      vi.spyOn(service, 'todayISO').mockReturnValue('2026-06-10');
      const result = service.validateImport({
        schemaVersion: 1,
        days,
        activeDayIndex: 3,
        settings: { userProfile: { weightKg: 80 } },
      });
      expect(result.schemaVersion).toBe(4);
      expect(result.routinePointer).toBe(3);
      expect(result.settings.userProfile.weightLog).toEqual([
        { dateISO: '2026-06-10', weightKg: 80 },
      ]);
    });

    it('v4 con weightLog existente no re-siembra ni duplica entradas', () => {
      const weightLog = [
        { dateISO: '2026-06-01', weightKg: 79 },
        { dateISO: '2026-06-08', weightKg: 78.5 },
      ];
      const result = service.validateImport({
        schemaVersion: 4,
        days,
        settings: {
          apiKey: '', cohereApiKey: '', defaultRest: 60, sounds: true, theme: 'dark',
          userProfile: { weightKg: 78.5, heightCm: null, age: null, sex: null, weightLog },
        },
      });
      expect(result.settings.userProfile.weightLog).toEqual(weightLog);
    });
  });

  describe('isValidAppState()', () => {
    it('devuelve false para null, string y número', () => {
      expect(isValidAppState(null)).toBe(false);
      expect(isValidAppState('texto')).toBe(false);
      expect(isValidAppState(42)).toBe(false);
    });

    it('devuelve false si days falta o no es un array', () => {
      expect(isValidAppState({})).toBe(false);
      expect(isValidAppState({ days: 'no-array' })).toBe(false);
    });

    it('devuelve false si sessions existe y no es un array', () => {
      expect(isValidAppState({ days: [], sessions: {} })).toBe(false);
    });

    it('devuelve false si todayProgress existe y no es un objeto', () => {
      expect(isValidAppState({ days: [], todayProgress: 'x' })).toBe(false);
      expect(isValidAppState({ days: [], todayProgress: null })).toBe(false);
    });

    it('devuelve true para un estado mínimo válido', () => {
      expect(isValidAppState({ days: [] })).toBe(true);
    });

    it('devuelve true para un backup completo válido', () => {
      expect(isValidAppState(baseState())).toBe(true);
    });
  });

  describe('load()', () => {
    it('devuelve el estado inicial sin lanzar si el JSON está corrupto', () => {
      localStorage.setItem(STORAGE_KEY, '{esto no es JSON válido');
      let state!: AppState;
      expect(() => { state = service.load(); }).not.toThrow();
      expect(state.schemaVersion).toBe(4);
      expect(state.days.length).toBe(5);
    });

    it('devuelve el estado inicial sin lanzar si el objeto no tiene la forma esperada', () => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
      let state!: AppState;
      expect(() => { state = service.load(); }).not.toThrow();
      expect(state.schemaVersion).toBe(4);
      expect(state.days.length).toBe(5);
    });

    it('carga correctamente un backup válido', () => {
      const saved = baseState({ days: [{ id: 'd1', name: 'Pecho', exercises: [] }] });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
      const state = service.load();
      expect(state.days.length).toBe(1);
      expect(state.days[0].name).toBe('Pecho');
    });
  });

  describe('save()', () => {
    it('captura QuotaExceededError, setea uiState.saveError y no propaga', () => {
      vi.spyOn(console, 'warn').mockImplementation(() => {});
      const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new DOMException('quota', 'QuotaExceededError');
      });

      expect(() => service.save(baseState())).not.toThrow();
      expect(uiState.saveError()).toContain('almacenamiento lleno');

      // Al volver a funcionar el guardado, el error se limpia
      spy.mockRestore();
      service.save(baseState());
      expect(uiState.saveError()).toBeNull();
    });
  });

  describe('weeklyStats()', () => {
    it('corta la semana en lunes: una sesión del domingo anterior queda fuera', () => {
      // 2026-06-10 es miércoles → la semana empieza el lunes 2026-06-08
      vi.spyOn(service, 'todayISO').mockReturnValue('2026-06-10');
      const state = baseState({
        sessions: [
          makeSession('dom', 'd1', '2026-06-07', [makeSet('e1', 0, 10, 10)]), // vol 100, semana pasada
          makeSession('lun', 'd1', '2026-06-08', [makeSet('e1', 0, 20, 10)]), // vol 200, esta semana
        ],
      });
      expect(service.weeklyStats(state).weeklyVolume).toBe(200);
    });

    it('cuando hoy es domingo, la semana arranca el lunes previo (UTC)', () => {
      // 2026-06-14 es domingo → la semana es 2026-06-08..2026-06-14
      vi.spyOn(service, 'todayISO').mockReturnValue('2026-06-14');
      const state = baseState({
        sessions: [
          makeSession('dom-prev', 'd1', '2026-06-07', [makeSet('e1', 0, 10, 10)]), // fuera
          makeSession('lun', 'd1', '2026-06-08', [makeSet('e1', 0, 20, 10)]),      // vol 200
          makeSession('dom-hoy', 'd1', '2026-06-14', [makeSet('e1', 0, 5, 10)]),   // vol 50
        ],
      });
      expect(service.weeklyStats(state).weeklyVolume).toBe(250);
    });

    it('calcula la racha hacia atrás desde hoy ignorando sesiones skipped', () => {
      vi.spyOn(service, 'todayISO').mockReturnValue('2026-06-10');
      const state = baseState({
        sessions: [
          makeSession('hoy', 'd1', '2026-06-10', [makeSet('e1', 0, 20, 10)]),
          makeSession('ayer', 'd1', '2026-06-09', [makeSet('e1', 0, 20, 10)]),
          makeSession('skip', 'd1', '2026-06-08', [], true), // skipped: corta la racha
        ],
      });
      expect(service.weeklyStats(state).streak).toBe(2);
    });
  });

  describe('roundToBrick()', () => {
    it('redondea al múltiplo del brick más cercano', () => {
      expect(service.roundToBrick(31, 2.5)).toBe(30);
      expect(service.roundToBrick(31.3, 2.5)).toBe(32.5);
      expect(service.roundToBrick(27, 5)).toBe(25);
      expect(service.roundToBrick(28, 5)).toBe(30);
    });

    it('sin brick válido redondea a 0.5 kg', () => {
      expect(service.roundToBrick(31.3, 0)).toBe(31.5);
      expect(service.roundToBrick(10.2, 0)).toBe(10);
    });
  });

  describe('allSessionsForDay()', () => {
    it('excluye sesiones skipped y ordena descendente por fecha', () => {
      const state = baseState({
        sessions: [
          makeSession('a', 'd1', '2026-06-01', []),
          makeSession('b', 'd1', '2026-06-05', [], true), // skipped
          makeSession('c', 'd1', '2026-06-03', []),
          makeSession('d', 'd2', '2026-06-04', []),       // otro día
        ],
      });
      const result = service.allSessionsForDay(state, 'd1');
      expect(result.map(s => s.id)).toEqual(['c', 'a']);
    });
  });

  describe('historyForExercise()', () => {
    it('excluye sesiones skipped y calcula topWeight/volume por sesión', () => {
      const state = baseState({
        sessions: [
          makeSession('s1', 'd1', '2026-06-01', [makeSet('e1', 0, 20, 10), makeSet('e1', 1, 22.5, 8)]),
          makeSession('s2', 'd1', '2026-06-03', [], true), // skipped
          makeSession('s3', 'd1', '2026-06-05', [makeSet('e1', 0, 25, 6), makeSet('e2', 0, 99, 5)]),
        ],
      });
      const history = service.historyForExercise(state, 'e1');
      expect(history.length).toBe(2);
      // Orden ascendente por fecha
      expect(history.map(h => h.dateISO)).toEqual(['2026-06-01', '2026-06-05']);
      expect(history[0].topWeight).toBe(22.5);
      expect(history[0].totalReps).toBe(18);
      expect(history[0].volume).toBe(20 * 10 + 22.5 * 8);
      // Solo sets del ejercicio pedido
      expect(history[1].sets.every(s => s.exerciseId === 'e1')).toBe(true);
      expect(history[1].volume).toBe(150);
    });
  });
});
