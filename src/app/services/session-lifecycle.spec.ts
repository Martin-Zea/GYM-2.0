import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import { TabLockService } from './tab-lock.service';
import { Exercise, WorkoutDay } from '../models/workout.model';
import { shiftISO } from '../utils/date';

/** Deja que corra el effect de persistencia de `StateService`. */
function flush(): void {
  TestBed.tick();
}

describe('Ciclo de vida de la sesión (RF-SES-02/07/08b)', () => {
  let service: StateService;
  let day: WorkoutDay;
  let exercise: Exercise;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(StateService);
    day = service.days()[0];
    exercise = day.exercises[0];
  });

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
  });

  describe('startSession()', () => {
    it('sella el arranque en el progreso de hoy', () => {
      service.startSession(day.id);
      expect(service.getTodayProgress(day.id).startedAt).toBeTruthy();
    });

    it('reanudar NO reinicia el reloj: la duración es la real, no la del último tramo', () => {
      service.startSession(day.id);
      const first = service.getTodayProgress(day.id).startedAt;
      service.startSession(day.id);
      expect(service.getTodayProgress(day.id).startedAt).toBe(first);
    });
  });

  describe('finishSession()', () => {
    it('sella el fin y devuelve la sesión cerrada', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      const finished = service.finishSession(day.id);

      expect(finished).not.toBeNull();
      expect(finished!.endedAt).toBeTruthy();
      expect(finished!.startedAt).toBeTruthy();
    });

    it('sin series registradas no crea una sesión fantasma', () => {
      expect(service.finishSession(day.id)).toBeNull();
      expect(service.sessions().some((s) => s.dateISO === service.todayKey)).toBe(false);
    });

    it('avanza la rutina al cerrar', () => {
      const before = service.routinePointer();
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      service.finishSession(day.id);
      expect(service.routinePointer()).toBeGreaterThan(before);
    });
  });

  describe('unfinishedSession() — EA-4', () => {
    it('una sesión de hoy con series y sin cerrar es una interrupción', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      expect(service.unfinishedSession()?.dayId).toBe(day.id);
    });

    it('deja de estarlo al cerrarla', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      service.finishSession(day.id);

      expect(service.unfinishedSession()).toBeNull();
    });

    it('el historial viejo sin endedAt NO se ofrece como interrumpido (R-5)', () => {
      // Las sesiones anteriores a v7 nunca tuvieron marcas de tiempo: si contaran como
      // interrumpidas, la app pediría "reanudar" un entrenamiento de hace meses
      service.state.update((s) => ({
        ...s,
        sessions: [
          ...s.sessions,
          {
            id: 'vieja',
            dayId: day.id,
            dateISO: '2026-01-01',
            sets: [{ exerciseId: exercise.id, setIndex: 0, weight: 50, reps: 5 }],
          },
        ],
      }));

      expect(service.unfinishedSession()).toBeNull();
    });
  });

  describe('discardSession()', () => {
    it('borra el progreso y manda la sesión a la papelera, no a la nada', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      service.discardSession(day.id);

      expect(service.unfinishedSession()).toBeNull();
      expect(service.getTodayProgress(day.id).sets[exercise.id]).toBeUndefined();
      expect(service.state().trash?.length).toBe(1);
    });
  });

  describe('acciones en vivo (RF-SES-05)', () => {
    it('quitar una serie no toca la rutina guardada', () => {
      const before = exercise.defaultSets;
      service.setTodaySetCount(day.id, exercise.id, before - 1);

      expect(service.getTodayProgress(day.id).setCounts?.[exercise.id]).toBe(before - 1);
      expect(service.days()[0].exercises[0].defaultSets).toBe(before);
    });

    it('quitar un ejercicio de hoy borra sus series pero no lo saca de la rutina', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      service.removeExerciseToday(day.id, exercise.id);

      expect(service.getTodayProgress(day.id).hiddenExerciseIds).toContain(exercise.id);
      expect(service.getTodayProgress(day.id).sets[exercise.id]).toBeUndefined();
      expect(service.days()[0].exercises.some((e) => e.id === exercise.id)).toBe(true);
    });

    it('quitar el único ejercicio con series no deja la sesión describiendo trabajo borrado', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      expect(service.todaySession(day.id)).not.toBeNull();

      service.removeExerciseToday(day.id, exercise.id);

      expect(service.todaySession(day.id)).toBeNull();
    });

    it('añadir un ejercicio solo por hoy no lo agrega a la rutina', () => {
      const otro = service.exercises().find((e) => !day.exercises.some((d) => d.id === e.id))!;

      service.addExerciseToday(day.id, otro.id);

      expect(service.getTodayProgress(day.id).addedExerciseIds).toContain(otro.id);
      expect(service.days()[0].exercises.some((e) => e.id === otro.id)).toBe(false);
    });

    it('la nota de sesión se guarda en la sesión de hoy', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      service.setSessionNote(day.id, '  dormí mal  ');

      expect(service.sessionNoteFor(day.id)).toBe('dormí mal');
    });
  });

  /**
   * Cruzar la medianoche a mitad de un entrenamiento (T-831).
   *
   * Todo lo que comparaba contra `todayKey` devolvía "no es de hoy" en cuanto cambiaba la
   * fecha: las series marcadas desaparecían de la pantalla y el atleta las repetía, con lo
   * que un mismo entrenamiento acababa partido en dos sesiones con dos fechas distintas.
   * Con el bug de UTC eso ocurría a las 21:00 en Argentina — plena franja de gimnasio.
   */
  describe('una sesión abierta que cruza la medianoche (T-831)', () => {
    /** Mueve "hoy" un día hacia adelante sin tocar el progreso ya guardado. */
    const avanzarUnDia = (): void => {
      const manana = shiftISO(service.todayKey, 1);
      vi.spyOn(TestBed.inject(StorageService), 'todayISO').mockReturnValue(manana);
    };

    it('el progreso NO se pierde y las series siguen ahí', () => {
      service.startSession(day.id);
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      const antes = service.getTodayProgress(day.id);
      expect(antes.sets[exercise.id]?.[0]?.done).toBe(true);

      avanzarUnDia();

      const despues = service.getTodayProgress(day.id);
      expect(despues.sets[exercise.id]?.[0]?.done).toBe(true);
      expect(despues.dateISO).toBe(antes.dateISO);
    });

    it('las series de después de medianoche entran en la MISMA sesión', () => {
      service.startSession(day.id);
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      const fechaInicio = service.getTodayProgress(day.id).dateISO;

      avanzarUnDia();
      service.updateSet(day.id, exercise.id, 1, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 1);

      // Una sola sesión, fechada cuando EMPEZÓ, con las dos series dentro. (El día trae
      // además la sesión sembrada de hace 7 días, que no entra en la comparación.)
      const delDia = service
        .sessions()
        .filter((x) => x.dayId === day.id && !x.skipped && x.dateISO >= fechaInicio);
      expect(delDia).toHaveLength(1);
      expect(delDia[0].dateISO).toBe(fechaInicio);
      expect(delDia[0].sets).toHaveLength(2);
      // Y NADA con la fecha del día siguiente: el entrenamiento no se partió en dos.
      expect(service.sessions().some((x) => x.dateISO === shiftISO(fechaInicio, 1))).toBe(false);
    });

    it('pero si la sesión YA se cerró, el día siguiente empieza de cero', () => {
      service.startSession(day.id);
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      service.finishSession(day.id);

      avanzarUnDia();

      // Volver al gimnasio después de medianoche con la sesión cerrada es un día nuevo.
      expect(service.getTodayProgress(day.id).sets[exercise.id] ?? []).toHaveLength(0);
    });

    it('un progreso abierto hace más de 12 h se considera olvidado, no en curso', () => {
      service.startSession(day.id);
      service.updateSet(day.id, exercise.id, 0, { weight: 40, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);
      // Retrasar el arranque 20 h: eso ya no es un entrenamiento en curso.
      const hace20h = new Date(Date.now() - 20 * 3_600_000).toISOString();
      service.state.update((st) => ({
        ...st,
        todayProgress: {
          ...st.todayProgress,
          [day.id]: { ...st.todayProgress[day.id], startedAt: hace20h },
        },
      }));

      avanzarUnDia();

      expect(service.getTodayProgress(day.id).sets[exercise.id] ?? []).toHaveLength(0);
    });
  });
});

