import { validateMigratedState, validateRawState } from './state-schema';
import { createInitialState } from '../data/initial-data';

describe('state-schema', () => {
  describe('validateRawState() — tolerante, corre ANTES de migrar', () => {
    it('acepta el estado mínimo que aceptaba la validación vieja', () => {
      expect(validateRawState({ days: [] }).ok).toBe(true);
    });

    it('acepta la forma pre-v5 con ejercicios embebidos en cada día', () => {
      const v4 = {
        schemaVersion: 4,
        days: [
          {
            id: 'd1',
            name: 'Pecho',
            exercises: [{ id: 'e1', name: 'Press banca', brick: 2.5 }],
          },
        ],
      };

      // Si esto fallara, migrar el estado sano de un usuario v4 lo mandaría a
      // cuarentena. Es exactamente el riesgo R-2.
      expect(validateRawState(v4).ok).toBe(true);
    });

    it('acepta la forma v5+ con exerciseIds', () => {
      const v6 = {
        schemaVersion: 6,
        days: [{ id: 'd1', name: 'Pecho', exerciseIds: ['e1'] }],
        exercises: [{ id: 'e1', name: 'Press banca' }],
      };
      expect(validateRawState(v6).ok).toBe(true);
    });

    it('rechaza cuando days no es un array', () => {
      const r = validateRawState({ days: 'nope' });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe('days');
    });

    it('detecta tipos internos rotos que la validación superficial dejaba pasar', () => {
      const corrupto = {
        days: [{ id: 'd1', name: 'Pecho', exerciseIds: ['e1'] }],
        sessions: [
          {
            id: 's1',
            dayId: 'd1',
            dateISO: '2026-08-01',
            sets: [{ exerciseId: 'e1', setIndex: 0, weight: 'mucho', reps: 8 }],
          },
        ],
      };

      const r = validateRawState(corrupto);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe('sessions[0].sets[0].weight');
    });

    it('rechaza una sesión sin array de sets', () => {
      const r = validateRawState({
        days: [],
        sessions: [{ id: 's1', dayId: 'd1', dateISO: '2026-08-01', sets: {} }],
      });
      expect(r.ok).toBe(false);
    });

    it('rechaza un weightLog que no es array', () => {
      const r = validateRawState({
        days: [],
        settings: { userProfile: { weightLog: 'x' } },
      });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe('settings.userProfile.weightLog');
    });

    it('no acumula un informe ilimitado ante basura masiva', () => {
      const days = Array.from({ length: 500 }, () => ({ id: 1, name: 2 }));
      const r = validateRawState({ days });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues.length).toBeLessThanOrEqual(20);
    });
  });

  describe('validateMigratedState() — estricta, postcondición de la migración', () => {
    it('acepta el estado inicial que genera la app', () => {
      const r = validateMigratedState(createInitialState());
      if (!r.ok) console.error(r.issues);
      expect(r.ok).toBe(true);
    });

    it('rechaza un día que quedó con ejercicios embebidos (pre-v5 sin migrar)', () => {
      const state = createInitialState() as unknown as Record<string, unknown>;
      const days = state['days'] as Record<string, unknown>[];
      days[0]['exercises'] = [];

      const r = validateMigratedState(state);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].message).toContain('pre-v5');
    });

    it('rechaza una unidad desconocida', () => {
      const state = createInitialState();
      state.exercises[0] = { ...state.exercises[0], unit: 'libras' as never };

      const r = validateMigratedState(state);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.issues[0].path).toBe('exercises[0].unit');
    });

    it('rechaza settings sin los campos obligatorios', () => {
      const state = createInitialState() as unknown as Record<string, unknown>;
      state['settings'] = { userProfile: {} };

      expect(validateMigratedState(state).ok).toBe(false);
    });
  });
});
