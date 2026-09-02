/**
 * Opciones que el generador de rutinas sabe representar, y cómo ajustarse a ellas (T-830).
 *
 * Viven en un módulo puro —sin Angular ni servicios— porque hay TRES puertas al mismo
 * estado y las tres tienen que coincidir por construcción:
 *
 *   1. Los botones de la vista R7.
 *   2. El deep link `?gen=1&days=4&min=60`, que es editable y se comparte.
 *   3. La petición de rutina que el coach detecta en el chat.
 *
 * Cuando los valores eran literales dentro del `@for` del template, nadie más podía
 * consultarlos: el chat pedía 7 días, `genDays.set(7)` funcionaba sin quejarse y el
 * selector se quedaba sin ninguna opción marcada mientras el generador corría con un
 * número que el usuario nunca eligió.
 */
export const GEN_DAYS = [2, 3, 4, 5, 6] as const;
export const GEN_MINUTES = [45, 60, 90] as const;

export const DEFAULT_GEN_DAYS = 4;
export const DEFAULT_GEN_MINUTES = 60;

/**
 * Ajusta al valor permitido más cercano.
 *
 * Fuera de rango NO es un error: "entreno 30 minutos" es información buena que la UI no
 * puede representar. Rechazarla pierde el dato; ajustarla lo conserva. Lo que no se puede
 * hacer es aceptarla en silencio y generar otra cosa — por eso quien la ajusta enseña
 * SIEMPRE el valor ajustado antes de gastar la llamada.
 */
export function snapTo(allowed: readonly number[], raw: unknown, fallback: number): number {
  // `Number(null)` y `Number('')` valen 0, así que un parámetro ausente se colaría como un
  // cero perfectamente finito y ajustaría al valor más bajo en vez de al de por defecto.
  if (raw === null || raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return allowed.reduce((best, v) => (Math.abs(v - n) < Math.abs(best - n) ? v : best));
}
