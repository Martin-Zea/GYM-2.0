import { TestBed } from '@angular/core/testing';
import { BackupService } from './backup.service';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import { TabLockService } from './tab-lock.service';
import { buildBackup, canonicalJson, checksumOf, parseBackup } from './backup-format';
import { mergeStates } from './backup-merge';
import { AppState, Exercise, Session, StoredWorkoutDay } from '../models/workout.model';

function ex(id: string, name: string): Exercise {
  return {
    id,
    name,
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
  };
}

function day(id: string, name: string, exerciseIds: string[]): StoredWorkoutDay {
  return { id, name, exerciseIds };
}

function session(id: string, dayId: string, dateISO: string, exerciseId: string): Session {
  return { id, dayId, dateISO, sets: [{ exerciseId, setIndex: 0, weight: 60, reps: 8 }] };
}

function state(overrides: Partial<AppState> = {}): AppState {
  return {
    schemaVersion: 10,
    exercises: [],
    days: [],
    sessions: [],
    routines: [{ id: 'r1', name: '', dayIds: [] }],
    activeRoutineId: 'r1',
    activeDayIndex: 0,
    routinePointer: 0,
    todayProgress: {},
    trash: [],
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
        level: null,
        equipment: null,
        daysPerWeek: null,
        aiNotes: '',
      },
    },
    ...overrides,
  };
}

describe('Formato de backup (RF-STO-05)', () => {
  it('el checksum no depende del orden de las claves', () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
    expect(checksumOf({ b: 1, a: 2 })).toBe(checksumOf({ a: 2, b: 1 }));
  });

  it('el checksum cambia si cambia un dato', () => {
    expect(checksumOf({ peso: 60 })).not.toBe(checksumOf({ peso: 61 }));
  });

  it('por defecto el export NO lleva las keys de IA (R-8)', () => {
    const withKeys = state({
      settings: { ...state().settings, apiKey: 'gsk-secreta', cohereApiKey: 'co-secreta' },
    });

    const envelope = buildBackup(withKeys, { appVersion: '1.4.0', includeCredentials: false });

    expect(envelope.includesCredentials).toBe(false);
    expect(envelope.state.settings.apiKey).toBe('');
    expect(JSON.stringify(envelope)).not.toContain('gsk-secreta');
  });

  it('con la opción explícita, las incluye', () => {
    const withKeys = state({ settings: { ...state().settings, apiKey: 'gsk-secreta' } });

    const envelope = buildBackup(withKeys, { appVersion: '1.4.0', includeCredentials: true });

    expect(envelope.includesCredentials).toBe(true);
    expect(envelope.state.settings.apiKey).toBe('gsk-secreta');
  });

  it('un backup íntegro se abre y devuelve su estado', () => {
    const envelope = buildBackup(state({ routinePointer: 4 }), {
      appVersion: '1.4.0',
      includeCredentials: false,
    });

    const parsed = parseBackup(JSON.parse(JSON.stringify(envelope)));

    expect(parsed.legacy).toBe(false);
    expect((parsed.state as AppState).routinePointer).toBe(4);
  });

  it('un backup manipulado o truncado se rechaza por checksum', () => {
    const envelope = buildBackup(state(), { appVersion: '1.4.0', includeCredentials: false });
    const dañado = { ...envelope, state: { ...envelope.state, routinePointer: 99 } };

    expect(() => parseBackup(dañado)).toThrow(/checksum/i);
  });

  it('acepta backups del formato anterior, sin sobre', () => {
    const viejo = { ...state(), exportedAt: '2026-01-01', appVersion: '2.0' };

    const parsed = parseBackup(viejo);

    expect(parsed.legacy).toBe(true);
    expect((parsed.state as AppState).schemaVersion).toBe(10);
  });

  it('avisa cuando un backup viejo trae credenciales adentro (R-8)', () => {
    const viejo = { ...state({ settings: { ...state().settings, apiKey: 'gsk-vieja' } }) };

    expect(parseBackup(viejo).includesCredentials).toBe(true);
  });
});

