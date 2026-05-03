# GYM 2.0

PWA de seguimiento de entrenamiento con progresión asistida por IA. Interfaz en español, mobile-first, funciona offline.

## Características

- **Rutina semanal configurable** — días editables con ejercicios personalizados
- **Registro de series** — peso, reps y estado completado por set
- **Progresión IA** — recomendaciones automáticas vía Groq (llama-3.3-70b) con fallback local
- **Gráficos** — progresión de peso por ejercicio (SVG)
- **Calendario** — heatmap mensual de actividad
- **Temporizador de descanso** — overlay con cuenta regresiva configurable
- **Perfil de usuario** — peso, altura y sexo para recomendaciones personalizadas
- **Exportar / importar** — backup completo en JSON
- **PWA** — instalable, funciona sin conexión

## Stack

- Angular 21.2 (standalone components, signals)
- TypeScript 5.9
- Groq API (`llama-3.3-70b-versatile`) — opcional
- localStorage (`gym_app_state_v2`)
- Vitest

## Desarrollo

```bash
npm start        # dev server → http://localhost:4200
npm run build    # build de producción
npm test         # unit tests con Vitest
```

## Configuración de IA

1. Abrí **Ajustes** en la app
2. Ingresá tu API key de [Groq](https://console.groq.com) (gratuita)
3. Opcionalmente completá tu perfil físico para recomendaciones personalizadas

Sin API key, la app usa el algoritmo de progresión local (siempre disponible).

## Estructura

```
src/app/
  models/         # interfaces TypeScript (workout.model.ts)
  data/           # rutina inicial (initial-data.ts)
  services/       # StorageService, StateService, UIStateService, ProgressionService
  components/     # home, exercise-card, charts, calendar, rest-timer, day-editor, settings, icon
```

## Datos

El estado completo se persiste en `localStorage`. Al exportar se descarga un `.json` con toda la historia de sesiones, rutina y configuración.
