# GymTrack AI — Análisis Funcional Completo

**App móvil (PWA) para controlar rutinas y progresos del gym, con progresión sugerida por IA (Groq / Cohere con key del usuario), sin base de datos en servidor.**

Versión 1.3 — Agosto 2026

---

## 1. Resumen ejecutivo

La app permite al usuario crear y ejecutar rutinas de entrenamiento, registrar cada serie (peso × repeticiones × RPE), visualizar su progreso y recibir sugerencias inteligentes de progresión generadas por IA. Todo el estado vive en el dispositivo del usuario (sin backend ni base de datos). La IA se consume directamente desde el cliente contra las APIs de **Groq** y **Cohere**, usando una API key que el propio usuario ingresa y que se guarda localmente.

**Principios de diseño:**

- **Offline-first:** todo funciona sin conexión, excepto las sugerencias de IA.
- **Mobile-first:** pensada para usarse con una mano, en el gym, entre series.
- **Datos del usuario, en el dispositivo del usuario:** sin cuentas, sin servidor, con export/import obligatorio como mecanismo de respaldo.
- **IA explicable:** cada sugerencia viene con su razón ("subí 2.5 kg porque completaste 3×8 con RPE 7 dos sesiones seguidas").
- **Todos los niveles:** la app adapta plantillas, lenguaje y agresividad de la progresión según el nivel del usuario (principiante / intermedio / avanzado).

---

## 2. Restricción técnica clave: almacenamiento sin base de datos

### 2.1 Por qué NO usar cookies como almacenamiento principal

El requerimiento dice "guardar los datos a través de la cookie", pero es importante señalar sus limitaciones reales:

| Aspecto | Cookie | localStorage | IndexedDB |
|---|---|---|---|
| Tamaño máximo | ~4 KB por cookie (~20 cookies/dominio) | 5–10 MB | Cientos de MB |
| Se envía en cada request HTTP | Sí (desperdicio) | No | No |
| API asíncrona / rendimiento | Pobre | Síncrona simple | Asíncrona, ideal |
| Datos estructurados | Solo string | Solo string (JSON) | Objetos, índices, blobs |
| Adecuada para historial de meses | No | Sí (con límite) | Sí |

Un solo mes de entrenamiento (12–20 sesiones × 15–30 series) ya supera fácilmente los 4 KB. **Recomendación:** usar **localStorage** como capa principal (simple y suficiente para JSON de texto) con migración futura a **IndexedDB** si se agregan fotos o el historial crece. La cookie puede conservarse únicamente como flag mínimo (ej. "usuario ya hizo onboarding") si se desea cumplir literalmente el requisito.

### 2.2 Consecuencias de no tener DB (deben comunicarse al usuario)

- Si el usuario borra los datos del navegador, **pierde todo** → la app debe insistir en backups.
- No hay sincronización entre dispositivos → export/import JSON es la única vía.
- No hay recuperación de cuenta (no hay cuenta).
- Las fotos de progreso NO deben guardarse en localStorage (pesan demasiado); solo referencias o descartarlas del MVP.

### 2.3 Mitigaciones obligatorias

- **Export/Import JSON** con un tap (descarga de archivo `gymtrack-backup-AAAA-MM-DD.json`).
- **Recordatorio automático de backup** cada N sesiones (configurable, default: cada 10).
- Compartir backup vía Web Share API (enviárselo a uno mismo por WhatsApp/Drive/email).
- **Compresión** del JSON (ej. LZ-string) si se acerca al límite de localStorage.
- Indicador de "espacio usado" en Ajustes + purga opcional de historial antiguo (ej. > 2 años).
- `navigator.storage.persist()` para pedir al navegador almacenamiento persistente.

---

## 3. Público objetivo y adaptación por nivel

La app pregunta el nivel en el onboarding y ajusta comportamiento:

| Dimensión | Principiante | Intermedio | Avanzado |
|---|---|---|---|
| Plantillas sugeridas | Full Body 3×sem | Upper/Lower, PPL | PPL 6d, especialización |
| Progresión IA | Lineal, agresiva (+2.5 kg frecuente) | Doble progresión | Ondulada, bloques, RPE |
| Lenguaje | Explicativo, con tips de técnica | Estándar | Técnico (RPE, RIR, tonelaje) |
| Deload sugerido | Raro | Cada 6–8 semanas | Autoregulado por fatiga |
| Métricas mostradas | Peso levantado, racha | + 1RM estimado, volumen | + tonelaje, volumen por grupo muscular, fatiga |

---

## 4. Módulos funcionales (funcionalidad completa)

### 4.1 Onboarding y perfil

- Pantalla de bienvenida + explicación de "tus datos viven en tu teléfono".
- Datos del perfil: nombre/apodo, edad, sexo (opcional), altura, peso actual, **nivel** (principiante/intermedio/avanzado), **objetivo** (fuerza / hipertrofia / pérdida de grasa / mantenimiento / resistencia), días disponibles por semana, duración típica de sesión, **equipo disponible** (gym completo / mancuernas / barra / peso corporal / bandas), lesiones o limitaciones (texto libre — se envía a la IA como contexto).
- Unidades: kg / lb; sistema de RPE o "sensación" simplificada (fácil/justo/difícil) para principiantes.
- Al finalizar: ofrecer **generar primera rutina con IA** o elegir una plantilla local.
- Perfil editable en cualquier momento; el peso corporal se puede registrar periódicamente (histórico).

