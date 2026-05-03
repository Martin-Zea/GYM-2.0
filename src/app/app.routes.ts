import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./components/home/home.component').then(m => m.HomeComponent),
  },
  {
    path: 'charts',
    loadComponent: () => import('./components/charts/charts.component').then(m => m.ChartsComponent),
  },
  {
    path: 'calendar',
    loadComponent: () => import('./components/calendar/calendar.component').then(m => m.CalendarComponent),
  },
  { path: '**', redirectTo: '' },
];
