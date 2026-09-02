import { daysBetweenISO, mondayOfISO, shiftISO, toLocalISO, weekdayISO } from './date';

/**
 * El día del atleta es el de SU reloj (T-831).
 *
 * Estos tests existen porque la app usaba `toISOString().slice(0, 10)` sobre fechas
 * construidas en hora local, y eso devuelve el día en UTC: en Argentina, entrenar un lunes
 * a las 21:30 quedaba registrado como martes.
 */
describe('toLocalISO() — el día LOCAL, no el de UTC', () => {
  it('a las 21:30 en UTC−3 sigue siendo el mismo día', () => {
    // Lunes 7/9/2026 21:30 en Argentina = martes 8 a las 00:30 UTC.
    const nocheEnArgentina = new Date('2026-09-08T00:30:00Z');
    // Se construye la fecha "local" equivalente para no depender de la TZ del runner.
    const local = new Date(2026, 8, 7, 21, 30, 0);
    expect(toLocalISO(local)).toBe('2026-09-07');
    // La versión que tenía la app se equivocaba justo aquí:
    expect(nocheEnArgentina.toISOString().slice(0, 10)).toBe('2026-09-08');
  });

  it('a las 00:30 sigue siendo el día que empieza, no el anterior', () => {
    expect(toLocalISO(new Date(2026, 8, 8, 0, 30, 0))).toBe('2026-09-08');
  });

  it('rellena mes y día con cero a la izquierda', () => {
    expect(toLocalISO(new Date(2026, 0, 5, 12, 0, 0))).toBe('2026-01-05');
  });
});

describe('shiftISO() — aritmética de días inmune a zona horaria y cambio de hora', () => {
  it('suma y resta días', () => {
    expect(shiftISO('2026-09-07', 1)).toBe('2026-09-08');
    expect(shiftISO('2026-09-07', -7)).toBe('2026-08-31');
    expect(shiftISO('2026-09-07', 0)).toBe('2026-09-07');
  });

  it('cruza fin de mes y fin de año', () => {
    expect(shiftISO('2026-08-31', 1)).toBe('2026-09-01');
    expect(shiftISO('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftISO('2027-01-01', -1)).toBe('2026-12-31');
  });

  it('respeta el año bisiesto', () => {
    expect(shiftISO('2028-02-28', 1)).toBe('2028-02-29');
    expect(shiftISO('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('no se mueve en el cambio de hora', () => {
    // En Chile el DST cae un domingo de septiembre: con `setDate()` sobre una fecha local,
    // un día de 23 h podía dejar el resultado en la fecha de al lado. Anclado a mediodía
    // UTC no hay forma de que ocurra.
    expect(shiftISO('2026-09-05', 1)).toBe('2026-09-06');
    expect(shiftISO('2026-09-06', 1)).toBe('2026-09-07');
  });

  it('una fecha ilegible se devuelve tal cual en vez de propagar Invalid Date', () => {
    expect(shiftISO('no-es-fecha', 3)).toBe('no-es-fecha');
    expect(shiftISO('', 1)).toBe('');
  });
});

describe('weekdayISO() / mondayOfISO()', () => {
  it('cuenta con lunes = 0', () => {
    expect(weekdayISO('2026-09-07')).toBe(0); // lunes
    expect(weekdayISO('2026-09-13')).toBe(6); // domingo
  });

  it('el lunes de un domingo es el lunes ANTERIOR, no el siguiente', () => {
    expect(mondayOfISO('2026-09-13')).toBe('2026-09-07');
    expect(mondayOfISO('2026-09-07')).toBe('2026-09-07');
    expect(mondayOfISO('2026-09-09')).toBe('2026-09-07');
  });

  it('una fecha ilegible no inventa una semana', () => {
    expect(weekdayISO('vacío')).toBe(-1);
    expect(mondayOfISO('vacío')).toBe('vacío');
  });
});

describe('daysBetweenISO()', () => {
  it('cuenta días enteros con signo', () => {
    expect(daysBetweenISO('2026-09-01', '2026-09-08')).toBe(7);
    expect(daysBetweenISO('2026-09-08', '2026-09-01')).toBe(-7);
    expect(daysBetweenISO('2026-09-08', '2026-09-08')).toBe(0);
  });
});
