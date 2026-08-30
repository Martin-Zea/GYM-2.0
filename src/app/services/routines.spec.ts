import { TestBed } from '@angular/core/testing';
import { StateService } from './state.service';
import { CatalogService } from './catalog.service';
import { TabLockService } from './tab-lock.service';
import { ROUTINE_TEMPLATES } from '../data/routine-templates';
import { templatesForProfile } from './catalog.service';

describe('Rutinas (RF-RUT-01/03/04)', () => {
  let state: StateService;
  let catalog: CatalogService;

  beforeEach(() => {
    localStorage.clear();
    state = TestBed.inject(StateService);
    catalog = TestBed.inject(CatalogService);
  });

  afterEach(() => {
    TestBed.inject(TabLockService).releaseForTest();
  });

  describe('CRUD', () => {
    it('el estado inicial trae una rutina con todos los días', () => {
      expect(state.routines()).toHaveLength(1);
      expect(state.activeRoutine()?.dayIds).toHaveLength(state.days().length);
    });

    it('crear una rutina la deja activa y vacía, sin tocar la anterior', () => {
      const before = state.days().length;

      state.createRoutine('Fuerza');

      expect(state.activeRoutine()?.name).toBe('Fuerza');
      expect(state.days()).toHaveLength(0);
      expect(state.routines()).toHaveLength(2);
      expect(state.state().days.length).toBe(before);
    });

    it('duplicar copia los días en vez de compartirlos', () => {
      const original = state.activeRoutine()!;
      const copyId = state.duplicateRoutine(original.id, 'Copia')!;

      const copy = state.routines().find((r) => r.id === copyId)!;
      expect(copy.dayIds).toHaveLength(original.dayIds.length);
      // Editar la copia no puede tocar el original
      expect(copy.dayIds.some((id) => original.dayIds.includes(id))).toBe(false);
    });

    it('cambiar de rutina reinicia el puntero: el día que toca es el primero de la nueva', () => {
      state.advanceRoutine();
      expect(state.routinePointer()).toBeGreaterThan(0);

      const id = state.createRoutine('Otra');
      state.setActiveRoutine(id);

      expect(state.routinePointer()).toBe(0);
    });

    it('no se puede borrar la única rutina', () => {
      expect(state.deleteRoutine(state.activeRoutine()!.id)).toBe(false);
      expect(state.routines()).toHaveLength(1);
    });

    it('borrar una rutina se lleva sus días pero NO el historial de esas sesiones', () => {
      const original = state.activeRoutine()!;
      const sessionsBefore = state.sessions().length;
      const id = state.createRoutine('Temporal');
      state.setActiveRoutine(original.id);

      expect(state.deleteRoutine(id)).toBe(true);
      expect(state.sessions()).toHaveLength(sessionsBefore);
    });

    it('un día nuevo entra en la rutina activa, no en el limbo', () => {
      const id = state.createRoutine('Nueva');
      state.saveDay({ id: '', name: 'Día suelto', exercises: [] });

      expect(state.routines().find((r) => r.id === id)!.dayIds).toHaveLength(1);
      expect(state.days()).toHaveLength(1);
    });
  });

  describe('plantillas (RF-RUT-03)', () => {
    it('filtra por nivel y equipo del perfil', () => {
      const forBeginnerBodyweight = templatesForProfile('beginner', ['bodyweight']);

      expect(forBeginnerBodyweight.length).toBeGreaterThan(0);
      expect(forBeginnerBodyweight.every((t) => t.levels.includes('beginner'))).toBe(true);
    });

    it('sin perfil declarado no esconde nada', () => {
      expect(templatesForProfile(null, null)).toHaveLength(ROUTINE_TEMPLATES.length);
    });

    it('importar crea una rutina nueva y deja intacta la anterior', () => {
      const before = state.routines().length;
      const template = ROUTINE_TEMPLATES[0];

      state.importTemplate(template, 'es', catalog);

      expect(state.routines()).toHaveLength(before + 1);
      expect(state.days()).toHaveLength(template.days.length);
      expect(state.days()[0].exercises.length).toBeGreaterThan(0);
    });

    it('reusa ejercicios que ya existían: importar no parte el historial', () => {
      // El estado inicial ya trae ejercicios; la plantilla que los repita debe reusar su id
      const template = ROUTINE_TEMPLATES[0];
      const namesBefore = new Set(state.exercises().map((e) => e.name.toLowerCase()));

      state.importTemplate(template, 'es', catalog);

      const duplicated = state
        .exercises()
        .filter((e) => namesBefore.has(e.name.toLowerCase()))
        .reduce<Record<string, number>>((acc, e) => {
          const k = e.name.toLowerCase();
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {});

      expect(Object.values(duplicated).every((n) => n === 1)).toBe(true);
    });

    it('todas las plantillas apuntan a ejercicios que existen en el catálogo', () => {
      for (const template of ROUTINE_TEMPLATES) {
        for (const day of template.days) {
          for (const ref of day.refs) {
            expect(catalog.byRef(ref), `${template.id}/${ref}`).not.toBeNull();
          }
        }
      }
    });
  });

  describe('archivado de ejercicios (RF-EJ-03)', () => {
    it('archivar conserva el ejercicio y su historial', () => {
      const ex = state.exercises()[0];
      const sessionsBefore = state.sessions().length;

      state.setExerciseArchived(ex.id, true);

      expect(state.exercises().find((e) => e.id === ex.id)?.archived).toBe(true);
      expect(state.sessions()).toHaveLength(sessionsBefore);
    });
  });
});
