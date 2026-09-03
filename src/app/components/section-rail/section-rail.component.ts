import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter, map } from 'rxjs';
import { BackupService } from '../../services/backup.service';
import { StateService } from '../../services/state.service';
import { StorageService } from '../../services/storage.service';
import { TranslationService } from '../../services/translation.service';
import { UIStateService, SettingsSection } from '../../services/ui-state.service';
import { STORAGE_KEYS } from '../../services/storage-keys';
import {
  DEFAULT_TOKEN_BUDGET,
  totalTokens,
  usageForMonth,
} from '../../services/providers/ai-usage';
import { mondayOfISO, toLocalISO } from '../../utils/date';
import { realSessions } from '../../utils/dashboard';
import { DEFAULT_DESKTOP_VIEW } from '../bottom-nav/nav-items';

/** Una fila de la columna. Cuatro formas, porque son cuatro cosas distintas. */
export type RailRow =
  | {
      kind: 'link';
      label: string;
      path: string;
      query: Record<string, string>;
      meta?: string;
      on: boolean;
    }
  | { kind: 'act'; label: string; act: RailAction; meta?: string }
  | { kind: 'routine'; label: string; id: string; meta?: string; on: boolean }
  | { kind: 'stat'; label: string; value: string; tone?: 'warn' };

export type RailAction = 'tools' | 'export' | SettingsSection;

export interface RailGroup {
  title?: string;
  rows: RailRow[];
}

export interface RailSection {
  title: string;
  subtitle?: string;
  groups: RailGroup[];
}

/**
 * Columna de sección: el segundo nivel de la navegación de escritorio (T-839).
 *
 * Este componente es la razón de ser del patrón elegido. Un rail de iconos sin esta
 * columna sería la barra inferior del móvil puesta de canto —el problema que veníamos a
 * arreglar—, y una columna que en alguna sección se quedara vacía dejaría medio lienzo
 * muerto. Por eso aquí está el INVENTARIO completo: cada una de las siete secciones tiene
 * algo real que poner, y en tres de ellas (Historial, Rutinas, Ajustes) lo que pone es la
 * lista maestra que esas pantallas tendrían que dibujarse por su cuenta.
 *
 * Las filas no son todas enlaces a propósito. Un "Esta semana 3/5" es un dato, no un
 * destino: pintarlo como enlace para que la lista quede uniforme sería mentir sobre lo
 * que pasa al pulsarlo.
 */
