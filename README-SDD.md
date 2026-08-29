# GymTrack AI — Paquete SDD (Spec-Driven Development)

Este paquete convierte el análisis del proyecto en artefactos SDD listos para trabajar con un agente de código (Claude Code, Copilot, Cursor, etc.): la especificación es la fuente de verdad y el código se deriva y verifica contra ella.

## Contenido

```
gymtrack-sdd/
├── README.md                      ← esta guía
├── memory/
│   └── constitution.md            ← 10 principios no negociables
├── specs/001-gymtrack-adaptacion/
│   ├── spec.md                    ← requisitos EARS + escenarios + criterios medibles
│   ├── plan.md                    ← arquitectura, decisiones, riesgos
│   └── tasks.md                   ← ~45 tareas atómicas por fases, con trazabilidad
└── docs/
    ├── analisis-app-gym.md        ← análisis funcional completo (fuente de dominio)
    └── disenos-vistas-gym.html    ← 23 mockups con IDs de vista
```

## Opción A — Con GitHub Spec Kit (recomendada)

1. Instalar el CLI e inicializar en el repo de tu app existente:
   ```bash
   uvx --from git+https://github.com/github/spec-kit.git specify init . --ai claude
   ```
   (cambia `claude` por tu agente: `copilot`, `cursor`, `gemini`…)
2. Copiar estos archivos sobre la estructura que crea:
   - `memory/constitution.md` → reemplaza el generado.
   - `specs/001-gymtrack-adaptacion/` → cópialo tal cual.
   - `docs/` → a la raíz del repo.
3. En tu agente, ejecutar en orden (Spec Kit instala los slash commands):
   - `/speckit.constitution` → confirmar/registrar la constitución.
   - `/speckit.specify` → pegar o referenciar `spec.md` (ya está escrita; el comando la valida y detecta huecos).
   - `/speckit.clarify` → resolverá los 4 `[ACLARAR]` de la spec **después** de la tarea T-000 (auditoría).
   - `/speckit.plan` y `/speckit.tasks` → contrastar con los `plan.md` y `tasks.md` de este paquete; quédate con la fusión.
   - `/speckit.analyze` → chequeo de consistencia spec ↔ plan ↔ tasks antes de tocar código.
   - `/speckit.implement` → ejecutar fase por fase (F0 primero, siempre).
   - Al final, el paso de convergencia verifica la implementación contra la spec; repite implement/converge hasta converger.

## Opción B — Manual con cualquier agente de chat/código

Sin instalar nada: en cada sesión de trabajo dale al agente, en este orden, (1) `constitution.md`, (2) `spec.md`, (3) `plan.md`, y pídele **una tarea de `tasks.md` por vez**, exigiendo que cite los RF que cumple y que los tests del Art. 9 pasen antes de dar la tarea por cerrada. Marca las tareas completadas en el propio `tasks.md` (es tu memoria durable entre sesiones).

## Reglas de oro para que SDD funcione en este proyecto

1. **F0 antes que nada.** T-000 audita tu app actual contra las checklists del análisis; sin ese mapa, cualquier plan es ficción. Sus hallazgos actualizan la spec (los `[ACLARAR]`).
2. **Una tarea = un cambio pequeño y verificable.** Si el agente quiere hacer tres tareas juntas, frénalo.
3. **La spec manda.** Si durante la implementación aparece algo que la contradice, se edita la spec primero (con motivo) y luego el código — nunca al revés en silencio.
4. **Convergencia real:** EA-1…EA-6 se prueban en un celular de gama media, no en el navegador de escritorio (Art. 1).
5. **La constitución corta discusiones:** ¿agregar un mini-backend? Art. 3 dice no. ¿Llamar a la IA por ejercicio? Art. 5 dice no.

## Orden de fases y qué obtienes en cada una

F0 auditoría → F1 datos sólidos (ya puedes confiar en no perder nada) → F2 sesión activa (la app ya es usable en el gym) → F3 motor local (progresión sin IA) → F4 capa IA (Groq/Cohere con presupuesto) → F5 rutinas + generador → F6 progreso/gráficas → F7 PWA y pulido → Convergencia (T-900…T-902).

Tras F2+F3 ya tienes un producto entrenable de punta a punta; todo lo demás suma sobre una base que funciona.
