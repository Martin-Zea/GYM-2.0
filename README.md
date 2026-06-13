# GYM 2.0

PWA de seguimiento de entrenamiento con progresión asistida por IA. Interfaz en español/inglés, mobile-first, funciona offline.

**[→ Demo en vivo](https://martin-zea.github.io/GYM-2.0/)**

---

## Por qué existe

Quería una app de gimnasio que no me pidiera cuenta, no guardara mis datos en ningún servidor y me dijera cuánto subir de peso en cada serie basándose en mi historial real. Las opciones existentes o son demasiado simples o requieren suscripción. Este proyecto resuelve eso: progresión IA con API keys propias (o sin ninguna), todo en el dispositivo.

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
- localStorage (`gym_app_state_v2`, `schemaVersion: 4`)
- Vitest

## Decisiones técnicas

**localStorage en lugar de IndexedDB** — el dataset máximo racional (5 días × 8 ejercicios × 365 sesiones) no supera los 2 MB. IndexedDB agrega complejidad asíncrona innecesaria.

**Dos proveedores de IA con fallback local** — ninguna feature crítica depende de conectividad. Si Groq falla, intenta Cohere; si ambos fallan, el algoritmo local siempre responde. La app es 100% funcional sin API keys.

**Sin backend** — decisión de privacidad consciente: ningún dato sale del dispositivo salvo las llamadas opcionales a las APIs de IA con el historial del ejercicio puntual.

## Desarrollo

### Requisitos

- Node.js 22+
- npm 11+ (incluido con Node 22)

```bash
npm install
npm start        # dev server → http://localhost:4200
npm run build    # build de producción
npm test         # unit tests con Vitest
```

## Configuración de IA

1. Abrí **Ajustes** en la app
2. Ingresá tu API key de [Groq](https://console.groq.com) (gratuita) y/o [Cohere](https://dashboard.cohere.com) (gratuita)
3. Completá tu perfil físico para recomendaciones personalizadas

Sin API key la app usa el algoritmo de progresión local (siempre disponible). Si Groq falla, se intenta Cohere automáticamente.

## Deploy

La app se despliega en GitHub Pages desde la rama `main`:

```bash
npm run build
# El output en dist/ se sirve desde https://martin-zea.github.io/GYM-2.0/
```

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

## CI

El workflow `.github/workflows/ci.yml` se dispara en cada push y pull request a `main`: ejecuta `format:check` → `lint` → `build` → `test`; el job falla si cualquier paso falla.

## Datos

El estado completo se persiste en `localStorage`. Al exportar se descarga un `.json` con toda la historia de sesiones, rutina y configuración.

---

Desarrollado por **Martín Zea**