describe('Fusión de backups (RF-STO-05, audit.md R-6)', () => {
  it('reconoce el mismo ejercicio por nombre y conserva el id local', () => {
    const local = state({ exercises: [ex('local1', 'Press Banca')] });
    const incoming = state({ exercises: [ex('otro9', 'press  bancá')] });

    const { state: merged, summary } = mergeStates(local, incoming);

    expect(merged.exercises).toHaveLength(1);
    expect(merged.exercises[0].id).toBe('local1');
    expect(summary.exercisesMatched).toBe(1);
    expect(summary.exercisesAdded).toBe(0);
  });

  it('NO fusiona por id: dos ejercicios distintos con el mismo id quedan separados', () => {
    // El escenario que hace peligrosa la fusión por id: `uid()` genera 7 caracteres
    // aleatorios en ambos dispositivos, así que la coincidencia es posible.
    const local = state({ exercises: [ex('abc1234', 'Sentadilla')] });
    const incoming = state({ exercises: [ex('abc1234', 'Peso Muerto')] });

    const { state: merged, summary } = mergeStates(local, incoming);

    expect(merged.exercises).toHaveLength(2);
    expect(merged.exercises.map((e) => e.name).sort()).toEqual(['Peso Muerto', 'Sentadilla']);
    // El entrante tuvo que recibir un id nuevo para no pisar al local
    expect(merged.exercises[1].id).not.toBe('abc1234');
    expect(summary.idsRemapped).toBe(1);
  });

  it('las sesiones del backup apuntan al ejercicio correcto tras el remapeo', () => {
    const local = state({ exercises: [ex('abc1234', 'Sentadilla')] });
    const incoming = state({
      exercises: [ex('abc1234', 'Peso Muerto')],
      days: [day('d9', 'Pierna', ['abc1234'])],
      sessions: [session('s9', 'd9', '2026-08-01', 'abc1234')],
    });

    const { state: merged } = mergeStates(local, incoming);

    const pesoMuerto = merged.exercises.find((e) => e.name === 'Peso Muerto')!;
    // El historial importado sigue al ejercicio importado, no al local homónimo por id
    expect(merged.sessions[0].sets[0].exerciseId).toBe(pesoMuerto.id);
    expect(merged.days[0].exerciseIds).toEqual([pesoMuerto.id]);
  });

  it('no duplica una sesión que ya existe para ese día y fecha', () => {
    const local = state({
      exercises: [ex('e1', 'Press')],
      days: [day('d1', 'Pecho', ['e1'])],
      sessions: [session('s1', 'd1', '2026-08-01', 'e1')],
    });
    const incoming = state({
      exercises: [ex('otro', 'Press')],
      days: [day('dX', 'Pecho', ['otro'])],
      sessions: [
        session('sX', 'dX', '2026-08-01', 'otro'),
        session('sY', 'dX', '2026-08-03', 'otro'),
      ],
    });

    const { state: merged, summary } = mergeStates(local, incoming);

    expect(merged.sessions).toHaveLength(2);
    expect(summary.sessionsSkipped).toBe(1);
    expect(summary.sessionsAdded).toBe(1);
    expect(merged.sessions.map((s) => s.dateISO)).toEqual(['2026-08-01', '2026-08-03']);
  });

  it('fusionar nunca pisa las preferencias ni las keys locales', () => {
    const local = state({
      settings: { ...state().settings, theme: 'light', apiKey: 'mia', defaultRest: 45 },
    });
    const incoming = state({
      settings: { ...state().settings, theme: 'dark', apiKey: 'ajena', defaultRest: 180 },
    });

    const { state: merged } = mergeStates(local, incoming);

    expect(merged.settings.theme).toBe('light');
    expect(merged.settings.apiKey).toBe('mia');
    expect(merged.settings.defaultRest).toBe(45);
  });

  it('suma el peso corporal que falta sin duplicar fechas', () => {
    const withLog = (log: { dateISO: string; weightKg: number }[]): AppState =>
      state({
        settings: {
          ...state().settings,
          userProfile: { ...state().settings.userProfile, weightLog: log },
        },
      });
    const local = withLog([{ dateISO: '2026-08-01', weightKg: 80 }]);
    const incoming = withLog([
      { dateISO: '2026-08-01', weightKg: 99 },
      { dateISO: '2026-07-01', weightKg: 82 },
    ]);

    const { state: merged, summary } = mergeStates(local, incoming);

    expect(merged.settings.userProfile.weightLog).toEqual([
      { dateISO: '2026-07-01', weightKg: 82 },
      { dateISO: '2026-08-01', weightKg: 80 },
    ]);
    expect(summary.weightEntriesAdded).toBe(1);
  });

  it('un día con el mismo nombre suma los ejercicios que le faltaban', () => {
    const local = state({
      exercises: [ex('e1', 'Press')],
      days: [day('d1', 'Pecho', ['e1'])],
    });
    const incoming = state({
      exercises: [ex('e1', 'Press'), ex('e2', 'Aperturas')],
      days: [day('dX', 'Pecho', ['e1', 'e2'])],
    });

    const { state: merged, summary } = mergeStates(local, incoming);

    expect(merged.days).toHaveLength(1);
    expect(merged.days[0].id).toBe('d1');
    expect(merged.days[0].exerciseIds).toEqual(['e1', 'e2']);
    expect(summary.daysMatched).toBe(1);
  });
});

describe('BackupService.applyBackup (EA-5)', () => {
  let backup: BackupService;
  let stateService: StateService;

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    backup = TestBed.inject(BackupService);
    stateService = TestBed.inject(StateService);
    TestBed.inject(StorageService);
  });

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
    vi.restoreAllMocks();
  });

  it('un archivo dañado se rechaza y los datos actuales quedan intactos', () => {
    const antes = stateService.state();

    expect(() => backup.applyBackup('{no es json', 'replace')).toThrow();
    expect(() => backup.applyBackup(JSON.stringify({ days: 'roto' }), 'replace')).toThrow();

    expect(stateService.state()).toEqual(antes);
  });

  it('reemplazar sustituye el estado completo', () => {
    const envelope = buildBackup(state({ routinePointer: 7 }), {
      appVersion: '1.4.0',
      includeCredentials: false,
    });

    const outcome = backup.applyBackup(JSON.stringify(envelope), 'replace');

    expect(outcome.mode).toBe('replace');
    expect(stateService.state().routinePointer).toBe(7);
    expect(stateService.state().days).toHaveLength(0);
  });

  it('fusionar conserva lo local y devuelve el resumen de lo importado', () => {
    const diasLocales = stateService.days().length;
    const envelope = buildBackup(
      state({
        exercises: [ex('nuevo1', 'Ejercicio Importado')],
        days: [day('dN', 'Día Nuevo', ['nuevo1'])],
      }),
      { appVersion: '1.4.0', includeCredentials: false },
    );

    const outcome = backup.applyBackup(JSON.stringify(envelope), 'merge');

    expect(outcome.summary?.exercisesAdded).toBe(1);
    expect(outcome.summary?.daysAdded).toBe(1);
    expect(stateService.days()).toHaveLength(diasLocales + 1);
  });
});
