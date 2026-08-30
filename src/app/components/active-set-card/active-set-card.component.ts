import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { SetLoggingService } from '../../services/set-logging.service';
import { AiRecommendation, Exercise, TrainingFeel, WorkoutDay } from '../../models/workout.model';
import { DEFAULT_BAR_KG, DEFAULT_PLATES_KG, plateBreakdown } from '../../utils/plates';
import { formatPrevSets } from '../../utils/rec-label';

/**
 * Vista enfocada de sesión: UNA serie protagonista con steppers grandes y un
 * botón gigante "Serie hecha". El caso normal (aceptar el prefill) es un tap.
 */
@Component({
  selector: 'app-active-set-card',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './active-set-card.component.html',
  styleUrl: './active-set-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActiveSetCardComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly uiState = inject(UIStateService);
  private readonly setLogging = inject(SetLoggingService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  readonly day = input.required<WorkoutDay>();
  readonly exercise = input.required<Exercise>();
  readonly aiRec = input<AiRecommendation | null>(null);
  readonly requestAi = output<void>();
  readonly exerciseCompleted = output<void>();
  readonly nextExercise = output<void>();
  readonly showTable = output<void>();

  protected readonly showPlates = signal(false);
  protected readonly showNote = signal(false);
  protected readonly showSubstitute = signal(false);
  protected readonly showAddExercise = signal(false);

  protected readonly setsArray = computed(() => {
    this.state.state(); // dependencia reactiva
    return this.setLogging.buildSetsArray(this.day(), this.exercise());
  });

  /** Índice de la serie actual (primera no hecha); -1 si el ejercicio está completo. */
  protected readonly currentIdx = computed(() => this.setsArray().findIndex((s) => !s.done));

  protected readonly current = computed(() => {
    const i = this.currentIdx();
    return i >= 0 ? this.setsArray()[i] : null;
  });

  protected readonly doneCount = computed(() => this.setsArray().filter((s) => s.done).length);
  protected readonly isDone = computed(() => this.currentIdx() < 0);

  protected readonly displayWeight = computed(() => {
    const c = this.current();
    if (!c || c.weight === '' || c.weight === undefined) return null;
    return Number(c.weight);
  });

  protected readonly displayReps = computed(() => {
    const c = this.current();
    if (!c || c.reps === '' || c.reps === undefined) return null;
    return Number(c.reps);
  });

  protected readonly needsWeight = computed(() => this.exercise().unit !== 'BODYWEIGHT');

  /** Sensación registrada hoy para este ejercicio (si ya se marcó). */
  protected readonly todayFeel = computed<TrainingFeel | null>(() => {
    const session = this.state
      .sessions()
      .find((s) => s.dayId === this.day().id && s.dateISO === this.state.todayKey && !s.skipped);
    return session?.feelings?.[this.exercise().id] ?? null;
  });

  protected readonly todayNote = computed(() => {
    const session = this.state
      .sessions()
      .find((s) => s.dayId === this.day().id && s.dateISO === this.state.todayKey && !s.skipped);
    return session?.notes?.[this.exercise().id] ?? '';
  });

  /** Desglose de discos para el peso actual (solo unidad kg de barra). */
  protected readonly plates = computed(() => {
    const w = this.displayWeight();
    if (w === null || this.exercise().unit !== 'KG') return null;
    const s = this.state.settings();
    return plateBreakdown(w, s.barWeightKg ?? DEFAULT_BAR_KG, s.platesKg ?? DEFAULT_PLATES_KG);
  });

  protected readonly barWeight = computed(
    () => this.state.settings().barWeightKg ?? DEFAULT_BAR_KG,
  );

  /** Sustitutos posibles: catálogo menos los ejercicios del día. */
  protected readonly substituteOptions = computed(() => {
    const inDay = new Set(this.day().exercises.map((e) => e.id));
    return this.state
      .exercises()
      .filter((e) => !inDay.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  });

  protected readonly canSubstitute = computed(() => this.doneCount() === 0);

  /**
   * Qué hizo la última vez en este ejercicio (RF-SES-02). La vista enfocada muestra una serie
   * sola: sin esta referencia el usuario decide el peso a ciegas, que es justo lo contrario
   * de lo que la vista pretende.
   */
  private readonly lastSession = computed(() =>
    this.storage.lastSessionForExercise(
      this.state.state(),
      this.exercise().id,
      this.state.todayKey,
    ),
  );

  protected readonly prevSetsLine = computed(() => {
    const session = this.lastSession();
    if (!session) return '';
    const sets = session.sets.filter((s) => s.exerciseId === this.exercise().id && !s.isWarmup);
    return formatPrevSets(this.exercise().unit, sets);
  });

  /** Sensación registrada la última vez (el RPE simplificado de la app). */
  protected readonly prevFeel = computed<TrainingFeel | null>(
    () => this.lastSession()?.feelings?.[this.exercise().id] ?? null,
  );

  protected feelLabel(feel: TrainingFeel): string {
    const t = this.T();
    return feel === 'easy' ? t.feel_easy : feel === 'hard' ? t.feel_hard : t.feel_ok;
  }

  protected readonly aiReason = computed(() => this.aiRec()?.reason ?? '');

  constructor() {
    // Prefill de IA al llegar la recomendación (idéntico a la vista tabla)
    effect(() => {
      const rec = this.aiRec();
      if (!rec || rec.loading || !rec.sets?.length) return;
      untracked(() => this.setLogging.applyRecPrefill(this.day(), this.exercise(), rec));
    });

    // Pedir recomendación al montarse con un ejercicio sin rec
    effect(() => {
      this.exercise();
      untracked(() => {
        if (!this.aiRec()) this.requestAi.emit();
        this.showPlates.set(false);
        this.showNote.set(false);
        this.showSubstitute.set(false);
        this.showAddExercise.set(false);
      });
    });
  }

  private weightStep(): number {
    const brick = this.exercise().brick;
    return brick > 0 ? brick : 0.5;
  }

  protected stepWeight(delta: number): void {
    const i = this.currentIdx();
    if (i < 0) return;
    const base = this.displayWeight() ?? 0;
    const next = Math.max(0, Math.round((base + delta * this.weightStep()) * 4) / 4);
    this.state.updateSet(this.day().id, this.exercise().id, i, {
      weight: next,
      aiPrefilled: false,
    });
  }

  protected stepReps(delta: number): void {
    const i = this.currentIdx();
    if (i < 0) return;
    const base = this.displayReps() ?? this.exercise().defaultRepTarget;
    const next = Math.max(1, base + delta);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps: next, aiPrefilled: false });
  }

  /** El botón gigante: garantiza valores y marca la serie — un solo tap en el caso normal. */
  protected completeSet(): void {
    const i = this.currentIdx();
    if (i < 0) return;
    const ex = this.exercise();
    const day = this.day();
    const reps = this.displayReps() ?? ex.defaultRepTarget;
    const weight = this.needsWeight() ? (this.displayWeight() ?? 0) : 0;
    this.state.updateSet(day.id, ex.id, i, { reps, weight });
    const result = this.setLogging.toggleDone(day, ex, i);
    if (result === 'done' && this.isDone()) {
      this.exerciseCompleted.emit();
    }
  }

  /** Deshace la última serie marcada. */
  protected undoLastSet(): void {
    const arr = this.setsArray();
    for (let i = arr.length - 1; i >= 0; i--) {
      if (arr[i].done) {
        this.setLogging.toggleDone(this.day(), this.exercise(), i);
        return;
      }
    }
  }

  protected toggleWarmup(): void {
    const i = this.currentIdx();
    const c = this.current();
    if (i < 0 || !c) return;
    this.state.updateSet(this.day().id, this.exercise().id, i, { isWarmup: !c.isWarmup });
  }

  protected addExtraSet(): void {
    this.setLogging.addExtraSet(this.day(), this.exercise());
  }

  /** Quita la serie en curso: hoy se hacen menos series de las que dice la rutina. */
  protected removeCurrentSet(): void {
    const i = this.currentIdx();
    if (i < 0) return;
    this.setLogging.removeSet(this.day(), this.exercise(), i);
  }

  protected readonly canRemoveSet = computed(() => this.setsArray().length > 1 && !this.isDone());

  /**
   * Saca el ejercicio de la sesión de hoy. Confirma si ya tenía series: quitarlo las borra,
   * y ese trabajo no se puede recuperar.
   */
  protected removeExerciseToday(): void {
    const ex = this.exercise();
    if (this.doneCount() > 0) {
      const msg = this.tr.tp('asc_remove_exercise_confirm', { name: ex.name });
      if (!window.confirm(msg)) return;
    }
    this.state.removeExerciseToday(this.day().id, ex.id);
  }

  /** Añade un ejercicio del catálogo solo por hoy (RF-SES-05). */
  protected addExerciseToday(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (!id) return;
    this.state.addExerciseToday(this.day().id, id);
    this.showAddExercise.set(false);
  }

  /** Nota de la serie en curso, distinta de la nota del ejercicio (RF-SES-05). */
  protected readonly currentSetNote = computed(() => this.current()?.note ?? '');

  protected saveSetNote(event: Event): void {
    const i = this.currentIdx();
    if (i < 0) return;
    const val = (event.target as HTMLTextAreaElement).value.trim().slice(0, 120);
    this.state.updateSet(this.day().id, this.exercise().id, i, { note: val });
  }

  protected setFeel(feel: TrainingFeel): void {
    const current = this.todayFeel();
    this.state.setExerciseFeel(this.day().id, this.exercise().id, current === feel ? null : feel);
  }

  protected saveNote(event: Event): void {
    const val = (event.target as HTMLTextAreaElement).value;
    this.state.setExerciseNote(this.day().id, this.exercise().id, val);
  }

  protected substitute(event: Event): void {
    const id = (event.target as HTMLSelectElement).value;
    if (!id) return;
    this.state.substituteToday(this.day().id, this.exercise().id, id);
    this.showSubstitute.set(false);
  }

  protected openChart(): void {
    this.uiState.openChartSheet(this.exercise());
  }
}
