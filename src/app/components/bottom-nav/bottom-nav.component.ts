import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Translations } from '../../i18n/translations';
import { TranslationService } from '../../services/translation.service';
import { IconComponent, IconName } from '../icon/icon.component';

interface NavItem {
  path: string;
  icon: IconName;
  key: keyof Translations;
  /** Solo "Hoy" necesita coincidencia exacta: su ruta es prefijo de todas las demás. */
  exact: boolean;
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

  protected readonly items: readonly NavItem[] = [
    { path: '/', icon: 'home', key: 'nav_today', exact: true },
    { path: '/routines', icon: 'dumbbell', key: 'nav_routines', exact: false },
    { path: '/progress', icon: 'chart', key: 'nav_progress', exact: false },
    { path: '/coach', icon: 'sparkle', key: 'nav_coach', exact: false },
    { path: '/settings', icon: 'settings', key: 'nav_settings', exact: false },
  ];
}
