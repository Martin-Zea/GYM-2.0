/**
 * Fecha: helpers puros para trabajar con fechas en formato ISO `YYYY-MM-DD`.
 *
 * ## Por qué existen `toLocalISO` y `shiftISO` (T-831)
 *
 * La app tenía DOS convenciones mezcladas. Unas fechas se anclaban en UTC y se manipulaban
 * con `getUTC*`/`setUTC*` —correcto—; otras se construían en hora LOCAL (`new Date()`,
 * `setDate(getDate() - n)`) y luego se serializaban con `toISOString()`, que devuelve el día
 * en UTC. Eso desplaza la fecha un día entero:
 *
 *   - En UTC−3 (Argentina), a partir de las 21:00 `toISOString()` ya devuelve MAÑANA.
 *     Entrenar el lunes por la noche quedaba registrado como martes.
 *   - En UTC+2 (Europa), una fecha construida a medianoche local cae en el día ANTERIOR.
 *
 * La regla es una sola: **el día del atleta es el día de su reloj**. Una fecha que nace en
 * local se serializa con `toLocalISO`; la aritmética entre fechas ya en ISO usa `shiftISO`,
 * que ancla a mediodía UTC y por eso es inmune tanto a la zona horaria como al cambio de
 * hora — `setDate()` sobre una fecha local puede caer en un día de 23 o 25 horas.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Días enteros transcurridos entre dos fechas ISO (`YYYY-MM-DD`), `to - from`.
 * Centraliza el cálculo que antes estaba duplicado en varios componentes.
 */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.floor((new Date(toISO).getTime() - new Date(fromISO).getTime()) / MS_PER_DAY);
}

/**
 * `YYYY-MM-DD` del día LOCAL de una fecha.
 *
 * NO usar `toISOString().slice(0, 10)` para esto: devuelve el día en UTC, que para medio
 * planeta no es el día que el usuario tiene delante.
 */
export function toLocalISO(d: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Suma (o resta, con `days` negativo) días a una fecha ISO.
 *
 * Ancla a mediodía UTC a propósito: así ni la zona horaria ni el cambio de hora pueden
 * mover el resultado al día de al lado. Una entrada ilegible se devuelve tal cual — es
 * preferible una fecha sin desplazar que un `Invalid Date` propagándose.
 */
export function shiftISO(dateISO: string, days: number): string {
  const t = Date.parse(`${dateISO}T12:00:00Z`);
  if (!Number.isFinite(t)) return dateISO;
  return new Date(t + days * MS_PER_DAY).toISOString().slice(0, 10);
}

/** Día de la semana de una fecha ISO, con **0 = lunes**. `-1` si la fecha no es legible. */
export function weekdayISO(dateISO: string): number {
  const t = Date.parse(`${dateISO}T12:00:00Z`);
  if (!Number.isFinite(t)) return -1;
  return (new Date(t).getUTCDay() + 6) % 7;
}

/** Lunes de la semana de una fecha ISO. */
export function mondayOfISO(dateISO: string): string {
  const dow = weekdayISO(dateISO);
  return dow < 0 ? dateISO : shiftISO(dateISO, -dow);
}
