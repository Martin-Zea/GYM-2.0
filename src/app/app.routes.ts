import { Routes } from '@angular/router';
import { trainingGuard } from './guards/training-guard';

/**
 * Cinco tabs (T-802), según el diseño: Hoy · Rutinas · Progreso · Coach · Ajustes.
 *
 * Ajustes deja de ser un bottom sheet y pasa a ser un destino navegable: era el cajón
 * donde acababa todo lo que no cabía en otro sitio, y desde un sheet no se puede enlazar
 * a una sección concreta. El perfil cuelga de Ajustes, no de la barra: se toca una vez
 * al mes y ocupaba un quinto de la navegación.
 */
export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then((m) => m.HomeComponent),
    canDeactivate: [trainingGuard],
  },
  {
    path: 'routines',
    loadComponent: () =>
      import('./components/routines/routines.component').then((m) => m.RoutinesComponent),
  },
  {
    path: 'progress',
    loadComponent: () =>
      import('./components/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'coach',
    loadComponent: () => import('./components/coach/coach.component').then((m) => m.CoachComponent),
  },
  {
    path: 'settings',
    loadComponent: () =>
      import('./components/settings-menu/settings-menu.component').then(
        (m) => m.SettingsMenuComponent,
      ),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./components/profile/profile.component').then((m) => m.ProfileComponent),
  },
  // Compatibilidad con enlaces viejos (bookmarks, accesos directos de la PWA)
  { path: 'history', redirectTo: 'progress' },
  { path: 'charts', redirectTo: 'progress' },
  { path: 'calendar', redirectTo: 'progress' },
  { path: '**', redirectTo: '' },
];
