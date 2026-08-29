# Tareas — Spec 001 GymTrack AI

> Convenciones: `[P]` = paralelizable con las de su fase · cada tarea cita sus RF · una tarea = un commit/PR pequeño.
> Definición de terminado (DoD) global: cumple constitución, RF citados verificables, tests del Art. 9 verdes si aplica.

## F0 · Auditoría de la app existente (resuelve los [ACLARAR])
- **T-000** Inventariar stack, estructura, estado y almacenamiento actual de la app; mapear cada pantalla existente contra los IDs de vista (O/H/R/P/C/A/G) y cada funcionalidad contra las checklists §11/§14/§15.4 del análisis. Salida: `audit.md` con columnas [cumple | adaptar | falta | eliminar].
- **T-001** Con `audit.md`, actualizar los [ACLARAR] de `spec.md` y ajustar `plan.md` (stack definitivo, migración de datos actuales). Gate: sin esto no se implementa nada.

## F1 · Fundaciones de datos (RF-STO)
- **T-100** Implementar `storageAdapter` con escritura atómica y prefijo `gt_` (RF-STO-01/03).
- **T-101** Esquemas + validación en lectura con cuarentena (RF-STO-04) `[P]`.
- **T-102** `schemaVersion` + framework de migraciones + migración desde el formato actual de la app (RF-STO-07, depende T-000).
- **T-103** Export JSON con checksum + Web Share; import con verificación y fusionar/reemplazar (RF-STO-05).
- **T-104** Snapshots internos rotativos + medidor de espacio + purga + borrar todo (RF-STO-08) `[P]`.
- **T-105** Detección multi-pestaña con evento `storage`/Web Locks (RF-STO-09) `[P]`.
- **T-106** Tests: adapter atómico, validador, migraciones con fixtures, import corrupto (EA-5, Art. 9).

## F2 · Sesión activa — flujo estrella (RF-SES)
- **T-200** Modelo de sesión con persistencia por serie y recuperación de interrumpida (RF-SES-02/07, EA-4).
- **T-201** Vista H2: filas de serie precargadas, steppers, ✓ ≤ 3 taps sin scroll (RF-SES-03, EA-1, Art. 8).
- **T-202** Temporizador de descanso G1: overlay persistente, vibración/sonido, notificación en segundo plano (RF-SES-04) `[P]`.
- **T-203** Acciones en vivo: añadir/quitar/sustituir/notas (RF-SES-05, RF-EJ-04).
- **T-204** Detección de PR en vivo + celebración G2 (RF-SES-06) `[P]`.
- **T-205** Resumen H3 (tonelaje, series, vs. anterior) + hook de fin de sesión (RF-SES-08).
- **T-206** Vistas H1 (estados: hoy toca / sin rutina / descanso / reanudar) y H4 (RF-SES-01/07).
- **T-207** Tests de cálculo de tonelaje/PR y prueba de cierre forzado (CE-3).

## F3 · Motor de progresión local (RF-IA-01)
- **T-300** `progresionLocal`: doble progresión, fallos consecutivos, estancamiento→deload, parámetros por nivel (§4.5).
- **T-301** Integrarlo como `LocalRulesProvider` de la interfaz `AIProvider`.
- **T-302** Tests exhaustivos con fixtures de historiales (progreso, meseta, regresión, lesión anotada) — es el corazón sin key (Art. 9).

## F4 · Capa IA (RF-IA)
- **T-400** Interfaz `AIProvider` + orquestador de cascada con estado visible (RF-IA-02, EA-2).
- **T-401** Spike: verificar CORS y formato real de Groq y Cohere desde navegador con una key de prueba (riesgo §6 del plan). Gate de la fase.
- **T-402** `GroqProvider` y `CohereProvider` con timeout 15 s, backoff, manejo 401/429 (RF-IA-02) `[P tras T-401]`.
- **T-403** Serializador de contexto compacto versionado + diccionario de abreviaturas (RF-IA-03, CE-4).
- **T-404** Validador de respuesta: esquema + límites duros ≤10% + respeto de lesiones + 1 reintento (RF-IA-04, EA-3).
- **T-405** Caché por hash de contexto + candado anti doble-tap (RF-IA-06) `[P]`.
- **T-406** Contador de `usage` + presupuesto mensual con corte automático (RF-IA-07, EA-6).
- **T-407** Gestión de keys: cifrado WebCrypto, probar conexión, selección proveedor/modelo por tarea — vista A3 (RF-IA-08/09).
- **T-408** Panel C1: aceptar/cambiar/rechazar con persistencia de feedback y reinyección en contexto (RF-IA-05) + historial C3.
- **T-409** Tests: serializador (fixtures + presupuesto de tokens), validador con respuestas malformadas/peligrosas, cascada con providers simulados.

## F5 · Rutinas y generación (RF-RUT, RF-EJ, RF-PER)
- **T-500** Catálogo estático de ejercicios + biblioteca R4 con filtros y custom (RF-EJ-01/02/03) `[P]`.
- **T-501** CRUD de rutinas R1–R3 + editor de esquema R5 + superseries (RF-RUT-01/02).
- **T-502** Rutina activa con rotación (RF-RUT-04) y plantillas R6 filtradas por perfil (RF-RUT-03).
- **T-503** Generador IA R7: wizard con costo estimado, regenerar por día, revisión obligatoria (RF-RUT-05, usa F4).
- **T-504** Onboarding O1–O6 completo y editable desde A2 (RF-PER-01/02/03).

## F6 · Progreso (RF-PRO)
- **T-600** Módulo `calculos`: e1RM, volumen por grupo, racha, adherencia + tests (RF-PRO-01, Art. 9).
- **T-601** Vistas P1/P2 con SVG propio, memoización y agregación >200 puntos (RF-PRO-04) `[P]`.
- **T-602** Heatmap P3 + récords P5 (RF-PRO-02) `[P]`.
- **T-603** Cuerpo P4: peso y medidas (RF-PER-04) `[P]`.
- **T-604** Alerta de desequilibrio de volumen (RF-PRO-03).

## F7 · Plataforma y pulido (RF-PWA, RF-HER)
- **T-700** Service worker + manifest + precache; verificación CE-5 con red desactivada (RF-PWA-01).
- **T-701** Wake Lock en sesión + notificaciones locales configurables (RF-PWA-02/03) `[P]`.
- **T-702** Herramientas A6: 1RM, discos con inventario, conversor, timer + tests de discos (RF-HER-01) `[P]`.
- **T-703** Preferencias A5, Acerca de A7 (disclaimer, privacidad, changelog) y recordatorio de backup G3 (RF-STO-06).
- **T-704** Pase mobile-first: zona del pulgar, targets 48 px, safe areas, teclado numérico, medición CE-1/CE-2 en gama media (Art. 1).

## Convergencia (antes de dar por terminado)
- **T-900** Recorrer EA-1…EA-6 y casos borde §6 de la spec en dispositivo real.
- **T-901** Auditar contra checklists §11, §14 y §15.4 del análisis; toda casilla en rojo genera tarea nueva o enmienda justificada de la spec.
- **T-902** Verificar criterios CE-1…CE-6 y registrar resultados en `convergencia.md`.
