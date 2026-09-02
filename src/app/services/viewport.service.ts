import { Injectable, signal } from '@angular/core';

/**
 * Ancho de la ventana, como señal (T-836).
 *
 * El escritorio dejó de ser "el móvil con más aire": es otro producto sobre las MISMAS
 * rutas —`/` en el teléfono es una decisión, en el escritorio es el panel—, y esa
 * diferencia no se puede resolver solo con CSS: pintar los dos y esconder uno duplicaría
 * el DOM del panel entero, con sus agregados y sus gráficos, en un teléfono que no los va
 * a enseñar nunca.
 *
 * El corte está en 768 y no en 1024 por decisión de producto: una tableta es un escritorio
 * angosto, no un teléfono grande. Con 1024 se quedaba en tierra de nadie — el layout de
 * móvil centrado a 720px y medio ancho vacío a los lados.
 */
export const DESKTOP_MIN_WIDTH = 768;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly query =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(`(min-width: ${DESKTOP_MIN_WIDTH}px)`)
      : null;

  /** `true` en escritorio y tableta. Sin `matchMedia` se asume móvil: es el caso seguro. */
  readonly isDesktop = signal(this.query?.matches ?? false);

  constructor() {
    // `change` en vez de un listener de `resize`: el navegador solo avisa cuando se cruza
    // el umbral, no en cada píxel de arrastre.
    this.query?.addEventListener('change', (e) => this.isDesktop.set(e.matches));
  }
}