### 4.2 Biblioteca de ejercicios

- Catálogo precargado (~150–250 ejercicios) embebido en la app (JSON estático, no ocupa localStorage), con: nombre (ES), grupo muscular principal y secundarios, equipo necesario, tipo (compuesto/aislamiento), patrón de movimiento (empuje/tirón/bisagra/sentadilla/carga), instrucciones breves de técnica, errores comunes.
- Búsqueda y filtros: por grupo muscular, equipo, tipo.
- **Ejercicios personalizados:** crear, editar, archivar (estos sí van a localStorage).
- Sustituciones sugeridas: "no hay banco libre → alternativas para press banca" (regla local + IA opcional).
- Historial por ejercicio: mejores marcas, última sesión, gráfica de progreso (acceso directo desde la ficha del ejercicio).

### 4.3 Gestión de rutinas

- CRUD completo de rutinas: crear, editar, duplicar, archivar, reordenar.
- Estructura: Rutina → Días (ej. "Día A – Empuje") → Ejercicios → Esquema (series × reps objetivo, rango de reps, % o peso objetivo, RPE objetivo, descanso sugerido, notas).
- Tipos de serie: normal, calentamiento, **superserie**, dropset, AMRAP, al fallo, serie con pausa.
- **Plantillas locales** por nivel y frecuencia: Full Body, Upper/Lower, Push/Pull/Legs, Torso/Pierna, rutinas de solo mancuernas / peso corporal.
- **Generador de rutina por IA:** a partir del perfil (nivel, objetivo, días, equipo, lesiones) la IA devuelve una rutina completa en JSON que el usuario revisa y edita antes de guardar.
- Rutina activa: marcar cuál rutina está "en curso" y qué día toca hoy (rotación automática).

### 4.4 Registro de entrenamiento (sesión activa)

Es la pantalla más usada; debe ser rapidísima:

- Iniciar sesión desde "hoy toca: Día B – Tirón" (1 tap) o entrenamiento libre.
- Por cada ejercicio: ver **qué hiciste la última vez** (peso × reps × RPE) y la **sugerencia de hoy** (de la IA o del motor de reglas).
- Registrar serie: peso, reps, RPE/sensación → botón grande "✓ Serie". Autocompletar con la serie anterior para editar solo lo que cambió.
- **Temporizador de descanso** automático al marcar la serie (configurable por ejercicio), con vibración/sonido y notificación local si la app está en segundo plano.
- Agregar/quitar series o ejercicios sobre la marcha; sustituir ejercicio (máquina ocupada).
- Notas por serie/ejercicio/sesión ("me dolió el hombro en la 3ª").
- Cronómetro de duración total de la sesión; pausar sesión.
- Detección de **PR** en vivo (mejor peso, mejores reps a un peso, mejor 1RM estimado) con celebración visual.
- Finalizar sesión → resumen: duración, tonelaje total, series efectivas, PRs, y disparo del análisis de progresión para la próxima sesión.
- **Recuperación ante cierre accidental:** la sesión en curso se persiste en cada serie registrada; al reabrir, se reanuda.

### 4.5 Motor de progresión con IA (núcleo diferencial)

**Arquitectura de doble capa:**

1. **Motor de reglas local (siempre disponible, sin key):**
   - Doble progresión: si completas el tope del rango de reps en todas las series con RPE ≤ 8 → subir peso (2.5 kg tren superior / 5 kg inferior; % configurable).
   - Si fallas reps 2 sesiones seguidas → mantener o bajar 5–10%.
   - Estancamiento (3+ sesiones sin progreso) → sugerir deload (-40–50% volumen, 1 semana) o cambio de esquema.
   - Progresión por nivel (ver tabla §3).
2. **Capa IA (Groq / Cohere, key del usuario):** recibe un contexto compacto y devuelve JSON estructurado con sugerencias más ricas: ajustes por ejercicio, detección de desequilibrios de volumen por grupo muscular, periodización, deload autoregulado, respuesta a notas del usuario ("me dolió el hombro" → sugerir variante y reducir volumen de empuje).

**Contexto que se envía a la IA (compacto, ~1–2 KB):** perfil resumido, objetivo, nivel, últimas 3–6 sesiones del día de rutina en cuestión (ejercicio, series peso×reps×RPE), PRs relevantes, notas recientes, lesiones declaradas.

**Respuesta exigida en JSON estricto:** por ejercicio → `{accion: subir_peso|mantener|bajar|deload|sustituir, nuevo_peso, nuevo_esquema, razon}` + `resumen_semana` + `alertas`.

**Funcionalidades del módulo:**

