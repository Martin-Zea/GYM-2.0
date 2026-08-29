import { Injectable, inject } from '@angular/core';
import { StateService } from './state.service';
import { StorageService } from './storage.service';
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
    const length = Math.max(ex.defaultSets, saved.length);
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

  /** Vuelca una recomendación de IA en las series de HOY (solo las no tocadas/no hechas). */
  applyRecPrefill(day: WorkoutDay, ex: Exercise, rec: AiRecommendation): void {
    if (!rec || rec.loading || !rec.sets?.length) return;
    const tp = this.state.getTodayProgress(day.id);
    const total = Math.max(ex.defaultSets, tp.sets[ex.id]?.length ?? 0);
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
    // Persiste las series visibles no guardadas para que el índice nuevo quede al final
    this.state.updateSet(day.id, ex.id, arr.length, {
      weight: '' as unknown as number,
      reps: '' as unknown as number,
      done: false,
    });
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

  private maybeCelebratePr(day: WorkoutDay, ex: Exercise, setIndex: number): void {
    // Weight isn't the progress metric for time/bodyweight exercises
    if (ex.unit === 'TIME' || ex.unit === 'BODYWEIGHT') return;

    const key = `${ex.id}:${setIndex}`;
    if (this.celebratedPrSets.has(key)) return;

    const set = this.state.getTodayProgress(day.id).sets[ex.id]?.[setIndex];
    const weight = Number(set?.weight) || 0;
    if (weight <= 0) return;

    // toggleSetDone already committed today's session — exclude it from the historic max
    const history = this.storage
      .historyForExercise(this.state.state(), ex.id)
      .filter((h) => h.dateISO < this.state.todayKey);
    if (!history.length) return;

    const maxWeight = Math.max(...history.map((h) => h.topWeight));
    if (weight <= maxWeight) return;

    this.celebratedPrSets.add(key);
    if (this.state.settings().sounds) this.sound.playPrBeep();
    this.uiState.celebratePr(ex.name, weight, ex.unit);
  }
}
