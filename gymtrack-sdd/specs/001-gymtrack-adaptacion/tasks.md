# Tareas — Spec 001 GymTrack AI

> Convenciones: `[P]` = paralelizable con las de su fase · cada tarea cita sus RF · una tarea = un commit/PR pequeño.
> Definición de terminado (DoD) global: cumple constitución, RF citados verificables, tests del Art. 9 verdes si aplica.

## F0 · Auditoría de la app existente (resuelve los [ACLARAR]) — ✅ COMPLETA

- **T-000** ✅ Inventariar stack, estructura, estado y almacenamiento actual de la app; mapear cada pantalla existente contra los IDs de vista (O/H/R/P/C/A/G) y cada funcionalidad contra las checklists §11/§14/§15.4 del análisis. Salida: `audit.md` con columnas [cumple | adaptar | falta | eliminar].
- **T-001** ✅ Con `audit.md`, actualizar los [ACLARAR] de `spec.md` y ajustar `plan.md` (stack definitivo, migración de datos actuales). Gate: sin esto no se implementa nada.
  - Resultado: stack **Angular 21 confirmado**; los 4 [ACLARAR] cerrados en `spec.md` §8; cookie eliminada del alcance; paleta del diseño adoptada conservando alto contraste; F1 reordenada por riesgos (plan §8.1).

## F1 · Fundaciones de datos (RF-STO) — ✅ COMPLETA

> **Orden obligatorio (plan §8.1, `audit.md` §5):** `T-105 → T-101 → T-100 → T-102 → T-106`.
> T-101 y T-105 **ya no son `[P]`**: migrar sin lock (R-9) o endurecer la validación sin cuarentena (R-2)
> son las dos formas realistas de destruir el historial de un usuario que no tiene backend del que rehidratar.

- **T-105** ✅ Detección multi-pestaña con evento `storage`/Web Locks (RF-STO-09). **Prerrequisito de T-102.**
  - AC (R-9): dos contextos abiertos no escriben a la vez; el que no tiene el lock muestra "actualizando datos, recargá" en vez de guardar en formato viejo encima del migrado.
- **T-101** ✅ Esquemas + validación en lectura con cuarentena (RF-STO-04). **Prerrequisito de T-100/T-102.**
  - AC (R-2, bloqueante): ante estado inválido, el original se mueve a `gt_quarantine_<timestamp>` y **no se persiste nada encima** hasta que el usuario decida. Prohibido el comportamiento actual (devolver estado inicial y dejar que el `effect` lo guarde sobre el original).
  - AC: la validación comprueba tipos internos, no solo que `days` sea un array.
- **T-100** ✅ Implementar `storageAdapter` con escritura atómica y prefijo `gt_` (RF-STO-01/03).
  - AC (R-1): commit multi-clave con journal — escribir con sufijo temporal → validar el conjunto → intercambiar punteros en `gt_meta` → borrar temporales. `gt_meta` versiona el **conjunto**, no cada clave.
- **T-102** ✅ `schemaVersion` + framework de migraciones + migración desde el formato actual (RF-STO-07, depende de T-000). Es un paso **v6 → v7** sobre el `migrate()` encadenado existente, no un framework nuevo.
  - AC: **snapshot IDB obligatorio antes de migrar** (reutiliza `writeSnapshot()`); si el snapshot falla, la migración no arranca.
  - AC: toma el lock de T-105 durante toda la migración.
  - AC (R-3): los ejercicios del usuario **conservan su id**; el enlace al catálogo estático es un `catalogRef` por nombre normalizado (`normalizeExerciseName()`, ya probado en v4→v5). Los no mapeados se marcan para resolución manual — no se adivina.
  - AC (R-4): unidades a enum neutro (`KG`, `KG_PER_HAND`, `KG_PER_ARM`, `TIME`, `BODYWEIGHT`); lb solo en presentación, almacenamiento canónico en kg.
  - AC (R-7): la caché de IA se invalida por completo en la migración.
  - AC: los flags `gym_onboarding_done_v1` / `gym_legal_accepted_v1` se migran a `gt_meta` (la cookie queda fuera del alcance, `spec.md` §8).
- **T-103** ✅ Export JSON con checksum + Web Share; import con verificación y fusionar/reemplazar (RF-STO-05). Va después de T-100; `[P]` con T-104.
  - AC (R-6): la fusión deduplica por **identidad semántica** (nombre normalizado; fecha + día para sesiones), nunca por id, y remapea los ids del backup entrante cuando colisionan con los locales.
  - AC (R-8, RF-STO-05b): el export **excluye las keys de IA** por defecto, con opción explícita "incluir credenciales" apagada.
