import { SetRecord, TrainingLevel } from '../../models/workout.model';
import { HistoryEntry } from '../storage.service';
import {
  LEVEL_PARAMS,
  completionRatio,
  confirmedAtWeight,
  consecutiveFailures,
  failureDropWeight,
  isStagnant,
  layoffFactor,
  levelParams,
  metTarget,
  progressStreak,
} from './progression-rules';

const REPS = 10;
const SETS = 3;

/** Una sesión: `n` series a `weight` × `reps`. */
function entry(dateISO: string, weight: number, reps: number, sets = SETS): HistoryEntry {
  const list: SetRecord[] = Array.from({ length: sets }, (_, i) => ({
    exerciseId: 'ex1',
    setIndex: i,
    weight,
    reps,
  }));
  return {
    dateISO,
    sets: list,
    topWeight: weight,
    topReps: reps,
    totalReps: reps * sets,
    volume: weight * reps * sets,
  };
}

/** Historial a partir de pares [peso, reps], del más viejo al más reciente. */
function history(pairs: [number, number][]): HistoryEntry[] {
  return pairs.map(([w, r], i) => entry(`2026-05-${String(i + 1).padStart(2, '0')}`, w, r));
}

describe('completionRatio()', () => {
  it('cumplir todas las series da 1', () => {
    expect(completionRatio(entry('d', 50, 10).sets, REPS, SETS)).toBe(1);
  });

  it('pasarse de reps no infla el ratio por encima de 1', () => {
    expect(completionRatio(entry('d', 50, 20).sets, REPS, SETS)).toBe(1);
  });

  it('una serie pasada de vueltas no compensa a las que fallaron', () => {
    // Sin el tope por serie, 15+5+5 daría 25/30 y parecería casi cumplido
    const sets: SetRecord[] = [
      { exerciseId: 'ex1', setIndex: 0, weight: 50, reps: 15 },
      { exerciseId: 'ex1', setIndex: 1, weight: 50, reps: 5 },
      { exerciseId: 'ex1', setIndex: 2, weight: 50, reps: 5 },
    ];
    expect(completionRatio(sets, REPS, SETS)).toBeCloseTo(20 / 30, 5);
  });

  it('cada serie se topea con el objetivo que tenía guardado, no con el actual', () => {
    // La serie se registró con objetivo 8 y se hicieron 12: cuenta 8, aunque hoy el
    // objetivo del ejercicio sea 15
    const old: SetRecord[] = [
      { exerciseId: 'ex1', setIndex: 0, weight: 50, reps: 12, repTarget: 8 },
    ];
    expect(completionRatio(old, 15, 1)).toBeCloseTo(8 / 15, 5);
  });

  it('sin objetivo posible no divide por cero', () => {
    expect(completionRatio(entry('d', 50, 10).sets, 0, SETS)).toBe(0);
  });
});

describe('consecutiveFailures() — §4.5', () => {
  it('cuenta las últimas sesiones seguidas por debajo del objetivo', () => {
    const h = history([
      [50, 10],
      [52.5, 7],
      [52.5, 6],
    ]);
    expect(consecutiveFailures(h, REPS, SETS)).toBe(2);
  });

  it('una sesión cumplida corta la racha: fallar una vez es ruido', () => {
    const h = history([
      [52.5, 6],
      [52.5, 10],
    ]);
    expect(consecutiveFailures(h, REPS, SETS)).toBe(0);
  });

  it('sin historial no hay fallos', () => {
    expect(consecutiveFailures([], REPS, SETS)).toBe(0);
  });
});

describe('isStagnant() — §4.5', () => {
  it('detecta N sesiones sin mejorar la marca', () => {
    const h = history([
      [50, 10],
      [50, 10],
      [50, 10],
    ]);
    expect(isStagnant(h, 3)).toBe(true);
  });

  it('bajar también es estancarse: lo que importa es que no avanza', () => {
    const h = history([
      [55, 10],
      [52.5, 8],
      [50, 8],
    ]);
    expect(isStagnant(h, 3)).toBe(true);
  });

  it('una mejora dentro del tramo lo descarta', () => {
    const h = history([
      [50, 10],
      [50, 10],
      [52.5, 8],
    ]);
    expect(isStagnant(h, 3)).toBe(false);
  });

  it('con menos historial del que pide la ventana no se concluye nada', () => {
    expect(isStagnant(history([[50, 10]]), 3)).toBe(false);
  });
});

describe('progressStreak()', () => {
  it('cuenta las subidas consecutivas más recientes', () => {
    const h = history([
      [45, 10],
      [50, 10],
      [52.5, 10],
      [55, 10],
    ]);
    expect(progressStreak(h)).toBe(3);
  });

  it('una sesión sin subir corta la racha', () => {
    const h = history([
      [50, 10],
      [55, 10],
      [55, 10],
    ]);
    expect(progressStreak(h)).toBe(0);
  });
});