describe('Cierre forzado durante la sesión (CE-3)', () => {
  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
  });

  it('lo registrado antes del cierre sigue ahí al volver a abrir', () => {
    localStorage.clear();
    const service = TestBed.inject(StateService);
    const day = service.days()[0];
    const exercise = day.exercises[0];

    service.startSession(day.id);
    service.updateSet(day.id, exercise.id, 0, { weight: 62.5, reps: 9 });
    service.toggleSetDone(day.id, exercise, 0);
    service.updateSet(day.id, exercise.id, 1, { weight: 62.5, reps: 8 });
    service.toggleSetDone(day.id, exercise, 1);
    flush();

    // La app muere aquí: sin "Terminar", sin descarga ordenada. Solo queda el disco.
    TestBed.inject(TabLockService).releaseForTest();
    TestBed.resetTestingModule();

    const reopened = TestBed.inject(StorageService).load();
    const session = reopened.sessions.find(
      (s) => s.dateISO === reopened.todayProgress[day.id]?.dateISO,
    );

    expect(session).toBeDefined();
    expect(session!.sets).toHaveLength(2);
    expect(session!.sets[0]).toMatchObject({ weight: 62.5, reps: 9 });
    expect(session!.startedAt).toBeTruthy();
    // Quedó sin cerrar: al reabrir, la app debe ofrecer reanudar/finalizar/descartar
    expect(session!.endedAt).toBeUndefined();
    // Y el progreso en curso sigue en su sitio para poder continuar
    expect(reopened.todayProgress[day.id].sets[exercise.id]).toHaveLength(2);
  });
});