- Sugerencia por ejercicio visible durante la sesión (chip: "IA sugiere 62.5 kg × 8 — ver por qué").
- **Aceptar / rechazar / modificar** cada sugerencia; el feedback se guarda y se incluye en el próximo contexto ("el usuario rechazó subir peso en sentadilla").
- Análisis semanal bajo demanda: "¿cómo va mi semana?" → resumen de volumen por grupo muscular, adherencia, recomendaciones.
- Chat libre opcional con la IA sobre tu entrenamiento (usa el mismo contexto).
- **Fallback en cascada:** Groq → Cohere → motor de reglas local (si no hay key, no hay red, o error/límite de la API). La app nunca se bloquea por falta de IA.
- Caché de sugerencias (no re-pedir si no hay sesiones nuevas).
- Selector de modelo: Groq (ej. Llama 3.3 70B) y Cohere (Command R+) — lista configurable, con modelo por defecto sensato y validación de la key al guardarla ("Probar conexión").

### 4.6 Progreso y analítica

- **Dashboard:** racha de semanas cumplidas, sesiones este mes, tonelaje semanal, próximo entrenamiento, último PR.
- **Por ejercicio:** gráfica de 1RM estimado (Epley/Brzycki) en el tiempo, mejor serie por sesión, volumen, tabla de historial completo, récords (1RM, mejores reps por peso).
- **Global:** volumen semanal por grupo muscular (detectar desequilibrios), frecuencia por grupo, duración media de sesión, calendario tipo *heatmap* de asistencia.
- **Cuerpo:** peso corporal (gráfica), medidas (cintura, brazo, pierna, pecho…) con histórico.
- Comparativas: este mes vs. anterior; "hace 3 meses levantabas X, hoy Y (+Z%)".
- Todas las gráficas se calculan en el cliente a partir del JSON local (sin dependencias de red).

### 4.7 Herramientas auxiliares

- Calculadora de **1RM** y de porcentajes (¿cuánto es el 75% de mi 1RM?).
- Calculadora de **discos** (qué discos poner a cada lado de la barra, según barra de 20/15/10 kg y discos disponibles configurables).
- Conversor kg ⇄ lb.
- Temporizador/cronómetro independiente (para descansos fuera de sesión, planchas, etc.).

### 4.8 Gestión de datos

- Exportar todo a JSON (descarga + Web Share). Importar con validación de esquema y **fusión o reemplazo** a elección.
- Exportar historial a **CSV** (para Excel).
- Recordatorio de backup automático (§2.3).
- Ver espacio usado / límite estimado; purgar historial antiguo; borrar todos los datos (doble confirmación).
- Versionado del esquema de datos (`schemaVersion`) con migraciones automáticas al actualizar la app.

### 4.9 Configuración

- Unidades (kg/lb), idioma (ES/EN), tema claro/oscuro/sistema.
- **API keys:** campos para Groq y Cohere, botón "probar conexión", proveedor preferido, modelo, y opción "solo motor local (sin IA)". Advertencia clara: la key se guarda solo en este dispositivo.
- Descanso por defecto, sonido/vibración del temporizador, RPE visible sí/no, incrementos de peso disponibles (2.5/1.25 kg…).
- Frecuencia del recordatorio de backup; notificaciones locales on/off.

### 4.10 PWA y notificaciones

- Instalable (manifest + service worker), funciona 100% offline salvo llamadas IA.
- Notificaciones locales: fin de descanso, recordatorio de entrenamiento ("hoy toca Pierna"), recordatorio de backup.
- Pantalla siempre activa durante la sesión (Wake Lock API).
- Indicador online/offline (afecta solo a la IA).

---

## 5. Modelo de datos (localStorage, JSON)

Claves separadas para minimizar escrituras: `gt_profile`, `gt_settings`, `gt_exercises_custom`, `gt_routines`, `gt_sessions`, `gt_body`, `gt_ai` (keys + caché + feedback), `gt_meta` (schemaVersion, contadores de backup).

```json
// gt_sessions (extracto)
{
  "id": "s_2026-08-29_1",
  "routineId": "r_ppl", "dayId": "d_push",
  "date": "2026-08-29", "durationMin": 62,
  "entries": [{
    "exerciseId": "press_banca",
    "sets": [
      {"kg": 60, "reps": 8, "rpe": 7, "type": "normal"},
      {"kg": 60, "reps": 8, "rpe": 8, "type": "normal"},
      {"kg": 60, "reps": 7, "rpe": 9, "type": "normal", "note": "hombro"}
    ],
    "suggestionShown": {"accion": "mantener", "razon": "..."},
    "suggestionAccepted": true
  }],
  "prs": ["press_banca:e1rm"], "note": ""
}
```

**Estimación de tamaño:** una sesión típica ≈ 1.5–3 KB → un año de 4 sesiones/semana ≈ 300–600 KB. Cabe holgadamente en localStorage (5 MB); con compresión LZ-string, varios años.

---

## 6. Especificación de la integración IA

