import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
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
import { CeilingCause } from '../../services/providers/session-response';
import { SessionRecommendation } from '../../services/providers/session-context';
import { StorageService } from '../../services/storage.service';
import { ViewportService } from '../../services/viewport.service';
import { NgTemplateOutlet } from '@angular/common';

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
  imports: [IconComponent, NgTemplateOutlet],
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
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly storage = inject(StorageService);
  protected readonly viewport = inject(ViewportService);

  protected readonly tab = signal<Tab>('panel');
  protected readonly draft = signal('');
  protected readonly chatTokens = CHAT_TOKENS_PER_MESSAGE;

  private readonly suggestions = signal<Record<string, AiRecommendation> | null>(null);
  /** Lo que hubo que corregir de la respuesta, con la causa. Alimenta la columna "por que". */
  private readonly validated = signal<SessionRecommendation['validated'] | null>(null);
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

    // La pestaña vive en la URL (T-838): en escritorio la barra lateral enlaza directamente
    // a "Chat" o "Historial", y sin esto esos enlaces llevaban siempre al panel. De paso
    // hace que un enlace al chat sea un enlace al chat, no a "el coach, ya buscarás".
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const vista = params.get('vista');
      if (vista === 'chat' || vista === 'historial') {
        this.tab.set(vista === 'chat' ? 'chat' : 'history');
      } else if (vista === 'panel') {
        this.tab.set('panel');
      }
    });
  }

  /** Cambiar de pestaña ESCRIBE la URL: volver atrás vuelve a la pestaña anterior. */
  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    const vista = tab === 'panel' ? 'panel' : tab === 'chat' ? 'chat' : 'historial';
    void this.router.navigate([], { relativeTo: this.route, queryParams: { vista } });
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
    this.validated.set(result.validated ?? null);
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

  /** El contexto se corrige donde vive, que es el perfil. */
  protected openProfile(): void {
    void this.router.navigate(['/profile']);
  }

  protected readonly history = computed(() => [...(this.state.state().aiFeedback ?? [])].reverse());

  // ── Escritorio: la propuesta como tabla auditable (T-839) ──
  //
  // En el móvil el coach es un chat con tarjetas. En un monitor eso desperdicia la única
  // ventaja del medio: poder poner el ANTES y el DESPUÉS uno al lado del otro con su
  // motivo. Estos ayudantes existen para esa tabla; el móvil no los usa.

  /** La marca de la que se parte. `null` si el ejercicio no tiene historial con carga. */
  protected lastLabel(row: SuggestionRow): string | null {
    if (row.exercise.unit === 'BODYWEIGHT' || row.exercise.unit === 'TIME') return null;
    const sets = this.storage.lastSetsForExercise(this.state.state(), row.exercise.id);
    const working = (sets ?? []).filter((s) => !s.isWarmup && s.weight > 0);
    if (!working.length) return null;
    const top = working.reduce((a, b) => (b.weight > a.weight ? b : a));
    return `${top.weight} × ${top.reps}`;
  }

  /**
   * Diferencia entre lo propuesto y la última marca.
   *
   * Se compara contra el TOPE de ambas, no contra la primera serie: el motor sube solo las
   * últimas series la primera vez que cumplís, y comparar primeras haría que una subida
   * real apareciera como "igual".
   */
  protected deltaOf(row: SuggestionRow): { text: string; tone: 'up' | 'down' | 'flat' } | null {
    if (row.exercise.unit === 'BODYWEIGHT' || row.exercise.unit === 'TIME') return null;
    const sets = this.storage.lastSetsForExercise(this.state.state(), row.exercise.id);
    const previous = Math.max(0, ...(sets ?? []).filter((s) => !s.isWarmup).map((s) => s.weight));
    const proposed = Math.max(0, ...row.rec.sets.map((s) => s.weight));
    if (previous <= 0 || proposed <= 0) return null;

    const diff = Math.round((proposed - previous) * 100) / 100;
    if (diff === 0) return { text: this.T().coach_delta_same, tone: 'flat' };
    return { text: `${diff > 0 ? '+' : '−'}${Math.abs(diff)}`, tone: diff > 0 ? 'up' : 'down' };
  }

  private readonly causeLabels = computed((): Record<CeilingCause, string> => {
    const T = this.T();
    return {
      layoff: T.coach_cause_layoff,
      injury: T.coach_cause_injury,
      hard_feel: T.coach_cause_hard_feel,
      max_increase: T.coach_cause_max_increase,
    };
  });

  /**
   * Por qué ese número.
   *
   * Si el techo tuvo que recortar la respuesta, esa es la explicación verdadera y gana:
   * el motivo que escribió el modelo describe lo que PROPUSO, no lo que quedó. Si no hubo
   * recorte, se enseña el motivo del motor tal cual.
   */
  protected whyLabel(row: SuggestionRow): string {
    const cause = this.validated()?.corrections.find((c) => c.exerciseId === row.exercise.id)
      ?.causes?.[0];
    if (cause) return this.causeLabels()[cause];
    // Un ejercicio estrenado hoy no tiene motivo que contar: el motor no está razonando
    // sobre nada, está proponiendo un punto de partida. Decirlo es más honesto que un hueco.
    if (!row.rec.reason && !this.lastLabel(row)) return this.T().coach_desk_first_time;
    return row.rec.reason;
  }

  /** Cuántas de las filas cambian algo: el titular del pie de la tabla. */
  protected readonly changeCount = computed(
    () => this.rows().filter((row) => this.deltaOf(row)?.tone !== 'flat').length,
  );

  /**
   * Con qué está respondiendo el coach, como franja de 44px en vez de panel de 320.
   *
   * Es el mismo contexto que el motor usa para decidir. Hoy solo aparece cuando el chat
   * propone algo, así que el atleta nunca sabe con qué se le está respondiendo.
   */
  protected readonly contextChips = computed((): { label: string; hot: boolean }[] => {
    const T = this.T();
    const p = this.state.settings().userProfile;
    const chips: { label: string; hot: boolean }[] = [];
    if (p.level) chips.push({ label: this.levelLabel(p.level), hot: false });
    if (p.goal) chips.push({ label: this.goalLabel(p.goal), hot: false });
    if (p.layoffSinceISO) {
      chips.push({ label: T.coach_context_layoff, hot: true });
    }
    chips.push({
      label: p.aiNotes?.trim() ? p.aiNotes.trim() : T.coach_context_no_notes,
      hot: !!p.aiNotes?.trim(),
    });
    return chips;
  });

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

  /** Las que todavía no se respondieron hoy: las que "Aceptar todo" tiene que tocar. */
  protected readonly pendingRows = computed(() => this.rows().filter((r) => !r.answered));

  /** El atleta pidió verlas una a una: la tarjeta de conjunto se aparta y deja el detalle. */
  protected readonly batchDismissed = signal(false);

  /**
   * Acepta de una vez lo que el motor propone para TODA la sesión (T-834).
   *
   * Cuatro tarjetas idénticas con tres botones cada una son doce decisiones para lo que
   * casi siempre es una sola: "está bien, seguimos". El detalle por ejercicio sigue ahí
   * abajo para quien quiera discutir uno — pero deja de ser el único camino.
   */
  protected acceptAll(): void {
    for (const row of this.pendingRows()) this.accept(row);
  }

  protected reviewOneByOne(): void {
    this.batchDismissed.set(true);
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

  /**
   * Abre el generador con la spec que salió de la conversación (T-830).
   *
   * Si además hay una propuesta de contexto pendiente, se acepta ANTES de navegar: la spec
   * del generador se arma desde el perfil (nivel, objetivo, equipo, notas), así que
   * aceptarla primero es lo que hace que la rutina salga con lo que el atleta acaba de
   * contar. El botón lo dice: "Aceptar y abrir el generador".
   */
  protected async openGenerator(): Promise<void> {
    const req = this.chat.consumeRoutineRequest();
    if (!req) return;
    if (this.chat.proposal()) await this.acceptProposal();
    void this.router.navigate(['/routines'], {
      queryParams: { gen: 1, days: req.daysPerWeek, min: req.minutes ?? null },
    });
  }

  /**
   * La spec, con el valor YA AJUSTADO a lo que el generador sabe hacer.
   *
   * Si el atleta pidió 30 minutos, aquí dice 45: enseñar lo que pidió y generar otra cosa
   * sería mentir en la única pantalla donde iba a confiar.
   */
  protected readonly routineSummary = computed(() => {
    const req = this.chat.routineRequest();
    if (!req) return '';
    return req.minutes
      ? this.tr.tp('coach_routine_summary', { days: req.daysPerWeek, minutes: req.minutes })
      : this.tr.tp('coach_routine_summary_days', { days: req.daysPerWeek });
  });

  /** Lo que hará el botón, dicho entero: aceptar el contexto es parte del mismo toque. */
  protected readonly openGeneratorLabel = computed(() =>
    this.chat.proposal() ? this.T().coach_routine_accept_open : this.T().coach_routine_open,
  );

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
