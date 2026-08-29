# T-000 · Auditoría de la app existente

> **Fase:** F0 · **Fecha:** 2026-08-29 · **Rama:** `main` (commit `4960cb7`)
> **Fuentes leídas:** `memory/constitution.md`, `specs/001-gymtrack-adaptacion/spec.md`, `plan.md`,
> `docs/analisis-app-gym.md` (§11, §14, §15), `docs/disenos-vistas-gym.html`, y el código en `src/`.
> **Alcance:** solo lectura. No se modificó ningún archivo de código.
> **Salida esperada por tasks.md:** inventario de stack + mapa de vistas + checklists clasificadas.
> Habilita **T-001** (actualizar los `[ACLARAR]` de la spec y cerrar el plan).

**Leyenda de clasificación**

| Etiqueta     | Significado                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------- |
| **CUMPLE**   | Existe y satisface el requisito tal como está escrito. A lo sumo, retoques cosméticos.                          |
| **ADAPTAR**  | Existe una base real y reutilizable, pero le falta cobertura, estructura o rigor. Se extiende, no se reescribe. |
| **FALTA**    | No existe. Hay que construirlo.                                                                                 |
| **ELIMINAR** | Existe y sobra (o contradice la constitución / el alcance de la spec).                                          |

---

## 0. Veredicto en una página

La app existente **no es un prototipo: es un producto en producción** (v1.4.0, 9.9k líneas de TS, 98 tests verdes,
PWA instalable, i18n ES/EN completo, IndexedDB + snapshots, tres proveedores de IA en cascada). La regla de oro
del plan ("conservar el stack salvo que viole la constitución") **se sostiene**: Angular 21 con signals cumple
Art. 1, 2, 3, 7, 8 y 9 sin pelea.

Lo que hay es **profundo pero angosto**: el flujo estrella (H1→H2→G1) está resuelto con un detalle que supera al
diseño, mientras que **capas enteras del análisis no existen**: no hay entidad Rutina (solo días), no hay
catálogo de ejercicios con grupo muscular/equipo, no hay tabs de Rutinas/Progreso/Coach, no hay onboarding de
perfil, no hay herramientas, no hay contabilidad de tokens.

Y hay **cuatro choques con la constitución** que deben resolverse antes de construir encima (§6).

---

## 1. Stack real

### 1.1 Framework y build

|                          | Realidad medida                                                                                                                                                                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Framework**            | Angular **21.2** — 100% standalone, `signal()`/`computed()`/`effect()`, `input()`/`output()`, `@if`/`@for`, `ChangeDetectionStrategy.OnPush` en todos los componentes, `inject()` (cero constructor DI) |
| **Lenguaje**             | TypeScript 5.9, `strict`, target ES2022                                                                                                                                                                 |
| **Build**                | `@angular/build` (esbuild/Vite bajo el capó). `npm start` / `npm run build`                                                                                                                             |
| **Routing**              | 3 rutas lazy: `/` (home + sesión), `/history`, `/profile`. `/charts` y `/calendar` redirigen a `/history`. Guard `canDeactivate` en `/`                                                                 |
| **Estilos**              | SCSS propio + CSS custom properties. Sin framework de UI. Mobile-first, `max-width: 720px`                                                                                                              |
| **Fuentes**              | Inter + JetBrains Mono **self-hosted** en `src/fonts/` (`@font-face` local, **cero CDN** — ya cumple ese requisito de §14)                                                                              |
| **Tests**                | Vitest 4 · **5 archivos spec · 98 tests · todos verdes** (verificado ejecutando `npm test`)                                                                                                             |
| **Lint/format**          | ESLint 10 + angular-eslint 21 + Prettier 3                                                                                                                                                              |
| **PWA**                  | `@angular/service-worker` + `ngsw-config.json` (prefetch del shell, lazy de assets) + `manifest.webmanifest` (standalone, portrait, iconos 72→512)                                                      |
| **E2E**                  | `npm run e2e` — smoke del flujo sagrado vía `scripts/e2e-smoke.mjs` (Edge + playwright-core)                                                                                                            |
| **Bundle**               | Medido sobre `dist/`: **~138 KB gzip de carga inicial**, 176 KB sumando todo el JS de app. **Bajo el techo de 300 KB (CE-2)**                                                                           |
| **Dependencias runtime** | Solo Angular + rxjs + `@angular/cdk` (usado únicamente para drag&drop en el editor de días). **Sin librería de gráficas** — el SVG es propio (`utils/chart.ts`)                                         |

**Veredicto de stack:** ✅ **Se conserva.** No viola ningún artículo. Cambiar a Vite+Preact (opción B del plan §1)
tiraría 9.9k líneas probadas para ganar ~40 KB sobre un presupuesto que ya sobra. No se hace.

### 1.2 Cómo maneja el estado hoy

Arquitectura de **signals centralizada**, ya alineada con la de 3 capas del plan §2:

```
Componentes (OnPush, solo leen signals y llaman mutadores)
  ├─ StateService       — signal<AppState> único + computed derivados (days, sessions, settings,
  │                       activeDay, currentDay). Mutadores explícitos. effect() → storage.save()
  ├─ UIStateService     — signals efímeras (sheets, rest timer, toasts) + stack de overlays para
  │                       el botón atrás de Android. NO se persiste
  ├─ ProgressionService — orquesta la cascada de AiProvider + caché de recomendaciones
  ├─ SetLoggingService  — única fuente de toggle + PR + descanso + prefill IA
  └─ StorageService     — carga/valida/migra/guarda. Espeja a IndexedDB. Snapshots
```

- **Un solo `signal<AppState>`** como fuente de verdad; toda escritura pasa por `StateService`.
- Un `effect()` persiste automáticamente en cada cambio y traduce el `SaveResult` a `uiState.saveError`.
- La UI **nunca** toca `localStorage` ni `fetch` directamente. **Ya cumple** la regla de dependencias del plan §2.
- Los servicios de borde ya están separados por SRP: `ThemeService` (DOM), `BackupService` (I/O de archivos),
  `ShareService`, `AppUpdateService`, `ErrorService` + `GlobalErrorHandler`.

### 1.3 Cómo maneja el almacenamiento hoy

**Doble escritura: localStorage (arranque síncrono) + IndexedDB (durabilidad).**

| Clave                                                                    | Contenido                                                                     |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| `gym_app_state_v2`                                                       | **Blob JSON único** con todo el `AppState` (`schemaVersion: 6`)               |
| `gym_state_saved_at`                                                     | Timestamp del último save (compara LS vs IDB al arrancar)                     |
| `gym_ai_cache_v2`                                                        | Caché de recomendaciones IA por `exerciseId`                                  |
| `gym_lang`                                                               | `'es' \| 'en'`                                                                |
| `gym_last_export` / `gym_backup_dismissed`                               | Fechas ISO para el recordatorio de backup                                     |
| `gym_session_view`                                                       | `'focused' \| 'list'`                                                         |
| `gym_hiw_dismissed` / `gym_onboarding_done_v1` / `gym_legal_accepted_v1` | Flags `'1'`                                                                   |
| `gym_ai_shadow_log_v1`                                                   | Log de evaluación de modelos IA candidatos                                    |
| IndexedDB `gainai`                                                       | `state.current` (espejo durable) + `snapshots` (semanales, rotativos, máx. 4) |