- **T-104** ✅ Snapshots internos rotativos + medidor de espacio + purga + borrar todo (RF-STO-08). Va después de T-100; `[P]` con T-103.
- **T-106** ✅ Tests de la fundación (EA-5, Art. 9).
  - AC: **corte a mitad de la migración multi-clave** deja el estado anterior intacto y recuperable (R-1) — escribir este test **antes** que la migración.
  - AC: **fusión de dos backups con ids coincidentes** no mezcla historiales de ejercicios distintos (R-6).
  - AC: **snapshot de esquema v6 restaurado en v7** pasa por `migrate()` antes de adoptarse (R-7).
  - AC: import corrupto → cuarentena, datos actuales intactos (EA-5).
  - AC: adapter atómico, validador y migraciones con fixtures.

> **Resultado F1:** `schemaVersion: 7` y almacenamiento particionado `gt_*` con commit por journal;
> validación en dos niveles (tolerante antes de migrar, estricta después) con cuarentena; lock multi-pestaña;
> backup con checksum y fusión por identidad semántica; medidor de espacio y purga. R-1…R-9 cerradas.
> `catalogRef` (R-3) queda deliberadamente sin poblar hasta T-500, que aporta el catálogo y los sinónimos.

## F2 · Sesión activa — flujo estrella (RF-SES) — ✅ COMPLETA

- **T-200** ✅ Modelo de sesión con persistencia por serie y recuperación de interrumpida (RF-SES-02/07, EA-4).
  - AC (R-5, RF-SES-08b): las sesiones nuevas registran `startedAt`/`endedAt`; ambos son **opcionales** en el modelo porque todo el historial previo a la migración no los tiene.
- **T-201** ✅ Vista H2: filas de serie precargadas, steppers, ✓ ≤ 3 taps sin scroll (RF-SES-03, EA-1, Art. 8).
- **T-202** ✅ Temporizador de descanso G1: overlay persistente, vibración/sonido, notificación en segundo plano (RF-SES-04) `[P]`.
- **T-203** ✅ Acciones en vivo: añadir/quitar/sustituir/notas (RF-SES-05, RF-EJ-04).
- **T-204** ✅ Detección de PR en vivo + celebración G2 (RF-SES-06) `[P]`.
- **T-205** ✅ Resumen H3 (tonelaje, series, vs. anterior) + hook de fin de sesión (RF-SES-08).
  - AC (R-5, RF-PRO-05): si la sesión comparada no tiene duración (historial previo), el resumen **omite** el dato en vez de mostrar "0 min".
  - AC (RF-IA-06b): el hook de fin de sesión dispara el cálculo de las sugerencias de la **próxima** sesión y las persiste; el usuario no espera por ellas.
- **T-206** ✅ Vistas H1 (estados: hoy toca / sin rutina / descanso / reanudar) y H4 (RF-SES-01/07).
- **T-207** ✅ Tests de cálculo de tonelaje/PR y prueba de cierre forzado (CE-3).

> **Resultado F2:** la sesión registra `startedAt`/`endedAt` (opcionales: el historial previo no los tiene)
> y ofrece reanudar/finalizar/descartar si quedó abierta. Nueva vista H3 con tonelaje, series, PRs y
> comparación con la vez anterior, que **omite** lo que la sesión no registró en vez de mostrar cero (R-5).
> Récords de peso, reps al mismo peso y e1RM. Acciones en vivo: añadir/quitar series y ejercicios solo por
> hoy, y notas por serie/ejercicio/sesión. El descanso sobrevive a que el SO mate la PWA.
> El hook de fin de sesión ya deja calculadas las sugerencias de la próxima (RF-IA-06b); T-400 sustituye
> el motor detrás por UNA llamada por sesión (Art. 5) sin tocar el punto de enganche.

## F3 · Motor de progresión local (RF-IA-01) — ✅ COMPLETA

- **T-300** ✅ `progresionLocal`: doble progresión, fallos consecutivos, estancamiento→deload, parámetros por nivel (§4.5).
- **T-301** ✅ Integrarlo como `LocalRulesProvider` de la interfaz `AIProvider`.
- **T-302** ✅ Tests exhaustivos con fixtures de historiales (progreso, meseta, regresión, lesión anotada) — es el corazón sin key (Art. 9).

