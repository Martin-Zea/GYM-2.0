import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService } from '../../services/ui-state.service';
import { Session } from '../../models/workout.model';
import { sessionDurationMinutes, tonnageOf, workingSets } from '../../utils/session';
import { detectPr } from '../../utils/pr';
import { realSessions } from '../../utils/dashboard';

interface HistoryRow {
  session: Session;
  dayName: string;
  sets: number;
  minutes: number | null;
  volume: number;
  skipped: boolean;
  highlight: string | null;
}

/**
 * Historial de sesiones (T-838).
 *
 * Existía solo dentro de un bottom sheet colgado del detalle de un día: para corregir una
 * serie de hace tres semanas había que acordarse de qué día de la rutina fue, abrir su
 * detalle y bajar. Aquí es una lista con su propia ruta, filtrable y enlazable — y en
 * escritorio, con el detalle al lado en vez de encima.
 */
@Component({
  selector: 'app-session-history',
  standalone: true,
  templateUrl: './session-history.component.html',
  styleUrl: './session-history.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SessionHistoryComponent {
  protected readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  protected readonly uiState = inject(UIStateService);

  /** `null` = todos los días de la rutina. */
  protected readonly dayFilter = signal<string | null>(null);
  protected readonly selectedId = signal<string | null>(null);

  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  constructor() {
    // El filtro vive en la URL (T-839): la columna de sección del escritorio enlaza a
    // cada día, y así el botón atrás deshace el filtro en vez de salir de la pantalla.
    this.route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const dia = params.get('dia');
      // Un id que ya no existe (rutina borrada, enlace viejo) no deja la tabla vacía
      // sin explicación: se ignora y se ven todas.
      this.dayFilter.set(dia && this.state.days().some((d) => d.id === dia) ? dia : null);
      this.selectedId.set(null);
    });
  }

  protected readonly days = computed(() => this.state.days());

  protected readonly rows = computed((): HistoryRow[] => {
    const s = this.state.state();
    const byDay = new Map(s.days.map((d) => [d.id, d.name]));
    const filter = this.dayFilter();

    return s.sessions
      .filter((x) => !filter || x.dayId === filter)
      .slice()
      .sort((a, b) => b.dateISO.localeCompare(a.dateISO))
      .map((session) => ({
        session,
        dayName: byDay.get(session.dayId) ?? '—',
        sets: workingSets(session.sets).length,
        minutes: sessionDurationMinutes(session),
        volume: Math.round(tonnageOf(session.sets, s.exercises)),
        skipped: !!session.skipped,
        highlight: this.highlightOf(session),
      }));
  });

  /**
   * Lo destacado de una sesión: un récord, o que se marcó dura. Nada más.
   *
   * Una columna que siempre dice algo deja de leerse; el guion es información.
   */
  private highlightOf(session: Session): string | null {
    if (session.skipped) return this.T().history_skipped;
    const hard = Object.values(session.feelings ?? {}).some((f) => f === 'hard');
    if (hard) return this.T().history_marked_hard;

    const catalog = this.state.exercises();
    for (const set of workingSets(session.sets)) {
      const exercise = catalog.find((e) => e.id === set.exerciseId);
      if (!exercise) continue;
      // Solo cuenta como récord contra lo que había ANTES de esta sesión: comparar contra
      // el historial completo haría que toda sesión con su propio máximo pareciera un PR.
      const before = this.storage
        .historyForExercise(this.state.state(), exercise.id)
        .filter((h) => h.dateISO < session.dateISO)
        .flatMap((h) => h.sets.map((x) => ({ weight: x.weight, reps: x.reps })));
      if (!before.length) continue;
      if (detectPr(exercise.unit, before, { weight: set.weight, reps: set.reps })) {
        return this.tr.tp('history_pr', { name: exercise.name, value: `${set.weight}` });
      }
    }
    return null;
  }

  protected readonly selected = computed(() => {
    const id = this.selectedId() ?? this.rows()[0]?.session.id;
    return this.rows().find((r) => r.session.id === id) ?? null;
  });

  /** Las series de la sesión abierta, agrupadas por ejercicio y en orden. */
  protected readonly selectedGroups = computed(() => {
    const row = this.selected();
    if (!row) return [];
    const catalog = new Map(this.state.exercises().map((e) => [e.id, e]));
    const groups = new Map<string, { name: string; sets: { weight: number; reps: number }[] }>();
    for (const set of row.session.sets) {
      const name = catalog.get(set.exerciseId)?.name ?? '—';
      if (!groups.has(set.exerciseId)) groups.set(set.exerciseId, { name, sets: [] });
      groups.get(set.exerciseId)!.sets.push({ weight: set.weight, reps: set.reps });
    }
    return [...groups.values()];
  });

  protected readonly trashCount = computed(() => (this.state.state().trash ?? []).length);

  protected select(id: string): void {
    this.selectedId.set(id);
  }

  protected setDayFilter(dayId: string | null): void {
    // Se navega en vez de asignar: la URL es la fuente y el suscriptor de arriba aplica.
    void this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { dia: dayId },
      queryParamsHandling: 'merge',
    });
  }

  protected dateLabel(iso: string): string {
    const d = new Date(`${iso}T12:00:00Z`);
    return new Intl.DateTimeFormat(this.tr.lang(), { day: 'numeric', month: 'short' }).format(d);
  }

  protected editSets(row: HistoryRow): void {
    // La edición fina sigue viviendo en el sheet que ya existe y ya está probado: abrirlo
    // filtrado por esta fecha es más honesto que duplicar el editor y que diverjan.
    const day = this.state.days().find((d) => d.id === row.session.dayId);
    if (!day) return;
    this.uiState.dayHistoryFilterISO.set(row.session.dateISO);
    this.uiState.openDayHistory(day);
  }

  protected remove(row: HistoryRow): void {
    this.state.deleteSession(row.session.id);
    this.selectedId.set(null);
  }

  protected readonly totalReal = computed(() => realSessions(this.state.state().sessions).length);
}
