# Tareas — Spec 001 GymTrack AI

> Convenciones: `[P]` = paralelizable con las de su fase · cada tarea cita sus RF · una tarea = un commit/PR pequeño.
> Definición de terminado (DoD) global: cumple constitución, RF citados verificables, tests del Art. 9 verdes si aplica.

## F0 · Auditoría de la app existente (resuelve los [ACLARAR]) — ✅ COMPLETA
- **T-000** ✅ Inventariar stack, estructura, estado y almacenamiento actual de la app; mapear cada pantalla existente contra los IDs de vista (O/H/R/P/C/A/G) y cada funcionalidad contra las checklists §11/§14/§15.4 del análisis. Salida: `audit.md` con columnas [cumple | adaptar | falta | eliminar].
- **T-001** ✅ Con `audit.md`, actualizar los [ACLARAR] de `spec.md` y ajustar `plan.md` (stack definitivo, migración de datos actuales). Gate: sin esto no se implementa nada.
  - Resultado: stack **Angular 21 confirmado**; los 4 [ACLARAR] cerrados en `spec.md` §8; cookie eliminada del alcance; paleta del diseño adoptada conservando alto contraste; F1 reordenada por riesgos (plan §8.1).

## F1 · Fundaciones de datos (RF-STO)

> **Orden obligatorio (plan §8.1, `audit.md` §5):** `T-105 → T-101 → T-100 → T-102 → T-106`.
> T-101 y T-105 **ya no son `[P]`**: migrar sin lock (R-9) o endurecer la validación sin cuarentena (R-2)
> son las dos formas realistas de destruir el historial de un usuario que no tiene backend del que rehidratar.

- **T-105** Detección multi-pestaña con evento `storage`/Web Locks (RF-STO-09). **Prerrequisito de T-102.**
  - AC (R-9): dos contextos abiertos no escriben a la vez; el que no tiene el lock muestra "actualizando datos, recargá" en vez de guardar en formato viejo encima del migrado.
- **T-101** Esquemas + validación en lectura con cuarentena (RF-STO-04). **Prerrequisito de T-100/T-102.**
  - AC (R-2, bloqueante): ante estado inválido, el original se mueve a `gt_quarantine_<timestamp>` y **no se persiste nada encima** hasta que el usuario decida. Prohibido el comportamiento actual (devolver estado inicial y dejar que el `effect` lo guarde sobre el original).
  - AC: la validación comprueba tipos internos, no solo que `days` sea un array.
- **T-100** Implementar `storageAdapter` con escritura atómica y prefijo `gt_` (RF-STO-01/03).
  - AC (R-1): commit multi-clave con journal — escribir con sufijo temporal → validar el conjunto → intercambiar punteros en `gt_meta` → borrar temporales. `gt_meta` versiona el **conjunto**, no cada clave.
- **T-102** `schemaVersion` + framework de migraciones + migración desde el formato actual (RF-STO-07, depende de T-000). Es un paso **v6 → v7** sobre el `migrate()` encadenado existente, no un framework nuevo.
  - AC: **snapshot IDB obligatorio antes de migrar** (reutiliza `writeSnapshot()`); si el snapshot falla, la migración no arranca.
  - AC: toma el lock de T-105 durante toda la migración.
  - AC (R-3): los ejercicios del usuario **conservan su id**; el enlace al catálogo estático es un `catalogRef` por nombre normalizado (`normalizeExerciseName()`, ya probado en v4→v5). Los no mapeados se marcan para resolución manual — no se adivina.
  - AC (R-4): unidades a enum neutro (`KG`, `KG_PER_HAND`, `KG_PER_ARM`, `TIME`, `BODYWEIGHT`); lb solo en presentación, almacenamiento canónico en kg.
  - AC (R-7): la caché de IA se invalida por completo en la migración.
  - AC: los flags `gym_onboarding_done_v1` / `gym_legal_accepted_v1` se migran a `gt_meta` (la cookie queda fuera del alcance, `spec.md` §8).
