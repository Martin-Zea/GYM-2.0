import { Injectable, inject } from '@angular/core';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
import { detectPr } from '../utils/pr';
import { UIStateService } from './ui-state.service';
import { SoundService } from './sound.service';
import { TranslationService } from './translation.service';
import { AiRecommendation, Exercise, TodaySetProgress, WorkoutDay } from '../models/workout.model';

/**
 * Lógica de registro de series compartida entre la vista tabla (ExerciseCard)
 * y la vista enfocada de sesión (ActiveSetCard): marcar serie, detección de PR,
 * lanzamiento del descanso y construcción del array de series del día.
 */
@Injectable({ providedIn: 'root' })
export class SetLoggingService {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly uiState = inject(UIStateService);
  private readonly sound = inject(SoundService);
  private readonly tr = inject(TranslationService);

  /** Sets ya celebrados como PR — evita re-celebrar en deshacer + rehacer (global a la sesión). */
  private readonly celebratedPrSets = new Set<string>();

  /**
   * Array de series de HOY para un ejercicio: el progreso persistido, completado con
   * los valores de la última sesión como prefill visual. La longitud es
   * max(defaultSets, series guardadas) para soportar series extra "solo por hoy".
   */
  buildSetsArray(day: WorkoutDay, ex: Exercise): TodaySetProgress[] {
    const tp = this.state.getTodayProgress(day.id);
    const saved = tp.sets[ex.id] ?? [];
    const last = this.storage.lastSetsForExercise(this.state.state(), ex.id, this.state.todayKey);
    const length = this.setCountFor(day, ex);
    return Array.from({ length }, (_, i) => {
      if (saved[i]) return saved[i];
      const prev = last?.[i];
      return {
        weight:
          prev && ex.unit !== 'BODYWEIGHT' && (prev.weight as number) > 0
            ? prev.weight
            : ('' as unknown as number),
        reps: prev && (prev.reps as number) > 0 ? prev.reps : ('' as unknown as number),
        done: false,
      };
    });
  }

  /**
   * Cuántas series muestra HOY este ejercicio: el número que fijó el usuario al añadir o
   * quitar series, y si no, el de la rutina. Regla única — la usan la sesión, el progreso
   * del día y el prefill, y si divergen el usuario ve "2/3" con el ejercicio terminado.
   *
   * Nunca por debajo de la última serie ya registrada: quitar series no puede esconder
   * trabajo hecho.
   */
  setCountFor(day: WorkoutDay, ex: Exercise): number {
    const tp = this.state.getTodayProgress(day.id);
    const saved = tp.sets[ex.id] ?? [];
    const override = tp.setCounts?.[ex.id];
    const base = override ?? Math.max(ex.defaultSets, saved.length);
    let lastDone = 0;
    saved.forEach((s, i) => {
      if (s?.done) lastDone = i + 1;
    });
    return Math.max(1, base, lastDone);
  }

  /** Vuelca una recomendación de IA en las series de HOY (solo las no tocadas/no hechas). */
  applyRecPrefill(day: WorkoutDay, ex: Exercise, rec: AiRecommendation): void {
    if (!rec || rec.loading || !rec.sets?.length) return;
    const tp = this.state.getTodayProgress(day.id);
    const total = this.setCountFor(day, ex);
    for (let i = 0; i < total; i++) {
      const existing = tp.sets[ex.id]?.[i];
      if (existing?.done) continue;
      const setRec = rec.sets[i] ?? rec.sets[rec.sets.length - 1];
      const patch: Partial<TodaySetProgress> = { reps: setRec.reps, aiPrefilled: true };
      if (ex.unit !== 'BODYWEIGHT' && setRec.weight > 0) patch.weight = setRec.weight;
      this.state.updateSet(day.id, ex.id, i, patch);
    }
  }

  /** Añade una serie extra solo por hoy (no toca defaultSets de la rutina). */
  addExtraSet(day: WorkoutDay, ex: Exercise): void {
    const arr = this.buildSetsArray(day, ex);
    this.state.setTodaySetCount(day.id, ex.id, arr.length + 1);
    // Persiste las series visibles no guardadas para que el índice nuevo quede al final
    this.state.updateSet(day.id, ex.id, arr.length, {
      weight: '' as unknown as number,
      reps: '' as unknown as number,
      done: false,
    });
  }

