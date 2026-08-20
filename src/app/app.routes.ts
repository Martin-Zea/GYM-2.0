import { Routes } from '@angular/router';
import { trainingGuard } from './guards/training-guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then((m) => m.HomeComponent),
    canDeactivate: [trainingGuard],
  },
  {
    path: 'history',
    loadComponent: () =>
      import('./components/history/history.component').then((m) => m.HistoryComponent),
  },
  {
    path: 'profile',
    loadComponent: () =>
      import('./components/profile/profile.component').then((m) => m.ProfileComponent),
  },
  // Compatibilidad con enlaces viejos (bookmarks, shortcuts)
  { path: 'charts', redirectTo: 'history' },
  { path: 'calendar', redirectTo: 'history' },
  { path: '**', redirectTo: '' },
];
