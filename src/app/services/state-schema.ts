import { ExerciseUnit } from '../models/workout.model';

/**
 * Validación de esquema del estado (RF-STO-04, `audit.md` §3.2 y R-2).
 *
 * Dos niveles, y la diferencia importa:
 *
 * - `validateRawState()` corre **antes** de migrar, sobre lo que había en disco. Tiene que
 *   aceptar TODOS los esquemas históricos (v1…v6): en v4 los ejercicios vivían embebidos en
 *   cada día, en v5 pasaron al catálogo. Si esto fuera estricto contra el modelo de hoy,
 *   marcaría como corrupto el estado sano de cualquier usuario que aún no migró — que es
 *   exactamente la forma de destruir datos que R-2 describe. Solo rechaza lo que rompería
 *   la app: tipos incompatibles, no campos ausentes (`buildState()` los rellena).
 *
 * - `validateMigratedState()` corre **después** de migrar y sí es estricta: es la
 *   postcondición de nuestra propia migración. Si falla, el bug es nuestro y el estado
 *   original va a cuarentena en vez de sobrescribirse.
 */

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidationResult = { ok: true } | { ok: false; issues: ValidationIssue[] };

const VALID_UNITS: readonly string[] = [
  'KG',
  'KG_PER_HAND',
  'KG_PER_ARM',
  'TIME',
  'BODYWEIGHT',
] satisfies readonly ExerciseUnit[];

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';

/** Acumula problemas con su ruta para que el mensaje de cuarentena diga QUÉ falló. */
class Issues {
  readonly list: ValidationIssue[] = [];

  add(path: string, message: string): void {
    // Un estado corrupto puede generar miles de problemas; con los primeros alcanza
    // para diagnosticar y evita quedarse sin memoria construyendo el informe.
    if (this.list.length < 20) this.list.push({ path, message });
  }

  get failed(): boolean {
    return this.list.length > 0;
  }

  result(): ValidationResult {
    return this.failed ? { ok: false, issues: this.list } : { ok: true };
  }
}

function checkString(i: Issues, v: unknown, path: string): void {
  if (!isStr(v)) i.add(path, `se esperaba string, llegó ${describe(v)}`);
}

function checkNumber(i: Issues, v: unknown, path: string): void {
  if (!isNum(v)) i.add(path, `se esperaba número, llegó ${describe(v)}`);
}

