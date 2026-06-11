import {
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
import { AiRecommendation, Exercise, TodaySetProgress, WorkoutDay } from '../../models/workout.model';

@Component({
  selector: 'app-exercise-card',
  standalone: true,
  imports: [IconComponent, RouterLink],
  templateUrl: './exercise-card.component.html',
  styleUrl: './exercise-card.component.scss',
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

  /** Indices where AI wrote the initial value — cleared on user edit */
  protected readonly aiPrefilledIndices = signal<ReadonlySet<number>>(new Set());

  protected readonly activeSetIndex = computed(() =>
    this.setsArray().findIndex(s => !s.done),
  );

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
        weight: prev && ex.unit !== 'peso corporal' && (prev.weight as number) > 0
          ? prev.weight
          : ('' as unknown as number),
        reps: prev && (prev.reps as number) > 0
          ? prev.reps
          : ('' as unknown as number),
        done: false,
      };
    });
  });

  protected readonly lastSets = computed(() =>
    this.storage.lastSetsForExercise(this.state.state(), this.exercise().id),
  );

  protected readonly doneSetsCount = computed(() =>
    this.setsArray().filter(s => s.done).length,
  );

  protected readonly isDone = computed(() => {
    const arr = this.setsArray();
    return arr.length > 0 && arr.every(s => s.done);
  });

  protected readonly aiRecLabel = computed(() => {
    const rec = this.aiRec();
    if (!rec || !rec.sets?.length) return '';
    const ex = this.exercise();
    const first = rec.sets[0];
    const last = rec.sets[rec.sets.length - 1];
    if (ex.unit === 'peso corporal') return `${first.reps} reps`;
    if (ex.unit === 'tiempo') return `${first.reps} seg`;
    const suffix = ex.unit === 'kg por mano' ? 'kg/m' : ex.unit === 'kg por brazo' ? 'kg/b' : 'kg';
    if (last.weight > first.weight) {
      return `${first.weight}${suffix} × ${first.reps} → ${last.weight}${suffix}`;
    }
    return `${first.weight}${suffix} × ${first.reps} reps`;
  });

  constructor() {
    // Auto-expand + scroll into view when this exercise becomes active
    effect(() => {
      const active = this.isActive();
      if (active) {
        untracked(() => {
          if (!this.expanded()) {
            this.expanded.set(true);
            if (!this.aiRec()) this.requestAi.emit();
          }
          requestAnimationFrame(() => {
            this.el.nativeElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
          });
        });
      }
    });

    // Pre-fill state from AI rec when it arrives (only for untouched sets)
    effect(() => {
      const rec = this.aiRec();
      if (!rec || rec.loading || !rec.sets?.length) return;
      const ex = this.exercise();
      const day = this.day();
      untracked(() => {
        const tp = this.state.getTodayProgress(day.id);
        const filled = new Set<number>();
        for (let i = 0; i < ex.defaultSets; i++) {
          const existing = tp.sets[ex.id]?.[i];
          if (existing?.done) continue;
          if (existing && (existing.weight !== '' || existing.reps !== '')) continue;
          const setRec = rec.sets[i] ?? rec.sets[rec.sets.length - 1];
          const patch: Partial<TodaySetProgress> = { reps: setRec.reps };
          if (ex.unit !== 'peso corporal' && setRec.weight > 0) patch.weight = setRec.weight;
          this.state.updateSet(day.id, ex.id, i, patch);
          filled.add(i);
        }
        this.aiPrefilledIndices.set(filled);
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
    this.expanded.update(v => !v);
    if (expanding && !this.aiRec()) {
      this.requestAi.emit();
    }
  }

  protected updateWeight(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const weight = val === '' ? ('' as unknown as number) : Number(val);
    this.state.updateSet(this.day().id, this.exercise().id, i, { weight });
    this.aiPrefilledIndices.update(s => { const n = new Set(s); n.delete(i); return n; });
  }

  protected updateReps(i: number, event: Event): void {
    const val = (event.target as HTMLInputElement).value;
    const reps = val === '' ? ('' as unknown as number) : Number(val);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps });
    this.aiPrefilledIndices.update(s => { const n = new Set(s); n.delete(i); return n; });
  }

  protected stepWeight(i: number, delta: number): void {
    const current = this.setsArray()[i]?.weight;
    const base = current !== '' && current !== undefined ? Number(current) : 0;
    const next = Math.max(0, Math.round((base + delta) * 4) / 4);
    this.state.updateSet(this.day().id, this.exercise().id, i, { weight: next });
    this.aiPrefilledIndices.update(s => { const n = new Set(s); n.delete(i); return n; });
  }

  protected stepReps(i: number, delta: number): void {
    const current = this.setsArray()[i]?.reps;
    const base = current !== '' && current !== undefined ? Number(current) : 0;
    const next = Math.max(1, base + delta);
    this.state.updateSet(this.day().id, this.exercise().id, i, { reps: next });
    this.aiPrefilledIndices.update(s => { const n = new Set(s); n.delete(i); return n; });
  }

  /** Sets already celebrated as PR — prevents re-celebrating on undo + redo */
  private readonly celebratedPrSets = new Set<string>();

  protected toggleDone(setIndex: number): void {
    const result = this.state.toggleSetDone(this.day().id, this.exercise(), setIndex);
    if (result === 'done') {
      this.maybeCelebratePr(setIndex);
      const ex = this.exercise();
      const restSecs = ex.restSeconds || this.state.settings().defaultRest;
      const arr = this.setsArray();
      const nextIdx = arr.findIndex((s, i) => i > setIndex && !s.done);
      const nextLabel = nextIdx >= 0
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
      .filter(h => h.dateISO < this.state.todayKey);
    if (!history.length) return;

    const maxWeight = Math.max(...history.map(h => h.topWeight));
    if (weight <= maxWeight) return;

    this.celebratedPrSets.add(key);
    if (this.state.settings().sounds) this.sound.playPrBeep();
    this.uiState.celebratePr(ex.name, weight);
  }

  protected ytUrl(): string {
    return 'https://www.youtube.com/results?search_query=' + encodeURIComponent(this.exercise().name);
  }

  protected onRequestAi(): void {
    this.requestAi.emit();
  }
}