  /** Quita una serie de hoy (RF-SES-05). Nunca deja el ejercicio sin ninguna. */
  removeSet(day: WorkoutDay, ex: Exercise, setIndex: number): void {
    const arr = this.buildSetsArray(day, ex);
    if (arr.length <= 1) return;
    this.state.removeTodaySet(day.id, ex.id, setIndex, arr.length);
  }

  /** Etiqueta de la próxima serie para el descanso: "Serie 3 · 22,5 kg × 8". */
  restNextLabel(ex: Exercise, arr: TodaySetProgress[], nextIdx: number): string {
    if (nextIdx < 0) return this.tr.T().rest_timer_next_exercise;
    const base = this.tr.tp('rest_timer_next_set', { n: nextIdx + 1 });
    const next = arr[nextIdx];
    if (!next) return base;
    const w = next.weight !== '' && next.weight !== undefined ? Number(next.weight) : null;
    const r = next.reps !== '' && next.reps !== undefined ? Number(next.reps) : null;
    let detail = '';
    if (ex.unit === 'TIME') {
      if (r) detail = `${r}s`;
    } else if (ex.unit === 'BODYWEIGHT') {
      if (r) detail = `× ${r}`;
    } else if (w && r) {
      detail = `${w} kg × ${r}`;
    } else if (r) {
      detail = `× ${r}`;
    }
    return detail ? `${base} · ${detail}` : base;
  }

  /**
   * Marca/desmarca una serie con todos los efectos: haptic, PR, descanso con la
   * próxima serie detallada. Devuelve el resultado de StateService.toggleSetDone.
   */
  toggleDone(day: WorkoutDay, ex: Exercise, setIndex: number): 'done' | 'undone' | 'needs_reps' {
    const result = this.state.toggleSetDone(day.id, ex, setIndex);
    if (result !== 'done') return result;

    if (this.state.settings().haptics && navigator.vibrate) navigator.vibrate(40);
    this.maybeCelebratePr(day, ex, setIndex);

    const restSecs = ex.restSeconds || this.state.settings().defaultRest;
    const arr = this.buildSetsArray(day, ex);
    const nextIdx = arr.findIndex((s, i) => i > setIndex && !s.done);
    this.uiState.restTimer.set({
      seconds: restSecs,
      exerciseId: ex.id,
      nextLabel: this.restNextLabel(ex, arr, nextIdx),
      nextSetIndex: nextIdx,
    });
    return result;
  }

  isExerciseDone(day: WorkoutDay, ex: Exercise): boolean {
    const arr = this.buildSetsArray(day, ex);
    return arr.length > 0 && arr.every((s) => s.done);
  }

  /**
   * Récord en vivo (RF-SES-06). No solo peso: subir una repetición al mismo peso, o mejorar
   * el 1RM estimado, también es progreso y es lo que el usuario ve casi todas las semanas.
   * En ejercicios corporales o por tiempo el récord son las repeticiones/segundos.
   */
  private maybeCelebratePr(day: WorkoutDay, ex: Exercise, setIndex: number): void {
    const key = `${ex.id}:${setIndex}`;
    if (this.celebratedPrSets.has(key)) return;

    const set = this.state.getTodayProgress(day.id).sets[ex.id]?.[setIndex];
    if (!set || set.isWarmup) return;
    const candidate = { weight: Number(set.weight) || 0, reps: Number(set.reps) || 0 };
    if (candidate.reps <= 0) return;

    // toggleSetDone ya commiteó la sesión de HOY: hay que excluirla de la referencia
    const previous = this.storage
      .historyForExercise(this.state.state(), ex.id)
      .filter((h) => h.dateISO < this.state.todayKey)
      .flatMap((h) => h.sets)
      .filter((s) => !s.isWarmup);

    const pr = detectPr(ex.unit, previous, candidate);
    if (!pr) return;

    this.celebratedPrSets.add(key);
    if (this.state.settings().sounds) this.sound.playPrBeep();
    this.uiState.celebratePr({
      exerciseName: ex.name,
      unit: ex.unit,
      kind: pr.kind,
      value: pr.value,
      previous: pr.previous,
      weight: candidate.weight,
      reps: candidate.reps,
    });
  }
}