- **`schemaVersion: 6`** con `migrate()` encadenado v1→v2→v3→v4→v5→v6, **con tests de fixtures reales**.
  La migración v4→v5 es notable: extrajo el catálogo de ejercicios y **saneó historiales partidos**
  deduplicando por nombre normalizado.
- `requestPersistentStorage()` al arrancar; `loadNewerFromIdb()` adopta el estado de IDB si el SO purgó localStorage.
- **Persistencia por serie: sí.** `toggleSetDone()` → `commitSession()` → `effect` → `save()`. Cumple RF-STO-02 / Art. 7.
- **Sin cookies en ninguna parte** (verificado por grep sobre `src/` y `public/`).

### 1.4 Modelo de datos actual (`workout.model.ts`)

```
AppState { schemaVersion:6, exercises[], days[], sessions[], activeDayIndex,
           routinePointer, todayProgress{}, settings, trash?[] }

Exercise         { id, name, brick, defaultSets, defaultRepTarget, restSeconds, unit, notes }
StoredWorkoutDay { id, name, exerciseIds[] }   ← persistido
WorkoutDay       { id, name, exercises[] }     ← resuelto en runtime por StateService.days()
Session          { id, dayId, dateISO, sets[], skipped?, feelings?, notes? }
SetRecord        { exerciseId, setIndex, weight, reps, target?, repTarget?, isWarmup? }
UserProfile      { weightKg, heightCm, age, sex, weightLog[], goal, aiNotes }
AppSettings      { apiKey, cohereApiKey, defaultRest, sounds, haptics, theme, userProfile,
                   barWeightKg?, platesKg? }
```

**Ausencias estructurales relevantes para la spec:** no hay entidad `Rutina` (los días son la rutina, y hay una
sola), no hay `muscleGroup`/`equipment`/`pattern` en `Exercise`, no hay RPE por serie (solo `feel` por
ejercicio), no hay timestamps de inicio/fin de sesión (⇒ imposible calcular duración), no hay `lb`
(`ExerciseUnit` es `'kg' | 'kg por mano' | 'kg por brazo' | 'tiempo' | 'peso corporal'` — literales en español).

### 1.5 Capa de IA actual

- `AiProvider` es una interfaz real (`recommend(ctx)`), con `GroqProvider` (`llama-3.3-70b-versatile`),
  `CohereProvider` (`command-r7b-12-2024`) y `LocalProvider` (549 líneas de reglas + tests exhaustivos).
- Cascada `buildProviders()`: Groq (si hay key) → Cohere (si hay key) → **local siempre** como red final.
  Cada fallo se traga con `catch` y sigue. **Cumple RF-IA-02 / EA-2 tal cual.**
- `temperature: 0`, `max_tokens: 300`, `response_format: json_object`, timeout 12 s,
  manejo de 429 con `retry-after` + 1 reintento (cap 8 s), `RateLimitError` tipado.
- Caché diaria por `exerciseId` invalidada por fecha + última sesión + firma de perfil.
  **Determinista por diseño** (documentado: "un número que baila sin datos nuevos mata la confianza").
- Cap de seguridad **parcial**: `applyLongRestAdjustment()` limita el peso al 90%/85% tras 14/28 días sin entrenar.

---

## 2. Mapa de pantallas actuales ↔ IDs de vista del diseño

IDs según `docs/disenos-vistas-gym.html` y §15.2 de `docs/analisis-app-gym.md`.

### 2.1 Onboarding (O)

| ID     | Diseño                                                  | Qué existe hoy                                                                                    | Estado      |
| ------ | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ----------- |
| **O1** | Bienvenida + aviso de privacidad local                  | `onboarding/` — 4 slides de valor; `legal-gate/` cubre el aviso legal y de privacidad             | **ADAPTAR** |
| **O2** | Perfil básico (apodo, edad, altura, peso, **unidades**) | No en onboarding. Los campos viven en `/profile` (sin apodo, sin unidades)                        | **FALTA**   |
| **O3** | Nivel y objetivo                                        | `goal` existe en `/profile`; **nivel no existe en ninguna parte**                                 | **FALTA**   |
| **O4** | Equipo, días/semana, duración, lesiones                 | Solo se elige 3/4/5 días como plantilla de rutina. Sin equipo, duración ni lesiones estructuradas | **FALTA**   |
| **O5** | Config IA con "Omitir — usar solo motor local"          | Las keys se ponen en el sheet de Ajustes. La app **ya funciona sin key**, pero la vista no existe | **FALTA**   |
| **O6** | Primera rutina (IA / plantilla / manual / después)      | `applyTemplate(3\|4\|5)` — solo el camino "plantilla", obligatorio, sin vista previa              | **ADAPTAR** |

### 2.2 Tab Hoy (H) + overlays globales (G)

| ID     | Diseño                                                    | Qué existe hoy                                                                                                                                                    | Estado                                                                                                                                           |
| ------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **H1** | Inicio/Hoy: 1 tap para entrenar, racha, PR, chip de IA    | `home/` en modo `'today'`: día que toca, CTA grande, resumen semanal Lun-Dom, racha, volumen, saltar día con deshacer                                             | **ADAPTAR** (falta chip de sugerencia pendiente, PR reciente y los estados "sin rutina"/"descanso")                                              |
| **H2** | Sesión activa: sin scroll, steppers, ✓ grande             | `home/` en modo sesión + `active-set-card/` (enfocada, default) y `exercise-card/` (lista). Pantalla completa: oculta topbar y bottom-nav. Steppers 48 px, un tap | **CUMPLE** (supera al diseño: dos vistas conmutables, calculadora de discos inline, `exercise-chart-sheet` de progresión sin salir de la sesión) |
| **H3** | Resumen de sesión (duración, tonelaje, PRs, vs. anterior) | Solo un modal de confirmación de "Terminar" que avanza el puntero. **No hay pantalla de resumen**                                                                 | **FALTA**                                                                                                                                        |
| **H4** | Detalle de sesión pasada (editar/borrar)                  | `day-history-sheet/` — sesiones por día, editable (peso/reps), borrable con papelera de 30 días, delta de volumen vs. anterior                                    | **CUMPLE** (como sheet en vez de pantalla; el propio §15.1 lo prefiere así)                                                                      |
| **G1** | Temporizador de descanso persistente y **minimizable**    | `rest-timer/` — overlay global, anillo de countdown, ±15 s, saltar, sonido + vibración, notificación en 2º plano, wake lock                                       | **ADAPTAR** (persistente sí; **minimizable no**: tapa la pantalla)                                                                               |
| **G2** | Celebración de PR                                         | Toast `prCelebration` con auto-dismiss 2.5 s + botón compartir                                                                                                    | **CUMPLE**                                                                                                                                       |
| **G3** | Aviso de backup pendiente                                 | Toast a las 10 sesiones (8 tras el primer export), con "exportar ahora" y dismiss por día                                                                         | **CUMPLE**                                                                                                                                       |
| **G4** | Confirmaciones destructivas                               | Diálogo de salida de sesión, confirmación de saltar día, reset con palabra clave `BORRAR`/`DELETE`                                                                | **CUMPLE**                                                                                                                                       |
| **G5** | Snackbar deshacer                                         | Existe para saltar día (6 s) y para el registro de peso corporal. **No es un mecanismo genérico**                                                                 | **ADAPTAR**                                                                                                                                      |
| **G6** | Indicador offline                                         | `navigator.onLine` se consulta en `ProgressionService` y la razón dice "(modo offline)". **Sin indicador visual global**                                          | **ADAPTAR**                                                                                                                                      |

