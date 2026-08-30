import { Exercise, ExerciseUnit, Session, SetRecord } from '../models/workout.model';
import {
  hasWork,
  sessionDurationMinutes,
  sessionTonnage,
  tonnageOf,
  unitWeightFactor,
  workingSets,
} from './session';

function ex(id: string, unit: ExerciseUnit): Exercise {
  return {
    id,
    name: id,
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 10,
    restSeconds: 90,
    unit,
    notes: '',
  };
}

function set(exerciseId: string, weight: number, reps: number, isWarmup = false): SetRecord {
  return { exerciseId, setIndex: 0, weight, reps, isWarmup };
}

function session(over: Partial<Session> = {}): Session {
  return { id: 's1', dayId: 'd1', dateISO: '2026-08-01', sets: [], ...over };
}

describe('unitWeightFactor() — audit.md R-4', () => {
  it('las unidades por mano y por brazo cuentan doble', () => {
    expect(unitWeightFactor('KG_PER_HAND')).toBe(2);
    expect(unitWeightFactor('KG_PER_ARM')).toBe(2);
  });

  it('el resto cuenta una vez', () => {
    expect(unitWeightFactor('KG')).toBe(1);
    expect(unitWeightFactor('BODYWEIGHT')).toBe(1);
    expect(unitWeightFactor('TIME')).toBe(1);
  });
});

describe('tonnageOf()', () => {
  const catalog = [ex('barra', 'KG'), ex('mancuernas', 'KG_PER_HAND'), ex('plancha', 'TIME')];

  it('suma peso × reps', () => {
    expect(tonnageOf([set('barra', 100, 5)], catalog)).toBe(500);
  });

  it('una mancuerna de 20 kg por mano son 40 kg movidos', () => {
    expect(tonnageOf([set('mancuernas', 20, 10)], catalog)).toBe(400);
  });

  it('los ejercicios por tiempo no suman tonelaje: sus reps son segundos', () => {
    expect(tonnageOf([set('plancha', 0, 60)], catalog)).toBe(0);
    expect(tonnageOf([set('plancha', 10, 60)], catalog)).toBe(0);
  });

  it('un ejercicio que ya no está en el catálogo cuenta sin factor, no se pierde', () => {
    expect(tonnageOf([set('borrado', 50, 4)], catalog)).toBe(200);
  });

  it('sessionTonnage suma todas las series de la sesión', () => {
    const s = session({ sets: [set('barra', 100, 5), set('mancuernas', 20, 10)] });
    expect(sessionTonnage(s, catalog)).toBe(900);
  });
});

describe('workingSets()', () => {
  it('el calentamiento no cuenta como trabajo', () => {
    const sets = [set('barra', 40, 10, true), set('barra', 100, 5)];
    expect(workingSets(sets)).toHaveLength(1);
    expect(workingSets(sets)[0].weight).toBe(100);
  });
});

describe('sessionDurationMinutes() — RF-SES-08b, R-5', () => {
  it('calcula los minutos entre inicio y fin', () => {
    const s = session({
      startedAt: '2026-08-01T10:00:00.000Z',
      endedAt: '2026-08-01T11:05:00.000Z',
    });
    expect(sessionDurationMinutes(s)).toBe(65);
  });

  it('sin marcas de tiempo devuelve null, NUNCA cero', () => {
    // Todo el historial anterior a v7 cae aquí: "0 min" sería un dato inventado
    expect(sessionDurationMinutes(session())).toBeNull();
    expect(sessionDurationMinutes(session({ startedAt: '2026-08-01T10:00:00.000Z' }))).toBeNull();
    expect(sessionDurationMinutes(session({ endedAt: '2026-08-01T11:00:00.000Z' }))).toBeNull();
  });

  it('descarta fechas corruptas o invertidas en vez de devolver un número absurdo', () => {
    expect(sessionDurationMinutes(session({ startedAt: 'ayer', endedAt: 'hoy' }))).toBeNull();
    expect(
      sessionDurationMinutes(
        session({ startedAt: '2026-08-01T11:00:00.000Z', endedAt: '2026-08-01T10:00:00.000Z' }),
      ),
    ).toBeNull();
  });
});

describe('hasWork()', () => {
  it('una sesión saltada o vacía no cuenta como trabajo', () => {
    expect(hasWork(session({ skipped: true, sets: [set('barra', 100, 5)] }))).toBe(false);
    expect(hasWork(session())).toBe(false);
    expect(hasWork(session({ sets: [set('barra', 100, 5)] }))).toBe(true);
  });
});
