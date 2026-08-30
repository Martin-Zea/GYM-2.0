import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { FocusTrapDirective } from '../../directives/focus-trap.directive';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { Session, SetRecord, WorkoutDay } from '../../models/workout.model';
import { sessionDurationMinutes, sessionTonnage, workingSets } from '../../utils/session';
import { PrKind, detectPr } from '../../utils/pr';

interface SummaryPr {
  exerciseName: string;
  kind: PrKind;
  value: number;
  previous: number;
  unit: string;
}

/** Orden de "fuerza" de un récord: más peso impresiona más que un 1RM estimado. */
const PR_RANK: Record<PrKind, number> = { weight: 3, reps_at_weight: 2, reps: 2, e1rm: 1 };

/**
 * H3 — resumen al terminar la sesión (RF-SES-08).
 *
 * Cierra el bucle del entrenamiento: qué hiciste, cómo se compara con la vez anterior y qué
 * récords caíste. Los datos que la sesión no registró se OMITEN; nunca se muestran como cero
 * (RF-SES-08b, RF-PRO-05, `audit.md` R-5).
 */
@Component({
  selector: 'app-session-summary',
  standalone: true,
  imports: [IconComponent, FocusTrapDirective],
  templateUrl: './session-summary.component.html',
  styleUrl: './session-summary.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionSummaryComponent {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  readonly session = input.required<Session>();
  readonly day = input.required<WorkoutDay>();
  readonly closed = output<void>();

  protected readonly durationMin = computed(() => sessionDurationMinutes(this.session()));

  protected readonly tonnage = computed(() =>
    Math.round(sessionTonnage(this.session(), this.state.exercises())),
  );

  protected readonly setCount = computed(() => workingSets(this.session().sets).length);

  protected readonly exerciseCount = computed(
    () => new Set(this.session().sets.map((s) => s.exerciseId)).size,
  );

  /** Sesión anterior del mismo día, para el "vs. anterior". */
  private readonly previousSession = computed<Session | null>(() => {
    const current = this.session();
    return (
      this.storage
        .allSessionsForDay(this.state.state(), current.dayId)
        .find((s) => s.dateISO < current.dateISO) ?? null
    );
  });

  protected readonly prevTonnage = computed(() => {
    const prev = this.previousSession();
    return prev ? Math.round(sessionTonnage(prev, this.state.exercises())) : null;
  });

  protected readonly tonnageDelta = computed(() => {
    const prev = this.prevTonnage();
    return prev === null || prev === 0 ? null : this.tonnage() - prev;
  });

  protected readonly tonnagePercent = computed(() => {
    const prev = this.prevTonnage();
    const delta = this.tonnageDelta();
    if (prev === null || prev === 0 || delta === null) return null;
    return Math.round((delta / prev) * 100);
  });

  /**
   * Duración de la sesión anterior, o `null` si no la registró.
   *
   * Todo el historial previo a v7 cae aquí: comparar contra "0 min" diría que el usuario
   * tardó una hora más de lo normal cuando en realidad no hay con qué comparar (R-5).
   */
  protected readonly prevDurationMin = computed(() => {
    const prev = this.previousSession();
    return prev ? sessionDurationMinutes(prev) : null;
  });

  protected readonly hasPrevious = computed(() => this.previousSession() !== null);

  /** Récords conseguidos en esta sesión (RF-SES-06/08). Uno por ejercicio, el más fuerte. */
  protected readonly prs = computed<SummaryPr[]>(() => {
    const session = this.session();
    const appState = this.state.state();
    const catalog = this.state.exercises();
    const byExercise = new Map<string, SetRecord[]>();
    workingSets(session.sets).forEach((set) => {
      const list = byExercise.get(set.exerciseId) ?? [];
      list.push(set);
      byExercise.set(set.exerciseId, list);
    });

    const found: SummaryPr[] = [];
    byExercise.forEach((sets, exerciseId) => {
      const ex = catalog.find((e) => e.id === exerciseId);
      if (!ex) return;
      const previous = this.storage
        .historyForExercise(appState, exerciseId)
        .filter((h) => h.dateISO < session.dateISO)
        .flatMap((h) => h.sets)
        .filter((s) => !s.isWarmup);

      let best: SummaryPr | null = null;
      for (const set of sets) {
        const pr = detectPr(ex.unit, previous, { weight: set.weight, reps: set.reps });
        if (!pr) continue;
        const candidate: SummaryPr = { ...pr, exerciseName: ex.name, unit: ex.unit };
        if (
          !best ||
          PR_RANK[candidate.kind] > PR_RANK[best.kind] ||
          (PR_RANK[candidate.kind] === PR_RANK[best.kind] && candidate.value > best.value)
        ) {
          best = candidate;
        }
      }
      if (best) found.push(best);
    });
    return found;
  });

  protected prLabel(pr: SummaryPr): string {
    const params = { value: String(pr.value), previous: String(pr.previous) };
    switch (pr.kind) {
      case 'weight':
        return this.tr.tp('summary_pr_weight', params);
      case 'reps_at_weight':
        return this.tr.tp('summary_pr_reps_at_weight', params);
      case 'e1rm':
        return this.tr.tp('summary_pr_e1rm', params);
      case 'reps':
        return this.tr.tp(pr.unit === 'TIME' ? 'summary_pr_time' : 'summary_pr_reps', params);
    }
  }

  protected readonly note = computed(() => this.session().sessionNote ?? '');

  protected saveNote(event: Event): void {
    this.state.setSessionNote(this.session().dayId, (event.target as HTMLTextAreaElement).value);
  }
}