### 2.3 Tab Rutinas (R)

| ID     | Diseño                                                  | Qué existe hoy                                                                                                                                             | Estado      |
| ------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **R1** | Lista de rutinas (activa, duplicar, archivar)           | **No existe el tab.** No existe la entidad Rutina: hay una única lista de días en la home                                                                  | **FALTA**   |
| **R2** | Detalle de rutina (días, rotación, activar)             | Parcial y disperso: la home lista los días y `routinePointer` marca el que toca. Sin reordenar días                                                        | **ADAPTAR** |
| **R3** | Editor de día (reordenable, superseries)                | `day-editor/` — bottom sheet con drag&drop de ejercicios (CDK). **Sin superseries**                                                                        | **ADAPTAR** |
| **R4** | Biblioteca / selector con filtros y ficha               | **No existe.** Los ejercicios se tipean a mano en el editor de día                                                                                         | **FALTA**   |
| **R5** | Editor de esquema (series × rango, RPE, descanso, tipo) | Dentro de `day-editor`: `defaultSets`, `defaultRepTarget`, `restSeconds`, `brick`, `unit`, `notes`. Sin rango de reps, sin RPE objetivo, sin tipo de serie | **ADAPTAR** |
| **R6** | Plantillas filtradas por perfil con vista previa        | `initial-data.ts` tiene 3 plantillas (3/4/5 días), solo ofrecidas en el onboarding, sin filtro ni preview                                                  | **ADAPTAR** |
| **R7** | Generador IA (wizard 3 pasos con costo)                 | **No existe**                                                                                                                                              | **FALTA**   |

### 2.4 Tab Progreso (P)

| ID     | Diseño                                                      | Qué existe hoy                                                                                                                                                         | Estado      |
| ------ | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **P1** | Analítica (rangos, tonelaje, volumen por grupo, adherencia) | `history/` tiene rangos 3m/6m/todo y una gráfica; la home muestra volumen semanal y racha. **Sin volumen por grupo muscular ni adherencia**                            | **ADAPTAR** |
| **P2** | Detalle de ejercicio (e1RM, récords, tabla)                 | `history/` (selector de ejercicio + gráfica e1RM/top, puntos interactivos, "ver sesión") y `exercise-chart-sheet/` en sesión. Sin tabla de historial completa ni ficha | **ADAPTAR** |
| **P3** | Calendario heatmap por tonelaje → H4                        | `history/` tiene calendario mensual con días entrenados en verde y tap → sheet filtrado. **Es binario, no heatmap de intensidad**                                      | **ADAPTAR** |
| **P4** | Cuerpo: peso y medidas                                      | `profile/` + `history/`: `weightLog` con alta/borrado y gráfica. **Sin medidas corporales**                                                                            | **ADAPTAR** |
| **P5** | Récords / PRs por ejercicio con fecha                       | `history/` muestra top 3 PRs; `profile/` la lista completa de logros                                                                                                   | **CUMPLE**  |

### 2.5 Tab Coach IA (C)

| ID     | Diseño                                                                                    | Qué existe hoy                                                                                                                                                        | Estado    |
| ------ | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| **C1** | Panel: sugerencias por día, aceptar/cambiar/rechazar, estado del proveedor, uso de tokens | **No existe el tab.** La sugerencia se muestra inline en el ejercicio (badge IA + razón). Sin aceptar/rechazar explícito, sin estado de proveedor visible, sin tokens | **FALTA** |
| **C2** | Chat con contexto (deshabilitado sin key)                                                 | **No existe**                                                                                                                                                         | **FALTA** |
| **C3** | Historial de sugerencias y feedback                                                       | **No existe** para el usuario. Existe `ai-shadow-log.service.ts`, pero es una herramienta interna de evaluación de modelos, no el historial de C3                     | **FALTA** |

### 2.6 Tab Ajustes (A)

| ID     | Diseño                                                                             | Qué existe hoy                                                                                                                                                                  | Estado      |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| **A1** | Menú de ajustes                                                                    | `settings/` es un bottom sheet, no un tab con stack. Sin resumen de estado por fila                                                                                             | **ADAPTAR** |
| **A2** | Perfil (editar todo el onboarding)                                                 | `/profile` — peso, altura, edad, sexo, objetivo, notas IA, log de peso, PRs. Falta nivel, equipo, disponibilidad, lesiones estructuradas, unidades                              | **ADAPTAR** |
| **A3** | IA y keys (probar conexión, proveedor/modelo, presupuesto, solo local)             | Solo dos campos de key en texto plano + nota de privacidad. **Sin probar conexión, sin selector de modelo, sin presupuesto, sin modo "solo local"**                             | **ADAPTAR** |
| **A4** | Datos (export JSON/CSV, import fusión/reemplazo, espacio, snapshots, borrar)       | Export JSON (share/download), import (**solo reemplaza**), restaurar snapshot, papelera, reset con palabra clave. **Sin CSV, sin fusión, sin medidor de espacio, sin checksum** | **ADAPTAR** |
| **A5** | Preferencias (unidades, tema, idioma, descansos, incrementos, RPE, notificaciones) | Tema (dark/light/alto contraste), idioma ES/EN, descanso por defecto, sonidos, hápticos, barra y discos. **Sin unidades, sin RPE on/off, sin config de notificaciones**         | **ADAPTAR** |
| **A6** | Herramientas (1RM, discos, conversor, timer)                                       | **No existe la vista.** La calculadora de discos existe (`utils/plates.ts`) pero solo embebida en la tarjeta de serie, con inventario configurable en Ajustes                   | **ADAPTAR** |
| **A7** | Acerca de (versión, changelog, disclaimer, privacidad, licencias)                  | `version.ts` + enlaces a `privacy.html` y `terms.html` desde Ajustes + `legal-gate`. Sin vista unificada ni changelog in-app                                                    | **ADAPTAR** |

### 2.7 Resumen del mapa

| Tab            | Vistas del diseño | CUMPLE      | ADAPTAR      | FALTA        |
| -------------- | ----------------- | ----------- | ------------ | ------------ |
| O · Onboarding | 6                 | 0           | 2            | 4            |
| H · Hoy        | 4                 | 2           | 1            | 1            |
| G · Overlays   | 6                 | 3           | 3            | 0            |
| R · Rutinas    | 7                 | 0           | 4            | 3            |
| P · Progreso   | 5                 | 1           | 4            | 0            |
| C · Coach IA   | 3                 | 0           | 0            | 3            |
| A · Ajustes    | 7                 | 0           | 7            | 0            |
| **Total**      | **38**            | **6 (16%)** | **21 (55%)** | **11 (29%)** |

**Lectura:** el 71% de las vistas del diseño tiene algo real detrás. El déficit se concentra en dos bloques
compactos: **Coach IA completo (C1–C3)** y **el ciclo de rutinas/biblioteca (R1, R4, R7)**. Ninguna vista
existente está de más.

