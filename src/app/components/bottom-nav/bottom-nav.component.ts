import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslationService } from '../../services/translation.service';
import { ViewportService } from '../../services/viewport.service';
import { IconComponent } from '../icon/icon.component';
import { MOBILE_NAV_PATHS, NAV_ITEMS, NavItem, RAIL_FOOTER_PATHS } from './nav-items';

/**
 * Dos navegaciones para los mismos destinos (T-839).
 *
 * En móvil, cinco iconos en la barra inferior: lo que cabe y se pulsa con el pulgar.
 *
 * En escritorio, un rail estrecho de iconos CON etiqueta, y al lado una columna con el
 * contenido de la sección activa (`SectionRailComponent`). El rail no lleva texto solo
 * por ahorrar ancho: lleva etiqueta debajo de cada icono porque un icono mudo no dice si
 * "Progreso" es el calendario o las curvas, y esa ambigüedad era justo el problema que
 * había que arreglar.
 */
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

  protected readonly mobileItems = computed(() =>
    MOBILE_NAV_PATHS.map((p) => NAV_ITEMS.find((i) => i.path === p)).filter(
      (i): i is NavItem => !!i,
    ),
  );

  /** Arriba, lo que se hace con la app. */
  protected readonly railItems = computed(() =>
    NAV_ITEMS.filter((i) => !RAIL_FOOTER_PATHS.includes(i.path)),
  );

  /** Abajo, la cuenta. Separarlas evita que Ajustes compita con Entrenar por la mirada. */
  protected readonly railFooterItems = computed(() =>
    RAIL_FOOTER_PATHS.map((p) => NAV_ITEMS.find((i) => i.path === p)).filter(
      (i): i is NavItem => !!i,
    ),
  );

  protected label(item: NavItem): string {
    const key = this.viewport.isDesktop() && item.desktopKey ? item.desktopKey : item.key;
    return this.T()[key] as string;
  }
}