> **Resultado F3:** reglas extraídas a `providers/progression-rules.ts` (puro, sin Angular) con la tabla
> de parámetros por nivel de §3. Nuevo: fallos consecutivos → bajar 5–10%, estancamiento → descarga, y
> la puerta de RPE de §4.5 (una sesión marcada "pesada" bloquea la subida aunque salgan las reps).
> `UserProfile.level` (`schemaVersion: 8`, v7→v8) editable en `/profile`; el onboarding O3 sigue en T-504.
> El provider conserva el nombre `LocalProvider` en vez de `LocalRulesProvider`: ya implementa
> `AiProvider` y renombrarlo solo movería imports.

## F4 · Capa IA (RF-IA) — ✅ COMPLETA (T-401 pendiente de verificación con key real)

> **Corrige tres incumplimientos de la constitución ya en producción** (`audit.md` §6, plan §6.1):
> Art. 5 (1 llamada por ejercicio → por sesión), Art. 6 (respuesta sin límites duros), Art. 4 (keys en claro).

- **T-400** ✅ Interfaz `AIProvider` + orquestador de cascada con estado visible (RF-IA-02, EA-2).
  - AC (Art. 5, §6.1 del audit): **rediseño por-sesión.** `AIProvider` pasa de recibir un `Exercise` a recibir el contexto de la **sesión completa** y devolver sugerencias para todos sus ejercicios en **1 llamada**. Se elimina la cola por ejercicio de `HomeComponent`.
  - AC (RF-IA-06b): el disparo ocurre **al finalizar la sesión**, calculando la próxima; nunca con el usuario esperando en H2. Sin sugerencia persistida, H2 precarga con la última sesión + motor local y sigue funcionando.
  - AC (RF-IA-06c): se **conserva la estabilidad determinista** actual — registrar series durante el día no recalcula la sugerencia. Solo la invalidan datos nuevos reales o el feedback explícito.
  - AC: la cascada Groq → Cohere → local existente se preserva tal cual (ya cumple EA-2).
- **T-401** ⚠️ Spike: verificar CORS y formato real de Groq y Cohere desde navegador con una key de prueba (riesgo §6 del plan). Gate de la fase.
- **T-402** ✅ `GroqProvider` y `CohereProvider` con timeout 15 s, backoff, manejo 401/429 (RF-IA-02) `[P tras T-401]`.
- **T-403** ✅ Serializador de contexto compacto versionado + diccionario de abreviaturas (RF-IA-03, CE-4).
  - AC (Art. 5): reemplaza el `JSON.stringify(summary, null, 2)` actual por el formato CSV-like abreviado. El contexto se arma **por sesión** (T-400), no por ejercicio.
  - AC: el prompt deja de depender del idioma del usuario — formato neutro, idioma solo como instrucción de salida para el campo `reason` (`spec.md` §8, [ACLARAR 3]).
  - AC (CE-4): contexto de sugerencia ≤ 1.200 tokens de entrada, verificado con fixtures.
- **T-404** ✅ Validador de respuesta: esquema + límites duros ≤10% + respeto de lesiones + 1 reintento (RF-IA-04, EA-3).
  - AC (Art. 6, §6.3 del audit): sobre el `parseAndNormalizeSets()` existente —que hoy valida forma pero **no acota**— añadir **tope de incremento ≤ +10%** sobre la referencia, **`peso > 0`** y **respeto de lesiones declaradas**. Una respuesta fuera de límites se corrige al tope local o cae al motor local; **la sugerencia original nunca se muestra** (EA-3).
  - AC: se conserva el cap por descanso largo ya existente (90%/85% tras 14/28 días) — es acumulativo, no sustituto.
- **T-405** ✅ Caché por hash de contexto + candado anti doble-tap (RF-IA-06) `[P]`.
  - AC: el hash cubre el contexto completo, manteniendo la invalidación por fecha, última sesión y perfil que ya existe, sin romper RF-IA-06c.
- **T-406** ✅ Contador de `usage` + presupuesto mensual con corte automático (RF-IA-07, EA-6).
  - AC: hoy la respuesta trae `usage` y se descarta; empezar por capturarlo en ambos proveedores.
  - AC (decisión T-001): el **shadow log de IA queda apagado por defecto**; si el usuario lo enciende, sus llamadas cuentan contra el presupuesto como cualquier otra.
