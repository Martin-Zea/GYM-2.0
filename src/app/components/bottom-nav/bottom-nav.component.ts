import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Translations } from '../../i18n/translations';
import { TranslationService } from '../../services/translation.service';
import { ViewportService } from '../../services/viewport.service';
import { IconComponent, IconName } from '../icon/icon.component';

interface NavItem {
  path: string;
  icon: IconName;
  key: keyof Translations;
  /** Solo "Hoy" necesita coincidencia exacta: su ruta es prefijo de todas las demás. */
  exact: boolean;
  /** Etiqueta distinta en escritorio, donde `/` no es una decisión sino el panel. */
  desktopKey?: keyof Translations;
  /** Segundo nivel: sub-vistas que YA existen dentro de la ruta y en móvil no caben. */
  sub?: { view: string; key: keyof Translations }[];
}

/** Una entrada de la barra lateral: cabecera de grupo o destino. */
interface RailEntry {
  group?: keyof Translations;
  item?: NavItem;
}

@Component({
  selector: 'app-bottom-nav',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, IconComponent],
  templateUrl: './bottom-nav.component.html',
  styleUrl: './bottom-nav.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BottomNavComponent {
  protected readonly tr = inject(TranslationService);
  protected readonly T = this.tr.T;
  protected readonly viewport = inject(ViewportService);

  /**
   * Los destinos de la app. Los MISMOS en móvil y escritorio (T-838).
   *
   * El escritorio no añade rutas: agrupa las que hay y saca a la superficie las sub-vistas
   * que ya existen dentro de cada una. En el teléfono, "plantillas" o "volumen" están
   * escondidas por falta de sitio y eso es correcto; en un monitor de 1440 px son once
   * destinos reales detrás de cinco iconos, y el usuario no tiene forma de saber que existen.
   */
  protected readonly items: readonly NavItem[] = [
    { path: '/', icon: 'home', key: 'nav_today', desktopKey: 'nav_panel', exact: true },
    {
      path: '/progress',
      icon: 'chart',
      key: 'nav_progress',
      exact: false,
      sub: [
        { view: 'calendario', key: 'nav_sub_calendar' },
        { view: 'progresion', key: 'nav_sub_progression' },
        { view: 'volumen', key: 'nav_sub_volume' },
      ],
    },
    { path: '/history', icon: 'history', key: 'nav_history', exact: false },
    {
      path: '/routines',
      icon: 'dumbbell',
      key: 'nav_routines',
      exact: false,
      sub: [
        { view: 'lista', key: 'nav_sub_my_routines' },
        { view: 'plantillas', key: 'nav_sub_templates' },
        { view: 'generador', key: 'nav_sub_generator' },
      ],
    },
    {
      path: '/coach',
      icon: 'sparkle',
      key: 'nav_coach',
      exact: false,
      sub: [
        { view: 'panel', key: 'coach_tab_panel' },
        { view: 'chat', key: 'coach_tab_chat' },
        { view: 'historial', key: 'coach_tab_history' },
      ],
    },
    { path: '/profile', icon: 'user', key: 'nav_profile', exact: false },
    { path: '/settings', icon: 'settings', key: 'nav_settings', exact: false },
  ];

  /**
   * En MÓVIL solo caben cinco, y son las cinco de siempre: la barra inferior no cambia.
   *
   * Historial y Perfil quedan fuera abajo —se llega a ellos desde Progreso y desde
   * Ajustes, como hasta ahora— porque una barra de siete en 390 px deja objetivos
   * táctiles de 55 px y se pulsa mal con el pulgar.
   */
  protected readonly mobileItems = computed(() =>
    this.items.filter((i) => i.path !== '/history' && i.path !== '/profile'),
  );

  /** En ESCRITORIO se agrupan por lo que el atleta viene a hacer, no por orden de menú. */
  protected readonly railEntries = computed((): RailEntry[] => {
    const byPath = new Map(this.items.map((i) => [i.path, i]));
    const entries: RailEntry[] = [];
    const push = (group: keyof Translations, paths: string[]) => {
      entries.push({ group });
      for (const p of paths) {
        const item = byPath.get(p);
        if (item) entries.push({ item });
      }
    };
    push('nav_group_train', ['/']);
    push('nav_group_analyze', ['/progress', '/history']);
    push('nav_group_plan', ['/routines', '/coach']);
    push('nav_group_account', ['/profile', '/settings']);
    return entries;
  });

  protected label(item: NavItem): string {
    const key = this.viewport.isDesktop() && item.desktopKey ? item.desktopKey : item.key;
    return this.T()[key] as string;
  }
}
