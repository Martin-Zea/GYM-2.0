import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import {
  AppSettings,
  AppState,
  Exercise,
  Session,
  SetRecord,
  StoredWorkoutDay,
  TodayDayProgress,
  TodaySetProgress,
  TrainingFeel,
  WorkoutDay,
} from '../models/workout.model';
import { StorageService, normalizeExerciseName } from './storage.service';
import { TranslationService } from './translation.service';
import { UIStateService } from './ui-state.service';
import { TabLockService } from './tab-lock.service';
import { STORAGE_KEYS } from './storage-keys';
import { createInitialState } from '../data/initial-data';

@Injectable({ providedIn: 'root' })
export class StateService {
  private readonly storage = inject(StorageService);
  private readonly tr = inject(TranslationService);
  private readonly uiState = inject(UIStateService);
  private readonly tabLock = inject(TabLockService);

  readonly state = signal<AppState>(this.storage.load());

  /** Catálogo maestro de ejercicios (fuente de verdad de identidad e historial). */
  readonly exercises = computed(() => this.state().exercises);

  /** Días resueltos: los `exerciseIds` guardados se expanden a objetos `Exercise` del catálogo. */
  readonly days = computed<WorkoutDay[]>(() => {
    const s = this.state();
    const byId = new Map(s.exercises.map((e) => [e.id, e]));
    return s.days.map((d) => ({
      id: d.id,
      name: d.name,
      exercises: d.exerciseIds
        .map((id) => byId.get(id))
        .filter((e): e is Exercise => e !== undefined),
    }));
  });

  readonly sessions = computed(() => this.state().sessions);
  readonly settings = computed(() => this.state().settings);
  readonly activeDayIndex = computed(() => this.state().activeDayIndex);
  readonly activeDay = computed(() => this.days()[this.state().activeDayIndex] ?? null);
  readonly routinePointer = computed(() => this.state().routinePointer);
  readonly currentDayIndex = computed(() => {
    const days = this.state().days;
    if (!days.length) return 0;
    return this.state().routinePointer % days.length;
  });
  readonly currentDay = computed(() => {
    const days = this.days();
    if (!days.length) return null;
    return days[this.state().routinePointer % days.length] ?? null;
  });

  get todayKey(): string {
    return this.storage.todayISO();
  }

  constructor() {
    // Almacenamiento durable: si el SO purgó localStorage pero IndexedDB conserva un
    // estado más nuevo, adoptarlo. Y pedir persistencia del origen (una sola vez).
    this.storage.requestPersistentStorage();
    void this.storage.loadNewerFromIdb().then((newer) => {
      if (newer) this.state.set(newer);
    });

    // Migración del blob v6 al conjunto `gt_*` (T-102). Es asíncrona porque exige una
    // copia previa en IndexedDB y el lock entre pestañas; hasta que termina, `save()`
    // sigue escribiendo el formato viejo, así que nada de lo que el usuario haga se pierde.
    void this.storage.runPartitionMigration(this.state()).then((result) => {
      if (result === 'migrated') this.state.set(this.storage.load());
    });

    // Persistencia: la capa de storage reporta el fallo; aquí lo traducimos y exponemos a la UI.
    effect(() => {
      const state = this.state();
      // Solo la pestaña primaria escribe (RF-STO-09). Una secundaria que guardara
      // pisaría lo que la primaria acaba de escribir —y, durante una migración,
      // volcaría el formato viejo encima del ya migrado.
      if (!this.tabLock.canWrite()) {
        untracked(() => this.uiState.tabConflict.set(true));
        return;
      }
      // Estado ilegible apartado: NADA se escribe encima hasta que el usuario decida
      // (RF-STO-04, R-2). Antes, un fallo de validación borraba el historial en el
      // primer render porque este mismo effect guardaba el estado inicial.
      if (this.storage.quarantine()) return;
      const result = this.storage.save(state);
      untracked(() => {
        if (result.ok) {
          if (this.uiState.saveError()) this.uiState.saveError.set(null);
        } else {
          this.uiState.saveError.set(
            result.reason === 'quota'
              ? this.tr.T().save_error_quota
              : this.tr.T().save_error_generic,
          );
        }
      });
    });
  }

  setActiveDay(index: number): void {
    this.state.update((s) => ({ ...s, activeDayIndex: index }));
  }

