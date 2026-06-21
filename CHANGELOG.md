# Changelog

Todos los cambios notables de **GYM 2.0** se documentan en este archivo.

El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y el proyecto sigue [Versionado Semántico](https://semver.org/lang/es/).

> Reconstruido a partir del historial de git. La versión en `package.json` es `1.0.0`;
> los números posteriores son una propuesta de versionado para los hitos ya entregados
> (aún sin publicar como tags). Ajusta el `version` de `package.json` cuando decidas el corte.

## [Sin publicar]

### Cambiado
- Refactor de los servicios de sonido y estado para mejorar el manejo de audio y la gestión de estado.

### Corregido
- Definición de tipo de `lastSets` para mayor consistencia.

---

## [1.4.0] - 2026-06-21

### Añadido
- Objetivo de entrenamiento (`strength` / `hypertrophy` / `endurance`) y notas de IA en el perfil de usuario.
- Selector de salto de ejercicio en `/charts` y filtrado mejorado de ítems del gráfico.
- Reordenamiento de ejercicios mediante drag-and-drop (integración de Angular CDK).
- Repeticiones incluidas en la visualización de logros (achievements) del perfil.

### Cambiado
- Formato y legibilidad del código en múltiples componentes y servicios.
- Lógica de ordenamiento de logros en el perfil.
- Traducciones (ES/EN) para la vista de gráficos y la etiqueta de salto.

---

## [1.3.0] - 2026-06-19

### Añadido
- Integración del perfil de usuario y del historial en el servicio de progresión IA.
- Lógica de ajuste por descanso prolongado y de "super completion" en la progresión.
- Sugerencias de ejercicios expandibles en el editor de día.

### Cambiado
- El temporizador de descanso se reinicia al finalizar la sesión de entrenamiento.

### Eliminado
- Parámetro sin uso en la función `detectDeload`.

---

## [1.2.0] - 2026-06-14

### Añadido
- Catálogo centralizado de ejercicios: la identidad y el historial dejan de vivir embebidos en cada día.
- Botón de editar día desde el sheet de detalle de día.
- Delta de volumen y badge de sesión incompleta en el historial de día.
- Etiqueta de "archivado" en las sugerencias de ejercicios del editor.
- Interfaz `LegacyDay` para mayor seguridad de tipos en `migrateToCatalog`.

### Cambiado
- Formato y legibilidad del historial de sesiones y de los cálculos de volumen.

---

## [1.1.0] - 2026-06-13

### Añadido
- Gestión de temas con opción de alto contraste y diálogo de confirmación de salida.
- Registro de peso corporal (weight log) con gestión de entradas y función de deshacer.
- Visualización del peso de la última sesión en la pantalla principal.

### Cambiado
- Refactor de estilos y lógica del componente home; mejora de la sección de rutina.
- Layout de los controles de gráficos y traducciones de métricas y rangos.
- Controles de sets en la tarjeta de ejercicio (exercise-card) simplificados.
- Variables de color para mejor contraste y accesibilidad.

### Eliminado
- Archivo `PLAN-UX.html` con el plan de diseño/UX.

---

## [1.0.0] - 2026-06-12

Primer release público.

### Añadido
- Visualización de la versión de la app (1.0.0) en Settings.
- Gate legal con enlaces a términos y privacidad; aceptación persistida.
- Manejo de errores centralizado con `ErrorService` y feedback de UI.
- Ajuste de háptica (haptics) en las preferencias de la app.
- Días de calendario y filas de rutina clicables para mayor interacción.
- Filtrado por fecha ISO en el historial de día.
- Traducciones ES/EN para los componentes de gráficos y calendario.
- Iconos maskable, fuente JetBrains Mono y script de generación de SVG.
- Workflow de CI y configuración de TypeScript actualizada.

### Cambiado
- Reestructuración de los estilos de la navegación inferior para mejor responsividad.

### Corregido
- Manejo del input de peso para preservar decimales y mejorar la seguridad de tipos.
- Enlaces en el gate legal y páginas de privacidad/términos (rutas correctas).
- Actualización de GitHub Actions (checkout/setup-node) y Node.js a la v22.

---

## [0.1.0] - 2026-05-03

Versión inicial de desarrollo (primer prototipo funcional).

### Añadido
- Gestión de estado y servicios de almacenamiento (`localStorage`) para la app.
- Integración de IA con Groq (migrado desde Gemini) y ajustes relacionados.
- Sheets de detalle e historial de día con iconos y manifest.
- Componente "How It Works" con tarjetas de onboarding y traducciones.
- Directiva de focus trap para navegación por teclado en los bottom sheets.
- Notificaciones vía service worker y feedback de sonido en el temporizador de descanso.
- Workflow de GitHub Actions para deploy a GitHub Pages.
- Branding e iconos de PWA.
