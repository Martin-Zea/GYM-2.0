import { MAX_SPEC_NOTES, snapTo, GEN_DAYS, DEFAULT_GEN_DAYS } from '../utils/gen-options';
import { effectiveLastSession } from './progression.service';

/**
 * Casos borde del panel de contexto del generador (T-832).
 *
 * El panel enseña lo que se va a usar y deja corregirlo. Lo que se fija aquí es la lógica
 * pura que hay detrás; el comportamiento de la UI se cubre en el E2E.
 */
describe('Contexto del generador — casos borde', () => {
  describe('parón declarado: cuándo deja de aplicarse', () => {
    /**
     * `layoffSinceISO` NO se borra nunca (ventana histórica, T-827). Mirarlo a secas hacía
     * que el panel anunciara "volvés tras 60 días" para siempre. La regla buena es la misma
     * que usa la progresión: una sesión posterior a la declaración es la vuelta real.
     */
    it('una sesión POSTERIOR a la declaración cancela el parón', () => {
      expect(effectiveLastSession('2026-09-01', '2026-07-04', '2026-09-01')).toBe('2026-09-01');
    });

    it('un registro DENTRO de la ventana no cuenta como vuelta', () => {
      expect(effectiveLastSession('2026-08-01', '2026-07-04', '2026-09-01')).toBe('2026-07-04');
    });

    it('sin parón declarado manda siempre el registro', () => {
      expect(effectiveLastSession('2026-08-01', null)).toBe('2026-08-01');
    });
  });

  describe('tope de las notas', () => {
    it('es el mismo número que enseña y acepta el campo', () => {
      // El prompt corta en MAX_SPEC_NOTES; si el `maxlength` no coincidiera, el atleta
      // escribiría texto que nunca llega al modelo y nadie se lo diría.
      expect(MAX_SPEC_NOTES).toBe(200);
    });
  });

  describe('valores de la spec que llegan por la URL', () => {
    it('un parámetro ausente cae al valor por defecto, no al mínimo', () => {
      expect(snapTo(GEN_DAYS, null, DEFAULT_GEN_DAYS)).toBe(DEFAULT_GEN_DAYS);
    });
  });
});
