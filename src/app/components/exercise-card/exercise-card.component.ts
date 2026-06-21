import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';
import { RouterLink } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { UIStateService } from '../../services/ui-state.service';
import { TranslationService } from '../../services/translation.service';
import { SoundService } from '../../services/sound.service';
import {
  AiRecommendation,
  Exercise,
  TodaySetProgress,
  WorkoutDay,
} from '../../models/workout.model';
import { formatRecLabel } from '../../utils/rec-label';

@Component({
  selector: 'app-exercise-card',
  standalone: true,
  imports: [IconComponent, RouterLink],
  templateUrl: './exercise-card.component.html',
  styleUrl: './exercise-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExerciseCardComponent {
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly uiState = inject(UIStateService);
  private readonly sound = inject(SoundService);
  private readonly el = inject(ElementRef);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;

  readonly day = input.required<WorkoutDay>();
  readonly exercise = input.required<Exercise>();
  readonly aiRec = input<AiRecommendation | null>(null);
  readonly isActive = input(false);
  readonly requestAi = output<void>();
  readonly exerciseCompleted = output<void>();

  protected readonly expanded = signal(typeof window !== 'undefined' && window.innerWidth >= 1024);

  /** Indices where AI wrote the value and user hasn't edited yet — derived from persisted state */
  protected readonly aiPrefilledIndices = computed((): ReadonlySet<number> => {
    const s = new Set<number>();
    this.setsArray().forEach((set, i) => {
      if (set.aiPrefilled) s.add(i);
    });
    return s;
  });

  protected readonly activeSetIndex = computed(() => this.setsArray().findIndex((s) => !s.done));

  protected weightStep(): number {
    const brick = this.exercise().brick;
    return brick > 0 ? brick : 0.5;
  }

  protected readonly setsArray = computed((): TodaySetProgress[] => {
    const ex = this.exercise();
    const tp = this.state.getTodayProgress(this.day().id);
    const saved = tp.sets[ex.id] ?? [];
    const last = this.storage.lastSetsForExercise(this.state.state(), ex.id);
    return Array.from({ length: ex.defaultSets }, (_, i) => {
      if (saved[i]) return saved[i];
      const prev = last?.[i];
      return {
        weight:
          prev && ex.unit !== 'peso corporal' && (prev.weight as number) > 0
            ? prev.weight
            : ('' as unknown as number),
        reps: prev && (prev.reps as number) > 0 ? prev.reps : ('' as unknown as number),
        done: false,
      };
    });
  });

  protected readonly doneSetsCount = computed(() => this.setsArray().filter((s) => s.done).length);

  protected readonly lastSets = computed(
    () => this.storage.lastSetsForExercise(this.state.state(), this.exercise().id) ?? [],
  );

  protected readonly prevSetsLine = computed(() => {
    const sets = this.lastSets();
    if (!sets.length) return '';
    const unit = this.exercise().unit;
    return sets
      .map((s) => {
        if (unit === 'peso corporal') return `${s.reps}r`;
        if (unit === 'tiempo') return `${s.reps}s`;
        return `${s.weight}×${s.reps}`;
      })
      .join(' / ');
  });

  protected readonly isDone = computed(() => {
    const arr = this.setsArray();
    return arr.length > 0 && arr.every((s) => s.done);
  });

  protected readonly aiRecLabel = computed(() =>
    formatRecLabel(this.exercise().unit, this.aiRec()?.sets, { withRepsInRange: true }),
  );

  constructor() {
    // Auto-expand + scroll into view when this exercise becomes active
    effect(() => {
      const active = this.isActive();
      if (active) {
        untracked(() => {
          if (!this.expanded()) this.expanded.set(true);
          if (!this.aiRec()) this.requestAi.emit();
          requestAnimationFrame(() => {
            this.el.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      }
    });

    // Pre-fill state from AI rec when it arrives (only for untouched sets)
    // exercise() and day() are read inside untracked() to avoid tracking them as reactive
    // dependencies — updateSet() changes state() → days() creates new references → day input
    // changes → if tracked here, the effect would re-fire infinitely (NG0103).
    effect(() => {
      const rec = this.aiRec();
      if (!rec || rec.loading || !rec.sets?.length) return;
      untracked(() => {
        const ex = this.exercise();
        const day = this.day();
        const tp = this.state.getTodayProgress(day.id);
        for (let i = 0; i < ex.defaultSets; i++) {
          const existing = tp.sets[ex.id]?.[i];
          if (existing?.done) continue;
          const setRec = rec.sets[i] ?? rec.sets[rec.sets.length - 1];
          const patch: Partial<TodaySetProgress> = { reps: setRec.reps, aiPrefilled: true };
          if (ex.unit !== 'peso corporal' && setRec.weight > 0) patch.weight = setRec.weight;
          this.state.updateSet(day.id, ex.id, i, patch);
        }
      });
    });

    // Auto-scroll + focus next pending set when rest timer ends
    effect(() => {
      const focus = this.uiState.focusSet();
      if (!focus || focus.exerciseId !== this.exercise().id) return;
      untracked(() => {
        this.uiState.focusSet.set(null);
        this.expanded.set(true);
        // Double RAF: first frame renders the expanded body, second frame measures layout
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            const root = this.el.nativeElement as HTMLElement;
            const input = root.querySelector<HTMLInputElement>(
              `.set-input-weight[data-set-index="${focus.setIndex}"]`,
            );
            if (input) {
              input.scrollIntoView({ behavior: 'smooth', block: 'center' });
              input.focus();
            }
          });
        });
      });
    });
  }

  protected toggle(): void {
    const expanding = !this.expanded();
    this.expanded.update((v) => !v);
    if (expanding && !this.aiRec()) {
      this.requestAi.emit();
    }
  }

  protected toggleWarmup(i: number): void {
    const cur = this.setsArray()[i];
    if (!cur || cur.done) return;
    this.state.updateSet(this.day().id, this.exercise().id, i, { isWarmup: !cur.isWarmup });
  }

  protected updateWeight(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    let weight: number | string;
    if (val === '') {
      weight = '' as unknown as number;
    } else if (val.endsWith('.')) {
      // Preserve "32." while user is mid-decimal — Number("32.") = 32 would lose the dot
      // and Angular re-rendering [value]="32" moves the cursor to the start
      weight = val as unknown as number;
    } else {
      const num = Number(val);
      weight = isNaN(num) ? ('' as unknown as number) : num;
    }
    this.state.updateSet(this.day().id, this.exercise().id, i, { weight, aiPrefilled: false });
  }

  protected updateReps(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const reps = val === '' ? ('' as unknown as number) : Number(val);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps, aiPrefilled: false });
  }

  protected stepWeight(i: number, delta: number): void {
    const current = this.setsArray()[i]?.weight;
    const base = current !== '' && current !== undefined ? Number(current) : 0;
    const next = Math.max(0, Math.round((base + delta) * 4) / 4);
    this.state.updateSet(this.day().id, this.exercise().id, i, {
      weight: next,
      aiPrefilled: false,
    });
  }

  protected stepReps(i: number, delta: number): void {
    const current = this.setsArray()[i]?.reps;
    const base = current !== '' && current !== undefined ? Number(current) : 0;
    const next = Math.max(1, base + delta);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps: next, aiPrefilled: false });
  }

  /** Sets already celebrated as PR — prevents re-celebrating on undo + redo */
  private readonly celebratedPrSets = new Set<string>();

  protected toggleDone(setIndex: number): void {
    const result = this.state.toggleSetDone(this.day().id, this.exercise(), setIndex);
    if (result === 'done') {
      if (this.state.settings().haptics && navigator.vibrate) navigator.vibrate(40);
      this.maybeCelebratePr(setIndex);
      const ex = this.exercise();
      const restSecs = ex.restSeconds || this.state.settings().defaultRest;
      const arr = this.setsArray();
      const nextIdx = arr.findIndex((s, i) => i > setIndex && !s.done);
      const nextLabel =
        nextIdx >= 0
          ? this.tr.tp('rest_timer_next_set', { n: nextIdx + 1 })
          : this.T().rest_timer_next_exercise;
      this.uiState.restTimer.set({
        seconds: restSecs,
        exerciseId: ex.id,
        nextLabel,
        nextSetIndex: nextIdx,
      });
      if (this.isDone()) {
        this.exerciseCompleted.emit();
      }
    }
  }

  private maybeCelebratePr(setIndex: number): void {
    const ex = this.exercise();
    // Weight isn't the progress metric for time/bodyweight exercises
    if (ex.unit === 'tiempo' || ex.unit === 'peso corporal') return;

    const key = `${ex.id}:${setIndex}`;
    if (this.celebratedPrSets.has(key)) return;

    const set = this.state.getTodayProgress(this.day().id).sets[ex.id]?.[setIndex];
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

  protected ytUrl(): string {
    return (
      'https://www.youtube.com/results?search_query=' + encodeURIComponent(this.exercise().name)
    );
  }

  protected onRequestAi(): void {
    this.requestAi.emit();
  }
}
