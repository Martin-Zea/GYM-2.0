import { Injectable, inject, signal } from '@angular/core';
import {
  AppSettings,
  AppState,
  Exercise,
  ExerciseUnit,
  SetRecord,
  Session,
  StoredWorkoutDay,
  TodayDayProgress,
  UserProfile,
  WeightLogEntry,
} from '../models/workout.model';
import { catalogRefForName } from './catalog.service';
import { tonnageOf } from '../utils/session';
import { DEFAULT_ROUTINE_ID, createInitialState } from '../data/initial-data';
import { STORAGE_KEYS } from './storage-keys';
import { IDB_SNAPSHOT_STORE, IDB_STATE_STORE, IdbService } from './idb';
import { daysBetweenISO as daysBetween } from '../utils/date';
import { formatIssues, validateMigratedState, validateRawState } from './state-schema';
import { GT_KEYS, GtDataKey, StorageAdapter } from './storage-adapter';
import { TabLockService } from './tab-lock.service';

const STORAGE_KEY = STORAGE_KEYS.appState;
const CURRENT_SCHEMA = 10;

/**
 * Unidades del esquema ≤ v6 → enum neutro de v7 (`audit.md` R-4).
 *
 * Antes el valor almacenado era la etiqueta en español: hacía de clave de dominio y de
 * texto de UI a la vez. Eso ataba el dato al idioma e impedía tratar lb como capa de
 * presentación sobre un almacenamiento canónico en kg.
 */
const LEGACY_UNIT_MAP: Record<string, ExerciseUnit> = {
  kg: 'KG',
  'kg por mano': 'KG_PER_HAND',
  'kg por brazo': 'KG_PER_ARM',
  tiempo: 'TIME',
  'peso corporal': 'BODYWEIGHT',
};

/** Resultado de `save()`: la capa de persistencia reporta el fallo, la UI decide qué mostrar. */
export type SaveResult = { ok: true } | { ok: false; reason: 'quota' | 'unknown' | 'quarantined' };

/** Copia del blob v6 conservada antes de migrar a `gt_*`. */
export const PREMIGRATION_KEY = 'gt_premigration_v6';

/** Medida de ocupación para la vista de Datos (RF-STO-08). */
export interface StorageEstimateInfo {
  /** Bytes que ocupan las claves de la app en localStorage. */
  appBytes: number;
  /** Bytes usados por todo el origen, si el navegador los informa. */
  usedBytes: number | null;
  quotaBytes: number | null;
  percent: number | null;
}

/** Desenlace de la migracion del blob v6 al conjunto `gt_*`. */
export type PartitionMigrationResult = 'migrated' | 'skipped' | 'failed' | 'no-backup';

/** Prefijo de las copias en cuarentena: `gt_quarantine_<timestamp ISO>`. */
export const QUARANTINE_PREFIX = 'gt_quarantine_';

/** Estado ilegible apartado sin sobrescribir, a la espera de que el usuario decida. */
export interface QuarantineInfo {
  /** Clave de localStorage donde quedó el original, intacto. */
  key: string;
  /** Momento en que se apartó (ISO). */
  atISO: string;
  /** Por qué se consideró inválido — se muestra al usuario y se loguea. */
  reason: string;
}

/**
 * Normaliza el nombre de un ejercicio para comparar identidad: sin espacios al
 * borde, minúsculas, sin acentos, espacios colapsados. "Press Banca" === "press  bancá".
 */
export function normalizeExerciseName(name: string): string {
  return name.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ');
}

/**
 * ¿Es legible este estado? Delega en `validateRawState`, que revisa tipos internos y no
 * solo la forma de `days` — la versión superficial anterior dejaba pasar sesiones o
 * ejercicios corruptos hasta que reventaban en runtime (`audit.md` §3.2).
 */
export function isValidAppState(x: unknown): boolean {
  return validateRawState(x).ok;
}

export interface HistoryEntry {
  dateISO: string;
  sets: SetRecord[];
  topWeight: number;
  topReps: number;
  totalReps: number;
  volume: number;
}

const VALID_UNITS: readonly ExerciseUnit[] = [
  'KG',
  'KG_PER_HAND',
  'KG_PER_ARM',
  'TIME',
  'BODYWEIGHT',
];

/**
 * Rellena los campos opcionales de un ejercicio con valores sanos. Un ejercicio creado a
 * mano en una versión vieja del editor puede no traerlos todos, y sin esto la validación
 * estricta posterior a la migración lo marcaría como corrupto (R-2: la validación no
 * puede convertir datos sanos en cuarentena).
 */