- **T-407** ✅ Gestión de keys: cifrado WebCrypto, probar conexión, selección proveedor/modelo por tarea — vista A3 (RF-IA-08/09).
  - AC (Art. 4, §6.2 del audit): las keys se guardan **cifradas con WebCrypto**, nunca en claro en el estado.
  - AC (R-8, RF-STO-05b): quedan **excluidas del backup** por defecto, con opción explícita de incluirlas.
  - AC (R-8): aviso único al usuario de que **los backups exportados antes de esta versión contienen su key en texto plano**, con recomendación de rotarla (Art. 10).
- **T-408** ✅ Panel C1: aceptar/cambiar/rechazar con persistencia de feedback y reinyección en contexto (RF-IA-05) + historial C3.
- **T-409** ✅ Tests: serializador (fixtures + presupuesto de tokens), validador con respuestas malformadas/peligrosas, cascada con providers simulados.

> **Resultado F4:** los tres incumplimientos de la constitución quedan cerrados. Art. 5: UNA llamada por
> sesión (`AiSessionProvider`), eliminada la cola por ejercicio de `HomeComponent`. Art. 6: `session-response.ts`
> acota toda respuesta (≤+10%, peso>0, lesiones y sensación "pesada" bloquean subir) y lo no corregible cae
> al motor local. Art. 4: las keys se cifran con AES-GCM y la clave vive en IndexedDB como `CryptoKey` NO
> extraíble; en el estado solo queda texto cifrado.
> Contexto CSV-like neutro de idioma con presupuesto de 1.200 tokens verificado, caché por hash de contexto,
> candado anti doble-tap, contador de consumo con corte por presupuesto, prueba de conexión, selección de
> modelo, y panel C1 (aceptar/cambiar/rechazar) con el feedback reinyectado en el contexto + historial C3.
> **T-401 sigue abierta**: verificar CORS y formato reales exige una key de prueba que solo tiene el usuario.

## F5 · Rutinas y generación (RF-RUT, RF-EJ, RF-PER) — ✅ COMPLETA

- **T-500** ✅ Catálogo estático de ejercicios + biblioteca R4 con filtros y custom (RF-EJ-01/02/03) `[P]`.
  - AC (R-3): incluye la tabla de sinónimos ES/EN que usa T-102 para enlazar por `catalogRef`; los ejercicios del usuario que no mapean quedan como custom **sin perder historial** y se listan para resolución manual.
  - AC: licencia del catálogo documentada (§14 del análisis) — hoy no aplica porque no hay catálogo de terceros; al incorporarlo es obligatoria.
- **T-501** ✅ CRUD de rutinas R1–R3 + editor de esquema R5 + superseries (RF-RUT-01/02).
- **T-502** ✅ Rutina activa con rotación (RF-RUT-04) y plantillas R6 filtradas por perfil (RF-RUT-03).
- **T-503** ✅ Generador IA R7: wizard con costo estimado, regenerar por día, revisión obligatoria (RF-RUT-05, usa F4).
- **T-504** ✅ Onboarding O1–O6 completo y editable desde A2 (RF-PER-01/02/03).

> **Resultado F5:** catálogo estático de ~60 ejercicios en el bundle con grupo, equipo, patrón y sinónimos
> ES/EN; la migración v8→v9 puebla `catalogRef` por nombre normalizado y deja sin enlazar lo que no mapea
> (R-3 cerrada). Biblioteca R4 con filtros dentro del editor, sustitutos por patrón de movimiento, y
> archivado que conserva el historial. Nuevo contenedor `Routine` (v9→v10) con CRUD, duplicado por copia y
> rotación por rutina activa; esquema con rango de reps, RPE objetivo, dropset/AMRAP y superseries que de
> verdad se saltan el descanso. Plantillas R6 filtradas por perfil con vista previa, generador R7 con coste
> estimado antes de llamar y revisión obligatoria, y onboarding O1–O6 con todos los pasos omitibles.

## F6 · Progreso (RF-PRO) — ✅ COMPLETA

- **T-600** ✅ Módulo `calculos`: e1RM, volumen por grupo, racha, adherencia + tests (RF-PRO-01, Art. 9).
  - AC (R-4): verificar que el tonelaje trata correctamente `KG_PER_HAND` / `KG_PER_ARM` (×2) **antes** de introducir el volumen por grupo muscular, o P1 saldrá mal desde el día uno.
  - AC (R-5, RF-PRO-05): los agregados **omiten** las sesiones sin duración/RPE en vez de imputarles cero.
