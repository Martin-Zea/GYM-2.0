import { TestBed } from '@angular/core/testing';
import { CatalogService, catalogRefForName } from './catalog.service';
import { EXERCISE_CATALOG } from '../data/exercise-catalog';
import { createInitialState } from '../data/initial-data';

describe('CatalogService — RF-EJ-01/02/04', () => {
  let catalog: CatalogService;

  beforeEach(() => {
    catalog = TestBed.inject(CatalogService);
  });

  describe('catálogo', () => {
    it('no tiene refs duplicadas', () => {
      const refs = EXERCISE_CATALOG.map((e) => e.ref);
      expect(new Set(refs).size).toBe(refs.length);
    });

    it('todas las entradas traen nombre en los dos idiomas', () => {
      expect(EXERCISE_CATALOG.every((e) => e.es.trim() && e.en.trim())).toBe(true);
    });
  });

  describe('enlace por nombre (R-3)', () => {
    it('reconoce el nombre en español y en inglés', () => {
      expect(catalog.refFor('Press banca')).toBe('bench_press');
      expect(catalog.refFor('Bench press')).toBe('bench_press');
    });

    it('ignora mayúsculas, acentos y espacios de más', () => {
      expect(catalog.refFor('  PRESS   BANCA ')).toBe('bench_press');
      expect(catalog.refFor('Sentadilla')).toBe('back_squat');
      expect(catalog.refFor('Bíceps' + ' con mancuernas')).toBeNull();
    });

    it('reconoce sinónimos habituales', () => {
      expect(catalog.refFor('lagartijas')).toBe('push_up');
      expect(catalog.refFor('jalon')).toBe('lat_pulldown');
      expect(catalog.refFor('rdl')).toBe('romanian_deadlift');
    });

    it('un ejercicio inventado NO se enlaza a la fuerza', () => {
      // Adivinar por parecido mezclaría el historial de dos ejercicios distintos
      expect(catalog.refFor('Mi ejercicio raro')).toBeNull();
    });

    it('la función sin inyección da el mismo resultado (la usa la migración)', () => {
      expect(catalogRefForName('press banca')).toBe(catalog.refFor('press banca'));
    });
  });

  describe('búsqueda (RF-EJ-02)', () => {
    it('filtra por texto en cualquiera de los dos idiomas', () => {
      expect(catalog.search({ text: 'sentadilla' }).length).toBeGreaterThan(0);
      expect(catalog.search({ text: 'squat' }).length).toBeGreaterThan(0);
    });

    it('filtra por grupo y por equipo a la vez', () => {
      const out = catalog.search({ group: 'chest', equipment: 'dumbbell' });

      expect(out.length).toBeGreaterThan(0);
      expect(out.every((e) => e.group === 'chest' && e.equipment === 'dumbbell')).toBe(true);
    });

    it('sin filtros devuelve el catálogo entero', () => {
      expect(catalog.search({})).toHaveLength(EXERCISE_CATALOG.length);
    });
  });

  describe('alternativas (RF-EJ-04)', () => {
    it('propone el mismo patrón de movimiento antes que el mismo músculo', () => {
      const alts = catalog.alternativesFor('Press banca');

      expect(alts.length).toBeGreaterThan(0);
      expect(alts[0].pattern).toBe('horizontal_push');
      expect(alts.some((a) => a.ref === 'bench_press')).toBe(false);
    });

    it('respeta el equipo disponible', () => {
      const alts = catalog.alternativesFor('Press banca', { equipment: ['bodyweight'] });

      expect(alts.length).toBeGreaterThan(0);
      expect(alts.every((a) => a.equipment === 'bodyweight')).toBe(true);
    });

    it('de un ejercicio que no está en el catálogo no inventa alternativas', () => {
      expect(catalog.alternativesFor('Ejercicio inventado')).toEqual([]);
    });
  });

  describe('toExercise()', () => {
    it('trae unidad, descanso y ladrillo coherentes con el tipo de ejercicio', () => {
      const compound = catalog.toExercise(catalog.byRef('back_squat')!, 'es', 'x1');
      const isolation = catalog.toExercise(catalog.byRef('lateral_raise')!, 'es', 'x2');
      const timed = catalog.toExercise(catalog.byRef('plank')!, 'es', 'x3');

      expect(compound.restSeconds).toBeGreaterThan(isolation.restSeconds);
      expect(compound.brick).toBeGreaterThan(isolation.brick);
      expect(isolation.unit).toBe('KG_PER_HAND');
      expect(timed.unit).toBe('TIME');
      expect(compound.catalogRef).toBe('back_squat');
    });

    it('usa el nombre del idioma activo', () => {
      const item = catalog.byRef('bench_press')!;
      expect(catalog.toExercise(item, 'en', 'x').name).toBe('Bench press');
      expect(catalog.toExercise(item, 'es', 'x').name).toBe('Press banca');
    });
  });

  /**
   * La rutina inicial TIENE que enlazar entera con el catálogo (T-837).
   *
   * Sin `catalogRef` no hay grupo muscular, y sin grupo no hay reparto de volumen ni avisos
   * de desequilibrio ni ejercicios alternativos. Enlazaban 3 de 22: la rutina que trae la
   * app usaba nombres con el equipamiento entre paréntesis —"Press de Pecho (Máquina)"— y
   * el catálogo tenía otros, así que esas tres funciones estaban muertas para todo el que
   * no hubiera renombrado sus ejercicios a mano.
   *
   * Este test es el que evita que vuelva a pasar: añadir un ejercicio a la rutina inicial
   * sin darle sinónimo lo rompe aquí y no seis pantallas más allá.
   */
  describe('la rutina inicial enlaza entera (T-837)', () => {
    it('cada ejercicio sembrado encuentra su entrada del catálogo', () => {
      const inicial = createInitialState();
      const sinEnlace = inicial.exercises
        .filter((e) => !catalogRefForName(e.name))
        .map((e) => e.name);

      expect(sinEnlace).toEqual([]);
    });

    it('y el enlace queda guardado en el estado, no solo calculable', () => {
      // La migración v8→v9 lo puebla para quien viene de antes; una instalación nueva
      // nace en el schema actual y nunca la ejecuta, así que lo tiene que traer puesto.
      const inicial = createInitialState();
      expect(inicial.exercises.every((e) => !!e.catalogRef)).toBe(true);
    });

    it('cada ejercicio sembrado resuelve a un grupo muscular', () => {
      const inicial = createInitialState();
      const sinGrupo = inicial.exercises
        .filter((e) => !catalog.byRef(e.catalogRef ?? null)?.group)
        .map((e) => e.name);

      expect(sinGrupo).toEqual([]);
    });
  });
});