function normalizeExercise(e: Exercise): Exercise {
  return {
    ...e,
    brick: typeof e.brick === 'number' && Number.isFinite(e.brick) ? e.brick : 2.5,
    defaultSets:
      typeof e.defaultSets === 'number' && Number.isFinite(e.defaultSets) ? e.defaultSets : 3,
    defaultRepTarget:
      typeof e.defaultRepTarget === 'number' && Number.isFinite(e.defaultRepTarget)
        ? e.defaultRepTarget
        : 10,
    restSeconds:
      typeof e.restSeconds === 'number' && Number.isFinite(e.restSeconds) ? e.restSeconds : 60,
    unit: VALID_UNITS.includes(e.unit) ? e.unit : 'KG',
    notes: typeof e.notes === 'string' ? e.notes : '',
  };
}

function defaultUserProfile(): UserProfile {
  return {
    weightKg: null,
    heightCm: null,
    age: null,
    sex: null,
    weightLog: [],
    goal: null,
    level: null,
    equipment: null,
    daysPerWeek: null,
    aiNotes: '',
  };
}

/** Banderas de arranque que dejan de vivir en claves sueltas y pasan a `gt_meta`. */
export const FLAGS = { onboardingDone: 'onboardingDone', legalAccepted: 'legalAccepted' } as const;

/** Forma de cada partición `gt_*`. Junta o separa el `AppState` sin perder nada. */
interface Partitions {
  [GT_KEYS.routines]: {
    days: StoredWorkoutDay[];
    activeDayIndex: number;
    routinePointer: number;
  };
  [GT_KEYS.sessions]: {
    sessions: Session[];
    trash: NonNullable<AppState['trash']>;
    todayProgress: Record<string, TodayDayProgress>;
  };
  [GT_KEYS.exercises]: Exercise[];
  [GT_KEYS.profile]: Omit<UserProfile, 'weightLog'>;
  [GT_KEYS.body]: { weightLog: WeightLogEntry[] };
  [GT_KEYS.settings]: Omit<AppSettings, 'userProfile' | 'apiKey' | 'cohereApiKey'>;
  [GT_KEYS.ai]: { keys: { groq: string; cohere: string } };
}

@Injectable({ providedIn: 'root' })
export class StorageService {
  private readonly adapter = inject(StorageAdapter);
  private readonly idb = inject(IdbService);
  private readonly tabLock = inject(TabLockService);
  /** Migra estado de schemas anteriores al schema actual (v6), encadenando versiones */
  private migrate(p: Partial<AppState>): Partial<AppState> {
    const version = typeof p.schemaVersion === 'number' ? p.schemaVersion : 1;
    let m: Partial<AppState> = p;
    // v1/v2 → v3: routinePointer se separó de activeDayIndex
    if (version < 3) {
      m = { ...m, routinePointer: m.routinePointer ?? m.activeDayIndex ?? 0 };
    }
    // v3 → v4: userProfile.weightLog; se siembra con el weightKg actual si existe
    if (version < 4 && m.settings?.userProfile) {
      const profile = m.settings.userProfile;
      const weightLog: WeightLogEntry[] =
        profile.weightLog ??
        (typeof profile.weightKg === 'number'
          ? [{ dateISO: this.todayISO(), weightKg: profile.weightKg }]
          : []);
      m = { ...m, settings: { ...m.settings, userProfile: { ...profile, weightLog } } };
    }
    // v4 → v5: catálogo de ejercicios. Los ejercicios dejan de vivir embebidos en
    // cada día y pasan a un catálogo maestro; los días referencian por id. Además
    // sana duplicados históricos: si el mismo ejercicio (nombre normalizado) existía
    // en varios días con ids distintos, se unifica y se remapean sesiones/progreso.
    if (version < 5) {
      m = this.migrateToCatalog(m);
    }
    // v5 → v6: objetivo de entrenamiento y notas para la IA en el perfil de usuario
    if (version < 6 && m.settings?.userProfile) {
      const profile = m.settings.userProfile;
      m = {
        ...m,
        settings: {
          ...m.settings,
          userProfile: {
            ...profile,
            goal: profile.goal ?? null,
            aiNotes: profile.aiNotes ?? '',
          },
        },
      };
    }
    // v6 → v7: unidades a enum neutro. El peso sigue siendo canónico en kg; lb, cuando
    // llegue, será solo presentación (RF-PWA-04, `audit.md` R-4).
    if (version < 7) {
      m = {
        ...m,
        exercises: (m.exercises ?? []).map((e) => ({
          ...e,
          unit: LEGACY_UNIT_MAP[e.unit as string] ?? e.unit,
        })),
      };
    }
    // v7 → v8: nivel de experiencia en el perfil. Sin declarar (`null`) el motor asume
    // intermedio, que es el punto medio menos arriesgado (RF-IA-01, §3).
    if (version < 8 && m.settings?.userProfile) {
      const profile = m.settings.userProfile;
      m = {
        ...m,
        settings: { ...m.settings, userProfile: { ...profile, level: profile.level ?? null } },
      };
    }
    // v8 → v9: enlaza cada ejercicio del usuario con el catálogo estático por nombre
    // normalizado (`audit.md` R-3). El id NO cambia: el enlace es un dato añadido. Los que
    // no mapean se quedan sin `catalogRef` y siguen funcionando igual — adivinar el enlace
    // mezclaría historiales de ejercicios distintos.
    if (version < 9) {
      m = {
        ...m,
        exercises: (m.exercises ?? []).map((e) =>
          e.catalogRef ? e : { ...e, catalogRef: catalogRefForName(e.name) ?? undefined },
        ),
      };
    }
    // v9 → v10: los días pasan a colgar de una rutina (RF-RUT-01). Lo que había se envuelve
    // en una rutina única para no cambiar nada de lo que el usuario ve.
    if (version < 10) {
      const dayIds = (m.days ?? []).map((d) => d.id);
      m = {
        ...m,
        routines: m.routines?.length ? m.routines : [{ id: 'routine-1', name: '', dayIds }],
        activeRoutineId: m.activeRoutineId ?? m.routines?.[0]?.id ?? 'routine-1',
      };
    }
    return { ...m, schemaVersion: CURRENT_SCHEMA };
  }