- **Groq:** `POST https://api.groq.com/openai/v1/chat/completions` (formato OpenAI-compatible), header `Authorization: Bearer <key>`, `response_format: {type: "json_object"}` cuando el modelo lo soporte.
- **Cohere:** `POST https://api.cohere.com/v2/chat`, header `Authorization: Bearer <key>`, forzando JSON vía instrucción + validación.
- **Prompt de sistema:** rol de coach de fuerza; reglas de seguridad (nunca sugerir aumentos >10%, respetar lesiones declaradas, sugerir deload ante fatiga); formato de salida JSON con esquema explícito; idioma del usuario.
- **Validación estricta** de la respuesta (parseo + esquema); si es inválida → 1 reintento → fallback a reglas locales.
- **Manejo de errores:** 401 (key inválida → aviso y link a ajustes), 429 (rate limit → backoff y fallback), timeout 15 s, sin red → motor local.
- **Privacidad:** solo se envían datos de entrenamiento y perfil resumido; nunca se envía nombre completo ni datos que el usuario marque como privados. Aviso claro de que los datos viajan al proveedor elegido.
- **Nota CORS:** verificar que los endpoints permitan llamadas desde navegador; si algún proveedor lo bloquea, documentar la limitación (esta arquitectura no tiene backend proxy). Groq y Cohere actualmente permiten llamadas browser-side con key propia, pero debe validarse en desarrollo.

---

## 7. UX / UI móvil

**Mobile-first es un requisito no negociable, no una preferencia:** la app se usa con el celular en la mano, en el gym, entre series, muchas veces con las manos sudadas o con guantes/magnesio, con poca luz y poca paciencia. Reglas concretas:

- **Diseñar primero para 360–430 px de ancho** (viewport real de celulares); el desktop es solo una adaptación posterior, nunca al revés. Sin layouts que dependan de pantalla ancha.
- **Zona del pulgar:** todas las acciones frecuentes (marcar serie, steppers, temporizador, tab bar) viven en el tercio inferior de la pantalla, alcanzables con una mano. Lo informativo arriba, lo accionable abajo.
- **Sin hover ni gestos ocultos como única vía:** todo lo esencial es un tap visible; los gestos (swipe para borrar) son atajos, nunca el único camino.
- Targets táctiles de mínimo 48 px con separación suficiente para dedos sudados; los botones críticos (✓ serie) aún más grandes.
- Teclado numérico nativo (`inputmode="decimal"`) y steppers ± para no tipear; autocompletar con la serie anterior.
- **Wake Lock** durante la sesión (la pantalla no se apaga entre series) y feedback por **vibración** además de sonido (gym ruidoso, auriculares puestos).
- Probar en dispositivos de gama media reales, no solo en el navegador de escritorio; presupuesto de rendimiento medido en ese hardware.
- Safe areas (notch/barra de gestos), orientación vertical como única soportada en sesión.

Además:

- Navegación inferior de 4–5 tabs: **Hoy / Rutinas / Progreso / Coach IA / Ajustes**.
- Botones de acción de mínimo 48 px; inputs numéricos con steppers (+2.5 / −2.5) y teclado numérico.
- Modo sesión: interfaz de alto contraste, tipografía grande, temporizador siempre visible, sin scroll para registrar una serie.
- Modo oscuro por defecto (gimnasios con poca luz, ahorro de batería).
- Estados vacíos con guía ("aún no tienes rutinas → crear con IA / usar plantilla / crear manual").
- Toda acción destructiva con confirmación; deshacer (snackbar) al borrar series.
- Accesibilidad: contraste AA, etiquetas, tamaños de fuente ajustables.

---

## 8. Requisitos no funcionales

- Carga inicial < 2 s en gama media; registrar una serie < 3 taps.
- Escritura en localStorage tras cada serie (nunca perder datos por cierre).
- Sin dependencias de red para el flujo principal.
- La API key nunca aparece en URLs ni logs; ofuscada en el almacenamiento (con la advertencia honesta de que en cliente no hay secreto absoluto).
- Código preparado para migrar localStorage → IndexedDB sin cambiar el modelo.

---

## 9. Riesgos y limitaciones asumidas

| Riesgo | Mitigación |
|---|---|
| Pérdida de datos al limpiar navegador | Backups insistentes + `storage.persist()` |
| Límite de localStorage | Compresión + purga + migración a IndexedDB |
| Key del usuario expuesta en su dispositivo | Ofuscación + aviso; es SU dispositivo y SU key |
| CORS o cambios de API de Groq/Cohere | Abstracción de proveedor + fallback local |
| Sugerencias de IA inadecuadas/peligrosas | Límites duros en prompt + validación local (tope de incremento, respeto de lesiones) + disclaimer "no es consejo médico" |
| Sin multi-dispositivo | Export/import como flujo de primera clase |

---

## 10. Roadmap sugerido

**MVP (fase 1):** perfil + onboarding, biblioteca base, CRUD rutinas + 4 plantillas, sesión activa completa (registro, descansos, PRs, recuperación), motor de reglas local, dashboard básico, export/import JSON, ajustes esenciales, PWA offline.

**Fase 2 (IA):** gestión de keys Groq/Cohere, sugerencias por ejercicio con aceptar/rechazar, generador de rutinas IA, análisis semanal, fallback en cascada, caché.

