import { AA_LARGE_TEXT, AA_NORMAL_TEXT, contrastRatio, hueDistance } from './contrast';

/**
 * Paleta de los tres temas (T-705).
 *
 * Duplicada aquí a propósito, en vez de leer `styles.scss`: si alguien cambia un token sin
 * mirar el contraste, este test falla y le obliga a pasar por aquí. Un espejo automático no
 * protegería de nada, porque se actualizaría solo.
 */
const THEMES = {
  dark: {
    bg0: '#0b0e11',
    bg1: '#12161b',
    bg2: '#171c22',
    text0: '#f2f5f7',
    text1: '#c7d0d9',
    text2: '#8d98a4',
    text3: '#7b848e',
    warning: '#ffc24d',
    accent: '#ff6a3d',
    accentFg: '#0b0e11',
    success: '#3fd68c',
    successFg: '#0b0e11',
    danger: '#ff6b6b',
  },
  light: {
    bg0: '#f8f9fa',
    bg1: '#ffffff',
    bg2: '#f1f5f9',
    text0: '#1e293b',
    text1: '#334155',
    text2: '#55606f',
    text3: '#66707f',
    warning: '#b45309',
    accent: '#c2410c',
    accentFg: '#ffffff',
    success: '#047857',
    successFg: '#ffffff',
    danger: '#dc2626',
  },
  highContrast: {
    bg0: '#000000',
    bg1: '#0a0a0a',
    bg2: '#111111',
    text0: '#ffffff',
    text1: '#ffff00',
    text2: '#ffff00',
    text3: '#aaaaaa',
    warning: '#ffff00',
    accent: '#ffff00',
    accentFg: '#000000',
    success: '#00ff00',
    successFg: '#000000',
    danger: '#ff4444',
  },
} as const;

describe('contrastRatio()', () => {
  it('negro sobre blanco es el máximo', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
  });

  it('un color contra sí mismo no contrasta', () => {
    expect(contrastRatio('#ff6a3d', '#ff6a3d')).toBe(1);
  });

  it('acepta hex de tres dígitos', () => {
    expect(contrastRatio('#fff', '#000')).toBe(21);
  });
});

describe('Paleta: contraste en los tres temas (T-705, Art. 1)', () => {
  for (const [name, theme] of Object.entries(THEMES)) {
    describe(name, () => {
      it('el texto principal se lee sobre los dos fondos', () => {
        expect(contrastRatio(theme.text0, theme.bg0)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        expect(contrastRatio(theme.text0, theme.bg1)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });

      it('el texto secundario también, no solo el principal', () => {
        expect(contrastRatio(theme.text1, theme.bg0)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });

      it('los grises apagados llegan a AA sobre las tres superficies', () => {
        // text-2 y text-3 se usan en etiquetas de 11 px: eso es texto NORMAL para la WCAG,
        // no texto grande. Medirlos solo contra bg-0 dejaba pasar el caso real, que es una
        // etiqueta apagada dentro de una tarjeta elevada.
        for (const bg of [theme.bg0, theme.bg1, theme.bg2]) {
          expect(contrastRatio(theme.text2, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
          expect(contrastRatio(theme.text3, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
      });

      it('la escala de grises baja de forma monótona', () => {
        // Si dos escalones se cruzan, la jerarquía visual miente: lo secundario se vería
        // más presente que lo principal.
        const steps = [theme.text0, theme.text1, theme.text2, theme.text3].map((c) =>
          contrastRatio(c, theme.bg0),
        );
        for (let i = 1; i < steps.length; i++) {
          expect(steps[i]).toBeLessThanOrEqual(steps[i - 1]);
        }
      });

      it('el ámbar de alerta se lee sobre el fondo', () => {
        expect(contrastRatio(theme.warning, theme.bg0)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
      });

      it('el acento se lee como texto y como fondo de botón', () => {
        // El naranja se usa como COLOR DE TEXTO (enlaces, badge IA), no solo como relleno:
        // por eso se le exige AA normal sobre las tres superficies, no el 3:1 de icono.
        for (const bg of [theme.bg0, theme.bg1, theme.bg2]) {
          expect(contrastRatio(theme.accent, bg)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
        }
        expect(contrastRatio(theme.accent, theme.bg0)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
        expect(contrastRatio(theme.accentFg, theme.accent)).toBeGreaterThanOrEqual(AA_NORMAL_TEXT);
      });

      it('el verde de "hecho" se distingue del fondo y de su propio texto', () => {
        expect(contrastRatio(theme.success, theme.bg0)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
        expect(contrastRatio(theme.successFg, theme.success)).toBeGreaterThanOrEqual(
          AA_NORMAL_TEXT,
        );
      });

      it('el rojo de error se lee sobre el fondo', () => {
        expect(contrastRatio(theme.danger, theme.bg0)).toBeGreaterThanOrEqual(AA_LARGE_TEXT);
      });

      it('acento y éxito tienen tonos claramente distintos', () => {
        // La separación semántica (acción vs. hecho) solo funciona si se ven distintos, y eso
        // es cuestión de TONO: el ratio de contraste mide luminancia y aquí no dice nada.
        expect(hueDistance(theme.accent, theme.success)).toBeGreaterThan(45);
      });
    });
  }
});