**Nota de diseño visual (decisión de producto, no hallazgo técnico):** la paleta actual
(`--accent: #3b82f6` azul, `--bg-0: #0f172a`) **no coincide** con la del diseño (`--acc: #FF6A3D` naranja,
`--bg: #0B0E11`). Como el sistema ya está tokenizado en CSS vars, es un cambio de valores, no de estructura.
La app además tiene un tema de **alto contraste** que el diseño no contempla: **conservarlo**.

---

## 3. Checklists del análisis, clasificadas

### 3.1 §11 — Checklist completa

#### Datos

| Ítem                                 | Estado      | Evidencia / brecha                                                                                      |
| ------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------- |
| localStorage estructurado por claves | **ADAPTAR** | Existe, pero es **un blob único** `gym_app_state_v2` + claves sueltas. La spec pide particionado `gt_*` |
| schemaVersion + migraciones          | **CUMPLE**  | v6, `migrate()` encadenado v1→v6, **con tests de fixtures**                                             |
| export JSON                          | **CUMPLE**  | `BackupService.exportData()`: Web Share nativo con fallback a `<a download>`                            |
| import con fusión/reemplazo          | **ADAPTAR** | Import existe pero **solo reemplaza**. Falta modo fusionar y resumen de lo importado (EA-5)             |
| export CSV                           | **FALTA**   | —                                                                                                       |
| recordatorio de backup               | **CUMPLE**  | Toast a las 10 sesiones (8 tras el primer export), dismiss por día                                      |
| medidor de espacio                   | **FALTA**   | No hay `navigator.storage.estimate()`                                                                   |
| borrar todo con confirmación         | **CUMPLE**  | Reset exige escribir `BORRAR`/`DELETE` (según idioma)                                                   |
| persistencia por serie               | **CUMPLE**  | `toggleSetDone` → `commitSession` → `effect` → `save()`                                                 |
| `storage.persist()`                  | **CUMPLE**  | `requestPersistentStorage()` al arrancar                                                                |

#### Perfil

| Ítem                    | Estado      | Evidencia / brecha                                                                        |
| ----------------------- | ----------- | ----------------------------------------------------------------------------------------- |
| nivel                   | **FALTA**   | No existe el concepto en el modelo                                                        |
| objetivo                | **CUMPLE**  | `goal: 'strength'\|'hypertrophy'\|'endurance'`, ya alimenta al motor local y al prompt    |
| equipo                  | **FALTA**   | —                                                                                         |
| días/semana             | **ADAPTAR** | Implícito en el nº de días de la rutina; no hay campo de disponibilidad declarada         |
| lesiones                | **ADAPTAR** | `aiNotes` (texto libre) llega al prompt, pero **no es campo estructurado ni límite duro** |
| unidades kg/lb          | **FALTA**   | `ExerciseUnit` no contempla lb. Todo se almacena y muestra en kg                          |
| peso corporal histórico | **CUMPLE**  | `weightLog[]`, upsert diario, gráfica en `/history`                                       |

#### Ejercicios

| Ítem                                             | Estado      | Evidencia / brecha                                                                                                                                                                                                       |
| ------------------------------------------------ | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| catálogo embebido con grupos musculares y equipo | **FALTA**   | Existe `AppState.exercises` como catálogo de identidad, pero **vive en localStorage**, se siembra desde plantillas y **no tiene grupo muscular, equipo, tipo ni patrón**. La spec pide catálogo **estático empaquetado** |
| búsqueda/filtros                                 | **FALTA**   | —                                                                                                                                                                                                                        |
| ejercicios custom                                | **CUMPLE**  | Todo ejercicio es de hecho custom: se crean y editan en `day-editor`                                                                                                                                                     |
| ficha con historial y récords                    | **ADAPTAR** | `exercise-chart-sheet` + `/history` dan gráfica e1RM/top y PRs. Falta ficha unificada (técnica, tabla de historial)                                                                                                      |
| sustituciones                                    | **ADAPTAR** | `substituteToday()` sustituye solo por hoy y registra bajo el id correcto (bien resuelto). **No propone alternativas** por patrón/grupo (no hay metadatos)                                                               |

#### Rutinas

| Ítem                                       | Estado      | Evidencia / brecha                                                                                                               |
| ------------------------------------------ | ----------- | -------------------------------------------------------------------------------------------------------------------------------- |
| CRUD + duplicar + archivar                 | **ADAPTAR** | CRUD de **días** sí (`saveDay`/`deleteDay`). **No hay entidad Rutina**, ni duplicar, ni archivar                                 |
| días y esquemas (series/reps/RPE/descanso) | **ADAPTAR** | Series, reps objetivo y descanso sí. **Sin rango de reps, sin RPE objetivo, sin % de 1RM**                                       |
| superseries / dropsets / AMRAP             | **FALTA**   | Solo existe `isWarmup` como tipo de serie                                                                                        |
| plantillas por nivel                       | **ADAPTAR** | 3 plantillas (3/4/5 días) en `initial-data.ts`, solo accesibles desde el onboarding, sin filtro por nivel/equipo ni vista previa |
| rutina activa con rotación                 | **CUMPLE**  | `routinePointer` + `advanceRoutine()` + `skipDay()`/`undoSkipDay()`                                                              |
| generador IA con revisión previa           | **FALTA**   | —                                                                                                                                |

#### Sesión

| Ítem                                    | Estado      | Evidencia / brecha                                                                                                                                                                                                                     |
| --------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| iniciar en 1 tap                        | **CUMPLE**  | CTA grande en H1                                                                                                                                                                                                                       |
| última sesión visible por ejercicio     | **CUMPLE**  | En ambas vistas de sesión                                                                                                                                                                                                              |
| sugerencia visible por ejercicio        | **CUMPLE**  | Badge IA + razón                                                                                                                                                                                                                       |
| registro rápido con autocompletar       | **CUMPLE**  | Prefill desde IA o última sesión, con marca visual del prefill                                                                                                                                                                         |
| temporizador con vibración/notificación | **CUMPLE**  | Sonido (Web Audio), vibración, notificación vía SW, wake lock                                                                                                                                                                          |
| editar sobre la marcha                  | **ADAPTAR** | Serie extra ✓, sustituir por hoy ✓. **Falta añadir/quitar ejercicio durante la sesión**                                                                                                                                                |
| notas                                   | **ADAPTAR** | Nota + sensación **por ejercicio** ✓. **Falta nota por serie y por sesión**                                                                                                                                                            |
| PRs en vivo                             | **CUMPLE**  | `maybeCelebratePr()`: compara contra el histórico excluyendo hoy, con anti-spam y exclusión de unidades no comparables                                                                                                                 |
| resumen final                           | **FALTA**   | Al terminar solo se avanza el puntero de rutina (H3 no existe)                                                                                                                                                                         |
| recuperación de sesión                  | **ADAPTAR** | El progreso sobrevive al cierre y el CTA cambia a "Continuar entrenamiento". **Falta el banner explícito con antigüedad y las opciones finalizar-como-está / descartar** (F7). Sin timestamp de inicio no se puede decir "hace 40 min" |

#### IA

