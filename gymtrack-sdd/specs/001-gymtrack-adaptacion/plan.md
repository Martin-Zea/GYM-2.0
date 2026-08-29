# Plan técnico — Spec 001 GymTrack AI

> Derivado de `spec.md` bajo `memory/constitution.md`. Los [ACLARAR] de la spec **quedaron resueltos** por la
> auditoría T-000 (`audit.md`) y cerrados en `spec.md` §8; este plan ya no asume el caso general.

## 1. Stack — **CONFIRMADO por T-000: Angular 21**
- **Regla de oro (brownfield):** conservar el stack de la app existente salvo que viole la constitución. No se reescribe por gusto. **La auditoría confirma que no lo viola: se conserva.**
- **Angular 21.2** standalone + signals (`signal`/`computed`/`effect`, `input()`/`output()`, `@if`/`@for`, OnPush en todos los componentes, `inject()`), **TypeScript 5.9 strict** (ES2022), build `@angular/build`. Descartada la alternativa Vite + Preact: tirar 9.9k líneas probadas para ganar ~40 KB sobre un presupuesto que ya sobra (~138 KB gzip de carga inicial, techo CE-2 = 300 KB).
- **Estilos:** SCSS propio con CSS custom properties, sin framework de UI (Art. 1, CE-2). Se **adopta la paleta del diseño** — fondo `#0B0E11`, superficie `#12161B`, acento `#FF6A3D`, éxito `#3FD68C`, alerta `#FFC24D` — sobre el sistema de tokens ya existente, **conservando el tema de alto contraste** actual (accesibilidad; el diseño no lo contempla). Se mantiene la separación semántica vigente: acento = acción, éxito = estado "hecho".
  - *Pendiente no bloqueante:* el diseño propone Barlow / Barlow Condensed; hoy hay Inter + JetBrains Mono self-hosted (cero CDN, ya conforme a §14). Cambiar de tipografía es una decisión de producto abierta, no un requisito de esta fase.
- **PWA:** ya existe — `@angular/service-worker` + `ngsw-config.json` + `manifest.webmanifest`. Falta añadir al precache el catálogo estático de ejercicios (T-500, T-700).
- **Tests:** Vitest 4, ya en uso (98 tests verdes) para las unidades del dominio (Art. 9). El smoke E2E existente (`npm run e2e`, Edge) cubre el flujo sagrado; se extiende para EA-1/EA-4.

## 2. Arquitectura por capas (dependencias solo hacia abajo)
```
UI (vistas O/H/R/P/C/A + overlays G)
  └─ Dominio: progresionLocal.ts · calculos.ts (e1RM, volumen, PR, discos)
  │           sesion.ts · rutinas.ts · presupuestoIA.ts
  ├─ IA: AIProvider (interfaz) ← GroqProvider · CohereProvider · LocalRulesProvider
  │      serializadorContexto.ts (compacto CSV-like) · validadorRespuesta.ts · cacheIA.ts
  └─ Storage: storageAdapter (get/set atómico, validación, migraciones, snapshots, locks)
              └─ localStorage hoy · IndexedDB mañana (misma interfaz)
```
- La UI nunca toca localStorage ni fetch de IA directamente (Art. 4, Art. 7).
- `LocalRulesProvider` implementa la misma interfaz que los proveedores remotos: la cascada es una lista ordenada de providers.

## 3. Modelo de datos (claves `gt_*`)
`gt_meta` (schemaVersion del **conjunto**, punteros de commit, contadores backup, flags de onboarding/legal) · `gt_profile` · `gt_settings` · `gt_exercises_custom` · `gt_routines` · `gt_sessions` (particionar por año si crece: `gt_sessions_2026`) · `gt_body` · `gt_ai` (keys cifradas, caché, feedback, uso de tokens).
Esquemas y ejemplo de sesión: §5 del análisis. Pesos siempre canónicos en kg; lb solo en presentación.

**Punto de partida real (T-000):** no se parte de cero. Hoy existe **un blob único** `gym_app_state_v2`
(`schemaVersion: 6`) + 9 claves `gym_*`, espejado en IndexedDB con snapshots semanales, y un framework de
migraciones encadenadas v1→v6 con tests de fixtures. La migración a `gt_*` es un paso **v6 → v7** sobre ese
framework. Consecuencias que el modelo nuevo debe absorber (`audit.md` §5):
- Unidades: pasar de literales en español a enum neutro (`KG`, `KG_PER_HAND`, `KG_PER_ARM`, `TIME`, `BODYWEIGHT`); lb solo en presentación (R-4).
- Ejercicios: **nunca reasignar el id del usuario**; enlazar al catálogo estático con `catalogRef` (R-3).
- Sesiones: `startedAt`/`endedAt` y RPE por serie son **opcionales**, ausentes en todo el historial previo (R-5, RF-PRO-05).

## 4. Decisiones y su porqué
| Decisión | Motivo |
|---|---|
| localStorage con adapter, no cookies | 4 KB/cookie no alcanza (§2.1); adapter permite migrar a IndexedDB sin tocar dominio |
| Cascada de providers como lista | RF-IA-02 se vuelve un `for` sobre providers; agregar proveedor = 1 clase nueva |
| Sugerencias al finalizar sesión, no en vivo | RF-IA-06/Art. 5: 1 llamada por sesión; en vivo sería 1 por ejercicio |
| Serialización CSV-like versionada | Art. 5: 60–75% menos tokens; versionar el formato para poder cambiarlo |
| Validación con esquema (Zod o equivalente ligero) en storage e IA | RF-STO-04, RF-IA-04: una sola herramienta para ambos bordes |
| Cálculo de gráficas memoizado + agregación semanal | RF-PRO-04, CE-2 |
| Catálogo de ejercicios como JSON estático empaquetado | No consume localStorage; se precachea con el SW |

