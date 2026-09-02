import { AppState, Exercise, Session, SetRecord } from '../models/workout.model';
import { MuscleGroup } from '../data/exercise-catalog';
import {
  buildMultiChart,
  comparePeriods,
  dashboardKpis,
  groupSeriesByWeek,
  indexSetsByExercise,
  realSessions,
} from './dashboard';

function ex(id: string, name = id): Exercise {
  return {
    id,
    name,
    brick: 2.5,
    defaultSets: 3,
    defaultRepTarget: 8,
    restSeconds: 90,
    unit: 'KG',
    notes: '',
  };
}

function set(exerciseId: string, weight: number, reps: number, isWarmup = false): SetRecord {
  return { exerciseId, setIndex: 0, weight, reps, isWarmup };
}

function session(dateISO: string, sets: SetRecord[], extra: Partial<Session> = {}): Session {
  return { id: dateISO + Math.random(), dayId: 'd1', dateISO, sets, ...extra };
}

function state(sessions: Session[], exercises: Exercise[] = [ex('e1'), ex('e2')]): AppState {
  return { exercises, sessions } as AppState;
}

describe('realSessions()', () => {
  it('descarta las saltadas y las vacías', () => {
    const all = [
      session('2026-09-01', [set('e1', 50, 5)]),
      session('2026-09-02', [], { skipped: true }),
      session('2026-09-03', []),
    ];
    expect(realSessions(all)).toHaveLength(1);
  });
});

describe('comparePeriods()', () => {
  it('calcula la variación porcentual', () => {
    expect(comparePeriods(120, 100)).toEqual({ value: 120, deltaPct: 20 });
    expect(comparePeriods(80, 100)).toEqual({ value: 80, deltaPct: -20 });
  });

  /**
   * Pasar de nada a algo no es "un aumento del 100 %": es que no había con qué comparar.
   * Inventar un número ahí es lo que hace desconfiar de un panel entero.
   */
  it('sin periodo anterior no inventa una variación', () => {
    expect(comparePeriods(120, 0)).toEqual({ value: 120, deltaPct: null });
    expect(comparePeriods(0, 0)).toEqual({ value: 0, deltaPct: null });
  });

  /**
   * "−100 %" es correcto y engañoso: sugiere un desplome cuando lo que hay es un hueco.
   * Una semana sin entrenar se dice, no se convierte en un porcentaje.
   */
  it('una semana a cero no es un desplome del 100 %', () => {
    expect(comparePeriods(0, 5000)).toEqual({ value: 0, deltaPct: null });
  });

  it('acota las variaciones absurdas de volver de una semana casi vacía', () => {
    expect(comparePeriods(200000, 1).deltaPct).toBe(999);
    expect(comparePeriods(1, 200000).deltaPct).toBe(-100);
  });
});

describe('dashboardKpis()', () => {
  it('compara la ventana actual con la inmediatamente anterior', () => {
    const s = state([
      // Semana actual (5–11 sep, hoy = 11): 2 sesiones, 3 series.
      session('2026-09-06', [set('e1', 50, 5), set('e1', 50, 5)]),
      session('2026-09-10', [set('e1', 50, 5)]),
      // Semana anterior (29 ago – 4 sep): 1 sesión, 1 serie.
      session('2026-09-02', [set('e1', 50, 5)]),
    ]);
    const kpis = dashboardKpis(s, '2026-09-11', 7);
    expect(kpis.sessions).toEqual({ value: 2, deltaPct: 100 });
    expect(kpis.sets).toEqual({ value: 3, deltaPct: 200 });
    expect(kpis.volumeKg.value).toBe(750);
  });

  it('las series de calentamiento no cuentan como trabajo', () => {
    const s = state([session('2026-09-10', [set('e1', 50, 5), set('e1', 20, 10, true)])]);
    expect(dashboardKpis(s, '2026-09-11', 7).sets.value).toBe(1);
  });

  it('sin historial previo no hay variación que enseñar', () => {
    const s = state([session('2026-09-10', [set('e1', 50, 5)])]);
    expect(dashboardKpis(s, '2026-09-11', 7).sessions.deltaPct).toBeNull();
  });
});