  /** Extrae el catálogo de ejercicios desde días con ejercicios embebidos (pre-v5). */
  private migrateToCatalog(m: Partial<AppState>): Partial<AppState> {
    interface LegacyDay {
      id: string;
      name: string;
      exercises?: Exercise[];
      exerciseIds?: string[];
    }
    const legacyDays = (m.days ?? []) as unknown as LegacyDay[];

    const catalog: Exercise[] = [];
    const byNorm = new Map<string, string>(); // nombre normalizado → id canónico
    const remap = new Map<string, string>(); // id viejo → id canónico
    const days: StoredWorkoutDay[] = [];

    for (const d of legacyDays) {
      // Ya migrado (tiene exerciseIds): preservar tal cual.
      if (d.exerciseIds && !d.exercises) {
        days.push({ id: d.id, name: d.name, exerciseIds: [...d.exerciseIds] });
        continue;
      }
      const exerciseIds: string[] = [];
      for (const ex of d.exercises ?? []) {
        const key = normalizeExerciseName(ex.name);
        let canonical = byNorm.get(key);
        if (!canonical) {
          canonical = ex.id;
          byNorm.set(key, canonical);
          catalog.push({ ...ex, id: canonical });
        }
        remap.set(ex.id, canonical);
        if (!exerciseIds.includes(canonical)) exerciseIds.push(canonical);
      }
      days.push({ id: d.id, name: d.name, exerciseIds });
    }

    // Remapear exerciseId en sesiones (sana historiales que el bug pudo haber partido)
    const sessions: Session[] = (m.sessions ?? []).map((s) => ({
      ...s,
      sets: s.sets.map((set) => ({
        ...set,
        exerciseId: remap.get(set.exerciseId) ?? set.exerciseId,
      })),
    }));

    // Remapear las claves de todayProgress
    const todayProgress: Record<string, TodayDayProgress> = {};
    for (const [dayId, prog] of Object.entries(m.todayProgress ?? {})) {
      const sets: TodayDayProgress['sets'] = {};
      for (const [exId, arr] of Object.entries(prog.sets)) {
        sets[remap.get(exId) ?? exId] = arr;
      }
      todayProgress[dayId] = { ...prog, sets };
    }

    return {
      ...m,
      exercises: [...(m.exercises ?? []), ...catalog],
      days: days as unknown as AppState['days'],
      sessions,
      todayProgress,
    };
  }