| Ítem                                     | Estado      | Evidencia / brecha                                                                                                                                         |
| ---------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| keys Groq y Cohere                       | **CUMPLE**  | Dos campos en Ajustes                                                                                                                                      |
| prueba de conexión                       | **FALTA**   | —                                                                                                                                                          |
| selección de proveedor/modelo            | **FALTA**   | Modelos hardcodeados (`GROQ_MODEL`, Cohere)                                                                                                                |
| contexto compacto                        | **FALTA**   | El prompt manda `JSON.stringify(summary, null, 2)` — **JSON indentado, lo contrario de la serialización CSV-like** del Art. 5                              |
| salida JSON validada                     | **ADAPTAR** | `response_format: json_object` + `parseAndNormalizeSets()` valida forma y tipos. **No valida contra límites duros**                                        |
| aceptar/rechazar con feedback persistido | **ADAPTAR** | El feedback subjetivo (`feel` + nota) se persiste y **se reinyecta al prompt** (`buildFeedbackNote`). **No existe aceptar/cambiar/rechazar la sugerencia** |
| fallback Groq→Cohere→reglas              | **CUMPLE**  | `buildProviders()` + bucle con `catch`. Cumple EA-2 tal cual                                                                                               |
| motor de reglas local completo           | **CUMPLE**  | `LocalProvider`, 549 líneas, con tests                                                                                                                     |
| deload y estancamiento                   | **CUMPLE**  | Deload al 70% tras N sesiones progresando; detección de sesiones confirmadas consecutivas                                                                  |
| análisis semanal                         | **FALTA**   | —                                                                                                                                                          |
| límites de seguridad                     | **ADAPTAR** | Solo el cap por descanso largo (90%/85% tras 14/28 días). **Falta el tope de +10% y el respeto de lesiones**                                               |
| disclaimer                               | **CUMPLE**  | `legal-gate` + `privacy.html` + `terms.html`                                                                                                               |

#### Progreso

| Ítem                       | Estado      | Evidencia / brecha                                                                                         |
| -------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------- |
| dashboard con racha        | **CUMPLE**  | Racha + volumen semanal + mapa Lun-Dom en H1                                                               |
| 1RM estimado por ejercicio | **CUMPLE**  | Epley en `utils/chart.ts`, seleccionable como métrica                                                      |
| volumen por grupo muscular | **FALTA**   | Bloqueado: no hay grupo muscular en el modelo                                                              |
| heatmap calendario         | **ADAPTAR** | Calendario mensual binario (entrenado/no). Falta intensidad por tonelaje                                   |
| medidas corporales         | **ADAPTAR** | Solo peso corporal                                                                                         |
| comparativas temporales    | **ADAPTAR** | vs. sesión anterior ✓ y rangos 3m/6m/todo ✓. Faltan los rangos 4/12 semanas y el agregado "vs. mes pasado" |

#### Herramientas

| Ítem                          | Estado      | Evidencia / brecha                                                                                                                                         |
| ----------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| calculadora 1RM / porcentajes | **FALTA**   | Epley se usa para graficar, no hay calculadora                                                                                                             |
| calculadora de discos         | **ADAPTAR** | `plateBreakdown()` con inventario configurable (`barWeightKg`, `platesKg`), **ya integrada en la tarjeta de serie**. Falta exponerla como herramienta (A6) |
| conversor kg/lb               | **FALTA**   | —                                                                                                                                                          |
| temporizador libre            | **FALTA**   | Solo el de descanso                                                                                                                                        |

#### PWA / UX

| Ítem                   | Estado      | Evidencia / brecha                                                                                                                 |
| ---------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| instalable + offline   | **CUMPLE**  | `ngsw-config.json` + manifest; `AppUpdateService` avisa de nueva versión                                                           |
| Wake Lock en sesión    | **CUMPLE**  | `WakeLockService` cubre **toda** la sesión y re-adquiere al volver a primer plano                                                  |
| notificaciones locales | **ADAPTAR** | Fin de descanso ✓ (vía SW). **Faltan recordatorios de entrenamiento y de backup como notificación** (el de backup es toast in-app) |
| modo oscuro            | **CUMPLE**  | Dark por defecto + light + alto contraste                                                                                          |
| navegación de 5 tabs   | **ADAPTAR** | Son 3 (Inicio / Historial / Perfil), sin stacks por tab                                                                            |
| inputs con steppers    | **CUMPLE**  | Steppers de 48 px en la vista enfocada                                                                                             |
| estados vacíos guiados | **ADAPTAR** | Home e Historial sí; no sistemáticamente en todas las vistas                                                                       |
| deshacer               | **ADAPTAR** | Saltar día (6 s) y peso corporal. No es un mecanismo genérico                                                                      |

### 3.2 §14 — Checklist adicional

#### Tokens / IA

| Ítem                                       | Estado       | Evidencia / brecha                                                                                                                                             |
| ------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| serialización compacta CSV-like            | **FALTA**    | Se envía JSON con `null, 2`                                                                                                                                    |
| diccionario de abreviaturas                | **FALTA**    | Claves largas en español (`dias_desde_ultima_sesion`, `historial_sesiones`)                                                                                    |
| ventana de 3–6 sesiones                    | **CUMPLE**   | `HISTORY_SESSIONS = 5`                                                                                                                                         |
| pre-filtrado local de casos obvios         | **ADAPTAR**  | No se llama si no hay providers ni datos (`hasDoneOrHistory`). Falta el pre-filtro por "caso obvio" (primera sesión, unidad no progresable)                    |
| **1 llamada por sesión**                   | **FALTA** ⚠️ | Hoy es **1 llamada por ejercicio**, encoladas y serializadas. Un día de 6 ejercicios = 6 llamadas. **Choca con Art. 5 y RF-IA-06** → §6.1                      |
| caché por hash de contexto                 | **ADAPTAR**  | Caché por `exerciseId` + fecha + última sesión + firma de perfil. Cumple el propósito (y es deliberadamente determinista), pero **no es un hash del contexto** |
| max_tokens por tipo de tarea               | **ADAPTAR**  | Fijo en 300; hoy solo existe una tarea                                                                                                                         |
| temperature 0–0.3                          | **CUMPLE**   | `temperature: 0` en ambos proveedores                                                                                                                          |
| contador de tokens (`usage`)               | **FALTA**    | La respuesta trae `usage` y **se descarta**                                                                                                                    |
| presupuesto mensual con corte              | **FALTA**    | —                                                                                                                                                              |
| modelo pequeño/grande por tarea            | **FALTA**    | —                                                                                                                                                              |
| confirmación de costo en operaciones caras | **FALTA**    | No hay operaciones caras todavía                                                                                                                               |
| anti doble-tap                             | **CUMPLE**   | `aiInFlight` (Set) + cola serializada `drainAiQueue()`                                                                                                         |

#### Ingeniería

