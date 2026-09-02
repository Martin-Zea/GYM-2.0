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
import { CatalogService } from '../../services/catalog.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { SetLoggingService } from '../../services/set-logging.service';
import {
  AiFeedbackAction,
  AiRecommendation,
  Exercise,
  SetRecommendation,
  TrainingFeel,
  WorkoutDay,
} from '../../models/workout.model';
import { DEFAULT_BAR_KG, DEFAULT_PLATES_KG, plateBreakdown } from '../../utils/plates';
import { formatPrevSets } from '../../utils/rec-label';
import { displayStep, fromDisplayWeight, toDisplayWeight, unitSuffixFor } from '../../utils/one-rm';

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
  private readonly catalog = inject(CatalogService);
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
  /** Acciones secundarias plegadas: visibles solo cuando se piden (T-833). */
  protected readonly showMore = signal(false);
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

  /** Unidad de presentación. El estado guarda SIEMPRE kg (RF-PWA-04). */
  protected readonly units = computed(() => this.state.settings().units ?? 'kg');
  protected readonly unitSuffix = computed(() => unitSuffixFor(this.units()));

  protected readonly displayWeight = computed(() => {
    const c = this.current();
    if (!c || c.weight === '' || c.weight === undefined) return null;
    return toDisplayWeight(Number(c.weight), this.units());
  });

  protected readonly displayReps = computed(() => {
    const c = this.current();
    if (!c || c.reps === '' || c.reps === undefined) return null;
    return Number(c.reps);
  });

  /**
   * Parte el nombre en título y calificativo: "Press de Pecho (Máquina)" (T-834).
   *
   * Casi todo el catálogo lleva el equipamiento entre paréntesis, y metido en el `<h2>`
   * partía el título en dos líneas y empujaba los steppers fuera del pliegue. Es puro
   * dato de PRESENTACIÓN: el nombre guardado no se toca —lo usan `refFor()` y todo el
   * historial— y si no hay paréntesis, el título se queda tal cual.
   */
  protected readonly nameParts = computed(() => {
    const full = this.exercise().name.trim();
    const m = /^(.*?)\s*\(([^()]+)\)$/.exec(full);
    return m && m[1].trim()
      ? { name: m[1].trim(), qualifier: m[2].trim() }
      : { name: full, qualifier: null as string | null };
  });

  /** Objetivo de reps: rango si el esquema lo define, número seco si no (RF-RUT-01). */
  protected readonly repRange = computed(() => {
    const ex = this.exercise();
    return ex.repMin && ex.repMin < ex.defaultRepTarget
      ? `${ex.repMin}-${ex.defaultRepTarget}`
      : `${ex.defaultRepTarget}`;
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
    // La calculadora de discos trabaja en kg: la barra y los discos se configuran en kg
    return plateBreakdown(
      fromDisplayWeight(w, this.units()),
      s.barWeightKg ?? DEFAULT_BAR_KG,
      s.platesKg ?? DEFAULT_PLATES_KG,
    );
  });

  protected readonly barWeight = computed(
    () => this.state.settings().barWeightKg ?? DEFAULT_BAR_KG,
  );

  /**
   * Sustitutos posibles (RF-EJ-04).
   *
   * Primero las alternativas del mismo patrón de movimiento —lo que hace equivalente a un
   * ejercicio—, incluso si el usuario aún no las tiene en su catálogo: se crean al elegirlas.
   * Después, el resto de sus ejercicios, por si prefiere algo suyo.
   */
  protected readonly substituteOptions = computed(() => {
    const inDay = new Set(this.day().exercises.map((e) => e.id));
    const mine = this.state.exercises().filter((e) => !inDay.has(e.id) && !e.archived);
    const byRef = new Map(mine.filter((e) => e.catalogRef).map((e) => [e.catalogRef!, e]));

    const alternatives = this.catalog.alternativesFor(this.exercise().name, { limit: 6 });
    const suggested = alternatives.map((item) => ({
      key: byRef.get(item.ref)?.id ?? `ref:${item.ref}`,
      name: this.catalog.nameOf(item, this.tr.lang()),
      suggested: true,
    }));
    const suggestedKeys = new Set(suggested.map((s) => s.key));

    const others = mine
      .filter((e) => !suggestedKeys.has(e.id))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((e) => ({ key: e.id, name: e.name, suggested: false }));

    return [...suggested, ...others];
  });

  /** Ejercicios propios que se pueden sumar a la sesión de hoy (RF-SES-05). */
  protected readonly addableExercises = computed(() => {
    const inDay = new Set(this.day().exercises.map((e) => e.id));
    return this.state
      .exercises()
      .filter((e) => !inDay.has(e.id) && !e.archived)
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
    const units = this.units();
    const sets = session.sets
      .filter((s) => s.exerciseId === this.exercise().id && !s.isWarmup)
      .map((s) => ({ ...s, weight: toDisplayWeight(s.weight, units) }));
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

  // ── C1: aceptar / cambiar / rechazar la sugerencia (RF-IA-05) ──

  /** Sugerencia para la serie en curso, si la hay. */
  private readonly currentSuggestion = computed(() => {
    const rec = this.aiRec();
    const i = this.currentIdx();
    if (!rec || rec.loading || !rec.sets?.length || i < 0) return null;
    return rec.sets[i] ?? rec.sets[rec.sets.length - 1];
  });

  protected readonly feedbackGiven = computed<AiFeedbackAction | null>(
    () =>
      this.state.aiFeedbackFor(this.exercise().id).find((f) => f.dateISO === this.state.todayKey)
        ?.action ?? null,
  );

  protected readonly canRateSuggestion = computed(
    () => !!this.currentSuggestion() && !this.isDone(),
  );

  /** Aceptar: se aplica tal cual y se registra. Es el camino de un tap. */
  protected acceptSuggestion(): void {
    const sug = this.currentSuggestion();
    const i = this.currentIdx();
    if (!sug || i < 0) return;
    this.state.updateSet(this.day().id, this.exercise().id, i, {
      weight: sug.weight,
      reps: sug.reps,
      aiPrefilled: true,
    });
    this.rate('accepted', sug, sug);
  }

  /**
   * Rechazar: se vuelve a lo de la última sesión y se registra el rechazo.
   *
   * Rechazar no puede dejar la serie vacía —el usuario sigue teniendo que entrenar—, así que
   * cae a lo que hizo la última vez, que es la referencia que él mismo conoce.
   */
  protected rejectSuggestion(): void {
    const sug = this.currentSuggestion();
    const i = this.currentIdx();
    if (!sug || i < 0) return;
    const prev = this.lastSession()?.sets.filter((s) => s.exerciseId === this.exercise().id) ?? [];
    const fallback = prev[i] ?? prev[prev.length - 1] ?? null;
    if (fallback) {
      this.state.updateSet(this.day().id, this.exercise().id, i, {
        weight: fallback.weight,
        reps: fallback.reps,
        aiPrefilled: false,
      });
    }
    this.rate('rejected', sug, fallback ? { weight: fallback.weight, reps: fallback.reps } : null);
  }

  protected feedbackLabel(action: AiFeedbackAction): string {
    const t = this.T();
    return action === 'accepted'
      ? t.ai_feedback_accepted
      : action === 'rejected'
        ? t.ai_feedback_rejected
        : t.ai_feedback_modified;
  }

  private rate(
    action: AiFeedbackAction,
    suggested: SetRecommendation | null,
    applied: SetRecommendation | null,
  ): void {
    this.state.recordAiFeedback({
      exerciseId: this.exercise().id,
      exerciseName: this.exercise().name,
      action,
      suggested,
      applied,
      source: this.aiRec()?.source ?? 'local',
    });
  }

  /**
   * "Cambiar" no es un botón: si el atleta completa la serie con valores distintos a los
   * sugeridos, eso ES la modificación y se registra sola. Pedirle que además pulse algo
   * sería cobrarle un tap por informarnos.
   */
  private rateIfModified(applied: SetRecommendation): void {
    if (this.feedbackGiven()) return;
    const sug = this.currentSuggestion();
    if (!sug) return;
    if (sug.weight === applied.weight && sug.reps === applied.reps) {
      this.rate('accepted', sug, applied);
    } else {
      this.rate('modified', sug, applied);
    }
  }

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
    return displayStep(this.exercise().brick, this.units());
  }

  /**
   * Sube o baja el peso en la unidad que el usuario ve, y guarda el kg equivalente.
   *
   * El paso se calcula en la unidad de presentación: en libras, subir "un disco" son 5 lb,
   * no los 5,51 que saldrían de convertir 2,5 kg.
   */
  protected stepWeight(delta: number): void {
    const i = this.currentIdx();
    if (i < 0) return;
    const base = this.displayWeight() ?? 0;
    const nextDisplay = Math.max(0, Math.round((base + delta * this.weightStep()) * 4) / 4);
    this.state.updateSet(this.day().id, this.exercise().id, i, {
      weight: fromDisplayWeight(nextDisplay, this.units()),
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
    // De vuelta a kg antes de guardar: el historial es canónico en kg (R-4)
    const weight = this.needsWeight()
      ? fromDisplayWeight(this.displayWeight() ?? 0, this.units())
      : 0;
    this.state.updateSet(day.id, ex.id, i, { reps, weight });
    this.rateIfModified({ weight, reps });
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
    const key = (event.target as HTMLSelectElement).value;
    if (!key) return;
    // Una alternativa del catálogo que el usuario aún no tiene se crea al elegirla: pedirle
    // que la dé de alta antes sería mandarlo a otra pantalla en mitad de la serie.
    let id = key;
    if (key.startsWith('ref:')) {
      const item = this.catalog.byRef(key.slice(4));
      if (!item) return;
      id = this.state.upsertExercise(
        this.catalog.toExercise(item, this.tr.lang(), this.storage.uid()),
      );
    }
    this.state.substituteToday(this.day().id, this.exercise().id, id);
    this.showSubstitute.set(false);
  }

  protected openChart(): void {
    this.uiState.openChartSheet(this.exercise());
  }
}