  /** Construye un AppState completo a partir de datos parciales/importados */
  private buildState(p: Partial<AppState>): AppState {
    const migrated = this.migrate(p);
    const profile = migrated.settings?.userProfile;
    return {
      schemaVersion: CURRENT_SCHEMA,
      exercises: (migrated.exercises ?? []).map(normalizeExercise),
      days: migrated.days ?? [],
      sessions: migrated.sessions ?? [],
      activeDayIndex: migrated.activeDayIndex ?? 0,
      routinePointer: migrated.routinePointer ?? migrated.activeDayIndex ?? 0,
      todayProgress: migrated.todayProgress ?? {},
      trash: this.purgeTrash(migrated.trash ?? []),
      aiFeedback: migrated.aiFeedback ?? [],
      routines: migrated.routines?.length
        ? migrated.routines
        : [{ id: DEFAULT_ROUTINE_ID, name: '', dayIds: (migrated.days ?? []).map((d) => d.id) }],
      activeRoutineId: migrated.activeRoutineId ?? DEFAULT_ROUTINE_ID,
      // PRIMERO el spread, DESPUÉS los defaults de lo obligatorio. Esto era una lista
      // blanca escrita a mano, y una lista blanca aquí es una trampa: cada campo nuevo de
      // AppSettings que nadie recordara añadir moría EN CADA CARGA. Así se perdieron
      // `apiKeySealed`/`cohereApiKeySealed` —la key "desaparecía" con cada F5, T-825—,
      // el modelo elegido de Groq/Cohere y todo optativo posterior a la lista.
      settings: {
        ...migrated.settings,
        apiKey: migrated.settings?.apiKey ?? '',
        cohereApiKey: migrated.settings?.cohereApiKey ?? '',
        defaultRest: migrated.settings?.defaultRest ?? 60,
        sounds: migrated.settings?.sounds ?? true,
        haptics: migrated.settings?.haptics ?? true,
        theme: migrated.settings?.theme ?? 'dark',
        userProfile: {
          ...profile,
          weightKg: profile?.weightKg ?? null,
          heightCm: profile?.heightCm ?? null,
          age: profile?.age ?? null,
          sex: profile?.sex ?? null,
          weightLog: profile?.weightLog ?? [],
          goal: profile?.goal ?? null,
          level: profile?.level ?? null,
          equipment: profile?.equipment ?? null,
          daysPerWeek: profile?.daysPerWeek ?? null,
          aiNotes: profile?.aiNotes ?? '',
        },
      },
    };
  }

  /**
   * Estado apartado por ilegible. MIENTRAS no sea `null`, la app está en solo lectura:
   * nadie debe escribir encima hasta que el usuario decida qué hacer (RF-STO-04, R-2).
   */
  readonly quarantine = signal<QuarantineInfo | null>(null);

  load(): AppState {
    // Reparar un commit interrumpido ANTES de leer nada: si quedó un journal a medias,
    // leer sin recuperar mostraría una mezcla de generaciones (R-1).
    this.adapter.recover();

    if (this.adapter.hasData()) return this.loadFromPartitions();
    return this.loadLegacyBlob();
  }

  /** Lee el conjunto `gt_*` y lo vuelve a armar como un `AppState`. */
  private loadFromPartitions(): AppState {
    const assembled = this.assemble();
    const check = validateRawState(assembled);
    if (!check.ok) {
      return this.quarantineAndFallback(JSON.stringify(assembled), formatIssues(check.issues));
    }
    const state = this.buildState(assembled);
    const strict = validateMigratedState(state);
    if (!strict.ok) {
      return this.quarantineAndFallback(
        JSON.stringify(assembled),
        `las particiones gt_* no forman un estado valido - ${formatIssues(strict.issues)}`,
      );
    }
    return state;
  }

  /** Formato anterior a v7: un unico blob. Se sigue leyendo hasta que la migracion corre. */
  private loadLegacyBlob(): AppState {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return this.quarantineAndFallback(raw, 'el JSON guardado no se puede parsear');
    }

    // Tolerante: tiene que aceptar cualquier schemaVersion histórico, porque esto corre
    // ANTES de migrar. Ver `state-schema.ts`.
    const raw_check = validateRawState(parsed);
    if (!raw_check.ok) {
      return this.quarantineAndFallback(raw, formatIssues(raw_check.issues));
    }

    const migrated = this.buildState(parsed as Partial<AppState>);

    // Postcondición de nuestra propia migración: si falla, el bug es nuestro y el
    // original se aparta en vez de sobrescribirse con el estado inicial.
    const migrated_check = validateMigratedState(migrated);
    if (!migrated_check.ok) {
      return this.quarantineAndFallback(
        raw,
        `la migración produjo un estado inválido — ${formatIssues(migrated_check.issues)}`,
      );
    }

