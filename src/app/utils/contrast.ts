/**
 * Contraste WCAG entre dos colores hex.
 *
 * Vive en el código, y no en una hoja de cálculo, para que los tests puedan comprobar la
 * paleta de verdad: un token que se cambia sin mirar el contraste es un bug de accesibilidad
 * que nadie ve hasta que alguien no puede leer la app (T-705, Art. 1).
 */
export function relativeLuminance(hex: string): number {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const channels = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Ratio de contraste WCAG (1 = idénticos, 21 = negro sobre blanco). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}

/** Mínimos de WCAG 2.1 AA. */
export const AA_NORMAL_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;

/** Tono en grados (0–360) de un color hex. */
export function hue(hex: string): number {
  const value = hex.replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / delta) % 6;
  else if (max === g) h = (b - r) / delta + 2;
  else h = (r - g) / delta + 4;
  return (h * 60 + 360) % 360;
}

/**
 * Distancia angular entre dos tonos (0–180).
 *
 * El ratio de contraste NO sirve para esto: mide luminancia, y dos colores de tonos opuestos
 * pueden tener la misma. Para comprobar que "acción" y "hecho" no se confunden hay que mirar
 * el tono, que es lo que de verdad los separa.
 */
export function hueDistance(a: string, b: string): number {
  const diff = Math.abs(hue(a) - hue(b));
  return diff > 180 ? 360 - diff : diff;
}