**Fase 3:** analítica avanzada (volumen por grupo, heatmap, comparativas), medidas corporales, calculadora de discos, CSV, superseries/dropsets, notificaciones de recordatorio, chat con la IA, compresión y migración a IndexedDB.

---

## 11. Checklist completa (para auditar la app existente)

**Datos:** [ ] localStorage estructurado por claves · [ ] schemaVersion + migraciones · [ ] export JSON · [ ] import con fusión/reemplazo · [ ] export CSV · [ ] recordatorio de backup · [ ] medidor de espacio · [ ] borrar todo con confirmación · [ ] persistencia por serie · [ ] storage.persist()

**Perfil:** [ ] nivel · [ ] objetivo · [ ] equipo · [ ] días/semana · [ ] lesiones · [ ] unidades kg/lb · [ ] peso corporal histórico

**Ejercicios:** [ ] catálogo embebido con grupos musculares y equipo · [ ] búsqueda/filtros · [ ] ejercicios custom · [ ] ficha con historial y récords · [ ] sustituciones

**Rutinas:** [ ] CRUD + duplicar + archivar · [ ] días y esquemas (series/reps/RPE/descanso) · [ ] superseries/dropsets/AMRAP · [ ] plantillas por nivel · [ ] rutina activa con rotación · [ ] generador IA con revisión previa

**Sesión:** [ ] iniciar en 1 tap · [ ] última sesión visible por ejercicio · [ ] sugerencia visible por ejercicio · [ ] registro rápido con autocompletar · [ ] temporizador de descanso con vibración/notificación · [ ] editar sobre la marcha · [ ] notas · [ ] PRs en vivo · [ ] resumen final · [ ] recuperación de sesión

**IA:** [ ] keys Groq y Cohere con prueba de conexión · [ ] selección de proveedor/modelo · [ ] contexto compacto · [ ] salida JSON validada · [ ] aceptar/rechazar con feedback persistido · [ ] fallback Groq→Cohere→reglas · [ ] motor de reglas local completo · [ ] deload y estancamiento · [ ] análisis semanal · [ ] límites de seguridad + disclaimer

**Progreso:** [ ] dashboard con racha · [ ] 1RM estimado por ejercicio · [ ] volumen por grupo muscular · [ ] heatmap calendario · [ ] medidas corporales · [ ] comparativas temporales

**Herramientas:** [ ] calculadora 1RM/porcentajes · [ ] calculadora de discos · [ ] conversor kg/lb · [ ] temporizador libre

**PWA/UX:** [ ] instalable + offline · [ ] Wake Lock en sesión · [ ] notificaciones locales · [ ] modo oscuro · [ ] navegación de 5 tabs · [ ] inputs con steppers · [ ] estados vacíos guiados · [ ] deshacer

---

## 12. Eficiencia de tokens y control de costos de IA

La key es del usuario: cada token desperdiciado es dinero/cuota suya. Reglas de diseño obligatorias:

### 12.1 Minimizar tokens de entrada

- **Formato compacto, no JSON verboso.** Enviar el historial como líneas tipo CSV, no como objetos con claves repetidas. Ejemplo: `PB|29-08|60x8@7,60x8@8,60x7@9` en vez de `{"ejercicio":"Press banca","fecha":"2026-08-29","series":[{"peso":60,...}]}`. Ahorro típico: 60–75% de tokens.
- **Diccionario de abreviaturas** definido una sola vez en el prompt de sistema (PB=press banca, S=sentadilla, @=RPE…).
- **Ventana de historial limitada:** solo las últimas 3–6 sesiones del día de rutina analizado, nunca el historial completo. Sesiones viejas → 1 línea de resumen ("tendencia 8 sem: +7% e1RM").
- **Nunca enviar** el catálogo de ejercicios, instrucciones de técnica, ni datos que la IA no necesita para decidir (nombre, medidas corporales salvo que el análisis lo requiera).
- **Prompt de sistema corto y estable** (< 400 tokens), sin ejemplos largos; los formatos se especifican con esquemas mínimos.
- **Pre-filtrado local:** el motor de reglas decide primero qué ejercicios tienen un caso "ambiguo"; los casos obvios (progresión lineal clara) se resuelven localmente GRATIS y solo los dudosos van a la IA.

### 12.2 Minimizar tokens de salida

- `max_tokens` acotado por tipo de llamada (sugerencia por sesión: ~500; rutina completa: ~1500; análisis semanal: ~700).
- Exigir **solo JSON, sin prosa** ("no expliques fuera del JSON"); la clave `razon` limitada a 1 frase.
- `temperature` baja (0–0.3) → respuestas más cortas y deterministas; sin streaming (no aporta en este caso).

### 12.3 Minimizar número de llamadas

- **1 llamada por sesión finalizada** (analiza todos los ejercicios juntos), nunca 1 llamada por ejercicio.
- **Caché por hash del contexto:** si no hay sesiones nuevas desde la última sugerencia, se reutiliza la respuesta guardada (0 tokens).
- La sugerencia se calcula **al cerrar la sesión** (para la próxima), no en tiempo real durante el entrenamiento.
- Generación de rutina y análisis semanal: solo bajo demanda explícita del usuario, con confirmación ("esto usará ~2.000 tokens de tu cuota").
- Debounce/candado anti doble-tap en todos los botones que disparan IA.