    return migrated;
  }

  /**
   * Aparta el contenido original bajo `gt_quarantine_<ts>` SIN borrar ni sobrescribir la
   * clave viva, y devuelve un estado inicial solo para que la app pueda renderizar. El
   * `effect` de persistencia respeta `quarantine()` y no guarda: los datos del usuario
   * siguen exactamente donde estaban.
   */
  private quarantineAndFallback(raw: string, reason: string): AppState {
    const atISO = new Date().toISOString();
    const key = `${QUARANTINE_PREFIX}${atISO}`;
    try {
      localStorage.setItem(key, raw);
    } catch (e) {
      // Sin espacio para la copia, lo importante sigue siendo NO tocar el original.
      console.warn('StorageService: no se pudo escribir la copia en cuarentena.', e);
    }
    console.warn(`StorageService.load: estado en cuarentena (${key}) — ${reason}`);
    this.quarantine.set({ key, atISO, reason });
    return createInitialState();
  }

  /** Contenido crudo del estado apartado, para que el usuario pueda descargarlo. */
  readQuarantined(key: string): string | null {
    return localStorage.getItem(key);
  }

  /**
   * El usuario decidió descartar el estado ilegible: se borra la clave viva y la copia
   * apartada, y la app vuelve a poder escribir desde cero.
   */
  discardQuarantine(): void {
    const info = this.quarantine();
    if (!info) return;
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(info.key);
    } catch (e) {
      console.warn('StorageService: no se pudo limpiar la cuarentena.', e);
    }
    this.quarantine.set(null);
  }

  save(state: AppState): SaveResult {
    if (this.quarantine()) {
      // Salvaguarda de último recurso: aunque el llamador se olvide de mirar
      // `quarantine()`, aquí no se escribe encima de datos que no supimos leer.
      return { ok: false, reason: 'quarantined' };
    }
    const savedAt = Date.now();
    // IndexedDB es la fuente de verdad durable (localStorage es purgable por el SO);
    // el espejo en localStorage sigue siendo la fuente de arranque rápido (sincrónica).
    void this.mirrorToIdb(state, savedAt);

    // Mientras la migracion a `gt_*` no haya corrido, seguimos escribiendo el blob viejo:
    // asi nada de lo que el usuario haga en esa ventana se pierde.
    const result = this.adapter.hasData()
      ? this.saveToPartitions(state)
      : this.saveLegacyBlob(state);

    if (result.ok) localStorage.setItem(STORAGE_KEYS.stateSavedAt, String(savedAt));
    return result;
  }

  private saveToPartitions(state: AppState): SaveResult {
    const commit = this.adapter.commit(this.disassemble(state), {
      schemaVersion: CURRENT_SCHEMA,
    });
    if (commit.ok) return { ok: true };
    console.warn('StorageService.save (gt_*) fallo:', commit.reason, commit.detail);
    return { ok: false, reason: commit.reason === 'quota' ? 'quota' : 'unknown' };
  }

  private saveLegacyBlob(state: AppState): SaveResult {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      return { ok: true };
    } catch (e) {
      console.warn('StorageService.save fallo:', e);
      const reason =
        e instanceof DOMException && e.name === 'QuotaExceededError' ? 'quota' : 'unknown';
      return { ok: false, reason };
    }
  }

  // -- Particionado gt_* (plan 3) --------------------------------------------

  /** `AppState` -> particiones. Cada dato vive en una sola clave; nada se duplica. */
  private disassemble(state: AppState): Partial<Record<GtDataKey, unknown>> {
    const { weightLog, ...profile } = state.settings.userProfile;
    const { userProfile, apiKey, cohereApiKey, ...settings } = state.settings;
    void userProfile;
    return {
      [GT_KEYS.routines]: {
        days: state.days,
        activeDayIndex: state.activeDayIndex,
        routinePointer: state.routinePointer,
      },
      [GT_KEYS.sessions]: {
        sessions: state.sessions,
        trash: state.trash ?? [],
        todayProgress: state.todayProgress,
      },
      [GT_KEYS.exercises]: state.exercises,
      [GT_KEYS.profile]: profile,
      [GT_KEYS.body]: { weightLog },
      [GT_KEYS.settings]: settings,
      // Las keys de IA viven en su propia particion: T-407 las cifra sin tocar el resto,
      // y quedan fuera del backup por defecto (RF-STO-05b).
      [GT_KEYS.ai]: { keys: { groq: apiKey, cohere: cohereApiKey } },
    };
  }

  /** Particiones -> `Partial<AppState>`, listo para `buildState()`. */
  private assemble(): Partial<AppState> {
    const routines = this.adapter.read<Partitions[typeof GT_KEYS.routines]>(GT_KEYS.routines);
    const sessions = this.adapter.read<Partitions[typeof GT_KEYS.sessions]>(GT_KEYS.sessions);
    const exercises = this.adapter.read<Partitions[typeof GT_KEYS.exercises]>(GT_KEYS.exercises);
    const profile = this.adapter.read<Partitions[typeof GT_KEYS.profile]>(GT_KEYS.profile);
    const body = this.adapter.read<Partitions[typeof GT_KEYS.body]>(GT_KEYS.body);
    const settings = this.adapter.read<Partitions[typeof GT_KEYS.settings]>(GT_KEYS.settings);
    const ai = this.adapter.read<Partitions[typeof GT_KEYS.ai]>(GT_KEYS.ai);

    return {
      schemaVersion: this.adapter.readMeta()?.schemaVersion ?? CURRENT_SCHEMA,
      exercises: exercises ?? [],
      days: routines?.days ?? [],
      activeDayIndex: routines?.activeDayIndex ?? 0,
      routinePointer: routines?.routinePointer ?? 0,
      sessions: sessions?.sessions ?? [],
      trash: sessions?.trash ?? [],
      todayProgress: sessions?.todayProgress ?? {},
      settings: {
        ...(settings ?? {}),
        apiKey: ai?.keys?.groq ?? '',
        cohereApiKey: ai?.keys?.cohere ?? '',
        userProfile: { ...(profile ?? {}), weightLog: body?.weightLog ?? [] },
      } as AppSettings,
    };
  }

  // -- Migracion del blob v6 al conjunto gt_* (T-102) -------------------------

  /** Queda estado viejo por migrar? */
  needsPartitionMigration(): boolean {
    return !this.adapter.hasData() && localStorage.getItem(STORAGE_KEY) !== null;
  }

  /**
   * Mueve el blob `gym_app_state_v2` al conjunto `gt_*`.
   *
   * Dos condiciones innegociables antes de escribir nada (`audit.md` 5):
   *
   * 1. **Copia previa recuperable.** Se intenta un snapshot en IndexedDB; si IDB no
   *    existe, el propio blob viejo se conserva bajo otra clave. Si no se puede dejar
   *    NINGUNA copia, la migracion no arranca: mejor no migrar que migrar sin red.
   * 2. **Lock exclusivo** (T-105): ninguna otra pestana puede estar escribiendo el
   *    formato viejo mientras esto corre (R-9).
   */
  async runPartitionMigration(state: AppState): Promise<PartitionMigrationResult> {
    if (!this.needsPartitionMigration()) return 'skipped';

    const legacyRaw = localStorage.getItem(STORAGE_KEY);
    if (legacyRaw === null) return 'skipped';

    const backedUp = await this.backUpBeforeMigration(state, legacyRaw);
    if (!backedUp) {
      console.warn('StorageService: migracion cancelada, no se pudo dejar copia previa.');
      return 'no-backup';
    }

    const outcome = await this.tabLock.withExclusiveLock<PartitionMigrationResult>(() => {
      // Otra pestana pudo haber migrado mientras esperabamos el lock.
      if (!this.needsPartitionMigration()) return 'skipped';

      const commit = this.adapter.commit(this.disassemble(state), {
        schemaVersion: CURRENT_SCHEMA,
        flags: this.legacyFlags(),
        // El conjunto solo se compromete si el estado que representa es valido.
        validate: () => {
          const check = validateMigratedState(state);
          return check.ok ? null : formatIssues(check.issues);
        },
      });
      if (!commit.ok) {
        console.warn('StorageService: fallo el commit de la migracion.', commit.detail);
        return 'failed';
      }

      // Ya esta todo en gt_*: el blob viejo y las claves sueltas dejan de ser la verdad.
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(STORAGE_KEYS.onboardingDone);
      localStorage.removeItem(STORAGE_KEYS.legalAccepted);
      // R-7: la cache de IA indexa por exerciseId y puede referirse a datos remapeados.
      // Regenerarla es barato; servir una recomendacion desalineada, no.
      localStorage.removeItem(STORAGE_KEYS.aiCache);
      return 'migrated';
    });

    return outcome ?? 'skipped';
  }

  /**
   * Copia previa a la migracion. El snapshot de IndexedDB es la via preferida; conservar
   * el blob viejo bajo otra clave cubre a los navegadores sin IDB sin gastar espacio
   * extra (ese blob se iba a borrar de todos modos).
   */
  private async backUpBeforeMigration(state: AppState, legacyRaw: string): Promise<boolean> {
    const snapshotOk = await this.writeSnapshot(state, `${this.todayISO()}-pre-v7`).catch(
      () => false,
    );

    let copyOk = false;
    try {
      localStorage.setItem(PREMIGRATION_KEY, legacyRaw);
      copyOk = true;
    } catch (e) {
      console.warn('StorageService: no se pudo guardar la copia pre-migracion.', e);
    }

    return snapshotOk || copyOk;
  }

  private legacyFlags(): Record<string, string> {
    const flags: Record<string, string> = {};
    if (localStorage.getItem(STORAGE_KEYS.onboardingDone) === '1') {
      flags[FLAGS.onboardingDone] = '1';
    }
    if (localStorage.getItem(STORAGE_KEYS.legalAccepted) === '1') {
      flags[FLAGS.legalAccepted] = '1';
    }
    return flags;
  }

  // -- Banderas de arranque --------------------------------------------------

  /** Lee una bandera de `gt_meta`, con respaldo en la clave suelta previa a la migracion. */
  getFlag(name: string, legacyKey: string): boolean {
    const fromMeta = this.adapter.readFlag(name);
    if (fromMeta !== null) return fromMeta === '1';
    return localStorage.getItem(legacyKey) === '1';
  }

  setFlag(name: string, legacyKey: string): void {
    this.adapter.writeFlag(name, '1', CURRENT_SCHEMA);
    // Antes de migrar, la clave suelta sigue siendo la que lee el resto del arranque.
    if (!this.adapter.hasData()) localStorage.setItem(legacyKey, '1');
  }

  // ── IndexedDB: espejo durable + snapshots automáticos ──────────────────────

  private lastSnapshotCheck = 0;

  private async mirrorToIdb(state: AppState, savedAt: number): Promise<void> {
    await this.idb.put(IDB_STATE_STORE, 'current', { state, savedAt });
    // Snapshot semanal rotativo (máx. 4): red de seguridad contra ediciones destructivas.
    const now = Date.now();
    if (now - this.lastSnapshotCheck < 60_000) return; // chequeo barato, no en cada save
    this.lastSnapshotCheck = now;
    const keys = (await this.idb.keys(IDB_SNAPSHOT_STORE)).sort();
    const last = keys.at(-1);
    const today = this.todayISO();
    if (!last || daysBetween(last, today) >= 7) {
      await this.writeSnapshot(state, today);
    }
  }

  /** Escribe un snapshot con fecha (usado por el ciclo semanal y antes de un reset). */
  async writeSnapshot(state: AppState, label?: string): Promise<boolean> {
    const key = label ?? this.todayISO();
    // `idbPut` devuelve false (no lanza) cuando IndexedDB no está disponible. Propagarlo
    // importa: quien exige un snapshot como red de seguridad —la migración— necesita
    // saber si realmente se escribió, no solo que la promesa se resolvió.
    const written = await this.idb.put(IDB_SNAPSHOT_STORE, key, {
      dateISO: key,
      savedAt: Date.now(),
      state,
    });
    if (!written) return false;
    const keys = (await this.idb.keys(IDB_SNAPSHOT_STORE)).sort();
    for (const stale of keys.slice(0, Math.max(0, keys.length - 4))) {
      await this.idb.delete(IDB_SNAPSHOT_STORE, stale);
    }
    return true;
  }

  listSnapshots(): Promise<string[]> {
    return this.idb.keys(IDB_SNAPSHOT_STORE).then((k) => k.sort().reverse());
  }

  async getSnapshot(key: string): Promise<AppState | null> {
    const entry = await this.idb.get<{ state: unknown }>(IDB_SNAPSHOT_STORE, key);
    if (!entry || !isValidAppState(entry.state)) return null;
    return this.buildState(entry.state as Partial<AppState>);
  }

  /**
   * Si IndexedDB tiene un estado MÁS NUEVO que el que arrancó de localStorage
   * (p. ej. el SO purgó localStorage), lo devuelve para que StateService lo adopte.
   */
  async loadNewerFromIdb(): Promise<AppState | null> {
    const entry = await this.idb.get<{ state: unknown; savedAt: number }>(
      IDB_STATE_STORE,
      'current',
    );
    if (!entry || !isValidAppState(entry.state)) return null;
    const lsSavedAt = Number(localStorage.getItem(STORAGE_KEYS.stateSavedAt) ?? 0);
    const lsHasState = localStorage.getItem(STORAGE_KEY) !== null;
    if (lsHasState && entry.savedAt <= lsSavedAt) return null;
    return this.buildState(entry.state as Partial<AppState>);
  }

  /**
   * Espacio usado (RF-STO-08). `navigator.storage.estimate()` mide TODO el origen —
   * localStorage, IndexedDB y la caché del service worker — que es lo que de verdad
   * consume la cuota. `appBytes` mide aparte lo que ocupan nuestras claves, porque es lo
   * único que el usuario puede purgar desde acá.
   */
  async storageEstimate(): Promise<StorageEstimateInfo> {
    const appBytes = this.appLocalStorageBytes();
    try {
      const estimate = await navigator.storage?.estimate?.();
      if (estimate?.usage !== undefined && estimate.quota) {
        return {
          appBytes,
          usedBytes: estimate.usage,
          quotaBytes: estimate.quota,
          percent: Math.min(100, Math.round((estimate.usage / estimate.quota) * 100)),
        };
      }
    } catch {
      /* API no disponible o bloqueada: nos quedamos con la medida propia */
    }
    return { appBytes, usedBytes: null, quotaBytes: null, percent: null };
  }

  /** Bytes aproximados de las claves de la app (UTF-16: 2 bytes por carácter). */
  private appLocalStorageBytes(): number {
    let total = 0;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith('gt_') && !key.startsWith('gym_')) continue;
      total += (key.length + (localStorage.getItem(key)?.length ?? 0)) * 2;
    }
    return total;
  }

  /** Marca el origen como persistente para que el navegador no purgue el almacenamiento. */
  requestPersistentStorage(): void {
    try {
      void navigator.storage?.persist?.().catch(() => {});
    } catch {
      /* API no disponible */
    }
  }

  /** Purga la papelera: las sesiones borradas hace más de 30 días desaparecen. */
  private purgeTrash(trash: AppState['trash']): NonNullable<AppState['trash']> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 30);
    const cutoffISO = cutoff.toISOString().slice(0, 10);
    return (trash ?? []).filter((t) => t.deletedISO >= cutoffISO);
  }

  /**
   * Valida y normaliza datos importados desde JSON.
   * Lanza Error con mensaje en español si el formato es inválido.
   */
  validateImport(data: unknown): AppState {
    if (typeof data !== 'object' || data === null) {
      throw new Error('El archivo no contiene un objeto JSON válido.');
    }
    const check = validateRawState(data);
    if (!check.ok) {
      throw new Error(`Formato inválido: ${formatIssues(check.issues)}`);
    }
    const state = this.buildState(data as Partial<AppState>);
    const migratedCheck = validateMigratedState(state);
    if (!migratedCheck.ok) {
      throw new Error(`El backup no se pudo migrar: ${formatIssues(migratedCheck.issues)}`);
    }
    return state;
  }

  todayISO(): string {
    return new Date().toISOString().slice(0, 10);
  }

  uid(): string {
    return Math.random().toString(36).slice(2, 9);
  }

  roundToBrick(weight: number, brick: number): number {
    if (!brick || brick <= 0) return Math.round(weight * 2) / 2;
    return Math.round(weight / brick) * brick;
  }

  lastSessionForExercise(state: AppState, exerciseId: string, beforeISO?: string): Session | null {
    const sessions = state.sessions
      .filter((s) => !s.skipped)
      .filter((s) => s.sets.some((set) => set.exerciseId === exerciseId))
      .filter((s) => !beforeISO || s.dateISO < beforeISO)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
    return sessions[0] ?? null;
  }

  lastSetsForExercise(state: AppState, exerciseId: string, beforeISO?: string): SetRecord[] | null {
    const session = this.lastSessionForExercise(state, exerciseId, beforeISO);
    if (!session) return null;
    return session.sets.filter((s) => s.exerciseId === exerciseId && !s.isWarmup);
  }

  lastSessionForDay(state: AppState, dayId: string): Session | null {
    return (
      state.sessions
        .filter((s) => s.dayId === dayId && !s.skipped)
        .sort((a, b) => b.dateISO.localeCompare(a.dateISO))[0] ?? null
    );
  }

  allSessionsForDay(state: AppState, dayId: string): Session[] {
    return state.sessions
      .filter((s) => s.dayId === dayId && !s.skipped)
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO));
  }

  weeklyStats(state: AppState): { streak: number; weeklyVolume: number } {
    const todayISO = this.todayISO();

    // UTC para evitar desfases por zona horaria
    const today = new Date(todayISO + 'T12:00:00Z');
    const dayOfWeek = today.getUTCDay();
    const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    const monday = new Date(today);
    monday.setUTCDate(today.getUTCDate() + mondayOffset);
    const mondayISO = monday.toISOString().slice(0, 10);

    let weeklyVolume = 0;
    const sessionDates = new Set<string>();
    for (const session of state.sessions) {
      if (session.skipped) continue;
      sessionDates.add(session.dateISO);
      if (session.dateISO >= mondayISO && session.dateISO <= todayISO) {
        // Con el factor de unidad: una mancuerna de 20 kg por mano son 40 kg movidos.
        // Antes se contaba a la mitad, así que el volumen semanal de quien entrena con
        // mancuernas sube al actualizar. Es una corrección, no un cambio de criterio (R-4).
        weeklyVolume += tonnageOf(session.sets, state.exercises);
      }
    }

    // Racha consecutiva hacia atrás desde hoy (UTC)
    let streak = 0;
    const cursor = new Date(todayISO + 'T12:00:00Z');
    while (sessionDates.has(cursor.toISOString().slice(0, 10))) {
      streak++;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }

    return { streak, weeklyVolume };
  }

  historyForExercise(state: AppState, exerciseId: string): HistoryEntry[] {
    const sessions = state.sessions
      .filter((s) => !s.skipped)
      .filter((s) => s.sets.some((set) => set.exerciseId === exerciseId && !set.isWarmup))
      .sort((a, b) => a.dateISO.localeCompare(b.dateISO));

    return sessions.map((session) => {
      const sets = session.sets.filter((s) => s.exerciseId === exerciseId && !s.isWarmup);
      const topWeight = sets.length ? Math.max(...sets.map((s) => s.weight || 0)) : 0;
      const topReps = sets.length ? Math.max(...sets.map((s) => s.reps || 0)) : 0;
      const totalReps = sets.reduce((sum, s) => sum + (s.reps || 0), 0);
      const volume = tonnageOf(sets, state.exercises);
      return { dateISO: session.dateISO, sets, topWeight, topReps, totalReps, volume };
    });
  }
}

export { defaultUserProfile };