- **T-103** Export JSON con checksum + Web Share; import con verificación y fusionar/reemplazar (RF-STO-05). Va después de T-100; `[P]` con T-104.
  - AC (R-6): la fusión deduplica por **identidad semántica** (nombre normalizado; fecha + día para sesiones), nunca por id, y remapea los ids del backup entrante cuando colisionan con los locales.
  - AC (R-8, RF-STO-05b): el export **excluye las keys de IA** por defecto, con opción explícita "incluir credenciales" apagada.
- **T-104** Snapshots internos rotativos + medidor de espacio + purga + borrar todo (RF-STO-08). Va después de T-100; `[P]` con T-103.
- **T-106** Tests de la fundación (EA-5, Art. 9).
  - AC: **corte a mitad de la migración multi-clave** deja el estado anterior intacto y recuperable (R-1) — escribir este test **antes** que la migración.
  - AC: **fusión de dos backups con ids coincidentes** no mezcla historiales de ejercicios distintos (R-6).
  - AC: **snapshot de esquema v6 restaurado en v7** pasa por `migrate()` antes de adoptarse (R-7).
  - AC: import corrupto → cuarentena, datos actuales intactos (EA-5).
  - AC: adapter atómico, validador y migraciones con fixtures.

## F2 · Sesión activa — flujo estrella (RF-SES)
- **T-200** Modelo de sesión con persistencia por serie y recuperación de interrumpida (RF-SES-02/07, EA-4).
  - AC (R-5, RF-SES-08b): las sesiones nuevas registran `startedAt`/`endedAt`; ambos son **opcionales** en el modelo porque todo el historial previo a la migración no los tiene.
- **T-201** Vista H2: filas de serie precargadas, steppers, ✓ ≤ 3 taps sin scroll (RF-SES-03, EA-1, Art. 8).
- **T-202** Temporizador de descanso G1: overlay persistente, vibración/sonido, notificación en segundo plano (RF-SES-04) `[P]`.
- **T-203** Acciones en vivo: añadir/quitar/sustituir/notas (RF-SES-05, RF-EJ-04).
- **T-204** Detección de PR en vivo + celebración G2 (RF-SES-06) `[P]`.
- **T-205** Resumen H3 (tonelaje, series, vs. anterior) + hook de fin de sesión (RF-SES-08).
  - AC (R-5, RF-PRO-05): si la sesión comparada no tiene duración (historial previo), el resumen **omite** el dato en vez de mostrar "0 min".
  - AC (RF-IA-06b): el hook de fin de sesión dispara el cálculo de las sugerencias de la **próxima** sesión y las persiste; el usuario no espera por ellas.
- **T-206** Vistas H1 (estados: hoy toca / sin rutina / descanso / reanudar) y H4 (RF-SES-01/07).
- **T-207** Tests de cálculo de tonelaje/PR y prueba de cierre forzado (CE-3).

## F3 · Motor de progresión local (RF-IA-01)
- **T-300** `progresionLocal`: doble progresión, fallos consecutivos, estancamiento→deload, parámetros por nivel (§4.5).
- **T-301** Integrarlo como `LocalRulesProvider` de la interfaz `AIProvider`.
- **T-302** Tests exhaustivos con fixtures de historiales (progreso, meseta, regresión, lesión anotada) — es el corazón sin key (Art. 9).

## F4 · Capa IA (RF-IA)

> **Corrige tres incumplimientos de la constitución ya en producción** (`audit.md` §6, plan §6.1):
> Art. 5 (1 llamada por ejercicio → por sesión), Art. 6 (respuesta sin límites duros), Art. 4 (keys en claro).