### 12.4 Presupuesto y transparencia

- **Contador local de uso:** tokens de entrada/salida por llamada (los devuelve la API en `usage`) acumulados por día/mes, visible en Ajustes.
- **Presupuesto mensual configurable** (ej. 100k tokens): al 80% avisa, al 100% pasa automáticamente al motor local.
- **Modelo según tarea:** tareas simples (sugerencia de sesión) → modelo pequeño y barato/rápido (ej. Llama 3.1 8B instant en Groq); tareas complejas (generar rutina, análisis semanal) → modelo grande (Llama 3.3 70B / Command R+). Selección automática con override manual.
- Mostrar costo estimado ~0 en Groq free tier / Cohere trial, pero diseñar como si cada token costara.

---

## 13. Ingeniería y calidad (requisitos de una app seria)

### 13.1 Integridad de datos (crítico sin DB)

- **Escritura atómica:** escribir en clave temporal → validar → renombrar/swap; nunca dejar un JSON a medio escribir si el navegador se cierra.
- **Validación de esquema** en cada lectura y en cada import (tipo Zod/JSON Schema); datos corruptos → cuarentena, no crash.
- **Checksum** (hash) incluido en los backups exportados; al importar se verifica.
- Copia de seguridad interna rotativa: snapshot automático de los últimos N estados en claves separadas (recuperación ante corrupción).
- **Multi-pestaña:** sincronizar con el evento `storage` o Web Locks API; si hay una sesión activa en otra pestaña, bloquear edición concurrente.
- Fechas siempre en **ISO 8601 local** con día de inicio de semana configurable (lunes/domingo); cuidado con cambios de zona horaria (viajes) al calcular rachas.

### 13.2 Seguridad

- La API key cifrada con **WebCrypto (AES-GCM)** con clave derivada del dispositivo — con la advertencia honesta de que en cliente puro es ofuscación, no secreto absoluto.
- **CSP estricta** (solo self + dominios de Groq/Cohere), sin `eval`, sin dependencias de CDN de terceros en producción (todo empaquetado), HTTPS obligatorio.
- Sanitizar todo texto libre (notas, nombres de ejercicios custom) antes de renderizar — riesgo XSS vía import de un backup malicioso.
- La respuesta de la IA **nunca se ejecuta ni se renderiza como HTML**; solo se parsea como datos y se valida contra límites duros locales (incremento máx. 10%, pesos > 0, etc.).
- Cero telemetría/trackers de terceros. Si se quiere analítica, solo contadores locales visibles para el usuario.

### 13.3 Robustez y rendimiento

- Manejo global de errores (error boundary) con opción "reportar/copiar detalle"; log de errores local rotativo.
- Listas largas (historial) con **virtualización**; gráficas con datos memoizados/downsampleados (> 200 puntos → agregación semanal).
- Lazy loading de vistas pesadas (gráficas, biblioteca); presupuesto de bundle < 300 KB gzip para carga < 2 s.
- Reintentos con backoff exponencial en llamadas IA; timeout 15 s; toda operación IA cancelable.

### 13.4 Calidad y mantenibilidad

- **Tests unitarios obligatorios** para: motor de reglas de progresión, cálculo de 1RM/volumen/PRs, parser de import, migraciones de esquema, serialización compacta para IA.
- Capa de abstracción `AIProvider` (interfaz común Groq/Cohere) → agregar un proveedor nuevo sin tocar la lógica.
- `schemaVersion` + migraciones probadas con fixtures de versiones antiguas.
- Versionado semántico de la app + changelog visible en Ajustes; feature flags simples para desplegar módulos incompletos ocultos.

### 13.5 Legal y confianza

- Disclaimer visible en onboarding y en cada sugerencia de IA: no es consejo médico ni sustituye a un profesional.
- Política de privacidad de 1 pantalla: qué se guarda (todo local), qué sale del dispositivo (solo el contexto de entrenamiento hacia el proveedor de IA elegido, con su key) y cómo borrarlo.
- Verificar licencia del catálogo de ejercicios si se toma de una fuente externa (usar fuentes libres o catálogo propio).

---

## 14. Checklist adicional (eficiencia + ingeniería)

**Tokens/IA:** [ ] serialización compacta CSV-like · [ ] diccionario de abreviaturas · [ ] ventana de 3–6 sesiones · [ ] pre-filtrado local de casos obvios · [ ] 1 llamada por sesión · [ ] caché por hash de contexto · [ ] max_tokens por tipo de tarea · [ ] temperature 0–0.3 · [ ] contador de tokens (usage) · [ ] presupuesto mensual con corte automático · [ ] modelo pequeño/grande según tarea · [ ] confirmación de costo en operaciones caras · [ ] anti doble-tap

