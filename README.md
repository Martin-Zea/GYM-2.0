# GYM 2.0

PWA de seguimiento de entrenamiento con progresión asistida por IA. Interfaz en español/inglés, mobile-first, funciona offline.

## Características

- **Rutina semanal configurable** — días editables con ejercicios personalizados
- **Registro de series** — peso, reps y estado completado por set; inputs táctiles 44px
- **Progresión IA** — recomendaciones automáticas vía Groq (`llama-3.3-70b`) o Cohere (`command-r7b`), con fallback local; badge sparkle (IA) vs ruler (local)
- **Historial de sesiones** — sheet por día con todas las sesiones anteriores y volumen total
- **Vista detalle de día** — previsualización de la última sesión antes de entrenar
- **Gráficos** — progresión de peso por ejercicio (SVG, ruta `/charts`)
- **Calendario** — heatmap mensual de actividad (ruta `/calendar`)
- **Temporizador de descanso** — overlay con cuenta regresiva y auto-foco en siguiente serie
- **YouTube integrado** — botón en cada ejercicio para buscar técnica
- **Perfil de usuario** — peso, altura, edad y sexo para recomendaciones personalizadas
- **Estadísticas semanales** — racha de días y volumen de la semana en el dashboard
- **Onboarding** — sección "Cómo funciona" descartable
- **Idiomas** — ES / EN con cambio en tiempo real (Settings o topbar)
- **Exportar / importar** — backup completo en JSON
- **PWA** — instalable, funciona sin conexión

## Stack

- Angular 21.2 (standalone components, signals, `@if`/`@for`/`@switch`)
- TypeScript 5.9 — strict mode
- Groq API (`llama-3.3-70b-versatile`) + Cohere API (`command-r7b-12-2024`) — opcionales, con fallback local
- localStorage (`gym_app_state_v2`, `schemaVersion: 3`)
- Vitest

## Desarrollo

```bash
npm start        # dev server → http://localhost:4200
npm run build    # build de producción
npm test         # unit tests con Vitest
```

## Configuración de IA

1. Abrí **Ajustes** en la app
2. Ingresá tu API key de [Groq](https://console.groq.com) (gratuita) y/o [Cohere](https://dashboard.cohere.com) (gratuita)
3. Completá tu perfil físico para recomendaciones personalizadas

Sin API key la app usa el algoritmo de progresión local (siempre disponible). Si Groq falla, se intenta Cohere automáticamente.

## Estructura

```
src/app/
  i18n/                # translations.ts — interfaz Translations + objetos es/en
  guards/              # training-guard.ts — CanDeactivateFn (confirmación al salir)
  models/              # workout.model.ts — todas las interfaces TypeScript
  data/                # initial-data.ts — rutina inicial (5 días, sesión -7d)
  services/            # StorageService, StateService, UIStateService,
                       # ProgressionService, TranslationService
  components/
    home/              # / — dashboard + modo entrenamiento
    exercise-card/     # hijo de home — inputs de series, badge IA, YouTube
    how-it-works/      # tarjetas de onboarding descartables
    charts/            # /charts — progresión SVG
    calendar/          # /calendar — heatmap mensual
    rest-timer/        # overlay global — temporizador con anillo
    day-editor/        # sheet — agregar/editar día
    day-detail-sheet/  # sheet — vista previa de última sesión + acción entrenar
    day-picker-sheet/  # sheet — selector de día durante entrenamiento
    day-history-sheet/ # sheet — historial completo de sesiones por día
    settings/          # sheet — ajustes + perfil + idioma + API keys
    icon/              # SVG icon por nombre
```

## Datos

El estado completo se persiste en `localStorage`. Al exportar se descarga un `.json` con toda la historia de sesiones, rutina y configuración.