describe('confirmedAtWeight() — doble progresión', () => {
  const h = history([
    [50, 10],
    [50, 10],
  ]);

  it('un principiante confirma con una sola sesión cumplida (lineal agresiva)', () => {
    expect(confirmedAtWeight(h, 50, REPS, SETS, LEVEL_PARAMS.beginner.confirmSessions)).toBe(true);
  });

  it('un intermedio necesita dos sesiones seguidas al mismo peso', () => {
    expect(confirmedAtWeight(h, 50, REPS, SETS, 2)).toBe(true);

    const soloUna = history([
      [47.5, 10],
      [50, 10],
    ]);
    expect(confirmedAtWeight(soloUna, 50, REPS, SETS, 2)).toBe(false);
  });

  it('no confirma si alguna de esas sesiones no cerró el objetivo', () => {
    const h2 = history([
      [50, 7],
      [50, 10],
    ]);
    expect(confirmedAtWeight(h2, 50, REPS, SETS, 2)).toBe(false);
  });
});

describe('failureDropWeight() — bajar 5–10% (§4.5)', () => {
  it('baja el porcentaje del nivel redondeando al ladrillo', () => {
    // 100 kg − 7,5% = 92,5 → redondeado a ladrillo de 2,5 es 92,5
    expect(failureDropWeight(100, 2.5, 0.075)).toBe(92.5);
  });

  it('bajar siempre baja de verdad, aunque el redondeo lo devolviera igual', () => {
    // 5 % de 20 kg con ladrillos de 5 redondearía a 20: tiene que caer un ladrillo
    expect(failureDropWeight(20, 5, 0.05)).toBe(15);
  });

  it('nunca deja el peso por debajo de un ladrillo', () => {
    expect(failureDropWeight(2.5, 2.5, 0.5)).toBe(2.5);
  });
});

describe('levelParams() — §3', () => {
  it('sin nivel declarado asume intermedio', () => {
    expect(levelParams(null)).toEqual(LEVEL_PARAMS.intermediate);
    expect(levelParams(undefined)).toEqual(LEVEL_PARAMS.intermediate);
  });

  it('un nivel desconocido (backup manipulado) cae en intermedio en vez de romper', () => {
    expect(levelParams('experto' as TrainingLevel)).toEqual(LEVEL_PARAMS.intermediate);
  });

  it('la agresividad al subir baja con el nivel y la descarga se adelanta', () => {
    const levels: TrainingLevel[] = ['beginner', 'intermediate', 'advanced'];
    const confirm = levels.map((l) => LEVEL_PARAMS[l].confirmSessions);
    const deload = levels.map((l) => LEVEL_PARAMS[l].deloadAfterProgress);
    const drop = levels.map((l) => LEVEL_PARAMS[l].failDrop);

    expect(confirm[0]).toBeLessThan(confirm[1]);
    expect(deload[0]).toBeGreaterThan(deload[1]);
    expect(deload[1]).toBeGreaterThan(deload[2]);
    expect(drop[0]).toBeLessThan(drop[2]);
  });

  it('el recorte por fallos se mantiene dentro del 5–10% que fija §4.5', () => {
    Object.values(LEVEL_PARAMS).forEach((p) => {
      expect(p.failDrop).toBeGreaterThanOrEqual(0.05);
      expect(p.failDrop).toBeLessThanOrEqual(0.1);
    });
  });
});

describe('metTarget()', () => {
  it('distingue cumplir de quedarse corto', () => {
    expect(metTarget(entry('d', 50, 10), REPS, SETS)).toBe(true);
    expect(metTarget(entry('d', 50, 9), REPS, SETS)).toBe(false);
  });
});

describe('layoffFactor() — una sola regla para los dos motores (T-812)', () => {
  const today = '2026-08-30';

  it('entrenando con normalidad no recorta nada', () => {
    expect(layoffFactor('2026-08-28', today)).toBe(1);
    expect(layoffFactor('2026-08-16', today)).toBe(1); // 14 días justos: todavía no
  });

  it('pasadas dos semanas recorta al 90%', () => {
    expect(layoffFactor('2026-08-10', today)).toBe(0.9);
  });

  it('pasado el mes recorta al 85%', () => {
    expect(layoffFactor('2026-06-30', today)).toBe(0.85);
  });

  it('es PROPORCIONAL: tres años no puede dar lo mismo que un mes', () => {
    // Un recorte fijo de dos incrementos daba 95 kg en los dos casos.
    const dosMeses = layoffFactor('2026-06-30', today);
    const tresAnios = layoffFactor('2023-08-30', today);
    expect(dosMeses).toBe(tresAnios);
    // Ambos recortan de verdad sobre la marca, no un ladrillo simbólico
    expect(100 * dosMeses).toBe(85);
  });

  it('sin fecha previa no hay nada que recortar', () => {
    expect(layoffFactor(null, today)).toBe(1);
  });

  it('una fecha ilegible no altera el peso', () => {
    expect(layoffFactor('no-es-una-fecha', today)).toBe(1);
  });
});