**Ingeniería:** [ ] escritura atómica · [ ] validación de esquema en lectura/import · [ ] checksum en backups · [ ] snapshots internos rotativos · [ ] manejo multi-pestaña · [ ] key cifrada (WebCrypto) · [ ] CSP sin CDNs externos · [ ] sanitización de texto libre e imports · [ ] respuesta IA validada con límites duros · [ ] error boundary + log local · [ ] virtualización y downsampling · [ ] bundle < 300 KB gzip · [ ] backoff y timeout en IA · [ ] tests del motor de reglas y migraciones · [ ] abstracción AIProvider · [ ] disclaimer + política de privacidad · [ ] licencia del catálogo

---

## 15. Navegación, vistas y flujos de usuario

### 15.1 Mapa de navegación

Navegación por **tab bar inferior de 5 pestañas**; cada tab es una pila (stack) propia que conserva su estado al cambiar de tab. El onboarding es un stack previo que solo se ve la primera vez.

```
ONBOARDING (solo primera vez)
 O1 Bienvenida -> O2 Perfil basico -> O3 Nivel y objetivo
 -> O4 Equipo y disponibilidad -> O5 Config IA (omitible)
 -> O6 Primera rutina (IA | plantilla | manual | luego)

TAB BAR
 [1] HOY        H1 Inicio/Hoy -> H2 Sesion activa -> H3 Resumen de sesion
                H1 -> H4 Detalle de sesion pasada
 [2] RUTINAS    R1 Lista -> R2 Detalle rutina -> R3 Editor de dia
                R3 -> R4 Biblioteca (selector) -> R5 Editor de esquema
                R1 -> R6 Plantillas | R7 Generador IA (wizard)
 [3] PROGRESO   P1 Analitica -> P2 Detalle ejercicio
                P1 -> P3 Calendario | P4 Cuerpo | P5 Records
 [4] COACH IA   C1 Panel -> C2 Chat | C3 Historial sugerencias
 [5] AJUSTES    A1 Menu -> A2 Perfil | A3 IA y keys | A4 Datos
                A1 -> A5 Preferencias | A6 Herramientas | A7 Acerca de

OVERLAYS GLOBALES (sobre cualquier vista)
 G1 Temporizador de descanso (persistente, minimizable)
 G2 Celebracion de PR   G3 Aviso de backup pendiente
 G4 Confirmaciones destructivas   G5 Snackbar deshacer
 G6 Indicador offline (solo afecta IA)
```

Regla: registrar una serie nunca requiere salir de H2; todo lo secundario abre como *bottom sheet*, no como pantalla nueva.

### 15.2 Catálogo de vistas (contenido, acciones y estados)

**Onboarding**

- **O1 Bienvenida:** propuesta de valor + aviso "tus datos viven en este teléfono". Acción: empezar.
- **O2 Perfil básico:** apodo, edad, altura, peso, unidades. Todo opcional salvo unidades.
- **O3 Nivel y objetivo:** selector de nivel (con descripción de qué implica) y objetivo.
- **O4 Equipo y disponibilidad:** equipo (multi-selección), días/semana, duración de sesión, lesiones (texto libre).
- **O5 Config IA:** explicación de Groq/Cohere, campos de key con "probar conexión", botón destacado **"Omitir — usar solo motor local"**. Nunca bloquear el alta por no tener key.
- **O6 Primera rutina:** 4 caminos: generar con IA / elegir plantilla / crear manual / decidir después.

**Tab Hoy**

- **H1 Inicio/Hoy:** tarjeta principal "Hoy toca: Día B — Tirón" con botón grande **Entrenar**; racha semanal; último PR; sugerencia IA pendiente (chip); accesos: sesión libre, calendario, herramientas. Estados: sin rutina activa (CTA a Rutinas), día de descanso, sesión interrumpida detectada (CTA **Reanudar**).
- **H2 Sesión activa:** cabecera con cronómetro de sesión y progreso (ej. 3/6 ejercicios); lista de ejercicios colapsables; el ejercicio actual expandido muestra: última sesión, sugerencia del día con "¿por qué?", filas de series con inputs peso/reps/RPE (steppers ±), botón grande **✓ Serie** que dispara G1. Acciones secundarias (sheet): sustituir ejercicio, añadir/quitar serie o ejercicio, nota, saltar. Botón Finalizar (con confirmación si hay series vacías). La vista escribe en localStorage tras cada serie.
- **H3 Resumen de sesión:** duración, tonelaje, series efectivas, PRs, comparación vs. sesión anterior, nota final; estado de la IA ("sugerencias para la próxima sesión listas / se usó motor local"); acciones: compartir, cerrar.
- **H4 Detalle de sesión pasada:** solo lectura + editar/borrar (con confirmación).

**Tab Rutinas**

- **R1 Lista:** rutina activa destacada, resto en lista; crear (manual/plantilla/IA), duplicar, archivar. Estado vacío guiado con los 3 caminos.
- **R2 Detalle de rutina:** días con su rotación, marcar como activa, reordenar días.
- **R3 Editor de día:** lista reordenable de ejercicios con su esquema resumido; agrupar en superserie; añadir ejercicio → R4.
- **R4 Biblioteca (selector/explorador):** búsqueda + filtros (grupo, equipo, tipo); ficha de ejercicio (técnica, historial, récords); crear ejercicio custom. Accesible también en modo consulta desde Ajustes/Herramientas.
- **R5 Editor de esquema:** series × rango de reps, peso o % objetivo, RPE objetivo, descanso, tipo de serie, notas.
- **R6 Plantillas:** filtradas por nivel/días/equipo del perfil, con vista previa antes de importar.
- **R7 Generador IA (wizard):** paso 1 confirma parámetros del perfil (editables) → paso 2 estimación de tokens y confirmación → paso 3 revisión de la rutina propuesta con edición inline y **regenerar por día** → guardar. Estados: cargando (cancelable), error con causa (key/red/límite) y alternativa (plantilla).