- **T-400** Interfaz `AIProvider` + orquestador de cascada con estado visible (RF-IA-02, EA-2).
  - AC (Art. 5, §6.1 del audit): **rediseño por-sesión.** `AIProvider` pasa de recibir un `Exercise` a recibir el contexto de la **sesión completa** y devolver sugerencias para todos sus ejercicios en **1 llamada**. Se elimina la cola por ejercicio de `HomeComponent`.
  - AC (RF-IA-06b): el disparo ocurre **al finalizar la sesión**, calculando la próxima; nunca con el usuario esperando en H2. Sin sugerencia persistida, H2 precarga con la última sesión + motor local y sigue funcionando.
  - AC (RF-IA-06c): se **conserva la estabilidad determinista** actual — registrar series durante el día no recalcula la sugerencia. Solo la invalidan datos nuevos reales o el feedback explícito.
  - AC: la cascada Groq → Cohere → local existente se preserva tal cual (ya cumple EA-2).
- **T-401** Spike: verificar CORS y formato real de Groq y Cohere desde navegador con una key de prueba (riesgo §6 del plan). Gate de la fase.
- **T-402** `GroqProvider` y `CohereProvider` con timeout 15 s, backoff, manejo 401/429 (RF-IA-02) `[P tras T-401]`.
- **T-403** Serializador de contexto compacto versionado + diccionario de abreviaturas (RF-IA-03, CE-4).
  - AC (Art. 5): reemplaza el `JSON.stringify(summary, null, 2)` actual por el formato CSV-like abreviado. El contexto se arma **por sesión** (T-400), no por ejercicio.
  - AC: el prompt deja de depender del idioma del usuario — formato neutro, idioma solo como instrucción de salida para el campo `reason` (`spec.md` §8, [ACLARAR 3]).
  - AC (CE-4): contexto de sugerencia ≤ 1.200 tokens de entrada, verificado con fixtures.
- **T-404** Validador de respuesta: esquema + límites duros ≤10% + respeto de lesiones + 1 reintento (RF-IA-04, EA-3).
  - AC (Art. 6, §6.3 del audit): sobre el `parseAndNormalizeSets()` existente —que hoy valida forma pero **no acota**— añadir **tope de incremento ≤ +10%** sobre la referencia, **`peso > 0`** y **respeto de lesiones declaradas**. Una respuesta fuera de límites se corrige al tope local o cae al motor local; **la sugerencia original nunca se muestra** (EA-3).
  - AC: se conserva el cap por descanso largo ya existente (90%/85% tras 14/28 días) — es acumulativo, no sustituto.
- **T-405** Caché por hash de contexto + candado anti doble-tap (RF-IA-06) `[P]`.
  - AC: el hash cubre el contexto completo, manteniendo la invalidación por fecha, última sesión y perfil que ya existe, sin romper RF-IA-06c.
- **T-406** Contador de `usage` + presupuesto mensual con corte automático (RF-IA-07, EA-6).
  - AC: hoy la respuesta trae `usage` y se descarta; empezar por capturarlo en ambos proveedores.
  - AC (decisión T-001): el **shadow log de IA queda apagado por defecto**; si el usuario lo enciende, sus llamadas cuentan contra el presupuesto como cualquier otra.
- **T-407** Gestión de keys: cifrado WebCrypto, probar conexión, selección proveedor/modelo por tarea — vista A3 (RF-IA-08/09).
  - AC (Art. 4, §6.2 del audit): las keys se guardan **cifradas con WebCrypto**, nunca en claro en el estado.
  - AC (R-8, RF-STO-05b): quedan **excluidas del backup** por defecto, con opción explícita de incluirlas.
  - AC (R-8): aviso único al usuario de que **los backups exportados antes de esta versión contienen su key en texto plano**, con recomendación de rotarla (Art. 10).
- **T-408** Panel C1: aceptar/cambiar/rechazar con persistencia de feedback y reinyección en contexto (RF-IA-05) + historial C3.
- **T-409** Tests: serializador (fixtures + presupuesto de tokens), validador con respuestas malformadas/peligrosas, cascada con providers simulados.

