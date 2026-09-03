import { Injectable, computed, signal } from '@angular/core';
import { STORAGE_KEYS } from './storage-keys';

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

/**
 * Debajo de esto la columna de sección se pliega SOLA (T-839).
 *
 * La navegación de escritorio son dos columnas: un rail de iconos de 66px y una columna
 * de 202px con el contenido de la sección activa. Juntas son 268px de cromo permanente.
 * En 1100 eso deja unos 780px de contenido, que es el suelo por debajo del cual la tabla
 * del historial y el gráfico comparado dejan de poder ponerse cosas AL LADO — que es la
 * única razón por la que existe la versión de escritorio.
 *
 * Plegada, la columna devuelve 202px y el contenido respira más que con una barra de
 * texto de 214. Por eso el pliegue no es una preferencia estética: es lo que hace que
 * este patrón quepa en un portátil.
 */
export const SECTION_RAIL_MIN_WIDTH = 1100;

@Injectable({ providedIn: 'root' })
export class ViewportService {
  private readonly query = this.match(`(min-width: ${DESKTOP_MIN_WIDTH}px)`);
  private readonly wideQuery = this.match(`(min-width: ${SECTION_RAIL_MIN_WIDTH}px)`);

  /** `true` en escritorio y tableta. Sin `matchMedia` se asume móvil: es el caso seguro. */
  readonly isDesktop = signal(this.query?.matches ?? false);

  /** `true` cuando hay sitio para el rail Y la columna de sección. */
  readonly isWide = signal(this.wideQuery?.matches ?? false);

  /** Lo que el usuario eligió a mano. La ventana puede imponerse por encima. */
  private readonly manuallyCollapsed = signal(this.readPref());

  /**
   * La columna de sección está abierta solo si hay sitio Y el usuario no la plegó.
   *
   * El ancho GANA a la preferencia: dejarla abierta en 900px no respeta una elección,
   * rompe la pantalla. Al ensanchar la ventana vuelve al estado que el usuario había
   * elegido, porque su preferencia nunca se pisa — solo se ignora mientras no cabe.
   */
  readonly sectionRailOpen = computed(
    () => this.isDesktop() && this.isWide() && !this.manuallyCollapsed(),
  );

  /** `true` cuando el pliegue lo impone la ventana y no el usuario (el botón se oculta). */
  readonly sectionRailForced = computed(() => this.isDesktop() && !this.isWide());

  constructor() {
    // `change` en vez de un listener de `resize`: el navegador solo avisa cuando se cruza
    // el umbral, no en cada píxel de arrastre.
    this.query?.addEventListener('change', (e) => this.isDesktop.set(e.matches));
    this.wideQuery?.addEventListener('change', (e) => this.isWide.set(e.matches));
  }

  toggleSectionRail(): void {
    const next = !this.manuallyCollapsed();
    this.manuallyCollapsed.set(next);
    try {
      localStorage.setItem(STORAGE_KEYS.railCollapsed, next ? '1' : '0');
    } catch {
      // Modo privado o cuota llena: la preferencia se pierde al recargar y no pasa nada.
    }
  }

  private match(q: string): MediaQueryList | null {
    return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(q)
      : null;
  }

  private readPref(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEYS.railCollapsed) === '1';
    } catch {
      return false;
    }
  }
}
