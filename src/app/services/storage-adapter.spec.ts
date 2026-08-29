import { TestBed } from '@angular/core/testing';
import { GT_KEYS, StorageAdapter, TMP_SUFFIX } from './storage-adapter';

/**
 * El test que la tarea T-106 exige escribir ANTES que la migración: un corte a mitad del
 * commit multi-clave no puede dejar el almacenamiento incoherente (`audit.md` R-1).
 */
describe('StorageAdapter', () => {
  let adapter: StorageAdapter;

  const raw = (key: string): string | null => localStorage.getItem(key);
  const tmps = (): string[] => Object.keys(localStorage).filter((k) => k.endsWith(TMP_SUFFIX));

  /** Hace fallar el enésimo `setItem` para simular un corte en ese punto exacto. */
  const failOnSetItemCall = (n: number): (() => number) => {
    let calls = 0;
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
      this: Storage,
      k: string,
      v: string,
    ) {
      calls += 1;
      if (calls === n) throw new DOMException('corte simulado', 'QuotaExceededError');
      real.call(this, k, v);
    });
    return () => calls;
  };

  const commitV1 = (): ReturnType<StorageAdapter['commit']> =>
    adapter.commit(
      {
        [GT_KEYS.routines]: [{ id: 'd1', name: 'Pecho', exerciseIds: ['e1'] }],
        [GT_KEYS.sessions]: [{ id: 's1', dayId: 'd1' }],
      },
      { schemaVersion: 7 },
    );

  beforeEach(() => {
    localStorage.clear();
    adapter = TestBed.inject(StorageAdapter);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('commit()', () => {
    it('escribe todas las claves y sube la generación', () => {
      const result = commitV1();

      expect(result).toEqual({ ok: true, generation: 1 });
      expect(adapter.read(GT_KEYS.routines)).toEqual([
        { id: 'd1', name: 'Pecho', exerciseIds: ['e1'] },
      ]);
      expect(adapter.readMeta()).toEqual({ schemaVersion: 7, generation: 1 });
    });

    it('no deja temporales tras un commit exitoso', () => {
      commitV1();
      expect(tmps()).toEqual([]);
    });

    it('rechaza el conjunto si el validador lo desaprueba, sin tocar lo definitivo', () => {
      commitV1();

      const result = adapter.commit(
        { [GT_KEYS.routines]: [] },
        { schemaVersion: 7, validate: () => 'rutinas vacías' },
      );

      expect(result).toEqual({ ok: false, reason: 'invalid', detail: 'rutinas vacías' });
      expect(adapter.read(GT_KEYS.routines)).toHaveLength(1);
      expect(adapter.readMeta()?.generation).toBe(1);
      expect(tmps()).toEqual([]);
    });

    it('reporta cuota sin dejar basura cuando no entra ni el temporal', () => {
      failOnSetItemCall(1);

      const result = commitV1();

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('quota');
      expect(tmps()).toEqual([]);
    });
  });

  describe('corte a mitad de la escritura (R-1)', () => {
    it('ANTES del punto de commit: el estado anterior queda intacto (rollback)', () => {
      commitV1();
      const before = raw(GT_KEYS.routines);

      // setItem #1 y #2 son los temporales; cortamos en el segundo, antes de gt_meta.
      failOnSetItemCall(2);
      const result = adapter.commit(
        {
          [GT_KEYS.routines]: [{ id: 'd2', name: 'Pierna', exerciseIds: [] }],
          [GT_KEYS.sessions]: [],
        },
        { schemaVersion: 7 },
      );

      expect(result.ok).toBe(false);
      // Lo definitivo no se movió y la generación tampoco
      expect(raw(GT_KEYS.routines)).toBe(before);
      expect(adapter.readMeta()).toEqual({ schemaVersion: 7, generation: 1 });
      // El propio commit ya deshizo su rastro, así que al arrancar no queda nada por
      // reparar. El corte "duro" —el proceso muere sin llegar al catch— deja temporales
      // huérfanos y lo cubre el test de recover() más abajo.
      expect(tmps()).toEqual([]);

      vi.restoreAllMocks();
      expect(adapter.recover()).toBe('none');
      expect(raw(GT_KEYS.routines)).toBe(before);
    });

    it('corte duro antes del punto de commit: los temporales se descartan al arrancar', () => {
      commitV1();
      const before = raw(GT_KEYS.routines);

      // Simula el proceso muriendo tras escribir temporales, sin llegar a gt_meta:
      // no hubo catch que limpiara nada.
      localStorage.setItem(
        `${GT_KEYS.routines}${TMP_SUFFIX}`,
        JSON.stringify([{ id: 'd2', name: 'a medias', exerciseIds: [] }]),
      );

      expect(adapter.recover()).toBe('rolled-back');

      // Sin punto de commit, esos datos no valen: gana el estado anterior completo
      expect(raw(GT_KEYS.routines)).toBe(before);
      expect(tmps()).toEqual([]);
    });

    it('DESPUÉS del punto de commit: recover() termina la promoción (roll-forward)', () => {
      commitV1();

      // #1 y #2 temporales · #3 es gt_meta con pending (punto de commit) · #4 promoción.
      // Cortar en #4 deja el pending escrito y los datos completos en los temporales.
      failOnSetItemCall(4);
      const nuevasRutinas = [{ id: 'd2', name: 'Pierna', exerciseIds: ['e9'] }];
      adapter.commit(
        { [GT_KEYS.routines]: nuevasRutinas, [GT_KEYS.sessions]: [] },
        { schemaVersion: 7 },
      );

      // Mientras tanto el disco muestra lo viejo: nadie ve un estado a medias
      expect(adapter.read(GT_KEYS.routines)).toEqual([
        { id: 'd1', name: 'Pecho', exerciseIds: ['e1'] },
      ]);
      expect(adapter.readMeta()?.pending).toEqual({
        generation: 2,
        keys: [GT_KEYS.routines, GT_KEYS.sessions],
      });

      // Al arrancar de nuevo, el commit se completa con los datos ya validados
      vi.restoreAllMocks();
      expect(adapter.recover()).toBe('rolled-forward');

      expect(adapter.read(GT_KEYS.routines)).toEqual(nuevasRutinas);
      expect(adapter.read(GT_KEYS.sessions)).toEqual([]);
      expect(adapter.readMeta()).toEqual({ schemaVersion: 7, generation: 2 });
      expect(tmps()).toEqual([]);
    });

    it('una promoción cortada por la mitad se reanuda sin duplicar ni perder claves', () => {
      commitV1();

      // Cortar en #5: la primera clave ya se promovió, la segunda no.
      failOnSetItemCall(5);
      adapter.commit(
        {
          [GT_KEYS.routines]: [{ id: 'd2', name: 'Pierna', exerciseIds: [] }],
          [GT_KEYS.sessions]: [{ id: 's9', dayId: 'd2' }],
        },
        { schemaVersion: 7 },
      );

      vi.restoreAllMocks();
      expect(adapter.recover()).toBe('rolled-forward');

      // Ambas claves terminan en la generación nueva: nada quedó mezclado
      expect(adapter.read(GT_KEYS.routines)).toEqual([
        { id: 'd2', name: 'Pierna', exerciseIds: [] },
      ]);
      expect(adapter.read(GT_KEYS.sessions)).toEqual([{ id: 's9', dayId: 'd2' }]);
      expect(adapter.readMeta()).toEqual({ schemaVersion: 7, generation: 2 });
    });
  });

  describe('recover()', () => {
    it('sin nada pendiente ni temporales no hace nada', () => {
      commitV1();
      expect(adapter.recover()).toBe('none');
      expect(adapter.readMeta()?.generation).toBe(1);
    });

    it('barre temporales huérfanos de un intento abortado', () => {
      commitV1();
      localStorage.setItem(`${GT_KEYS.sessions}${TMP_SUFFIX}`, '[]');

      expect(adapter.recover()).toBe('rolled-back');
      expect(tmps()).toEqual([]);
    });
  });

  describe('lectura', () => {
    it('hasData() distingue un almacenamiento nuevo de uno ya escrito', () => {
      expect(adapter.hasData()).toBe(false);
      commitV1();
      expect(adapter.hasData()).toBe(true);
    });

    it('read() devuelve null ante una clave corrupta en vez de lanzar', () => {
      localStorage.setItem(GT_KEYS.sessions, '{no es json');
      expect(adapter.read(GT_KEYS.sessions)).toBeNull();
    });

    it('readMeta() devuelve null si gt_meta está corrupto o incompleto', () => {
      localStorage.setItem(GT_KEYS.meta, '{"generation": 3}');
      expect(adapter.readMeta()).toBeNull();
    });
  });
});