## F5 · Rutinas y generación (RF-RUT, RF-EJ, RF-PER)
- **T-500** Catálogo estático de ejercicios + biblioteca R4 con filtros y custom (RF-EJ-01/02/03) `[P]`.
  - AC (R-3): incluye la tabla de sinónimos ES/EN que usa T-102 para enlazar por `catalogRef`; los ejercicios del usuario que no mapean quedan como custom **sin perder historial** y se listan para resolución manual.
  - AC: licencia del catálogo documentada (§14 del análisis) — hoy no aplica porque no hay catálogo de terceros; al incorporarlo es obligatoria.
- **T-501** CRUD de rutinas R1–R3 + editor de esquema R5 + superseries (RF-RUT-01/02).
- **T-502** Rutina activa con rotación (RF-RUT-04) y plantillas R6 filtradas por perfil (RF-RUT-03).
- **T-503** Generador IA R7: wizard con costo estimado, regenerar por día, revisión obligatoria (RF-RUT-05, usa F4).
- **T-504** Onboarding O1–O6 completo y editable desde A2 (RF-PER-01/02/03).

## F6 · Progreso (RF-PRO)
- **T-600** Módulo `calculos`: e1RM, volumen por grupo, racha, adherencia + tests (RF-PRO-01, Art. 9).
  - AC (R-4): verificar que el tonelaje trata correctamente `KG_PER_HAND` / `KG_PER_ARM` (×2) **antes** de introducir el volumen por grupo muscular, o P1 saldrá mal desde el día uno.
  - AC (R-5, RF-PRO-05): los agregados **omiten** las sesiones sin duración/RPE en vez de imputarles cero.
- **T-601** Vistas P1/P2 con SVG propio, memoización y agregación >200 puntos (RF-PRO-04) `[P]`.
  - AC (R-5, RF-PRO-05): las gráficas distinguen "sin dato" de cero — ningún punto en 0 por una métrica que esa sesión no registró; el tramo sin dato se indica visualmente.
- **T-602** Heatmap P3 + récords P5 (RF-PRO-02) `[P]`.
- **T-603** Cuerpo P4: peso y medidas (RF-PER-04) `[P]`.
- **T-604** Alerta de desequilibrio de volumen (RF-PRO-03).

## F7 · Plataforma y pulido (RF-PWA, RF-HER)
- **T-700** Service worker + manifest + precache; verificación CE-5 con red desactivada (RF-PWA-01).
- **T-701** Wake Lock en sesión + notificaciones locales configurables (RF-PWA-02/03) `[P]`.
- **T-702** Herramientas A6: 1RM, discos con inventario, conversor, timer + tests de discos (RF-HER-01) `[P]`.
- **T-703** Preferencias A5, Acerca de A7 (disclaimer, privacidad, changelog) y recordatorio de backup G3 (RF-STO-06).
- **T-704** Pase mobile-first: zona del pulgar, targets 48 px, safe areas, teclado numérico, medición CE-1/CE-2 en gama media (Art. 1).
- **T-705** Adoptar la paleta del diseño sobre los tokens CSS existentes: acento `#FF6A3D`, fondo `#0B0E11`, superficie `#12161B`, éxito `#3FD68C`, alerta `#FFC24D` (decisión T-001, plan §1) `[P]`.
  - AC: **se conserva el tema de alto contraste** actual, que el diseño no contempla y es accesibilidad.
  - AC: se mantiene la separación semántica vigente — acento = acción (botones, CTA, foco, badge IA), éxito = estado "hecho". No reintroducir el acento para estados completados.
  - AC: contraste verificado en los tres temas (claro, oscuro, alto contraste).

## Convergencia (antes de dar por terminado)
- **T-900** Recorrer EA-1…EA-6 y casos borde §6 de la spec en dispositivo real.
- **T-901** Auditar contra checklists §11, §14 y §15.4 del análisis; toda casilla en rojo genera tarea nueva o enmienda justificada de la spec.
- **T-902** Verificar criterios CE-1…CE-6 y registrar resultados en `convergencia.md`.