function describe(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

/**
 * Validación tolerante previa a la migración: acepta cualquier `schemaVersion` histórico.
 * Solo se queja de tipos que la migración no podría manejar.
 */
export function validateRawState(x: unknown): ValidationResult {
  const i = new Issues();

  if (!isObj(x)) {
    i.add('$', `el estado debe ser un objeto, llegó ${describe(x)}`);
    return i.result();
  }

  if ('schemaVersion' in x && !isNum(x['schemaVersion'])) {
    i.add('schemaVersion', `se esperaba número, llegó ${describe(x['schemaVersion'])}`);
  }
  for (const key of ['activeDayIndex', 'routinePointer'] as const) {
    if (key in x && !isNum(x[key])) i.add(key, `se esperaba número, llegó ${describe(x[key])}`);
  }

  // days: obligatorio en todos los esquemas
  if (!Array.isArray(x['days'])) {
    i.add('days', `se esperaba array, llegó ${describe(x['days'])}`);
  } else {
    x['days'].forEach((d, idx) => {
      const path = `days[${idx}]`;
      if (!isObj(d)) {
        i.add(path, `se esperaba objeto, llegó ${describe(d)}`);
        return;
      }
      checkString(i, d['id'], `${path}.id`);
      checkString(i, d['name'], `${path}.name`);
      // v5+ guarda `exerciseIds`; v4 y anteriores embebían `exercises`. Ambos valen.
      if ('exerciseIds' in d && !Array.isArray(d['exerciseIds'])) {
        i.add(`${path}.exerciseIds`, `se esperaba array, llegó ${describe(d['exerciseIds'])}`);
      }
      if ('exercises' in d && !Array.isArray(d['exercises'])) {
        i.add(`${path}.exercises`, `se esperaba array, llegó ${describe(d['exercises'])}`);
      }
    });
  }

  if ('exercises' in x) checkExerciseList(i, x['exercises'], 'exercises', false);
  if ('sessions' in x) checkSessionList(i, x['sessions'], 'sessions');

  if ('todayProgress' in x && !isObj(x['todayProgress'])) {
    i.add('todayProgress', `se esperaba objeto, llegó ${describe(x['todayProgress'])}`);
  }
  if ('trash' in x && !Array.isArray(x['trash'])) {
    i.add('trash', `se esperaba array, llegó ${describe(x['trash'])}`);
  }
  if ('settings' in x) checkSettings(i, x['settings'], false);

  return i.result();
}

/** Postcondición estricta de la migración: el estado ya debe tener la forma de hoy. */
export function validateMigratedState(x: unknown): ValidationResult {
  const i = new Issues();

  if (!isObj(x)) {
    i.add('$', `el estado debe ser un objeto, llegó ${describe(x)}`);
    return i.result();
  }

  checkNumber(i, x['schemaVersion'], 'schemaVersion');
  checkNumber(i, x['activeDayIndex'], 'activeDayIndex');
  checkNumber(i, x['routinePointer'], 'routinePointer');

  checkExerciseList(i, x['exercises'], 'exercises', true);

  if (!Array.isArray(x['days'])) {
    i.add('days', `se esperaba array, llegó ${describe(x['days'])}`);
  } else {
    x['days'].forEach((d, idx) => {
      const path = `days[${idx}]`;
      if (!isObj(d)) {
        i.add(path, `se esperaba objeto, llegó ${describe(d)}`);
        return;
      }
      checkString(i, d['id'], `${path}.id`);
      checkString(i, d['name'], `${path}.name`);
      if (!Array.isArray(d['exerciseIds'])) {
        i.add(`${path}.exerciseIds`, `se esperaba array, llegó ${describe(d['exerciseIds'])}`);
      } else {
        d['exerciseIds'].forEach((id, j) => checkString(i, id, `${path}.exerciseIds[${j}]`));
      }
      // Tras migrar, ningún día debe seguir con ejercicios embebidos (v4 y anteriores).
      if ('exercises' in d) i.add(`${path}.exercises`, 'quedó forma pre-v5 sin migrar');
    });
  }

  checkSessionList(i, x['sessions'], 'sessions');

  if (!isObj(x['todayProgress'])) {
    i.add('todayProgress', `se esperaba objeto, llegó ${describe(x['todayProgress'])}`);
  } else {
    for (const [dayId, tp] of Object.entries(x['todayProgress'])) {
      const path = `todayProgress["${dayId}"]`;
      if (!isObj(tp)) {
        i.add(path, `se esperaba objeto, llegó ${describe(tp)}`);
        continue;
      }
      checkString(i, tp['dateISO'], `${path}.dateISO`);
      if (!isObj(tp['sets'])) {
        i.add(`${path}.sets`, `se esperaba objeto, llegó ${describe(tp['sets'])}`);
      }
    }
  }

  checkSettings(i, x['settings'], true);

  return i.result();
}

function checkExerciseList(i: Issues, list: unknown, path: string, strict: boolean): void {
  if (!Array.isArray(list)) {
    i.add(path, `se esperaba array, llegó ${describe(list)}`);
    return;
  }
  list.forEach((e, idx) => {
    const p = `${path}[${idx}]`;
    if (!isObj(e)) {
      i.add(p, `se esperaba objeto, llegó ${describe(e)}`);
      return;
    }
    checkString(i, e['id'], `${p}.id`);
    checkString(i, e['name'], `${p}.name`);
    if (!strict) return;
    for (const k of ['brick', 'defaultSets', 'defaultRepTarget', 'restSeconds'] as const) {
      checkNumber(i, e[k], `${p}.${k}`);
    }
    checkString(i, e['notes'], `${p}.notes`);
    if (!isStr(e['unit']) || !VALID_UNITS.includes(e['unit'])) {
      i.add(`${p}.unit`, `unidad desconocida: ${JSON.stringify(e['unit'])}`);
    }
  });
}

function checkSessionList(i: Issues, list: unknown, path: string): void {
  if (!Array.isArray(list)) {
    i.add(path, `se esperaba array, llegó ${describe(list)}`);
    return;
  }
  list.forEach((s, idx) => {
    const p = `${path}[${idx}]`;
    if (!isObj(s)) {
      i.add(p, `se esperaba objeto, llegó ${describe(s)}`);
      return;
    }
    checkString(i, s['id'], `${p}.id`);
    checkString(i, s['dayId'], `${p}.dayId`);
    checkString(i, s['dateISO'], `${p}.dateISO`);
    if ('skipped' in s && !isBool(s['skipped'])) {
      i.add(`${p}.skipped`, `se esperaba booleano, llegó ${describe(s['skipped'])}`);
    }
    // Opcionales por diseño: el historial anterior a v7 no los tiene (RF-SES-08b, R-5).
    for (const k of ['startedAt', 'endedAt'] as const) {
      if (k in s && s[k] !== undefined && !isStr(s[k])) {
        i.add(`${p}.${k}`, `se esperaba fecha ISO, llegó ${describe(s[k])}`);
      }
    }
    if (!Array.isArray(s['sets'])) {
      i.add(`${p}.sets`, `se esperaba array, llegó ${describe(s['sets'])}`);
      return;
    }
    s['sets'].forEach((set, j) => {
      const sp = `${p}.sets[${j}]`;
      if (!isObj(set)) {
        i.add(sp, `se esperaba objeto, llegó ${describe(set)}`);
        return;
      }
      checkString(i, set['exerciseId'], `${sp}.exerciseId`);
      checkNumber(i, set['setIndex'], `${sp}.setIndex`);
      checkNumber(i, set['weight'], `${sp}.weight`);
      checkNumber(i, set['reps'], `${sp}.reps`);
    });
  });
}

function checkSettings(i: Issues, settings: unknown, strict: boolean): void {
  if (settings === undefined && !strict) return;
  if (!isObj(settings)) {
    i.add('settings', `se esperaba objeto, llegó ${describe(settings)}`);
    return;
  }
  if (strict) {
    checkString(i, settings['apiKey'], 'settings.apiKey');
    checkString(i, settings['cohereApiKey'], 'settings.cohereApiKey');
    checkNumber(i, settings['defaultRest'], 'settings.defaultRest');
    for (const k of ['sounds', 'haptics'] as const) {
      if (!isBool(settings[k])) {
        i.add(`settings.${k}`, `se esperaba booleano, llegó ${describe(settings[k])}`);
      }
    }
  }

  const profile = settings['userProfile'];
  if (profile === undefined && !strict) return;
  if (!isObj(profile)) {
    i.add('settings.userProfile', `se esperaba objeto, llegó ${describe(profile)}`);
    return;
  }
  const log = profile['weightLog'];
  if (log !== undefined && !Array.isArray(log)) {
    i.add('settings.userProfile.weightLog', `se esperaba array, llegó ${describe(log)}`);
    return;
  }
  if (Array.isArray(log)) {
    log.forEach((entry, idx) => {
      const p = `settings.userProfile.weightLog[${idx}]`;
      if (!isObj(entry)) {
        i.add(p, `se esperaba objeto, llegó ${describe(entry)}`);
        return;
      }
      checkString(i, entry['dateISO'], `${p}.dateISO`);
      checkNumber(i, entry['weightKg'], `${p}.weightKg`);
    });
  }
}

/** Resumen legible de los problemas, para el mensaje de cuarentena y los logs. */
export function formatIssues(issues: ValidationIssue[]): string {
  return issues.map((v) => `${v.path}: ${v.message}`).join(' · ');
}
