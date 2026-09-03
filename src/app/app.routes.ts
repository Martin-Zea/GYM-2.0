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
  /**
   * `/history` deja de redirigir y vuelve a tener contenido (T-838).
   *
   * No es una ruta nueva: existía y se tiraba a `/progress`. Corregir una serie de hace
   * tres semanas vivía solo dentro de un bottom sheet, sin enlace ni vuelta atrás propia.
   * Analizar tendencias y corregir el pasado son dos trabajos distintos.
   */
  {
    path: 'history',
    loadComponent: () =>
      import('./components/session-history/session-history.component').then(
        (m) => m.SessionHistoryComponent,
      ),
  },

  // Compatibilidad con enlaces viejos (bookmarks, accesos directos de la PWA)
  { path: 'charts', redirectTo: 'progress' },
  { path: 'calendar', redirectTo: 'progress' },
  { path: '**', redirectTo: '' },
];