| Ítem                                    | Estado         | Evidencia / brecha                                                                                                                                                                                                                                                             |
| --------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| escritura atómica                       | **FALTA** ⚠️   | `save()` hace `localStorage.setItem()` directo del blob completo. **No hay temporal → validar → swap** (Art. 7). Mitigado parcialmente por el espejo IDB y los snapshots                                                                                                       |
| validación de esquema en lectura/import | **ADAPTAR** ⚠️ | `isValidAppState()` es **superficial**: comprueba que `days` sea array y poco más; no valida tipos internos. Y ante estado inválido **`load()` devuelve el estado inicial**, es decir, **tapa datos potencialmente recuperables en vez de ponerlos en cuarentena** (RF-STO-04) |
| checksum en backups                     | **FALTA**      | El export añade `exportedAt` y `appVersion`, sin checksum                                                                                                                                                                                                                      |
| snapshots internos rotativos            | **CUMPLE**     | IndexedDB, semanales, máx. 4, restaurables desde Ajustes                                                                                                                                                                                                                       |
| manejo multi-pestaña                    | **FALTA**      | Sin listener de `storage` ni Web Locks. **Dos pestañas abiertas hoy se pisan** (gana la última en guardar)                                                                                                                                                                     |
| key cifrada (WebCrypto)                 | **FALTA** ⚠️   | Las keys viven en claro dentro de `AppState.settings` **y salen en el backup JSON** → §6.2                                                                                                                                                                                     |
| CSP sin CDNs externos                   | **ADAPTAR**    | Cero CDNs: fuentes self-hosted, sin librerías externas. **Falta declarar la CSP** (meta o cabecera)                                                                                                                                                                            |
| sanitización de texto libre e imports   | **ADAPTAR**    | Angular escapa por interpolación y no hay `innerHTML`. Falta saneo explícito de strings importados                                                                                                                                                                             |
| respuesta IA validada con límites duros | **FALTA** ⚠️   | → §6.3                                                                                                                                                                                                                                                                         |
| error boundary + log local              | **ADAPTAR**    | `GlobalErrorHandler` + `ErrorService` + toast. **Sin log persistido**                                                                                                                                                                                                          |
| virtualización y downsampling           | **FALTA**      | `buildChart()` dibuja todos los puntos; sin agregación >200 (RF-PRO-04)                                                                                                                                                                                                        |
| bundle < 300 KB gzip                    | **CUMPLE**     | ~138 KB gzip de carga inicial                                                                                                                                                                                                                                                  |
| backoff y timeout en IA                 | **CUMPLE**     | 12 s, `retry-after` respetado, 1 reintento, cap de espera 8 s                                                                                                                                                                                                                  |
| tests del motor de reglas y migraciones | **CUMPLE**     | 98 tests verdes en 5 archivos, con fixtures de migración v1→v6                                                                                                                                                                                                                 |
| abstracción `AIProvider`                | **CUMPLE**     | Interfaz real; la UI nunca llama a un proveedor                                                                                                                                                                                                                                |
| disclaimer + política de privacidad     | **CUMPLE**     | `legal-gate` + `privacy.html` + `terms.html`                                                                                                                                                                                                                                   |
| licencia del catálogo                   | **FALTA**      | No aplica hoy (no hay catálogo de terceros); será obligatorio al incorporarlo en T-500                                                                                                                                                                                         |

### 3.3 §15.4 — Checklist de navegación y vistas

| Ítem                                                        | Estado      | Evidencia / brecha                                                                                                 |
| ----------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------ |
| tab bar de 5 pestañas con stacks independientes             | **ADAPTAR** | 3 tabs, sin stacks (cada tab es una ruta plana)                                                                    |
| onboarding omitible en cada paso                            | **ADAPTAR** | 4 slides navegables, pero **la elección de días al final es obligatoria**                                          |
| O5 permite omitir la key sin fricción                       | **FALTA**   | La vista no existe. Funcionalmente la app ya no bloquea nada sin key (el espíritu se cumple), pero el paso no está |
| H1 con estados: sin rutina / descanso / sesión interrumpida | **ADAPTAR** | Estado vacío guiado ✓. **Sin estado "día de descanso"**; interrumpida solo como cambio de texto del CTA            |
| H2 sin scroll para registrar serie                          | **CUMPLE**  | Vista enfocada: 1 serie, steppers 48 px, un tap. Es el punto más fuerte de la app                                  |
| temporizador G1 persistente y minimizable                   | **ADAPTAR** | Persistente y global ✓. **No minimizable**: ocupa la pantalla hasta saltarlo                                       |
| sheets en vez de pantallas para acciones secundarias        | **CUMPLE**  | 7 bottom sheets + stack de overlays integrado con el botón atrás de Android                                        |
| R7 con confirmación de costo y edición antes de guardar     | **FALTA**   | —                                                                                                                  |
| C2 deshabilitado sin key con explicación                    | **FALTA**   | No hay chat                                                                                                        |
| 4 estados definidos en cada vista                           | **ADAPTAR** | "Con datos" y "vacío" cubiertos en las vistas principales; "cargando" solo en la IA; "error" solo global           |
| F7 recuperación de sesión                                   | **ADAPTAR** | Ver arriba                                                                                                         |
| F8 offline sin bloqueo                                      | **CUMPLE**  | Todo el flujo estrella funciona sin red; la IA degrada al motor local con la razón anotada                         |

### 3.4 Nada que ELIMINAR (y por qué)

Ninguna funcionalidad existente contradice la constitución ni el alcance de la spec. Cuatro candidatos
evaluados y **descartados como eliminación**:

1. **`ai-shadow-log.service.ts`** — logging de modelos IA candidatos. Es herramienta interna de evaluación, no
   telemetría de terceros (Art. 3): escribe en el localStorage del propio usuario y se exporta a mano.
   **Conservar**, pero al implementar el contador de tokens (T-406) debe **contar también sus llamadas**, o
   apagarse por defecto: hoy es una llamada extra a Groq invisible para el presupuesto.
2. **Tema de alto contraste** — no está en el diseño, pero es accesibilidad. **Conservar.**
3. **`APP_DOWNLOAD_URL`** (link a Play Store) — vestigio de otra distribución. Revisar en T-703, no urgente.
4. **`/charts` y `/calendar` como redirects** — compatibilidad con bookmarks. Conservar hasta rehacer la
   navegación en 5 tabs; ahí sí se replantean.

---

## 4. Respuesta a los 4 `[ACLARAR]` de spec.md §8

### [ACLARAR 1] Stack actual de la app existente → **RESUELTO**

**Angular 21.2 standalone + signals + TypeScript 5.9 strict, build `@angular/build`, SCSS propio con CSS vars,
Vitest 4, PWA con `@angular/service-worker`.** Estado en un `signal<AppState>` único centralizado en
`StateService` con persistencia automática vía `effect()`; UI efímera separada en `UIStateService`.

**Decisión propuesta para T-001:** conservar el stack. Cumple Art. 1, 2, 3, 7, 8 y 9 sin modificaciones, el
bundle está en 138 KB gzip (menos de la mitad del techo CE-2) y la arquitectura de capas del plan §2 **ya está
implementada** (la UI no toca storage ni fetch). Sustituir el §1 del plan ("Vite + Preact") por
"Angular 21 — confirmado por T-000".

### [ACLARAR 2] ¿localStorage ya en uso? ¿con qué estructura? → **RESUELTO**

**Sí, intensamente**, y además con IndexedDB como capa durable. Estructura: **un blob JSON único**
`gym_app_state_v2` con todo el `AppState` (`schemaVersion: 6`), más 9 claves auxiliares `gym_*` para flags y
caché (inventario completo en §1.3). Espejo en IndexedDB `gainai` (`state.current`) + snapshots semanales
rotativos (máx. 4). Ya existe un framework de migraciones encadenadas v1→v6 con tests de fixtures.

