# Plan técnico — Spec 001 GymTrack AI

> Derivado de `spec.md` bajo `memory/constitution.md`. Los [ACLARAR] de la spec deben resolverse
> auditando la app existente (T-000) antes de implementar; este plan asume el caso general.

## 1. Stack
- **Regla de oro (brownfield):** conservar el stack de la app existente salvo que viole la constitución. No se reescribe por gusto.
- Si hay que elegir: **Vite + Preact (o React) + TypeScript**, CSS propio con variables (tokens del diseño: fondo #0B0E11, superficie #12161B, acento #FF6A3D, éxito #3FD68C, alerta #FFC24D; Barlow / Barlow Condensed). Sin frameworks de UI pesados (Art. 1, CE-2).
- PWA: `manifest.webmanifest` + service worker (Workbox o manual) con precache del shell y catálogo de ejercicios.
- Tests: Vitest para unidades del dominio (Art. 9). Playwright opcional para EA-1/EA-4.

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
`gt_meta` (schemaVersion, contadores backup) · `gt_profile` · `gt_settings` · `gt_exercises_custom` · `gt_routines` · `gt_sessions` (particionar por año si crece: `gt_sessions_2026`) · `gt_body` · `gt_ai` (keys cifradas, caché, feedback, uso de tokens).
Esquemas y ejemplo de sesión: §5 del análisis. Pesos siempre canónicos en kg; lb solo en presentación.

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

## 7. Qué NO hacer
No agregar backend "chiquito". No llamar a la IA por ejercicio. No guardar fotos. No usar librerías de gráficas pesadas (SVG propio o lib < 15 KB). No bloquear ningún flujo por falta de IA. No romper el presupuesto de 3 taps de la sesión activa.

## 8. Orden de fases (detalle en tasks.md)
F0 auditoría de la app existente → F1 storage/base → F2 sesión activa → F3 motor local → F4 capa IA → F5 rutinas+IA → F6 progreso → F7 PWA/pulido → Convergencia contra checklists §11/§14/§15.4.