## 5. Contratos clave
- **AIProvider:** `sugerirProgresion(ctx) → SugerenciasSesion` · `generarRutina(perfil) → RutinaPropuesta` · `analizarSemana(ctx)` · `probarConexion(key)`. Todos devuelven `{ok, data?, error?, usage?}`; nunca lanzan a la UI.
- **SugerenciasSesion (validado):** por ejercicio `{accion: subir|mantener|bajar|deload|sustituir, nuevoPeso?, nuevoEsquema?, razon(≤140 chars)}` + `alertas[]`.
- **storageAdapter:** `read(key)` valida y migra · `write(key, data)` atómico · `snapshot()` · `export()/import(file, modo)` con checksum.

## 6. Riesgos técnicos y respuesta
CORS de Groq/Cohere desde navegador → verificar en T-401 antes de construir encima; si un proveedor bloquea, documentar y priorizar el otro. · Límite de localStorage → compresión LZ-string detrás del adapter cuando uso > 60%. · Deriva del formato compacto ↔ prompt → tests de serialización con fixtures (Art. 9).

**Riesgos de migración de datos vivos (T-000, `audit.md` §5).** Hay usuarios con historial irrecuperable: no hay
backend del que rehidratar. Los dos altos condicionan el orden de F1:
- **R-1 (alto) · atomicidad.** Partir el blob en 8 claves pierde la atomicidad que hoy da un solo `setItem`. El adapter hace commit multi-clave con journal: escribir con sufijo temporal → validar el conjunto → intercambiar punteros en `gt_meta` → borrar temporales.
- **R-2 (alto) · cuarentena antes que validación estricta.** Hoy, ante estado inválido `load()` devuelve el estado inicial **y el `effect` lo persiste encima del original**: un bug de validación borraría el historial en el primer render. La cuarentena (`gt_quarantine_<ts>`, sin escribir nada encima) debe existir **antes** de endurecer el validador y antes de migrar.
- R-3 catálogo sin metadatos · R-4 unidades en español sin lb · R-5 historial sin duración/RPE · R-6 ids de 7 chars colisionables al fusionar · R-7 caché IA y snapshots huérfanos · R-8 keys en claro dentro de backups viejos · R-9 dos pestañas migrando a la vez.

## 6.1 Correcciones de constitución detectadas en producción (`audit.md` §6)
Cuatro incumplimientos ya existentes, con su tarea asignada:
| Art. | Incumplimiento | Se corrige en |
|---|---|---|
| **5** | La IA se llama **1 vez por ejercicio**, no por sesión, y con JSON indentado (≈6–8× el gasto objetivo) | T-400 + T-403 |
| **4** | Keys en texto plano y exportadas dentro del backup | T-407 (+ RF-STO-05b) |
| **6** | La respuesta IA se normaliza pero no se acota: sin tope +10%, sin `peso > 0`, sin lesiones | T-404 |
| **7** | Escritura no atómica, validación superficial, sin multi-pestaña | T-100 / T-101 / T-105 |

## 7. Qué NO hacer
No agregar backend "chiquito". No llamar a la IA por ejercicio. No guardar fotos. No usar librerías de gráficas pesadas (SVG propio o lib < 15 KB). No bloquear ningún flujo por falta de IA. No romper el presupuesto de 3 taps de la sesión activa. **No hacer esperar al usuario en H2 por una respuesta de IA** (RF-IA-06b): la sugerencia se calcula al finalizar la sesión anterior. **No reescribir lo que ya cumple** — el flujo H1→H2→G1, la cascada de providers, el motor local y las migraciones existentes se extienden, no se rehacen. **No migrar sin snapshot previo ni sin lock.**

## 8. Orden de fases (detalle en tasks.md)
F0 auditoría de la app existente ✅ (T-000/T-001) → F1 storage/base → F2 sesión activa → F3 motor local → F4 capa IA → F5 rutinas+IA → F6 progreso → F7 PWA/pulido → Convergencia contra checklists §11/§14/§15.4.

### 8.1 F1 reordenada por los riesgos de migración (`audit.md` §5)
El `[P]` original de T-101 y T-105 se retira: **son prerrequisitos**, no trabajo paralelo. Migrar sin lock
(R-9) o endurecer la validación sin cuarentena (R-2) son las dos formas realistas de destruir datos de usuario.

```
  T-105  locks multi-pestaña (R-9)            ─┐
                                               ├─→  T-100  adapter atómico  ─→  T-102  migración v6 → gt_*
  T-101  validación + CUARENTENA (R-2)        ─┘         commit multi-clave           · snapshot IDB OBLIGATORIO antes
         nada se persiste encima del original            con journal (R-1)            · toma el lock de T-105
                                                                                      · invalida la caché de IA (R-7)
                                                                                                 │
                                                                                                 ▼
                                                                              T-106  tests de la fundación
                                                                              · corte a mitad de la migración (R-1)
                                                                              · fusión con ids colisionados (R-6)
                                                                              · snapshot v6 restaurado en v7 (R-7)
                                                                              · import corrupto → cuarentena (EA-5)

  T-103 (export/import) y T-104 (snapshots/espacio/purga) van después de T-100; siguen paralelizables entre sí.
```
