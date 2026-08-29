# Spec 001 — GymTrack AI (adaptación de app existente)

**Rama sugerida:** `001-gymtrack-adaptacion` · **Estado:** lista para /plan
**Fuente de dominio:** `docs/analisis-app-gym.md` (§ referenciadas) · **Diseño:** `docs/disenos-vistas-gym.html` (IDs de vista)

## 1. Resumen
Adaptar la app existente para convertirla en una PWA mobile-first de rutinas y progreso de gym, sin backend, con datos en almacenamiento local y progresión sugerida por IA (Groq/Cohere con key del usuario) sobre un motor de reglas local siempre disponible.

**Actores:** Usuario (único, sin cuentas) · Proveedor IA (externo, opcional).
**Fuera de alcance:** cuentas/login, sync entre dispositivos, fotos de progreso, social, backend propio, pagos.

## 2. Historias de usuario (prioridad P1 > P3)

- **HU-1 (P1)** Como usuario, quiero registrar cada serie de mi entrenamiento en segundos, para no perder el ritmo entre series. → vistas H1, H2, G1.
- **HU-2 (P1)** Como usuario, quiero que la app me sugiera cuánto peso/reps hacer hoy con una razón clara, para progresar sin pensar la programación. → C1, H2.
- **HU-3 (P1)** Como usuario, quiero que mis datos vivan en mi teléfono y poder exportar/importar copias, porque no hay servidor. → A4.
- **HU-4 (P2)** Como usuario, quiero crear/editar rutinas o generarlas con IA según mi perfil. → R1–R7.
- **HU-5 (P2)** Como usuario, quiero ver mi progreso (e1RM, volumen, racha, medidas) calculado localmente. → P1–P5.
- **HU-6 (P2)** Como usuario, quiero controlar cuántos tokens gasta la IA y que la app funcione igual sin key o sin conexión. → A3, C1.
- **HU-7 (P3)** Como usuario, quiero herramientas rápidas (1RM, discos, conversor, timer). → A6.

## 3. Requisitos funcionales (EARS)

### RF-STO · Almacenamiento y datos (§2, §5, §13.1)
- **RF-STO-01** El sistema DEBE persistir todo el estado en almacenamiento local del navegador bajo claves con prefijo `gt_` y campo `schemaVersion`.
- **RF-STO-02** CUANDO el usuario registra una serie, el sistema DEBE persistirla de inmediato (antes de cualquier otra interacción).
- **RF-STO-03** CUANDO se escribe estado, el sistema DEBE hacerlo de forma atómica (temporal → validación → swap).
- **RF-STO-04** CUANDO se lee o importa estado, el sistema DEBE validarlo contra el esquema; SI es inválido ENTONCES DEBE ponerlo en cuarentena sin romper la app.
- **RF-STO-05** El sistema DEBE permitir exportar todo a JSON (descarga y Web Share) con checksum, e importar con verificación y opción fusionar/reemplazar.
- **RF-STO-06** CUANDO pasan N sesiones sin backup (default 10), el sistema DEBE mostrar un recordatorio no bloqueante.
- **RF-STO-07** CUANDO cambia `schemaVersion`, el sistema DEBE migrar automáticamente los datos antiguos.
- **RF-STO-08** El sistema DEBE mostrar espacio usado y permitir purgar historial antiguo y borrar todo con doble confirmación.
- **RF-STO-09** MIENTRAS haya una sesión activa en otra pestaña, el sistema DEBE impedir la edición concurrente.

### RF-PER · Perfil y onboarding (§4.1, vistas O1–O6)
- **RF-PER-01** El sistema DEBE capturar en onboarding: unidades (obligatorio), nivel, objetivo, equipo, días/semana, lesiones (opcionales), con cada paso omitible.
- **RF-PER-02** El sistema DEBE ofrecer escala RPE 1–10 o simplificada (fácil/justo/difícil).
- **RF-PER-03** CUANDO termina el onboarding, el sistema DEBE ofrecer crear la primera rutina por IA, plantilla, manual o después.
- **RF-PER-04** El sistema DEBE permitir registrar peso corporal y medidas con histórico.

### RF-EJ · Biblioteca de ejercicios (§4.2, vista R4)
- **RF-EJ-01** El sistema DEBE incluir un catálogo embebido (estático, fuera de localStorage) con grupo muscular, equipo, tipo y patrón.
- **RF-EJ-02** El sistema DEBE permitir buscar y filtrar por grupo, equipo y tipo.
- **RF-EJ-03** El sistema DEBE permitir crear/editar/archivar ejercicios personalizados (estos sí en localStorage).
- **RF-EJ-04** CUANDO el usuario pide sustituir un ejercicio, el sistema DEBE proponer alternativas del mismo patrón/grupo compatibles con su equipo.

