import { Translations } from '../../i18n/translations';
import { IconName } from '../icon/icon.component';

export interface NavItem {
  path: string;
  icon: IconName;
  key: keyof Translations;
  /** Solo "Hoy" necesita coincidencia exacta: su ruta es prefijo de todas las demás. */
  exact: boolean;
  /** Etiqueta distinta en escritorio, donde `/` no es una decisión sino el panel. */
  desktopKey?: keyof Translations;
}

/**
 * Los destinos de la app. Los MISMOS en móvil y escritorio (T-838).
 *
 * El escritorio no añade rutas. Lo que hace es enseñar, en la columna de sección, las
 * sub-vistas que ya existen dentro de cada una y que en cinco iconos son invisibles.
 * Esa lista NO vive aquí: la arma `SectionRailComponent`, porque depende del estado
 * (cuántas rutinas hay, cuántas sesiones en la papelera) y esto es una constante.
 */
export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', icon: 'home', key: 'nav_today', desktopKey: 'nav_panel', exact: true },
  { path: '/progress', icon: 'chart', key: 'nav_progress', exact: false },
  { path: '/history', icon: 'history', key: 'nav_history', exact: false },
  { path: '/routines', icon: 'dumbbell', key: 'nav_routines', exact: false },
  { path: '/coach', icon: 'sparkle', key: 'nav_coach', exact: false },
  { path: '/profile', icon: 'user', key: 'nav_profile', exact: false },
  { path: '/settings', icon: 'settings', key: 'nav_settings', exact: false },
];

/**
 * En MÓVIL solo caben cinco, y son las cinco de siempre: la barra inferior no cambia.
 *
 * Historial y Perfil quedan fuera abajo —se llega a ellos desde Progreso y desde Ajustes,
 * como hasta ahora— porque una barra de siete en 390px deja objetivos táctiles de 55px
 * y se pulsa mal con el pulgar.
 */
export const MOBILE_NAV_PATHS = ['/', '/routines', '/progress', '/coach', '/settings'];

/** En el rail, Perfil y Ajustes se separan del resto: son la cuenta, no el entrenamiento. */
export const RAIL_FOOTER_PATHS = ['/settings', '/profile'];

/**
 * A qué sub-vista se entra en escritorio cuando la URL no trae `?vista=` (T-839).
 *
 * Vive aquí, y no en cada pantalla, porque lo tienen que saber DOS sitios: la pantalla,
 * para decidir qué pinta, y la columna de sección, para decidir qué fila enciende. Cuando
 * cada uno lo sabía por su cuenta, se desincronizaron: la pantalla enseñaba una vista y la
 * columna no marcaba ninguna fila. Un solo dato, dos lectores.
 *
 * `/progress` entra por PROGRESIÓN y no por el calendario: la pregunta que se trae quien
 * abre "Progreso" es si está mejorando, y eso lo contesta la curva. El calendario contesta
 * si fue, que es otra pregunta — y ya la contestan la adherencia y la racha, que se ven en
 * las tres sub-vistas.
 */
export const DEFAULT_DESKTOP_VIEW: Readonly<Record<string, string>> = {
  '/progress': 'progresion',
  '/coach': 'panel',
  '/settings': 'prefs',
};