  /**
   * Persiste un día (forma resuelta del editor) descomponiéndolo en:
   * 1. upserts al catálogo de ejercicios, y
   * 2. un `StoredWorkoutDay` que referencia por id.
   *
   * Identidad: un ejercicio que ya existe (mismo id) actualiza su definición en el
   * catálogo. Un ejercicio "nuevo" cuyo nombre normalizado coincide con uno ya
   * existente reutiliza ese id canónico — así re-tipear un ejercicio que ya hacías
   * reconecta su historial en vez de empezar de cero.
   */
  saveDay(day: WorkoutDay): void {
    this.state.update((s) => {
      const catalog = s.exercises.map((e) => ({ ...e }));
      const byId = new Map(catalog.map((e) => [e.id, e]));
      const byNorm = new Map<string, string>();
      for (const e of catalog) {
        const key = normalizeExerciseName(e.name);
        if (!byNorm.has(key)) byNorm.set(key, e.id);
      }

      const exerciseIds: string[] = [];
      for (const ex of day.exercises) {
        let canonicalId: string;
        const existing = byId.get(ex.id);
        if (existing) {
          Object.assign(existing, ex); // actualiza definición, conserva id
          canonicalId = ex.id;
        } else {
          const matchId = byNorm.get(normalizeExerciseName(ex.name));
          if (matchId) {
            Object.assign(byId.get(matchId)!, ex, { id: matchId }); // reconecta historial
            canonicalId = matchId;
          } else {
            const fresh = { ...ex };
            catalog.push(fresh);
            byId.set(fresh.id, fresh);
            byNorm.set(normalizeExerciseName(fresh.name), fresh.id);
            canonicalId = fresh.id;
          }
        }
        if (!exerciseIds.includes(canonicalId)) exerciseIds.push(canonicalId);
      }

      const stored: StoredWorkoutDay = {
        id: day.id || this.storage.uid(),
        name: day.name,
        exerciseIds,
      };
      const exists = s.days.some((d) => d.id === stored.id);
      const days = exists
        ? s.days.map((d) => (d.id === stored.id ? stored : d))
        : [...s.days, stored];

      return {
        ...s,
        exercises: catalog,
        days,
        activeDayIndex: exists ? s.activeDayIndex : days.length - 1,
      };
    });
  }

  deleteDay(dayId: string): void {
    this.state.update((s) => {
      const days = s.days.filter((d) => d.id !== dayId);
      return {
        ...s,
        days,
        activeDayIndex: Math.min(s.activeDayIndex, Math.max(0, days.length - 1)),
      };
    });
  }

  saveSettings(settings: AppSettings): void {
    this.state.update((s) => ({ ...s, settings }));
  }

  advanceRoutine(fromDayIndex?: number): void {
    this.state.update((s) => {
      const days = s.days.length || 1;
      const base = fromDayIndex !== undefined ? fromDayIndex : s.routinePointer % days;
      const nextIndex = (base + 1) % days;
      const rem = s.routinePointer % days;
      let delta = nextIndex - rem;
      if (delta <= 0) delta += days;
      return {
        ...s,
        routinePointer: s.routinePointer + delta,
        todayProgress: this.pruneTodayProgress(s.todayProgress),
      };
    });
  }

  /** Salta el día actual. Devuelve el id de la sesión "saltada" creada (para poder deshacer). */
  skipDay(): string | null {
    const day = this.currentDay();
    if (!day) return null;
    const alreadySkipped = this.state().sessions.some(
      (s) => s.dayId === day.id && s.dateISO === this.todayKey && s.skipped,
    );
    let sessionId: string | null = null;
    if (!alreadySkipped) {
      sessionId = this.storage.uid();
      const id = sessionId;
      this.state.update((s) => ({
        ...s,
        sessions: [
          ...s.sessions,
          {
            id,
            dayId: day.id,
            dateISO: this.todayKey,
            sets: [],
            skipped: true,
          },
        ],
      }));
    }
    this.advanceRoutine();
    return sessionId;
  }

  /** Deshace un skipDay() inmediato: borra la sesión saltada y retrocede el puntero un paso. */
  undoSkipDay(sessionId: string | null): void {
    this.state.update((s) => ({
      ...s,
      sessions: sessionId ? s.sessions.filter((x) => x.id !== sessionId) : s.sessions,
      routinePointer: Math.max(0, s.routinePointer - 1),
    }));
  }