### RF-RUT · Rutinas (§4.3, vistas R1–R7)
- **RF-RUT-01** El sistema DEBE soportar CRUD de rutinas con estructura Rutina → Días → Ejercicios → Esquema (series × rango reps, peso/RPE objetivo, descanso, tipo, notas).
- **RF-RUT-02** El sistema DEBE soportar tipos de serie: normal, calentamiento, superserie, dropset, AMRAP.
- **RF-RUT-03** El sistema DEBE ofrecer plantillas locales filtradas por nivel/días/equipo del perfil, con vista previa antes de importar.
- **RF-RUT-04** El sistema DEBE mantener una rutina activa con rotación automática del "día que toca".
- **RF-RUT-05** CUANDO el usuario genera una rutina con IA, el sistema DEBE mostrar costo estimado antes, permitir regenerar por día y exigir revisión/edición antes de guardar.

### RF-SES · Sesión activa (§4.4, vistas H1–H4, G1)
- **RF-SES-01** El sistema DEBE permitir iniciar el entrenamiento del día en 1 tap desde Inicio.
- **RF-SES-02** El sistema DEBE mostrar por ejercicio la última sesión (peso×reps×RPE) y la sugerencia de hoy.
- **RF-SES-03** El sistema DEBE precargar cada serie con la sugerencia o la serie anterior; marcarla DEBE costar ≤ 3 taps sin scroll (Art. 8).
- **RF-SES-04** CUANDO se marca una serie, el sistema DEBE iniciar el temporizador de descanso configurado, con vibración/sonido al terminar y visible aunque se minimice.
- **RF-SES-05** El sistema DEBE permitir sobre la marcha: añadir/quitar series o ejercicios, sustituir, notas por serie/ejercicio/sesión.
- **RF-SES-06** CUANDO una marca supera el récord (peso, reps a un peso, e1RM), el sistema DEBE detectarlo y celebrarlo en vivo.
- **RF-SES-07** CUANDO se cierra la app con sesión sin finalizar, el sistema DEBE ofrecer reanudar/finalizar/descartar al reabrir.
- **RF-SES-08** CUANDO finaliza la sesión, el sistema DEBE mostrar resumen (duración, tonelaje, series, PRs, vs. anterior) y disparar el análisis de progresión para la próxima.

### RF-IA · Motor de progresión (§4.5, §6, §12, vistas C1–C3, A3)
- **RF-IA-01** El sistema DEBE incluir un motor de reglas local (doble progresión, deload, estancamiento, ajuste por nivel) que funcione sin key y sin red.
- **RF-IA-02** El sistema DEBE implementar la cascada Groq → Cohere → motor local ante ausencia de key, error, límite o falta de red, con el modo activo visible.
- **RF-IA-03** El sistema DEBE enviar contexto compacto: serialización CSV-like con abreviaturas, máximo 6 sesiones del día analizado, perfil resumido, lesiones y feedback previo.
- **RF-IA-04** El sistema DEBE exigir respuesta JSON, validarla contra esquema y contra límites duros (incremento ≤ 10%, respeto de lesiones); SI es inválida ENTONCES 1 reintento y fallback local.
- **RF-IA-05** Toda sugerencia DEBE mostrar acción + razón (1 frase) y permitir aceptar/cambiar/rechazar; el feedback DEBE persistirse e incluirse en contextos futuros.
- **RF-IA-06** El sistema DEBE hacer máximo 1 llamada por sesión finalizada y cachear por hash de contexto.
- **RF-IA-07** El sistema DEBE contar tokens (campo `usage`) por día/mes, mostrar el acumulado y cortar a motor local al agotar el presupuesto configurado.
- **RF-IA-08** El sistema DEBE seleccionar modelo por tarea (pequeño: sugerencia de sesión; grande: rutina/análisis) con override manual.
- **RF-IA-09** El sistema DEBE validar la key con "probar conexión" y guardarla cifrada (WebCrypto) solo en el dispositivo.
- **RF-IA-10** CUANDO no hay key, el chat DEBE estar deshabilitado con explicación y enlace a configuración; el resto de la app no cambia.

### RF-PRO · Progreso y analítica (§4.6, vistas P1–P5)
- **RF-PRO-01** El sistema DEBE calcular localmente: e1RM (Epley) por ejercicio, tonelaje, volumen semanal por grupo, racha, adherencia.
- **RF-PRO-02** El sistema DEBE mostrar heatmap mensual de asistencia con acceso al detalle de cada sesión.
- **RF-PRO-03** CUANDO el volumen de un grupo queda fuera del rango objetivo, el sistema DEBE señalarlo.
- **RF-PRO-04** CUANDO el historial de una gráfica supera 200 puntos, el sistema DEBE agregarlo (semanal) antes de renderizar.