- **T-601** ✅ Vistas P1/P2 con SVG propio, memoización y agregación >200 puntos (RF-PRO-04) `[P]`.
  - AC (R-5, RF-PRO-05): las gráficas distinguen "sin dato" de cero — ningún punto en 0 por una métrica que esa sesión no registró; el tramo sin dato se indica visualmente.
- **T-602** ✅ Heatmap P3 + récords P5 (RF-PRO-02) `[P]`.
- **T-603** ✅ Cuerpo P4: peso y medidas (RF-PER-04) `[P]`.
- **T-604** ✅ Alerta de desequilibrio de volumen (RF-PRO-03).

> **Resultado F6:** `utils/stats.ts` con e1RM, volumen por grupo, adherencia y agregación semanal. El AC de
> R-4 se cumplió ANTES del volumen por grupo y de paso se unificó la fórmula: `weeklyStats()` e
> `historyForExercise()` ya aplican el factor de unidad, así que el volumen de quien entrena con mancuernas
> sube al actualizar — es una corrección, no un cambio de criterio.
> R-5 respetada en toda la fase: las sesiones sin la métrica se EXCLUYEN del trazo y se avisa de cuántas
> faltan, la duración media las omite, y la adherencia sin plan declarado devuelve `null`. Heatmap por
> tonelaje, agregación semanal por encima de 200 puntos, alerta de desequilibrio y medidas corporales.

## F7 · Plataforma y pulido (RF-PWA, RF-HER) — ✅ COMPLETA

- **T-700** ✅ Service worker + manifest + precache; verificación CE-5 con red desactivada (RF-PWA-01).
- **T-701** ✅ Wake Lock en sesión + notificaciones locales configurables (RF-PWA-02/03) `[P]`.
- **T-702** ✅ Herramientas A6: 1RM, discos con inventario, conversor, timer + tests de discos (RF-HER-01) `[P]`.
- **T-703** ✅ Preferencias A5, Acerca de A7 (disclaimer, privacidad, changelog) y recordatorio de backup G3 (RF-STO-06).
- **T-704** ✅ Pase mobile-first: zona del pulgar, targets 48 px, safe areas, teclado numérico, medición CE-1/CE-2 en gama media (Art. 1).
- **T-705** ✅ Adoptar la paleta del diseño sobre los tokens CSS existentes: acento `#FF6A3D`, fondo `#0B0E11`, superficie `#12161B`, éxito `#3FD68C`, alerta `#FFC24D` (decisión T-001, plan §1) `[P]`.
  - AC: **se conserva el tema de alto contraste** actual, que el diseño no contempla y es accesibilidad.
  - AC: se mantiene la separación semántica vigente — acento = acción (botones, CTA, foco, badge IA), éxito = estado "hecho". No reintroducir el acento para estados completados.
  - AC: contraste verificado en los tres temas (claro, oscuro, alto contraste).

> **Resultado F7:** herramientas A6 completas (1RM con tabla de porcentajes, discos, conversor y
> temporizador libre, separado del descanso de la sesión), preferencias A5 con unidades kg/lb y permiso de
> notificaciones pedido desde un gesto explícito, y Acerca de A7 con disclaimer y privacidad visibles.
> Paleta del diseño aplicada conservando el tema de alto contraste y la separación semántica; el contraste
> de los tres temas está VERIFICADO POR TEST, y ese test destapó un fallo de accesibilidad anterior
> (blanco sobre el verde del tema claro daba 3,39:1). El smoke E2E comprueba ahora targets de 44 px y
> ausencia de scroll horizontal a 390 px.
> **Parcial:** el recordatorio de entrenamiento con la app cerrada (RF-PWA-03) no se implementa: sin push
> ni Notification Triggers no hay forma de despertar la app, y fingirlo con un timer sería mentir.
> El resto de notificaciones (fin de descanso en segundo plano, backup) sí funcionan.

## F8 · Aplicar el diseño completo (`docs/disenos-vistas-gym.html`)

Las 31 pantallas del diseño, en tres capas: tipografía y componentes, la navegación de 5 tabs, y
el Coach con chat (que exige relajar el Art. 5 de forma acotada, ver T-804).

- **T-800** ✅ Tipografía Barlow (cuerpo) + Barlow Condensed (display y números), autoalojada.
  - AC: solo subsets `latin` y `latin-ext` — la UI es ES/EN; los subsets cirílico, griego y vietnamita que
    arrastraba Inter eran peso muerto en el arranque (CE-2).
  - AC: sin peso 500 (22 kB menos); a 9–11 px no se distingue del 600.
  - AC: JetBrains Mono desaparece — los números tabulares los da el display condensado.