**Implicación para T-102:** la migración a `gt_*` **no parte de cero**: se añade un paso `v6 → v7` al `migrate()`
existente que reparticiona el blob en las claves `gt_*` del plan §3. Riesgos en §5.

### [ACLARAR 3] ¿ES solo o ES/EN desde el inicio? → **RESUELTO: ES/EN desde el inicio, ya implementado**

`TranslationService` con `lang: WritableSignal<'es'|'en'>` y `T` como `computed()`; interfaz `Translations` con
objetos `es`/`en` completos; interpolación `tp()`; persistencia en `gym_lang`; hasta la palabra de confirmación
de reset depende del idioma (`BORRAR`/`DELETE`). **No es una decisión pendiente: es una restricción heredada.**
Toda vista nueva debe añadir sus claves a la interfaz `Translations` y a **ambos** objetos, o no compila.

**Cuidado detectado:** los prompts de IA están **escritos en español y son fijos**, con solo una instrucción de
idioma para el campo `reason`. Al rehacer el serializador compacto (T-403) conviene sacar el prompt del idioma
del usuario por completo (formato abreviado neutro) y dejar el idioma únicamente como instrucción de salida:
ahorra tokens y elimina la deriva ES/EN.

### [ACLARAR 4] ¿Se mantiene la cookie como flag de onboarding? → **RESUELTO: no aplica — ELIMINAR el requisito**

**No existe ninguna cookie en la app.** Verificado por búsqueda sobre `src/` y `public/`: las únicas menciones
están en `privacy.html`, y son para afirmar que la app **no usa** cookies de seguimiento. El flag de onboarding
es `localStorage['gym_onboarding_done_v1'] = '1'`, y el legal `gym_legal_accepted_v1`.

**Recomendación:** eliminar el requisito de cookie de la spec. Reintroducirla contradiría el Art. 3
(persistencia bajo claves `gt_*`) y el §2.1 del análisis (4 KB por cookie no alcanzan), degradaría la promesa de
privacidad ya publicada en `privacy.html`, y no aporta nada: la cookie no sobrevive a un borrado de datos del
navegador mejor que localStorage. **Los dos flags se migran a `gt_meta` en T-102.**

---

## 5. Riesgos de la migración de datos actuales al modelo `gt_*`

Contexto: hay usuarios reales con historial acumulado en `gym_app_state_v2` v6. La migración no es un refactor,
es **cirugía sobre datos vivos e irrecuperables** (no hay backend del que rehidratar).

### R-1 · Pérdida de atomicidad al partir el blob en varias claves 🔴 ALTO

Hoy todo el estado se guarda en **un** `setItem`: es atómico por accidente. El plan §3 lo reparte en 8 claves
(`gt_profile`, `gt_routines`, `gt_sessions`, …). Un fallo de cuota o un cierre a mitad de la secuencia deja
**estado incoherente entre claves** (p. ej. sesiones que referencian ejercicios que no se llegaron a escribir).

**Mitigación:** el `storageAdapter` de T-100 debe hacer commit multi-clave con journal (escribir todas las claves
nuevas con sufijo temporal → validar el conjunto → intercambiar punteros en `gt_meta` → borrar temporales), y
`gt_meta` debe llevar la versión del conjunto completo, no de cada clave por separado. **Escribir el test de
"corte de energía a mitad de la migración" antes que la migración.**

### R-2 · La validación actual borra en vez de poner en cuarentena 🔴 ALTO

`load()` ante un estado inválido devuelve `createInitialState()` **y el `effect` de persistencia lo guarda encima
del original**. Es decir: un bug de validación durante la migración **destruye el historial del usuario en el
primer render**. Con un validador más estricto (RF-STO-04), el riesgo crece, no baja.

**Mitigación (bloqueante, antes de T-102):** implementar la cuarentena **primero** — mover el original a
`gt_quarantine_<timestamp>`, no persistir nada encima hasta que el usuario decida, y escribir un snapshot IDB
obligatorio antes de ejecutar la migración v6→v7. Ya existe `writeSnapshot()`, se reutiliza.

### R-3 · El catálogo de ejercicios no tiene los metadatos que el modelo nuevo exige 🟠 MEDIO

`Exercise` actual no tiene `muscleGroup`, `equipment`, `type` ni `pattern`; el catálogo del usuario se sembró
desde plantillas y **se editó a mano** (nombres libres). El modelo nuevo (RF-EJ-01) separa catálogo estático
empaquetado de ejercicios custom en localStorage. Al migrar hay que decidir, ejercicio por ejercicio, si **mapea
al catálogo estático** (hereda metadatos, pero cambia de id) o **se queda como custom** (sin grupo muscular, y
entonces P1 "volumen por grupo" lo ignora en silencio).

**Mitigación:** matching por nombre normalizado — la función ya existe (`normalizeExerciseName()`, probada en la
migración v4→v5) — con tabla de sinónimos ES/EN. **Nunca cambiar el id del ejercicio del usuario**: en su lugar
añadir `catalogRef` apuntando al ejercicio estático. Así el historial nunca se desancla y un error de matching es
reversible. Los no mapeados se marcan y se ofrece resolverlos a mano (no adivinar).

### R-4 · Las unidades actuales son literales en español y no contemplan lb 🟠 MEDIO

`ExerciseUnit` es `'kg' | 'kg por mano' | 'kg por brazo' | 'tiempo' | 'peso corporal'`: **strings de UI usados
como claves de dominio**, ya persistidos en los datos de todos los usuarios. La spec exige kg/lb con
almacenamiento canónico en kg (§6 casos borde).

**Mitigación:** migrar a un enum neutro (`KG`, `KG_PER_HAND`, `KG_PER_ARM`, `TIME`, `BODYWEIGHT`) con tabla de
equivalencias en la migración, y tratar lb como **capa de presentación**, nunca de almacenamiento. Ojo:
`'kg por mano'` y `'kg por brazo'` afectan al cálculo de tonelaje (×2) — verificar que el cálculo actual lo
respeta **antes** de introducir volumen por grupo muscular, o los números de P1 saldrán mal desde el día uno.

### R-5 · Sesiones sin timestamps ni RPE: el historial nace incompleto 🟠 MEDIO

`Session` tiene `dateISO` (día), no hora de inicio/fin ⇒ **la duración de sesiones pasadas es irrecuperable**.
`SetRecord` no tiene RPE (solo hay `feel` por ejercicio) ⇒ el "peso×reps×RPE" de RF-SES-02 y las gráficas de RPE
**arrancan vacías para todo el historial previo**.

**Mitigación:** aceptar el hueco explícitamente. Campos opcionales, UI que distingue "sin dato" de "cero" (nunca
mostrar duración 0 min), y H3/P1 que degradan con elegancia en el histórico previo a la migración. Documentarlo
en la spec para no descubrirlo en T-205.

### R-6 · Ids de 7 caracteres aleatorios y sin espacio de nombres 🟡 BAJO-MEDIO

`uid()` = `Math.random().toString(36).slice(2, 9)`. Con pocos cientos de entidades la colisión interna es
despreciable, **pero el import en modo fusionar (RF-STO-05) une dos universos de ids generados por la misma
función**: dos ejercicios distintos con el mismo id es un escenario real, y el resultado sería historial fusionado
en el ejercicio equivocado — **corrupción silenciosa**, la peor clase.