### RF-HER · Herramientas (§4.7, vista A6)
- **RF-HER-01** El sistema DEBE incluir calculadoras de 1RM/porcentajes y de discos (con inventario de discos configurable), conversor kg⇄lb y temporizador libre.

### RF-PWA · PWA y plataforma (§4.10, §7)
- **RF-PWA-01** La app DEBE ser instalable y funcionar 100% offline salvo IA (service worker + manifest).
- **RF-PWA-02** MIENTRAS hay sesión activa, el sistema DEBE mantener la pantalla encendida (Wake Lock).
- **RF-PWA-03** El sistema DEBE emitir notificaciones locales de fin de descanso y recordatorios (entrenamiento, backup) configurables.
- **RF-PWA-04** La UI DEBE cumplir el Art. 1 de la constitución (mobile-first) y soportar tema oscuro por defecto, unidades kg/lb y ES/EN.

## 4. Escenarios de aceptación clave (Given/When/Then)

**EA-1 · Registrar serie (RF-SES-03/04, Art. 8)**
Dado un usuario en sesión activa con sugerencia 62.5×8, cuando confirma la serie sin cambios, entonces cuesta 1 tap, se persiste al instante, arranca el descanso de 120 s y la fila siguiente queda precargada.

**EA-2 · IA caída (RF-IA-02)**
Dado que Groq devuelve 429 y no hay key de Cohere, cuando finaliza la sesión, entonces el motor local genera las sugerencias, la UI indica "motor local" y ninguna función queda bloqueada.

**EA-3 · Respuesta IA peligrosa (RF-IA-04, Art. 6)**
Dado que la IA sugiere subir sentadilla de 100 a 120 kg (+20%), cuando se valida la respuesta, entonces el sistema la rechaza, aplica el tope local (≤ +10%) o cae al motor local, y nunca muestra la sugerencia original.

**EA-4 · Sesión interrumpida (RF-SES-07)**
Dado un cierre de app con 3/6 ejercicios registrados, cuando el usuario reabre, entonces ve el banner de reanudar con los datos intactos hasta la última serie marcada.

**EA-5 · Restaurar backup (RF-STO-05)**
Dado un archivo de backup válido, cuando el usuario importa en modo "fusionar", entonces se verifica el checksum, no se duplican sesiones existentes y se muestra un resumen de lo importado. Dado un archivo corrupto, entonces se rechaza con mensaje claro y los datos actuales quedan intactos.

**EA-6 · Presupuesto agotado (RF-IA-07)**
Dado un presupuesto de 100k tokens con 100k usados, cuando finaliza una sesión, entonces no se llama a ningún proveedor, se usa el motor local y Ajustes muestra el corte.

## 5. Criterios de éxito medibles
- CE-1: registrar una serie ≤ 3 taps y ≤ 4 s (medido en dispositivo de gama media).
- CE-2: carga inicial < 2 s; bundle < 300 KB gzip.
- CE-3: 0 pérdidas de datos en pruebas de cierre forzado durante sesión (20 repeticiones).
- CE-4: contexto de sugerencia de sesión ≤ 1.200 tokens de entrada; respuesta ≤ 500.
- CE-5: 100% de flujos P1 operables sin red (verificado con red desactivada).
- CE-6: tests unitarios verdes en motor de reglas, cálculos, serializador, import y migraciones.

## 6. Casos borde obligatorios
Peso 0/negativo o reps absurdas (validar) · cambio de unidad kg↔lb con historial (convertir solo visualización, almacenar canónico en kg) · localStorage lleno (avisar + compresión/purga) · respuesta IA con JSON malformado o campos extra · doble tap en botones de IA · cambio de zona horaria y rachas · import de backup de versión de esquema anterior · dos pestañas abiertas · key revocada a mitad de uso.

## 7. Trazabilidad
Cada RF referencia su sección del análisis (`docs/analisis-app-gym.md`) y su vista (`docs/disenos-vistas-gym.html`). Las checklists §11, §14 y §15.4 del análisis sirven como lista de verificación final de la fase de convergencia.

## 8. Ambigüedades a resolver en /plan (marcar, no adivinar)
- [ACLARAR] Stack actual de la app existente (framework, build, estado) → condiciona todo el plan.
- [ACLARAR] ¿localStorage ya en uso? ¿con qué estructura? → define migración inicial.
- [ACLARAR] Idiomas: ¿ES solo o ES/EN desde el inicio?
- [ACLARAR] ¿Se mantiene cookie como flag de onboarding por requisito original o se elimina?