- **T-801** ✅ Primitivas del sistema de diseño en `styles.scss`: `.card`/`.card--hi`, `.chip` (+ accent/ok/warn),
  `.seg`, `.li`, `.k`, `.num`, `.big-t`, `.note`, `.stat-grid`, `.sr-only`.
  - AC: viven en global, no en cada componente: una tarjeta tiene que ser la MISMA en Hoy, Rutinas y Coach.
  - AC: los segmentados son `<button>` reales, no `<span>` como los dibuja el diseño: se navegan con teclado.
- **T-802** ✅ Navegación de 5 tabs: Hoy · Rutinas · Progreso · Coach · Ajustes.
  - AC: Ajustes deja de ser un bottom sheet y pasa a ruta navegable; el perfil cuelga de Ajustes, no de la barra.
  - AC: `/history`, `/charts` y `/calendar` siguen redirigiendo (bookmarks y accesos directos de la PWA).
  - AC: `IconName` pasa a ser un tipo: un icono mal escrito ahora falla en compilación en vez de renderizar un hueco.
- **T-803** ✅ Tab Rutinas con R1 (lista), R2 (detalle), R6 (plantillas) y R7 (generador) bajo una ruta.
  - AC: Inicio DEJA de duplicar la gestión de rutinas — H1 es una sola decisión (226 líneas de TS y 150 de CSS muertas, eliminadas).
- **T-804** ✅ Tab Coach: C1 (aceptar/cambiar/rechazar con presupuesto a la vista), C2 (chat) y C3 (historial de feedback).
  - AC: el Art. 5 se relaja SOLO para el chat, y con techos: una llamada por mensaje escrito por una persona,
    ventana de 6 mensajes de contexto, respuesta acotada a 400 tokens y el MISMO presupuesto mensual que la
    progresión, con corte al agotarlo. La progresión automática sigue en una llamada por sesión.
  - AC: sin key, sin conexión o sin presupuesto el chat se deshabilita CON EXPLICACIÓN (RF-IA-10); el resto de la app no cambia.
  - AC: el panel C1 nunca llama a la red al abrirse: lee lo precalculado o el motor local.
  - AC: la conversación vive en `gt_coach_chat` y NO viaja en los backups: restaurar una copia no debe resucitar charlas viejas.
- **T-805** ✅ Ajustes como tab (A1): menú de 6 filas con el estado de cada una; el sheet se acota por sección (A3, A4, A5, A7).
- **T-806** ✅ H1 según el diseño: título del día en display condensado, tarjetas de racha y sesiones del mes, y último PR.
- **T-807** ✅ P1: adherencia (contra los días de la rutina activa) y duración media, ambas `null` cuando no hay con qué calcularlas (R-5).

> **Resultado F8:** el diseño está aplicado en sus tres capas. Paleta y tipografía en toda la app;
> primitivas compartidas en vez de una tarjeta distinta por vista; navegación de 5 tabs con Rutinas,
> Coach y Ajustes como destinos propios. El Coach trae el chat que faltaba (C2) sin abrir un agujero en
> el presupuesto: cada mensaje es una llamada pedida a mano, con ventana de contexto acotada y el mismo
> techo mensual que la progresión. Quitar la gestión de rutinas de Inicio eliminó 376 líneas de código
> muerto y bajó el chunk de home.
> **Desviaciones conscientes del diseño:**
>
> - No se añade el apodo del atleta (O2) ni el saludo "Hola, {nombre}" de H1: el modelo no tiene ese
>   campo y añadirlo obliga a una migración de esquema para un saludo. La cabecera se queda sin nombre.
> - R1 no rotula "creada con IA": el estado no guarda el origen de una rutina y etiquetarlo a ojo sería inventarlo.
> - P2, P4 y P5 (detalle de ejercicio, cuerpo, récords) siguen donde estaban —hoja de progresión, perfil—
>   en vez de mudarse a subpantallas de Progreso: son alcanzables y moverlas es reorganización, no diseño.

## Convergencia (antes de dar por terminado)

- **T-900** Recorrer EA-1…EA-6 y casos borde §6 de la spec en dispositivo real.
- **T-901** Auditar contra checklists §11, §14 y §15.4 del análisis; toda casilla en rojo genera tarea nueva o enmienda justificada de la spec.
- **T-902** Verificar criterios CE-1…CE-6 y registrar resultados en `convergencia.md`.