**Mitigación:** la fusión debe deduplicar por identidad semántica (nombre normalizado; fecha+día para sesiones),
no por id, y detectar colisiones de id entre universos remapeando el entrante. Test obligatorio en T-106 con dos
backups que compartan ids.

### R-7 · La caché de IA y los snapshots quedan huérfanos tras la migración 🟡 BAJO

`gym_ai_cache_v2` está indexada por `exerciseId`, y los snapshots IDB guardan `AppState` **en la forma vieja**.
Tras migrar, la caché puede devolver recomendaciones ancladas a ids remapeados, y **restaurar un snapshot viejo
revierte el esquema sin avisar**.

**Mitigación:** invalidar la caché IA por completo en la migración (es barata de regenerar), y garantizar que
`getSnapshot()` pase el estado por `migrate()` antes de adoptarlo — hoy pasa por `buildState()`, que migra, así
que el camino existe; falta el test de snapshot v6 restaurado en v7.

### R-8 · Las keys de IA en claro viajan dentro del backup 🟠 MEDIO (seguridad, no pérdida)

`exportData()` serializa `state()` completo, **incluidos `apiKey` y `cohereApiKey` en texto plano**. Ese archivo
se comparte por WhatsApp, se sube a Drive, se manda por mail. Al cifrar las keys con WebCrypto (T-407) hay que
decidir **explícitamente** qué pasa con ellas en el export.

**Mitigación propuesta:** excluir las keys del backup por defecto (con opción "incluir credenciales" apagada) y,
en la migración, **avisar de que los backups anteriores contienen la key** y recomendar rotarla. Es más honesto y
cuesta un párrafo (Art. 10).

### R-9 · Sin manejo multi-pestaña, migrar con dos pestañas abiertas corrompe 🟠 MEDIO

No hay listener de `storage` ni Web Locks (§3.2). Si el usuario tiene la PWA y una pestaña del navegador
abiertas, **una puede estar migrando mientras la otra guarda en formato viejo encima**. Es el escenario más
plausible de pérdida real durante el despliegue de la migración.

**Mitigación:** **T-105 (Web Locks) debe ir antes que T-102 (migración)**, no en paralelo como sugiere el `[P]`
actual de tasks.md. La migración toma el lock, y las otras pestañas muestran "actualizando datos, recargá".

### Orden de trabajo que estos riesgos imponen

```
T-105 (locks multi-pestaña)   ─┐
T-101 (validación+cuarentena) ─┼─→ T-100 (adapter atómico) ─→ T-102 (migración v6→gt_*)
snapshot obligatorio previo   ─┘                                      │
                                                             T-106 (tests: corte a mitad,
                                                             fusión con ids colisionados,
                                                             snapshot viejo restaurado)
```

Es un cambio de dependencias respecto al `[P]` que tasks.md marca hoy en T-101/T-105, y debería reflejarse en el
plan durante T-001.

---

## 6. Choques con la constitución (avisos, no decisiones)

Estos cuatro puntos son incumplimientos de artículos **no negociables** en el código que hoy está en producción.
No los toco: los reporto para que decidas si se corrigen, se planifican o se enmienda la constitución con fecha y
motivo (Gobernanza).

### 6.1 · Art. 5 (frugalidad) — la IA se llama 1 vez **por ejercicio**, no por sesión 🔴

`HomeComponent.requestAi()` encola una llamada por ejercicio; `ProgressionService.recommend()` recibe **un
`Exercise`** como parámetro. Un día de 6 ejercicios = **6 llamadas a Groq**, cada una con su prompt completo
(perfil, historial de 5 sesiones, principios de entrenamiento). El Art. 5 y el RF-IA-06 exigen **1 llamada por
sesión finalizada**. Además el contexto va como JSON indentado (`null, 2`), justo lo contrario de la
serialización compacta que pide el mismo artículo. Estimación conservadora: **6–8× el gasto de tokens del
diseño objetivo**.

**Impacto:** es el cambio arquitectónico más grande de la adaptación. Afecta a la firma de `AiProvider` (pasa de
por-ejercicio a por-sesión), a la caché, al momento del disparo (al finalizar, no al expandir) y al prefill (que
pasaría a leer sugerencias precalculadas la sesión anterior). **Tocar esto en T-400/T-403, no antes.**

**Mérito que hay que preservar:** la decisión de que la recomendación del día sea **determinista y estable**
(documentada en el código: "un número que baila sin datos nuevos mata la confianza") es mejor que lo que pide la
spec y **debe sobrevivir** al rediseño.

### 6.2 · Art. 4 (key del usuario) — keys en claro, y dentro del backup 🔴

`AppSettings.apiKey` / `cohereApiKey` se guardan como texto plano en `gym_app_state_v2` y **se exportan en el
backup JSON**. El Art. 4 exige cifrado con WebCrypto. Ver R-8 para la parte de migración.

### 6.3 · Art. 6 (IA con límites duros) — la respuesta se normaliza pero no se acota 🔴

`parseAndNormalizeSets()` valida forma y tipos y redondea al `brick`, pero **no aplica el tope de +10%, no
comprueba `peso > 0` y no consulta lesiones**. El único freno es el cap por descanso largo. Hoy, si Groq
sugiriera 100 → 120 kg, **la app lo mostraría** (EA-3 fallaría). Es una tarea acotada (T-404) sobre una función
que ya existe y ya tiene tests.

### 6.4 · Art. 7 (integridad) — escritura no atómica, validación superficial, sin multi-pestaña 🟠

Tres huecos ya detallados en §3.2 y §5 (R-1, R-2, R-9). Atenuante importante: el espejo IndexedDB + los snapshots
semanales dan una red de seguridad real que muchas apps no tienen. **No es una emergencia, pero es la fundación
de F1 y debe cerrarse antes de reparticionar el almacenamiento.**

---

## 7. Conclusiones para T-001

1. **Stack confirmado: Angular 21.** Reescribir el `plan.md` §1 en consecuencia. Los `[ACLARAR]` 1–4 de
   `spec.md` §8 quedan resueltos en §4 de este documento.
2. **Reutilización real y alta.** 6 vistas cumplen, 21 se adaptan, 11 faltan. El flujo estrella (Art. 8) ya está
   resuelto por encima del diseño y **no debe tocarse salvo para no empeorarlo**.
3. **El trabajo de verdad son tres bloques:** (a) fundaciones de datos `gt_*` con integridad — condicionadas por
   los riesgos R-1/R-2/R-9; (b) el rediseño de la capa IA de por-ejercicio a por-sesión, con presupuesto y
   límites duros (§6.1, §6.3); (c) las vistas ausentes: Rutinas (R1/R4/R7) y Coach (C1–C3).
4. **Cambio de dependencias propuesto en tasks.md:** T-105 y T-101 dejan de ser `[P]` y pasan a ser
   prerrequisitos de T-102 (§5).
5. **Nada que eliminar.** El único candidato con matiz es el shadow logging de IA: se conserva, pero debe entrar
   en la contabilidad de tokens de T-406 o apagarse por defecto.
6. **Decisión de producto pendiente (no técnica):** adoptar o no la paleta naranja del diseño
   (`#FF6A3D` / `#0B0E11`) en lugar de la azul actual. El sistema ya está tokenizado; es cambiar valores.
   No la tomo yo.