  deleteSession(sessionId: string): void {
    this.state.update((s) => {
      const victim = s.sessions.find((x) => x.id === sessionId);
      const trash = victim
        ? [...(s.trash ?? []), { session: victim, deletedISO: this.todayKey }].slice(-50)
        : s.trash;
      return {
        ...s,
        sessions: s.sessions.filter((x) => x.id !== sessionId),
        trash,
      };
    });
    this.invalidateAiCache();
  }

  /** Restaura una sesión desde la papelera. */
  restoreSession(sessionId: string): void {
    this.state.update((s) => {
      const entry = (s.trash ?? []).find((t) => t.session.id === sessionId);
      if (!entry) return s;
      return {
        ...s,
        sessions: [...s.sessions, entry.session],
        trash: (s.trash ?? []).filter((t) => t.session.id !== sessionId),
      };
    });
    this.invalidateAiCache();
  }

  /** Vacía la papelera de sesiones. */
  emptyTrash(): void {
    this.state.update((s) => ({ ...s, trash: [] }));
  }

  updateSessionSet(
    sessionId: string,
    exerciseId: string,
    setIndex: number,
    patch: Partial<Pick<SetRecord, 'weight' | 'reps'>>,
  ): void {
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((session) =>
        session.id !== sessionId
          ? session
          : {
              ...session,
              sets: session.sets.map((sr) =>
                sr.exerciseId === exerciseId && sr.setIndex === setIndex ? { ...sr, ...patch } : sr,
              ),
            },
      ),
    }));
    this.invalidateAiCache();
  }

  /** El historial cambió: las recomendaciones cacheadas ya no valen */
  private invalidateAiCache(): void {
    localStorage.removeItem(STORAGE_KEYS.aiCache);
    // También las precalculadas para la próxima sesión: se dedujeron del historial que
    // acaba de cambiar (RF-IA-06b).
    localStorage.removeItem(STORAGE_KEYS.nextSuggestions);
  }

  getTodayProgress(dayId: string): TodayDayProgress {
    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) {
      return { dateISO: this.todayKey, sets: {} };
    }
    return tp;
  }

  /**
   * Marca el arranque de la sesión de hoy. Idempotente: volver a entrar tras una interrupción
   * NO reinicia el reloj, o la duración registrada sería solo la del último tramo (RF-SES-08b).
   */
  startSession(dayId: string): void {
    this.state.update((s) => {
      const prev = s.todayProgress[dayId];
      const today: TodayDayProgress =
        prev?.dateISO === this.todayKey
          ? structuredClone(prev)
          : { dateISO: this.todayKey, sets: {} };
      if (today.startedAt) return s;
      today.startedAt = new Date().toISOString();
      return { ...s, todayProgress: { ...s.todayProgress, [dayId]: today } };
    });
  }

  /**
   * Cierra la sesión de hoy: sella `endedAt` y avanza la rutina.
   *
   * Devuelve la sesión cerrada para que H3 pueda resumirla, o `null` si no hubo trabajo
   * (terminar sin registrar nada no crea una sesión fantasma en el historial).
   */
  finishSession(dayId: string, fromDayIndex?: number): Session | null {
    this.commitSession(dayId);
    const existing = this.todaySession(dayId);
    let finished: Session | null = null;
    if (existing) {
      finished = { ...existing, endedAt: new Date().toISOString() };
      const closed = finished;
      this.state.update((s) => ({
        ...s,
        sessions: s.sessions.map((x) => (x.id === closed.id ? closed : x)),
      }));
    }
    this.advanceRoutine(fromDayIndex);
    return finished;
  }

  /**
   * Descarta la sesión de hoy: borra el progreso en curso y manda la sesión a la papelera.
   *
   * A la papelera y no a la nada: "descartar" en un diálogo de reanudación se pulsa por error
   * con facilidad, y esos datos no se pueden reconstruir (RF-SES-07).
   */
  discardSession(dayId: string): void {
    const existing = this.todaySession(dayId);
    if (existing) this.deleteSession(existing.id);
    this.state.update((s) => {
      const rest = { ...s.todayProgress };
      delete rest[dayId];
      return { ...s, todayProgress: rest };
    });
  }

  /** La sesión de HOY para ese día, si existe. */
  todaySession(dayId: string): Session | null {
    return (
      this.state().sessions.find((s) => s.dayId === dayId && s.dateISO === this.todayKey) ?? null
    );
  }

  /**
   * Sesión de hoy con trabajo registrado y sin cerrar: la app se cerró en medio (RF-SES-07, EA-4).
   *
   * Solo mira HOY. Una sesión vieja sin `endedAt` no es una interrupción recuperable: es
   * historial anterior a v7, que nunca tuvo marcas de tiempo (R-5).
   */
  readonly unfinishedSession = computed<Session | null>(() => {
    const today = this.todayKey;
    return (
      this.state().sessions.find(
        (s) => s.dateISO === today && !s.skipped && !s.endedAt && s.sets.length > 0,
      ) ?? null
    );
  });

  /** Muta el progreso de HOY de un día conservando el resto del estado. */
  private patchToday(dayId: string, fn: (today: TodayDayProgress) => void): void {
    this.state.update((s) => {
      const prev = s.todayProgress[dayId];
      const today: TodayDayProgress =
        prev?.dateISO === this.todayKey
          ? structuredClone(prev)
          : { dateISO: this.todayKey, sets: {} };
      fn(today);
      return { ...s, todayProgress: { ...s.todayProgress, [dayId]: today } };
    });
  }

  /** Fija cuántas series tiene hoy un ejercicio (solo por hoy, RF-SES-05). */
  setTodaySetCount(dayId: string, exerciseId: string, count: number): void {
    this.patchToday(dayId, (today) => {
      today.setCounts = { ...today.setCounts, [exerciseId]: Math.max(1, count) };
    });
  }

  /**
   * Quita una serie de hoy. Las siguientes suben un puesto, así que se reescribe el array
   * entero: dejar un hueco haría que la serie 3 pasara a mostrarse como serie 4.
   */
  removeTodaySet(dayId: string, exerciseId: string, setIndex: number, visible: number): void {
    this.patchToday(dayId, (today) => {
      const arr = [...(today.sets[exerciseId] ?? [])];
      if (setIndex < arr.length) arr.splice(setIndex, 1);
      today.sets = { ...today.sets, [exerciseId]: arr };
      today.setCounts = { ...today.setCounts, [exerciseId]: Math.max(1, visible - 1) };
    });
    this.commitSession(dayId);
  }

  /** Añade un ejercicio del catálogo SOLO por hoy; la rutina guardada no cambia. */
  addExerciseToday(dayId: string, exerciseId: string): void {
    this.patchToday(dayId, (today) => {
      const hidden = (today.hiddenExerciseIds ?? []).filter((id) => id !== exerciseId);
      today.hiddenExerciseIds = hidden;
      const added = today.addedExerciseIds ?? [];
      if (!added.includes(exerciseId)) today.addedExerciseIds = [...added, exerciseId];
    });
  }

  /**
   * Quita un ejercicio de la sesión de hoy. Si ya tenía series registradas, se borran: la
   * sesión debe reflejar lo que el usuario dice haber hecho, no series huérfanas de un
   * ejercicio que no aparece.
   */
  removeExerciseToday(dayId: string, exerciseId: string): void {
    this.patchToday(dayId, (today) => {
      const added = today.addedExerciseIds ?? [];
      if (added.includes(exerciseId)) {
        today.addedExerciseIds = added.filter((id) => id !== exerciseId);
      } else {
        const hidden = today.hiddenExerciseIds ?? [];
        if (!hidden.includes(exerciseId)) today.hiddenExerciseIds = [...hidden, exerciseId];
      }
      const sets = { ...today.sets };
      delete sets[exerciseId];
      today.sets = sets;
    });
    this.commitSession(dayId);
  }

  /**
   * Nota de la sesión entera, distinta de las notas por ejercicio (RF-SES-05).
   *
   * Si todavía no hay sesión (ninguna serie registrada) no hay dónde guardarla y se ignora,
   * igual que `setExerciseNote`. Se escribe al cerrar, que es cuando la UI la pide.
   */
  setSessionNote(dayId: string, note: string): void {
    const existing = this.todaySession(dayId);
    if (!existing) return;
    const trimmed = note.trim().slice(0, 500);
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((x) => (x.id === existing.id ? { ...x, sessionNote: trimmed } : x)),
    }));
  }

  sessionNoteFor(dayId: string): string {
    return this.todaySession(dayId)?.sessionNote ?? '';
  }

  updateSet(
    dayId: string,
    exerciseId: string,
    setIndex: number,
    patch: Partial<TodaySetProgress>,
  ): void {
    this.state.update((s) => {
      const today: TodayDayProgress =
        s.todayProgress[dayId]?.dateISO === this.todayKey
          ? structuredClone(s.todayProgress[dayId])
          : { dateISO: this.todayKey, sets: {} };

      if (!today.sets[exerciseId]) today.sets[exerciseId] = [];
      const cur = today.sets[exerciseId][setIndex] ?? { weight: '', reps: '', done: false };
      today.sets[exerciseId][setIndex] = { ...cur, ...patch };

      return { ...s, todayProgress: { ...s.todayProgress, [dayId]: today } };
    });
  }

  toggleSetDone(
    dayId: string,
    exercise: Exercise,
    setIndex: number,
  ): 'done' | 'undone' | 'needs_reps' {
    const tp = this.getTodayProgress(dayId);
    const cur = tp.sets[exercise.id]?.[setIndex] ?? { weight: '', reps: '', done: false };

    if (cur.done) {
      this.updateSet(dayId, exercise.id, setIndex, { done: false });
      this.commitSession(dayId);
      return 'undone';
    }

    const reps = Number(cur.reps) || 0;
    if (reps <= 0) return 'needs_reps';

    const weight = Number(cur.weight) || 0;
    this.updateSet(dayId, exercise.id, setIndex, { done: true, weight, reps });
    this.commitSession(dayId);
    return 'done';
  }

  private commitSession(dayId: string): void {
    const day = this.state().days.find((d) => d.id === dayId);
    if (!day) return;

    const tp = this.state().todayProgress[dayId];
    if (!tp || tp.dateISO !== this.todayKey) return;

    const hasAnyDone = Object.values(tp.sets).some((arr) => arr.some((s) => s?.done));
    const alreadySaved = this.todaySession(dayId);
    // Sin nada marcado y sin sesión previa no hay qué guardar. Con sesión previa sí hay que
    // seguir: puede que el usuario acabe de quitar el último ejercicio que tenía series, y
    // entonces la sesión guardada quedaría describiendo un trabajo que ya no existe.
    if (!hasAnyDone && !alreadySaved) return;

    const catalog = this.state().exercises;
    const setsList: SetRecord[] = [];
    Object.entries(tp.sets).forEach(([exId, arr]) => {
      arr.forEach((s, i) => {
        if (s?.done) {
          const ex = catalog.find((e) => e.id === exId);
          setsList.push({
            exerciseId: exId,
            setIndex: i,
            weight: typeof s.weight === 'number' ? s.weight : 0,
            reps: typeof s.reps === 'number' ? s.reps : 0,
            target: ex ? `${ex.defaultSets}x${ex.defaultRepTarget}` : '',
            repTarget: ex?.defaultRepTarget,
            isWarmup: s.isWarmup ?? false,
            ...(s.note ? { note: s.note } : {}),
          });
        }
      });
    });

    const existing = alreadySaved;

    // La sesión se quedó sin series (se quitaron los ejercicios o se desmarcó todo): se
    // elimina en vez de dejar una entrada vacía en el historial. No va a la papelera porque
    // ya no queda nada que recuperar.
    if (!setsList.length) {
      if (existing) {
        this.state.update((s) => ({
          ...s,
          sessions: s.sessions.filter((x) => x.id !== existing.id),
        }));
      }
      return;
    }

    // El arranque lo pone `startSession()`; si la sesión empezó por otra vía (atajo del
    // manifest, reanudación), la primera serie registrada sirve de marca (RF-SES-08b).
    const startedAt = tp.startedAt ?? new Date().toISOString();

    if (existing) {
      if (JSON.stringify(existing.sets) === JSON.stringify(setsList) && existing.startedAt) return;
      this.state.update((s) => ({
        ...s,
        sessions: s.sessions.map((x) =>
          x.id === existing.id ? { ...x, sets: setsList, startedAt: x.startedAt ?? startedAt } : x,
        ),
      }));
    } else {
      this.state.update((s) => ({
        ...s,
        sessions: [
          ...s.sessions,
          {
            id: this.storage.uid(),
            dayId,
            dateISO: this.todayKey,
            sets: setsList,
            startedAt,
          },
        ],
      }));
    }
  }

  /** Sensación del ejercicio al completarlo — se guarda en la sesión de HOY. */
  setExerciseFeel(dayId: string, exerciseId: string, feel: TrainingFeel | null): void {
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((session) => {
        if (session.dayId !== dayId || session.dateISO !== this.todayKey || session.skipped) {
          return session;
        }
        const feelings = { ...(session.feelings ?? {}) };
        if (feel) feelings[exerciseId] = feel;
        else delete feelings[exerciseId];
        return { ...session, feelings };
      }),
    }));
  }

  /** Nota rápida por ejercicio — se guarda en la sesión de HOY. */
  setExerciseNote(dayId: string, exerciseId: string, note: string): void {
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.map((session) => {
        if (session.dayId !== dayId || session.dateISO !== this.todayKey || session.skipped) {
          return session;
        }
        const notes = { ...(session.notes ?? {}) };
        const trimmed = note.trim().slice(0, 200);
        if (trimmed) notes[exerciseId] = trimmed;
        else delete notes[exerciseId];
        return { ...session, notes };
      }),
    }));
  }

  /** Sustituye un ejercicio SOLO POR HOY (p. ej. máquina ocupada). No toca la rutina. */
  substituteToday(dayId: string, originalExId: string, substituteExId: string | null): void {
    this.state.update((s) => {
      const today: TodayDayProgress =
        s.todayProgress[dayId]?.dateISO === this.todayKey
          ? structuredClone(s.todayProgress[dayId])
          : { dateISO: this.todayKey, sets: {} };
      const overrides = { ...(today.overrides ?? {}) };
      if (substituteExId) overrides[originalExId] = substituteExId;
      else delete overrides[originalExId];
      today.overrides = overrides;
      return { ...s, todayProgress: { ...s.todayProgress, [dayId]: today } };
    });
  }

  /** Añade un ejercicio existente del catálogo a un día guardado (dedupe por id). */
  addExerciseToDay(dayId: string, exerciseId: string): void {
    this.state.update((s) => ({
      ...s,
      days: s.days.map((d) =>
        d.id !== dayId || d.exerciseIds.includes(exerciseId)
          ? d
          : { ...d, exerciseIds: [...d.exerciseIds, exerciseId] },
      ),
    }));
  }

  /** Quita un ejercicio de un día guardado (el catálogo y el historial no se tocan). */
  removeExerciseFromDay(dayId: string, exerciseId: string): void {
    this.state.update((s) => ({
      ...s,
      days: s.days.map((d) =>
        d.id !== dayId ? d : { ...d, exerciseIds: d.exerciseIds.filter((id) => id !== exerciseId) },
      ),
    }));
  }

  /** Elimina entradas de todayProgress que no sean del día actual */
  private pruneTodayProgress(tp: AppState['todayProgress']): AppState['todayProgress'] {
    const today = this.todayKey;
    const pruned: AppState['todayProgress'] = {};
    for (const [dayId, progress] of Object.entries(tp)) {
      if (progress.dateISO === today) pruned[dayId] = progress;
    }
    return pruned;
  }

  /**
   * Cuenta las sesiones anteriores a una fecha, para poder decir cuántas se van ANTES de
   * borrarlas (RF-STO-08: purgar historial antiguo no puede ser un salto al vacío).
   */
  countSessionsBefore(cutoffISO: string): number {
    return this.state().sessions.filter((s) => s.dateISO < cutoffISO).length;
  }

  /**
   * Borra el historial anterior a `cutoffISO`. No pasa por la papelera: es una purga
   * deliberada para recuperar espacio, no un borrado accidental que haya que deshacer.
   * Devuelve cuántas sesiones se eliminaron.
   */
  purgeSessionsBefore(cutoffISO: string): number {
    const before = this.state().sessions.length;
    this.state.update((s) => ({
      ...s,
      sessions: s.sessions.filter((sess) => sess.dateISO >= cutoffISO),
      trash: (s.trash ?? []).filter((t) => t.session.dateISO >= cutoffISO),
    }));
    const removed = before - this.state().sessions.length;
    if (removed > 0) this.invalidateAiCache();
    return removed;
  }

  resetAll(): void {
    // Red de seguridad: snapshot del estado actual antes de destruirlo
    void this.storage.writeSnapshot(this.state(), `pre-reset-${this.todayKey}`);
    this.state.set(createInitialState());
  }

  /** Reemplaza el estado con una plantilla de rutina (wizard de primer arranque). */
  applyTemplate(days: 3 | 4 | 5): void {
    this.state.set(createInitialState(days));
  }
}
