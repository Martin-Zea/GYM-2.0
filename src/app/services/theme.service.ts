import { Injectable, effect, inject } from '@angular/core';
import { StateService } from './state.service';

/**
 * Aplica el tema activo al `<html>` (atributo `data-theme`) de forma reactiva.
 * Aislado de `StateService` para que la gestión de estado no toque el DOM (SRP).
 * Debe inyectarse al arrancar la app (lo hace `App`) para activar el efecto.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly state = inject(StateService);

  constructor() {
    effect(() => {
      document.documentElement.setAttribute('data-theme', this.state.settings().theme);
    });
  }
}