**Tab Progreso**

- **P1 Analítica:** selector de rango (4 sem / 12 sem / año / todo); tarjetas: tonelaje semanal, sesiones, volumen por grupo muscular (radar o barras con alerta de desequilibrio), duración media.
- **P2 Detalle de ejercicio:** gráfica e1RM + mejor serie + volumen; tabla de historial; récords. Acceso desde P1, R4 o H2.
- **P3 Calendario:** heatmap mensual de asistencia; tap en día → H4.
- **P4 Cuerpo:** peso corporal y medidas con gráficas; alta rápida de registro.
- **P5 Récords:** lista de PRs por ejercicio (1RM estimado, mejores reps por peso) con fecha.

**Tab Coach IA**

- **C1 Panel:** sugerencias pendientes por día de rutina (aceptar / rechazar / modificar en lote o por ejercicio), botón "análisis semanal" (con costo estimado), estado del proveedor (Groq/Cohere/local) y uso de tokens del mes.
- **C2 Chat:** conversación libre con contexto de entrenamiento; historial solo local; aviso de costo por mensaje. Deshabilitado sin key (muestra el porqué + CTA a A3).
- **C3 Historial:** sugerencias pasadas y qué se hizo con ellas (base del feedback que se reenvía a la IA).

**Tab Ajustes**

- **A1 Menú** → **A2 Perfil** (editar todo el onboarding) · **A3 IA y keys** (keys, probar conexión, proveedor/modelo, presupuesto mensual, modo "solo local") · **A4 Datos** (export JSON/CSV, import con fusión/reemplazo, espacio usado, snapshots, borrar todo) · **A5 Preferencias** (unidades, tema, idioma, descansos, incrementos, RPE on/off, notificaciones, recordatorio de backup) · **A6 Herramientas** (1RM, discos, conversor, temporizador) · **A7 Acerca de** (versión, changelog, disclaimer, privacidad, licencias).

Toda vista define sus 4 estados: **con datos / vacío guiado / cargando / error**, y las que dependen de IA además el estado **offline/sin key → fallback local visible**.

### 15.3 Flujos de usuario clave

- **F1 Primer uso (< 3 min):** O1→O6; si elige IA sin key configurada, se ofrece O5 o plantilla. Termina siempre en H1 con "hoy toca X".
- **F2 Entrenar (flujo estrella):** H1 → Entrenar (1 tap) → H2 con valores precargados de la sugerencia → por serie: ajustar si hace falta + ✓ (1–3 taps) → G1 descanso automático → … → Finalizar → H3 → al cerrar, la IA (o motor local) prepara la próxima sesión en segundo plano.
- **F3 Máquina ocupada:** en H2, menú del ejercicio → Sustituir → R4 filtrada por mismo patrón/grupo → el reemplazo puede guardarse solo por hoy o en la rutina.
- **F4 Generar rutina con IA:** R1/O6 → R7 (wizard de 3 pasos con confirmación de costo) → rutina activa.
- **F5 Configurar key:** A3 → pegar key → probar conexión (feedback claro: válida / inválida / sin red) → elegir proveedor preferido y presupuesto.
- **F6 Backup:** G3 recuerda cada N sesiones → A4 → exportar (descarga o compartir). **Restaurar:** A4 → importar → validación + checksum → elegir fusionar o reemplazar → resumen de lo importado.
- **F7 Sesión interrumpida:** al abrir la app con sesión sin cerrar → banner en H1 "Reanudar sesión de hace 40 min" con opciones reanudar / finalizar como está / descartar.
- **F8 Sin conexión:** todo el flujo F2 funciona igual; los elementos de IA muestran "modo local" sin bloquear nada.

### 15.4 Checklist de navegación y vistas

[ ] tab bar de 5 pestañas con stacks independientes · [ ] onboarding omitible en cada paso · [ ] O5 permite omitir la key sin fricción · [ ] H1 con estados: sin rutina / descanso / sesión interrumpida · [ ] H2 sin scroll para registrar serie · [ ] temporizador G1 persistente y minimizable sobre cualquier vista · [ ] sheets en vez de pantallas para acciones secundarias · [ ] R7 con confirmación de costo y edición antes de guardar · [ ] C2 deshabilitado sin key con explicación · [ ] 4 estados definidos en cada vista · [ ] F7 recuperación de sesión · [ ] F8 offline sin bloqueo

---

*Documento generado para servir como especificación de adaptación de la app existente. Disclaimer: las sugerencias de la IA no sustituyen consejo médico o de un profesional del entrenamiento.*
