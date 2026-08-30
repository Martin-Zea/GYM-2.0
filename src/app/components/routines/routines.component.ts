import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { IconComponent } from '../icon/icon.component';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { CatalogService, templatesForProfile } from '../../services/catalog.service';
import {
  CostEstimate,
  GeneratedRoutine,
  RoutineGeneratorService,
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

  protected readonly view = signal<View>('list');
  protected readonly detailId = signal<string | null>(null);
  protected readonly toast = signal<string | null>(null);
  protected readonly confirmDeleteId = signal<string | null>(null);

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

  protected readonly genDays = signal(4);
  protected readonly genMinutes = signal(60);
  protected readonly generating = signal(false);
  protected readonly generated = signal<GeneratedRoutine | null>(null);
  protected readonly genError = signal(false);

  protected readonly canGenerate = computed(() =>
    this.generator.canGenerate(this.state.settings()),
  );

  protected readonly costEstimate = computed(
    (): CostEstimate => this.generator.estimateCost(this.spec(), this.state.settings()),
  );

  private spec() {
    const p = this.state.settings().userProfile;
    return {
      daysPerWeek: this.genDays(),
      level: p?.level ?? null,
      goal: p?.goal ?? null,
      equipment: (p?.equipment as Equipment[] | null) ?? null,
      notes: [p?.aiNotes, `~${this.genMinutes()} min`].filter(Boolean).join(' · '),
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
    this.genError.set(false);
    try {
      this.generated.set(await this.generator.generate(this.spec(), this.state.settings()));
    } catch {
      this.genError.set(true);
    } finally {
      this.generating.set(false);
    }
  }

  protected saveGenerated(): void {
    const routine = this.generated();
    if (!routine) return;
    const id = this.generator.save(routine, this.T().routines_new_name, this.tr.lang());
    this.generated.set(null);
    this.showToast(this.T().generator_saved);
    this.openDetail(id);
  }

  protected exerciseSummary(day: { exercises: { name: string }[] }): string {
    return day.exercises.map((e) => e.name).join(' · ');
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
