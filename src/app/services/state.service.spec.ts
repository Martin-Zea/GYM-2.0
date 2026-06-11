import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { Exercise, WorkoutDay } from '../models/workout.model';

describe('StateService', () => {
  let service: StateService;
  let day: WorkoutDay;
  let exercise: Exercise;

  beforeEach(() => {
    localStorage.clear();
    service = TestBed.inject(StateService);
    // Estado inicial seedeado: 5 días con ejercicios
    day = service.days()[0];
    exercise = day.exercises[0];
  });

  describe('toggleSetDone()', () => {
    it("devuelve 'needs_reps' si el set no tiene reps cargadas", () => {
      expect(service.toggleSetDone(day.id, exercise, 0)).toBe('needs_reps');
    });

    it("alterna 'done' y 'undone' cuando hay reps", () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 20, reps: 8 });

      expect(service.toggleSetDone(day.id, exercise, 0)).toBe('done');
      expect(service.getTodayProgress(day.id).sets[exercise.id][0].done).toBe(true);

      expect(service.toggleSetDone(day.id, exercise, 0)).toBe('undone');
      expect(service.getTodayProgress(day.id).sets[exercise.id][0].done).toBe(false);
    });

    it('al marcar done registra una sesión de hoy para el día', () => {
      service.updateSet(day.id, exercise.id, 0, { weight: 20, reps: 8 });
      service.toggleSetDone(day.id, exercise, 0);

      const session = service.sessions().find(
        s => s.dayId === day.id && s.dateISO === service.todayKey && !s.skipped,
      );
      expect(session).toBeDefined();
      expect(session!.sets).toEqual([
        expect.objectContaining({ exerciseId: exercise.id, setIndex: 0, weight: 20, reps: 8 }),
      ]);
    });
  });

  describe('advanceRoutine()', () => {
    it('incrementa routinePointer', () => {
      const before = service.routinePointer();
      service.advanceRoutine();
      expect(service.routinePointer()).toBe(before + 1);
    });

    it('poda entradas viejas de todayProgress y conserva las de hoy', () => {
      service.state.update(s => ({
        ...s,
        todayProgress: {
          'dia-viejo': { dateISO: '2020-01-01', sets: {} },
          [day.id]: { dateISO: service.todayKey, sets: {} },
        },
      }));

      service.advanceRoutine();

      expect(service.state().todayProgress['dia-viejo']).toBeUndefined();
      expect(service.state().todayProgress[day.id]).toBeDefined();
    });
  });

  describe('deleteSession()', () => {
    it('elimina la sesión del array sessions', () => {
      // Estado inicial: cada día tiene una sesión baseline de hace 7 días
      const session = service.sessions().find(s => s.dayId === day.id);
      expect(session).toBeDefined();

      service.deleteSession(session!.id);

      expect(service.sessions().find(s => s.id === session!.id)).toBeUndefined();
    });

    it('no toca otras sesiones', () => {
      const before = service.sessions();
      const target = before[0];

      service.deleteSession(target.id);

      expect(service.sessions()).toHaveLength(before.length - 1);
      expect(service.sessions()).toEqual(before.filter(s => s.id !== target.id));
    });

    it('invalida el caché de IA', () => {
      localStorage.setItem('gym_ai_cache_v1', '{}');

      service.deleteSession(service.sessions()[0].id);

      expect(localStorage.getItem('gym_ai_cache_v1')).toBeNull();
    });
  });

  describe('updateSessionSet()', () => {
    it('actualiza weight y reps del SetRecord correspondiente', () => {
      const session = service.sessions().find(
        s => s.dayId === day.id && s.sets.some(sr => sr.exerciseId === exercise.id),
      );
      expect(session).toBeDefined();
      const target = session!.sets.find(sr => sr.exerciseId === exercise.id)!;

      service.updateSessionSet(session!.id, exercise.id, target.setIndex, { weight: 8, reps: 12 });

      const updated = service.sessions().find(s => s.id === session!.id)!;
      const updatedSet = updated.sets.find(
        sr => sr.exerciseId === exercise.id && sr.setIndex === target.setIndex,
      )!;
      expect(updatedSet.weight).toBe(8);
      expect(updatedSet.reps).toBe(12);
    });

    it('aplica patch parcial sin pisar el otro campo y no toca otros sets', () => {
      const session = service.sessions().find(
        s => s.dayId === day.id && s.sets.some(sr => sr.exerciseId === exercise.id),
      )!;
      const target = session.sets.find(sr => sr.exerciseId === exercise.id)!;
      const otherSets = session.sets.filter(
        sr => !(sr.exerciseId === exercise.id && sr.setIndex === target.setIndex),
      );

      service.updateSessionSet(session.id, exercise.id, target.setIndex, { weight: 99 });

      const updated = service.sessions().find(s => s.id === session.id)!;
      const updatedSet = updated.sets.find(
        sr => sr.exerciseId === exercise.id && sr.setIndex === target.setIndex,
      )!;
      expect(updatedSet.weight).toBe(99);
      expect(updatedSet.reps).toBe(target.reps);
      expect(updated.sets.filter(
        sr => !(sr.exerciseId === exercise.id && sr.setIndex === target.setIndex),
      )).toEqual(otherSets);
    });

    it('invalida el caché de IA', () => {
      const session = service.sessions().find(
        s => s.dayId === day.id && s.sets.some(sr => sr.exerciseId === exercise.id),
      )!;
      localStorage.setItem('gym_ai_cache_v1', '{}');

      service.updateSessionSet(session.id, exercise.id, 0, { weight: 10 });

      expect(localStorage.getItem('gym_ai_cache_v1')).toBeNull();
    });
  });

  describe('updateSet()', () => {
    it('persiste el patch en todayProgress', () => {
      service.updateSet(day.id, exercise.id, 1, { weight: 42 });

      const progress = service.getTodayProgress(day.id);
      expect(progress.dateISO).toBe(service.todayKey);
      expect(progress.sets[exercise.id][1].weight).toBe(42);

      // Un patch posterior se mergea sin pisar lo anterior
      service.updateSet(day.id, exercise.id, 1, { reps: 9 });
      const updated = service.getTodayProgress(day.id).sets[exercise.id][1];
      expect(updated.weight).toBe(42);
      expect(updated.reps).toBe(9);
    });
  });
});
