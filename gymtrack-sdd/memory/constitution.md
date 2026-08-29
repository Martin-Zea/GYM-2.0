# Constitución — GymTrack AI

> Principios NO negociables. Toda spec, plan, tarea y línea de código debe cumplirlos.
> Si una decisión técnica entra en conflicto con un artículo, la decisión se rechaza o la constitución se enmienda explícitamente (nunca se ignora en silencio).

## Art. 1 — Mobile-first absoluto

El usuario lleva el celular al gym. Se diseña y prueba primero en 360–430 px; desktop es adaptación posterior. Acciones frecuentes en el tercio inferior (zona del pulgar), targets táctiles ≥ 48 px, sin hover ni gestos ocultos como única vía, teclado numérico nativo + steppers, Wake Lock durante la sesión, vibración además de sonido, orientación vertical en sesión.

## Art. 2 — Offline-first

Todo flujo central (crear rutina, entrenar, registrar, ver progreso, backup) funciona sin conexión. Solo las llamadas de IA requieren red, y su ausencia nunca bloquea nada: degradan al motor local con estado visible.

## Art. 3 — Datos 100% locales, sin backend

No existe servidor ni base de datos remota. Persistencia en localStorage (migrable a IndexedDB) bajo claves `gt_*` con `schemaVersion` y migraciones. Export/import JSON es funcionalidad de primera clase, no un extra. Prohibido introducir cuentas, sync remoto o telemetría de terceros.

## Art. 4 — IA en cascada, nunca bloqueante

Orden fijo: Groq → Cohere → motor de reglas local. La key es del usuario, se guarda solo en su dispositivo (cifrada con WebCrypto) y la app es plenamente funcional sin key. Toda integración pasa por la abstracción `AIProvider`; prohibido llamar a un proveedor directamente desde la UI.

## Art. 5 — Frugalidad de tokens

Cada token es cuota del usuario. Obligatorio: serialización compacta (formato CSV-like con abreviaturas), ventana máxima de 6 sesiones, 1 llamada por sesión finalizada, caché por hash de contexto, `max_tokens` acotado por tarea, pre-filtrado local de casos obvios, contador de uso visible y presupuesto mensual con corte automático. Operaciones caras (generar rutina, análisis semanal) muestran costo estimado y piden confirmación.

## Art. 6 — IA explicable y con límites duros

Toda sugerencia lleva su razón en una frase y botones aceptar/cambiar/rechazar. La respuesta de la IA es solo datos: se parsea, se valida contra esquema y contra límites locales (incremento máx. 10%, respeto de lesiones declaradas, pesos > 0) antes de mostrarse. Nunca se ejecuta ni renderiza como HTML. Disclaimer: no es consejo médico.

## Art. 7 — Integridad de datos

Escritura tras cada serie registrada (nunca se pierde una sesión por cierre). Escrituras atómicas (temporal → validar → swap). Validación de esquema en cada lectura e import; checksum en backups; snapshots internos rotativos; manejo multi-pestaña (evento `storage` / Web Locks).

## Art. 8 — Registrar una serie: ≤ 3 taps, sin scroll

La pantalla de sesión activa es sagrada: valores precargados de la sugerencia o de la última sesión, y marcar una serie cuesta como máximo 3 taps sin hacer scroll. Cualquier cambio que empeore esto se rechaza.

## Art. 9 — Testing del núcleo antes de mergear

Motor de reglas de progresión, cálculos (e1RM, volumen, PRs, discos), serializador compacto de contexto IA, parser/validador de import y migraciones de esquema requieren tests unitarios. Sin tests verdes, la tarea no se considera terminada.

## Art. 10 — Privacidad y honestidad

Del dispositivo solo sale el contexto de entrenamiento hacia el proveedor de IA que el usuario eligió, con su key. La app dice la verdad: qué guarda, qué envía, cuánto gasta y qué pasa si el usuario borra los datos del navegador.

---

**Gobernanza:** versión 1.0 (agosto 2026). Enmiendas solo por edición explícita de este archivo, con fecha y motivo. En caso de ambigüedad en una spec, esta constitución decide.
