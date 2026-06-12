import { Routes } from '@angular/router';
import { trainingGuard } from './guards/training-guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent),
    canDeactivate: [trainingGuard],
  },
  {
    path: 'charts',
    loadComponent: () => import('./components/charts/charts.component').then(m => m.ChartsComponent),
  },
  {
    path: 'calendar',
    loadComponent: () => import('./components/calendar/calendar.component').then(m => m.CalendarComponent),
  },
  {
    path: 'profile',
    loadComponent: () => import('./components/profile/profile.component').then(m => m.ProfileComponent),
  },
  { path: '**', redirectTo: '' },
];