describe('groupSeriesByWeek()', () => {
  const groupOf = (e: Exercise): MuscleGroup | null =>
    e.id === 'e1' ? ('chest' as MuscleGroup) : ('legs' as MuscleGroup);

  it('cuenta series por grupo y por semana, ordenando por la última', () => {
    const s = state([
      session('2026-09-01', [set('e1', 50, 5), set('e1', 50, 5)]), // semana del 31 ago
      session('2026-09-08', [set('e1', 50, 5), set('e2', 80, 5), set('e2', 80, 5)]), // del 7 sep
    ]);
    const series = groupSeriesByWeek(s, groupOf, '2026-08-31', '2026-09-11');
    expect(series.map((g) => g.group)).toEqual(['legs', 'chest']); // legs tiene 2 la última
    const chest = series.find((g) => g.group === 'chest')!;
    expect(chest.points.map((p) => p.sets)).toEqual([2, 1]);
    expect(chest.latest).toBe(1);
  });

  /**
   * Una semana sin ese grupo vale CERO, no un hueco: un trazo interrumpido se lee como
   * "no hay dato", y aquí el cero es precisamente el dato que hay que ver.
   */
  it('las semanas sin ese grupo valen cero, no se saltan', () => {
    const s = state([session('2026-08-31', [set('e2', 80, 5)])]);
    // Del lunes 31 de agosto al domingo 20 de septiembre hay TRES semanas.
    const legs = groupSeriesByWeek(s, groupOf, '2026-08-31', '2026-09-20')[0];
    expect(legs.points.map((p) => p.sets)).toEqual([1, 0, 0]);
    expect(legs.latest).toBe(0);
  });

  it('un ejercicio sin grupo conocido no ensucia el reparto', () => {
    const s = state([session('2026-09-01', [set('e1', 50, 5)])]);
    expect(groupSeriesByWeek(s, () => null, '2026-09-01', '2026-09-07')).toEqual([]);
  });
});

describe('indexSetsByExercise()', () => {
  it('agrupa por ejercicio y ordena por fecha con un solo barrido', () => {
    const index = indexSetsByExercise([
      session('2026-09-08', [set('e1', 55, 5)]),
      session('2026-09-01', [set('e1', 50, 5), set('e2', 80, 5)]),
    ]);
    expect(index.get('e1')!.map((e) => e.dateISO)).toEqual(['2026-09-01', '2026-09-08']);
    expect(index.get('e2')).toHaveLength(1);
  });

  it('deja fuera el calentamiento y las sesiones saltadas', () => {
    const index = indexSetsByExercise([
      session('2026-09-01', [set('e1', 20, 10, true)]),
      session('2026-09-02', [set('e1', 50, 5)], { skipped: true }),
    ]);
    expect(index.get('e1')).toBeUndefined();
  });
});

describe('buildMultiChart()', () => {
  const serie = (id: string, values: number[]) => ({
    id,
    label: id,
    points: values.map((value, i) => ({ dateISO: `2026-09-0${i + 1}`, value })),
  });

  it('dibuja varias curvas en la MISMA escala', () => {
    const out = buildMultiChart([serie('a', [10, 20]), serie('b', [50, 100])])!;
    expect(out.min).toBe(10);
    expect(out.max).toBe(100);
    expect(out.paths).toHaveLength(2);
    // La curva baja arranca cerca del suelo del eje común, no en su propio máximo.
    expect(out.paths[0].d.startsWith('M0.0,200.0')).toBe(true);
  });

  it('una serie de un solo punto no es una tendencia', () => {
    expect(buildMultiChart([serie('a', [10])])).toBeNull();
  });

  it('sin series no devuelve un gráfico vacío, devuelve null', () => {
    expect(buildMultiChart([])).toBeNull();
  });

  it('todos los valores iguales no dividen por cero', () => {
    const out = buildMultiChart([serie('a', [40, 40, 40])])!;
    expect(out.paths[0].d).not.toContain('NaN');
  });
});
