import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { CatalogService, templatesForProfile } from '../../services/catalog.service';
import {
  CostEstimate,
  DEFAULT_GEN_DAYS,
  DEFAULT_GEN_MINUTES,
  GEN_DAYS,
  GEN_MINUTES,
  GenBlock,
  GenFailure,
  GeneratedDay,
  GeneratedRoutine,
  GeneratorError,
  RoutineGeneratorService,
  snapTo,
} from '../../services/routine-generator.service';
import { RoutineTemplate } from '../../data/routine-templates';
import { Equipment } from '../../data/exercise-catalog';
import { daysBetweenISO } from '../../utils/date';
import { Routine, WorkoutDay } from '../../models/workout.model';

/** Cuatro pantallas del diseño (R1, R2, R6, R7) bajo una sola ruta. */
type View = 'list' | 'detail' | 'templates' | 'generator';

interface RoutineRow {
  routine: Routine;
  dayCount: number;
  lastUsedISO: string | null;
  isActive: boolean;
}

@Component({
  selector: 'app-routines',
  standalone: true,
  imports: [IconComponent],
  templateUrl: './routines.component.html',
  styleUrl: './routines.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoutinesComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  protected readonly uiState = inject(UIStateService);
  private readonly catalog = inject(CatalogService);
  private readonly generator = inject(RoutineGeneratorService);
  private readonly route = inject(ActivatedRoute);

  protected readonly view = signal<View>('list');
  protected readonly detailId = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);

  constructor() {
    // `?gen=1&days=4&min=60` abre el generador con la spec puesta. Es como llega la
    // petición del chat, pero la URL es editable y se comparte: lo que entra por aquí se
    // valida igual que lo que manda el modelo, porque son dos puertas al mismo estado.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      if (params.get('gen') !== '1') return;
      this.genDays.set(snapTo(GEN_DAYS, params.get('days'), DEFAULT_GEN_DAYS));
      this.genMinutes.set(snapTo(GEN_MINUTES, params.get('min'), DEFAULT_GEN_MINUTES));
      this.generated.set(null);
      this.genError.set(null);
      this.view.set('generator');
    });
  }

  // ── R1 · lista ──

  /**
   * Una fila por rutina con lo que hace falta para decidir: cuántos días tiene y cuándo se
   * usó por última vez. El diseño rotula alguna como "creada con IA", pero el estado no
   * guarda el origen: inventarlo sería etiquetar a ojo.
   */
  protected readonly rows = computed((): RoutineRow[] => {
    const s = this.state.state();
    const sessions = s.sessions.filter((x) => !x.skipped);
    return s.routines.map((routine) => {
      const dayIds = new Set(routine.dayIds);
      const used = sessions.filter((x) => dayIds.has(x.dayId)).map((x) => x.dateISO);
      return {
        routine,
        dayCount: routine.dayIds.length,
        lastUsedISO: used.length ? used.reduce((a, b) => (a > b ? a : b)) : null,
        isActive: routine.id === s.activeRoutineId,
      };
    });
  });

  protected readonly activeRow = computed(() => this.rows().find((r) => r.isActive) ?? null);
  protected readonly otherRows = computed(() =>
    this.rows().filter((r) => !r.isActive && !r.routine.archived),
  );
  protected readonly archivedRows = computed(() =>
    this.rows().filter((r) => !r.isActive && r.routine.archived),
  );

  /** Nombre del día que toca en la rotación de la rutina activa. */
  protected readonly nextDayName = computed(() => this.state.currentDay()?.name ?? null);

  // ── R2 · detalle ──

  protected readonly detailRoutine = computed(() => {
    const id = this.detailId();
    return id === null ? null : (this.state.routines().find((r) => r.id === id) ?? null);
  });

  /**
   * Días de la rutina abierta. `state.days()` resuelve solo la ACTIVA, así que una rutina
   * que no lo es hay que resolverla contra el catálogo a mano.
   */
  protected readonly detailDays = computed((): WorkoutDay[] => {
    const routine = this.detailRoutine();
    if (!routine) return [];
    const s = this.state.state();
    const byId = new Map(s.exercises.map((e) => [e.id, e]));
    return routine.dayIds.flatMap((dayId) => {
      const stored = s.days.find((d) => d.id === dayId);
      if (!stored) return [];
      return [
        {
          id: stored.id,
          name: stored.name,
          exercises: stored.exerciseIds.flatMap((exId) => {
            const ex = byId.get(exId);
            return ex ? [ex] : [];
          }),
        },
      ];
    });
  });

  protected readonly rotationLabel = computed(() =>
    this.detailDays()
      .map((d) => d.name)
      .join(' → '),
  );

  protected readonly todayDayId = computed(() =>
    this.detailRoutine()?.id === this.state.state().activeRoutineId
      ? (this.state.currentDay()?.id ?? null)
      : null,
  );

  // ── R6 · plantillas ──

  protected readonly templates = computed(() => {
    const profile = this.state.settings().userProfile;
    const filtered = templatesForProfile(profile.level, profile.equipment as Equipment[] | null);
    // Un filtro que no deja nada es peor que no filtrar: el usuario se queda sin salida.
    return filtered.length ? filtered : templatesForProfile(null, null);
  });

  protected readonly templateProfileLabel = computed(() => {
    const p = this.state.settings().userProfile;
    const parts: string[] = [];
    if (p.level) parts.push(p.level);
    if (p.goal) parts.push(p.goal);
    return parts.length ? parts.join(' · ') : null;
  });

  protected readonly previewTemplate = signal<RoutineTemplate | null>(null);

  protected templateName(t: RoutineTemplate): string {
    return this.tr.lang() === 'en' ? t.en : t.es;
  }

  protected templateDayNames(t: RoutineTemplate): string[] {
    return t.days.map((d) => (this.tr.lang() === 'en' ? d.en : d.es));
  }

  // ── R7 · generador ──

  /** Las opciones que la UI sabe representar; también las que aceptan el chat y el deep link. */
  protected readonly GEN_DAYS = GEN_DAYS;
  protected readonly GEN_MINUTES = GEN_MINUTES;

  protected readonly genDays = signal<number>(DEFAULT_GEN_DAYS);
  protected readonly genMinutes = signal<number>(DEFAULT_GEN_MINUTES);
  protected readonly generating = signal(false);
  protected readonly generated = signal<GeneratedRoutine | null>(null);
  protected readonly genError = signal<GenFailure | null>(null);

  /** Qué impide generar ahora mismo, para poder DECIRLO en vez de deshabilitar y callar. */
  protected readonly genBlock = computed(
    (): GenBlock => this.generator.blockedBy(this.state.settings()),
  );

  protected readonly costEstimate = computed(
    (): CostEstimate =>
      this.generator.estimateCost(this.spec(), this.state.settings(), this.tr.lang()),
  );

  private spec() {
    const p = this.state.settings().userProfile;
    return {
      daysPerWeek: this.genDays(),
      level: p?.level ?? null,
      goal: p?.goal ?? null,
      equipment: (p?.equipment as Equipment[] | null) ?? null,
      // Los minutos van PRIMERO: `buildPrompt()` recorta las notas a 200 caracteres y
      // `aiNotes` está capado en exactamente 200, así que puestos al final se perdían
      // enteros — y quien llena `aiNotes` hasta el tope es justamente el chat.
      notes: [`~${this.genMinutes()} min`, p?.aiNotes].filter(Boolean).join(' · '),
    };
  }

  // ── Acciones ──

  protected openDetail(id: string): void {
    this.detailId.set(id);
    this.view.set('detail');
  }

  protected back(): void {
    if (this.previewTemplate()) {
      this.previewTemplate.set(null);
      return;
    }
    if (this.generated()) {
      this.generated.set(null);
      return;
    }
    this.view.set('list');
    this.detailId.set(null);
  }

  protected activate(id: string): void {
    this.state.setActiveRoutine(id);
  }

  protected createFromScratch(): void {
    const id = this.state.createRoutine(this.T().routines_new_name);
    this.openDetail(id);
  }

  protected duplicate(routine: Routine): void {
    const id = this.state.duplicateRoutine(
      routine.id,
      `${routine.name} (${this.T().routines_copy_suffix})`,
    );
    if (id) this.openDetail(id);
  }

  protected rename(routine: Routine): void {
    const name = window.prompt(this.T().routines_rename, routine.name)?.trim();
    if (name) this.state.renameRoutine(routine.id, name);
  }

  protected toggleArchived(routine: Routine): void {
    this.state.setRoutineArchived(routine.id, !routine.archived);
  }

  protected askDelete(id: string): void {
    this.confirmDeleteId.set(id);
  }

  protected confirmDelete(): void {
    const id = this.confirmDeleteId();
    if (!id) return;
    const ok = this.state.deleteRoutine(id);
    this.confirmDeleteId.set(null);
    if (!ok) {
      this.showToast(this.T().routines_delete_last);
      return;
    }
    this.view.set('list');
    this.detailId.set(null);
  }

  protected addDay(): void {
    this.uiState.openEditingDay('new');
  }

  protected editDay(day: WorkoutDay): void {
    this.uiState.openEditingDay(day);
  }

  protected importTemplate(t: RoutineTemplate): void {
    const id = this.state.importTemplate(t, this.tr.lang(), this.catalog);
    this.previewTemplate.set(null);
    this.showToast(this.T().templates_imported);
    this.openDetail(id);
  }

  protected async runGenerator(): Promise<void> {
    if (this.generating()) return;
    this.generating.set(true);
    this.genError.set(null);
    try {
      this.generated.set(
        await this.generator.generate(this.spec(), this.state.settings(), this.tr.lang()),
      );
    } catch (e) {
      this.genError.set(e instanceof GeneratorError ? e.code : 'failed');
    } finally {
      this.generating.set(false);
    }
  }

  /**
   * Guarda la propuesta. `activate` es una elección del usuario, no un efecto secundario.
   *
   * Guardar activaba siempre: quien estaba a mitad de su rotación y probaba el generador
   * se quedaba sin ella. Ahora las dos salidas están rotuladas y la que no cambia nada es
   * la secundaria.
   */
  protected saveGenerated(activate: boolean): void {
    const routine = this.generated();
    if (!routine) return;
    const id = this.generator.save(routine, this.T().routines_new_name, this.tr.lang(), {
      activate,
    });
    this.generated.set(null);
    this.showToast(activate ? this.T().generator_saved : this.T().generator_saved_inactive);
    this.openDetail(id);
  }

  /** Mensaje del motivo por el que no se puede generar. */
  protected blockLabel(block: NonNullable<GenBlock>): string {
    const t = this.T();
    return block === 'no_key'
      ? t.generator_no_key
      : block === 'offline'
        ? t.generator_offline
        : t.generator_over_budget;
  }

  /** Mensaje del fallo de una generación que sí se intentó. */
  protected errorLabel(code: GenFailure): string {
    const t = this.T();
    switch (code) {
      case 'budget':
        return t.generator_over_budget;
      case 'offline':
        return t.generator_offline;
      case 'no_key':
        return t.generator_no_key;
      case 'auth':
        return t.generator_auth_failed;
      case 'model':
        return t.generator_model_failed;
      case 'empty':
        return t.generator_empty;
      default:
        return t.generator_failed;
    }
  }

  /**
   * Los ejercicios de la propuesta, con el nombre que van a tener una vez guardados.
   *
   * El modelo los devuelve en inglés a la fuerza —`refFor()` los enlaza al catálogo por
   * nombre— y `importTemplate()` los guarda ya traducidos. Enseñar el nombre crudo hacía
   * que revisaras "Back squat · Deadlift" y te quedara "Sentadilla · Peso muerto": los
   * mismos ejercicios, pero no lo que confirmaste. Lo que no enlaza se muestra tal cual,
   * porque es exactamente lo que se va a crear.
   */
  protected exerciseSummary(day: GeneratedDay): string {
    const lang = this.tr.lang();
    return day.exercises
      .map((e) => {
        const item = e.ref ? this.catalog.byRef(e.ref) : null;
        return item ? this.catalog.nameOf(item, lang) : e.name;
      })
      .join(' · ');
  }

  protected dateLabel(iso: string): string {
    return daysBetweenISO(iso, this.storage.todayISO()) === 0
      ? this.T().routines_today_chip
      : iso.slice(5);
  }

  private showToast(msg: string): void {
    this.toast.set(msg);
    setTimeout(() => this.toast.set(null), 3000);
  }
}
