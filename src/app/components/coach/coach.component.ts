import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { TranslationService } from '../../services/translation.service';
import { ProgressionService } from '../../services/progression.service';
import { CoachChatService } from '../../services/coach-chat.service';
import {
  AiFeedbackEntry,
  AiRecommendation,
  Exercise,
  WorkoutDay,
} from '../../models/workout.model';
import { DEFAULT_TOKEN_BUDGET } from '../../services/providers/ai-usage';

type Tab = 'panel' | 'chat' | 'history';

interface SuggestionRow {
  exercise: Exercise;
  rec: AiRecommendation;
  /** Ya respondida hoy: se marca en vez de volver a preguntar. */
  answered: AiFeedbackEntry | null;
}

/** Coste aproximado de un mensaje de chat, para enseñarlo antes de gastar. */
const CHAT_TOKENS_PER_MESSAGE = 120;

@Component({
  selector: 'app-coach',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './coach.component.html',
  styleUrl: './coach.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CoachComponent {
  protected readonly state = inject(StateService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  private readonly progression = inject(ProgressionService);
  protected readonly chat = inject(CoachChatService);

  protected readonly tab = signal<Tab>('panel');
  protected readonly draft = signal('');
  protected readonly chatTokens = CHAT_TOKENS_PER_MESSAGE;

  private readonly suggestions = signal<Record<string, AiRecommendation> | null>(null);
  protected readonly source = signal<'groq' | 'cohere' | 'local' | null>(null);

  protected readonly day = computed(() => this.state.currentDay());

  protected readonly budget = computed(
    () => this.state.settings().aiTokenBudget ?? DEFAULT_TOKEN_BUDGET,
  );

  protected readonly block = computed(() => this.chat.blockedBy(this.state.settings()));

  /**
   * Sugerencias del próximo día. Se leen de lo PRECALCULADO al cerrar la última sesión: el
   * panel no puede disparar una llamada al abrirse, o entrar al tab costaría tokens.
   */
  constructor() {
    effect(() => {
      const day = this.day();
      if (day) void this.loadSuggestions(day);
    });
  }

  private async loadSuggestions(day: WorkoutDay): Promise<void> {
    // El estado VIVO, igual que el resto de llamadores: quien lo relee del disco puede
    // construir otro contexto, otro hash, y no encontrar la sugerencia que se acaba de guardar.
    // `allowNetwork`: el panel es el ÚNICO lugar que puede disparar la llamada de IA fuera
    // del cierre de sesión — una por contexto, cacheada por hash (T-826). La sesión (H2)
    // sigue leyendo sin red.
    const result = await this.progression.suggestionsForToday(
      day,
      this.state.settings(),
      this.tr.lang(),
      { state: this.state.state(), allowNetwork: true },
    );
    this.suggestions.set(result.byExercise);
    this.source.set(result.source);
  }

  protected readonly rows = computed((): SuggestionRow[] => {
    const day = this.day();
    const byExercise = this.suggestions();
    if (!day || !byExercise) return [];
    return day.exercises.flatMap((exercise) => {
      const rec = byExercise[exercise.id];
      if (!rec) return [];
      const answered = this.state.aiFeedbackFor(exercise.id)[0] ?? null;
      return [{ exercise, rec, answered: this.isForToday(answered) ? answered : null }];
    });
  });

  private isForToday(entry: AiFeedbackEntry | null): boolean {
    return entry !== null && entry.dateISO === this.state.todayKey;
  }

  protected readonly history = computed(() => [...(this.state.state().aiFeedback ?? [])].reverse());

  protected firstSet(rec: AiRecommendation) {
    return rec.sets[0] ?? null;
  }

  /**
   * Cómo se lee el peso de una recomendación.
   *
   * El motor sube SOLO las últimas series la primera vez que cumplís el objetivo, así que
   * `sets` puede venir `[35, 45, 45]`. Enseñar `sets[0]` mostraba 35 mientras el motivo
   * hablaba de 45: la tarjeta contradecía su propia explicación.
   *
   * `null` cuando el ejercicio no lleva carga (peso corporal, tiempo): ahí un "0 kg" no
   * significa nada y se muestran solo las reps.
   */
  protected weightLabel(row: SuggestionRow): string | null {
    if (row.exercise.unit === 'BODYWEIGHT' || row.exercise.unit === 'TIME') return null;
    const weights = row.rec.sets.map((s) => s.weight).filter((w) => w > 0);
    if (!weights.length) return null;
    const min = Math.min(...weights);
    const max = Math.max(...weights);
    return min === max ? `${max}` : `${min} → ${max}`;
  }

  /** Reps objetivo: si varían entre series se muestra el rango. */
  protected repsLabel(row: SuggestionRow): string {
    const reps = row.rec.sets.map((s) => s.reps);
    const min = Math.min(...reps);
    const max = Math.max(...reps);
    return min === max ? `${max}` : `${min}–${max}`;
  }

  // ── C1 · aceptar / cambiar / rechazar ──

  protected accept(row: SuggestionRow): void {
    const set = this.firstSet(row.rec);
    this.state.recordAiFeedback({
      exerciseId: row.exercise.id,
      exerciseName: row.exercise.name,
      action: 'accepted',
      suggested: set,
      applied: set,
      source: row.rec.source,
    });
  }

  protected reject(row: SuggestionRow): void {
    this.state.recordAiFeedback({
      exerciseId: row.exercise.id,
      exerciseName: row.exercise.name,
      action: 'rejected',
      suggested: this.firstSet(row.rec),
      applied: null,
      source: row.rec.source,
    });
  }

  protected change(row: SuggestionRow): void {
    const set = this.firstSet(row.rec);
    const raw = window.prompt(this.T().coach_change_prompt, String(set?.weight ?? ''));
    const weight = Number(raw);
    if (!raw || !Number.isFinite(weight) || weight <= 0) return;
    this.state.recordAiFeedback({
      exerciseId: row.exercise.id,
      exerciseName: row.exercise.name,
      action: 'modified',
      suggested: set,
      applied: { weight, reps: set?.reps ?? 0 },
      source: row.rec.source,
    });
  }

  protected actionLabel(action: AiFeedbackEntry['action']): string {
    if (action === 'accepted') return this.T().coach_accepted;
    if (action === 'rejected') return this.T().coach_rejected;
    return this.T().coach_modified;
  }

  // ── C2 · chat ──

  /** Con cambios de peso el texto habla de la sesión; sin ellos, solo del contexto. */
  protected readonly proposalIntro = computed(() =>
    this.chat.proposedWeights().length
      ? this.T().coach_weights_intro
      : this.T().coach_proposal_intro,
  );

  protected readonly acceptLabel = computed(() =>
    this.chat.proposedWeights().length
      ? this.T().coach_weights_accept
      : this.T().coach_proposal_accept,
  );

  protected readonly proposalSaved = signal(false);

  protected async acceptProposal(): Promise<void> {
    await this.chat.acceptProposal();
    this.proposalSaved.set(true);
    setTimeout(() => this.proposalSaved.set(false), 3000);
    // El panel lee de lo GUARDADO, no de una señal: sin recargar, aceptar no se vería.
    // Se recarga siempre, no solo con pesos: cambiar el contexto también mueve los números.
    const day = this.day();
    if (day) void this.loadSuggestions(day);
  }

  /** Etiqueta legible de objetivo y nivel: el modelo los manda como enum. */
  protected goalLabel(goal: string): string {
    const t = this.T() as unknown as Partial<Record<string, string>>;
    return t[`settings_goal_${goal}`] ?? goal;
  }

  protected levelLabel(level: string): string {
    const t = this.T() as unknown as Partial<Record<string, string>>;
    return t[`profile_level_${level}`] ?? level;
  }

  protected async send(): Promise<void> {
    const text = this.draft().trim();
    if (!text) return;
    this.draft.set('');
    await this.chat.send(text, this.state.settings(), this.tr.lang());
  }

  protected onDraft(event: Event): void {
    this.draft.set((event.target as HTMLInputElement).value);
  }

  protected onEnter(event: Event): void {
    event.preventDefault();
    void this.send();
  }

  protected providerLabel(): string {
    const source = this.source();
    if (source === 'groq') return this.tr.tp('coach_provider_active', { name: 'Groq' });
    if (source === 'cohere') return this.tr.tp('coach_provider_active', { name: 'Cohere' });
    return this.T().coach_provider_local;
  }
}