@Component({
  selector: 'app-section-rail',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './section-rail.component.html',
  styleUrl: './section-rail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SectionRailComponent {
  private readonly router = inject(Router);
  private readonly state = inject(StateService);
  private readonly storage = inject(StorageService);
  private readonly backup = inject(BackupService);
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  protected readonly uiState = inject(UIStateService);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /** Ruta base y parámetros actuales: lo que decide qué sección se pinta y qué fila va marcada. */
  private readonly here = computed(() => {
    const tree = this.router.parseUrl(this.url());
    const segments = tree.root.children['primary']?.segments ?? [];
    const path = segments.length ? `/${segments[0].path}` : '/';
    return { path, q: (tree.queryParams ?? {}) as Record<string, string | undefined> };
  });

  protected readonly section = computed((): RailSection => {
    switch (this.here().path) {
      case '/progress':
        return this.progressSection();
      case '/history':
        return this.historySection();
      case '/routines':
        return this.routinesSection();
      case '/coach':
        return this.coachSection();
      case '/profile':
        return this.profileSection();
      case '/settings':
        return this.settingsSection();
      default:
        return this.panelSection();
    }
  });

  // ─────────────────────────── Secciones ───────────────────────────

  private panelSection(): RailSection {
    const T = this.T();
    const day = this.state.currentDay();
    const stats = this.storage.weeklyStats(this.state.state());
    const planned = this.state.days().length;

    const rows: RailRow[] = [
      { kind: 'stat', label: T.rail_today_focus, value: day?.name ?? T.rail_rest_day },
      {
        kind: 'stat',
        label: T.rail_week_done,
        value: planned ? `${this.sessionsThisWeek()} / ${planned}` : `${this.sessionsThisWeek()}`,
      },
      { kind: 'stat', label: T.rail_streak, value: `${stats.streak}` },
    ];

    const groups: RailGroup[] = [
      { title: T.rail_group_today, rows },
      {
        title: T.rail_group_tools,
        rows: [{ kind: 'act', label: T.settings_menu_tools, act: 'tools' }],
      },
    ];

    // La copia de seguridad solo aparece cuando hay algo que copiar: un aviso permanente
    // deja de leerse y esta columna está siempre a la vista.
    if (this.backupPending()) {
      groups.push({
        rows: [
          {
            kind: 'act',
            label: T.rail_export_now,
            act: 'export',
            meta: T.settings_menu_backup_pending,
          },
        ],
      });
    }
    return { title: T.nav_panel, subtitle: this.todayLabel(), groups };
  }

  private progressSection(): RailSection {
    const T = this.T();
    const rows: RailRow[] = [
      this.viewLink(T.nav_sub_calendar, '/progress', 'calendario'),
      this.viewLink(T.nav_sub_progression, '/progress', 'progresion'),
      this.viewLink(T.nav_sub_volume, '/progress', 'volumen'),
    ];
    // El peso corporal NO va aquí aunque quepa: vive dentro del selector de la vista de
    // progresión, y un enlace que promete llevar a un sitio y deja la pantalla igual es
    // peor que no ofrecerlo. Vuelve cuando la vista acepte preseleccionar la serie.
    return { title: T.nav_progress, groups: [{ rows }] };
  }

  private historySection(): RailSection {
    const T = this.T();
    const here = this.here();
    const active = here.q['dia'] ?? null;
    const counts = new Map<string, number>();
    for (const s of realSessions(this.state.state().sessions)) {
      counts.set(s.dayId, (counts.get(s.dayId) ?? 0) + 1);
    }

    const rows: RailRow[] = [
      {
        kind: 'link',
        label: T.rail_all_days,
        path: '/history',
        query: {},
        meta: `${realSessions(this.state.state().sessions).length}`,
        on: !active,
      },
      ...this.state.days().map(
        (d): RailRow => ({
          kind: 'link',
          label: d.name,
          path: '/history',
          query: { dia: d.id },
          meta: `${counts.get(d.id) ?? 0}`,
          on: active === d.id,
        }),
      ),
    ];

    const groups: RailGroup[] = [{ title: T.rail_group_filter_day, rows }];
    const trash = (this.state.state().trash ?? []).length;
    if (trash > 0) {
      groups.push({
        rows: [{ kind: 'act', label: T.settings_trash_title, act: 'data', meta: `${trash}` }],
      });
    }
    return { title: T.nav_history, groups };
  }

  private routinesSection(): RailSection {
    const T = this.T();
    const activeId = this.state.activeRoutine()?.id ?? null;
    const routines = this.state.routines().filter((r) => !r.archived);

    const groups: RailGroup[] = [
      {
        title: T.rail_group_my_routines,
        rows: routines.map(
          (r): RailRow => ({
            kind: 'routine',
            // La rutina sembrada viaja sin nombre a propósito; sin este respaldo la
            // columna enseña una fila en blanco. Misma regla que en `/routines`.
            label: r.name.trim() || T.routines_default_name,
            id: r.id,
            meta: `${r.dayIds.length}`,
            on: r.id === activeId,
          }),
        ),
      },
      {
        rows: [
          this.viewLink(T.nav_sub_templates, '/routines', 'plantillas'),
          this.viewLink(T.nav_sub_generator, '/routines', 'generador'),
        ],
      },
    ];
    return { title: T.nav_routines, groups };
  }

  private coachSection(): RailSection {
    const T = this.T();
    const budget = this.state.settings().aiTokenBudget ?? DEFAULT_TOKEN_BUDGET;
    const used = totalTokens(usageForMonth());
    return {
      title: T.nav_coach,
      groups: [
        {
          // En escritorio la propuesta y el chat comparten pantalla: ofrecer "Chat" como
          // destino aparte llevaría al mismo sitio. Quedan los dos que son distintos.
          rows: [
            this.viewLink(T.coach_desk_proposal, '/coach', 'panel'),
            this.viewLink(T.coach_tab_history, '/coach', 'historial'),
          ],
        },
        // El consumo solo se enseña si hubo consumo: "0 / 200000" en una columna
        // permanente es ruido, y además expone una cifra que no significa nada para
        // quien no ha configurado ninguna key.
        ...(used > 0
          ? [
              {
                rows: [
                  {
                    kind: 'stat' as const,
                    label: T.rail_ai_month,
                    value: `${used} / ${budget}`,
                    tone: used >= budget ? ('warn' as const) : undefined,
                  },
                ],
              },
            ]
          : []),
      ],
    };
  }

  private profileSection(): RailSection {
    const T = this.T();
    const p = this.state.settings().userProfile;
    const levels = {
      beginner: T.profile_level_beginner,
      intermediate: T.profile_level_intermediate,
      advanced: T.profile_level_advanced,
    };
    const goals = {
      strength: T.settings_goal_strength,
      hypertrophy: T.settings_goal_hypertrophy,
      endurance: T.settings_goal_endurance,
    };
    const rows: RailRow[] = [];
    // El enum crudo ('intermediate') no es una etiqueta: si no hay traducción, no hay fila.
    if (p.level) rows.push({ kind: 'stat', label: T.profile_level_label, value: levels[p.level] });
    if (p.goal) rows.push({ kind: 'stat', label: T.settings_goal_label, value: goals[p.goal] });
    if (p.weightKg)
      rows.push({ kind: 'stat', label: T.settings_weight, value: `${p.weightKg} kg` });

    const groups: RailGroup[] = [];
    if (rows.length) groups.push({ title: T.rail_group_summary, rows });
    groups.push({
      rows: [this.viewLink(T.profile_achievements_title, '/progress', 'volumen')],
    });
    return { title: T.nav_profile, groups };
  }

  private settingsSection(): RailSection {
    const T = this.T();
    return {
      title: T.nav_settings,
      groups: [
        {
          title: T.rail_group_sections,
          rows: [
            { kind: 'act', label: T.settings_menu_prefs, act: 'prefs' },
            { kind: 'act', label: T.settings_menu_ai, act: 'ai' },
            { kind: 'act', label: T.settings_menu_data, act: 'data' },
            { kind: 'act', label: T.settings_menu_about, act: 'about' },
          ],
        },
        { rows: [{ kind: 'act', label: T.settings_menu_tools, act: 'tools' }] },
      ],
    };
  }

  // ─────────────────────────── Ayudas ───────────────────────────

  /**
   * Un enlace a una sub-vista.
   *
   * `isDefault` marca la fila a la que se llega SIN parámetro. Sin esto, entrar a una
   * sección desde el rail dejaba la columna entera apagada aunque estuvieras viendo una de
   * sus vistas: la fila no se encendía hasta que la pulsabas, y la columna dejaba de
   * responder a la única pregunta que tiene que responder, que es dónde estás.
   */
  private viewLink(label: string, path: string, vista: string): RailRow {
    const here = this.here();
    const current = here.q['vista'];
    // Sin parámetro se marca la fila por defecto, que la pantalla lee del MISMO sitio.
    // Si cada uno lo decidiera por su cuenta volvería el fallo: la vista enseñada y la fila
    // encendida dejan de ser la misma cosa.
    const isDefault = DEFAULT_DESKTOP_VIEW[path] === vista;
    return {
      kind: 'link',
      label,
      path,
      query: { vista },
      on: here.path === path && (current === vista || (!current && isDefault)),
    };
  }

  /** Sesiones reales desde el lunes de esta semana. */
  private sessionsThisWeek(): number {
    const monday = mondayOfISO(toLocalISO());
    return realSessions(this.state.state().sessions).filter((s) => s.dateISO >= monday).length;
  }

  private backupPending(): boolean {
    let last: string | null = null;
    try {
      last = localStorage.getItem(STORAGE_KEYS.lastExport);
    } catch {
      // Sin localStorage no se puede saber; se asume al día antes que alarmar en falso.
      return false;
    }
    if (!last) return this.state.sessions().length > 0;
    return this.state.sessions().some((s) => s.dateISO > last);
  }

  private todayLabel(): string {
    const d = new Date(`${toLocalISO()}T12:00:00Z`);
    return new Intl.DateTimeFormat(this.tr.lang(), {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(d);
  }

  protected run(act: RailAction): void {
    if (act === 'tools') this.uiState.openTools();
    else if (act === 'export') void this.backup.exportData();
    else this.uiState.openSettings(act);
  }

  protected pickRoutine(id: string): void {
    this.state.setActiveRoutine(id);
  }
}
