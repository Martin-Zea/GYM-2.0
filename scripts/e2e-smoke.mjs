/**
 * E2E smoke del flujo sagrado: empezar → registrar series → descanso → terminar → historial.
 * Corre contra un dev server en http://localhost:4200 usando el Edge del sistema.
 *   npm run e2e
 * Requiere: playwright-core (ya en node_modules) + Microsoft Edge instalado.
 */
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const BASE = process.env.E2E_BASE ?? 'http://localhost:4200';
const OUT = process.env.E2E_SHOTS ?? 'e2e-shots';
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

mkdirSync(OUT, { recursive: true });

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'ok ' : 'FAIL'} — ${name}`);
  if (!cond) failures++;
};

// Espera al server
for (let i = 0; i < 60; i++) {
  try {
    if ((await fetch(BASE)).ok) break;
  } catch {
    /* aún no */
  }
  await new Promise((r) => setTimeout(r, 1000));
}

const browser = await chromium.launch({ executablePath: EDGE, headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();
const consoleErrors = [];
page.on('pageerror', (e) => consoleErrors.push(e.message));

await page.addInitScript(() => {
  localStorage.setItem('gym_onboarding_done_v1', '1');
  localStorage.setItem('gym_legal_accepted_v1', '1');
  localStorage.setItem('gym_hiw_dismissed', '1');
  localStorage.setItem('gym_backup_dismissed', new Date().toISOString().slice(0, 10));
});

// ── Home ──
async function go(url) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
}

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('home: tarjeta de hoy visible', (await page.locator('.today-card').count()) === 1);
check('home: CTA visible', (await page.locator('.today-cta').count()) === 1);
check('home: chips de ejercicios', (await page.locator('.today-ex-chip').count()) > 0);
check('home: nav de 5 tabs', (await page.locator('.bottom-nav .nav-item').count()) === 5);
await page.screenshot({ path: `${OUT}/01-home.png`, fullPage: true });

// ── Empezar sesión ──
await page.locator('.today-cta').click();
await page.waitForTimeout(700);
check('sesión: header visible', (await page.locator('.session-header').count()) === 1);
check('sesión: nav oculta', (await page.locator('.bottom-nav').count()) === 0);
check('sesión: cola de ejercicios', (await page.locator('.session-pill').count()) > 0);
check('sesión: tarjeta activa', (await page.locator('.asc').count()) === 1);
await page.screenshot({ path: `${OUT}/02-session.png`, fullPage: true });

// ── Serie en un tap ──
await page.locator('.asc-done-btn').click();
await page.waitForTimeout(500);
const restVisible = (await page.locator('.rest-overlay').count()) === 1;
check('descanso: overlay visible tras marcar serie', restVisible);
if (restVisible) {
  const nextText = await page
    .locator('.rest-next')
    .textContent()
    .catch(() => '');
  check('descanso: muestra la próxima serie', /Serie|Set/.test(nextText ?? ''));
  await page.screenshot({ path: `${OUT}/03-rest.png` });
  await page.locator('.rest-skip').click();
  await page.waitForTimeout(400);
}

// Completa el resto del primer ejercicio
for (let i = 0; i < 10; i++) {
  const btn = page.locator('.asc-done-btn');
  if (!(await btn.count())) break;
  const chip = await page.locator('.asc-set-chip').first().textContent();
  await btn.click();
  await page.waitForTimeout(350);
  if (await page.locator('.rest-overlay .rest-skip').count()) {
    await page.locator('.rest-overlay .rest-skip').click();
    await page.waitForTimeout(300);
  }
  // ¿apareció la pregunta de sensación? → ejercicio completo
  if (await page.locator('.asc-feel-chips').count()) break;
  if (i === 9) console.log('   (aviso: no se llegó a completar el ejercicio)', chip);
}
const feelShown = (await page.locator('.asc-feel-chips').count()) === 1;
check('sesión: pregunta de sensación al completar', feelShown);
if (feelShown) {
  await page.locator('.asc-feel-chip').nth(1).click();
  await page.waitForTimeout(300);
  await page.locator('.asc-next-btn').click();
  await page.waitForTimeout(400);
  check(
    'sesión: avanza al siguiente ejercicio',
    (await page.locator('.asc-done-btn').count()) === 1,
  );
}
await page.screenshot({ path: `${OUT}/04-exercise-done.png`, fullPage: true });

// ── Vista tabla y vuelta ──
if (await page.locator('.session-view-toggle').count()) {
  await page.locator('.session-view-toggle').first().click();
  await page.waitForTimeout(400);
  check('sesión: vista tabla renderiza cards', (await page.locator('.exercise').count()) > 0);
  await page.screenshot({ path: `${OUT}/05-table-view.png`, fullPage: true });
  await page.locator('.session-view-toggle').first().click();
  await page.waitForTimeout(400);
}

// ── Sheet de progresión desde la sesión ──
const chartLink = page.locator('.asc-link', { hasText: /progresi|chart|gráfic/i }).first();
if (await chartLink.count()) {
  await chartLink.click();
  await page.waitForTimeout(400);
  check(
    'sesión: sheet de progresión abre',
    (await page.locator('app-exercise-chart-sheet').count()) === 1,
  );
  await page.screenshot({ path: `${OUT}/06-chart-sheet.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
}

// ── Terminar sesión ──
await page.locator('.session-finish-btn').click();
await page.waitForTimeout(400);
check('terminar: sheet visible', (await page.locator('.finish-sheet').count()) === 1);
await page.screenshot({ path: `${OUT}/07-finish.png` });
await page.locator('.finish-sheet .sheet-footer .btn-primary').click();
await page.waitForTimeout(600);

// ── H3: resumen de la sesión (RF-SES-08) ──
check('resumen: sheet visible', (await page.locator('.summary-sheet').count()) === 1);
check('resumen: cifras de la sesión', (await page.locator('.summary-stat').count()) >= 3);
await page.screenshot({ path: `${OUT}/07b-summary.png` });
await page.locator('.summary-close').click();
await page.waitForTimeout(400);
check('resumen: se cierra', (await page.locator('.summary-sheet').count()) === 0);

check('terminar: vuelve al dashboard', (await page.locator('.today-card').count()) === 1);
// La sesión quedó cerrada: no debe ofrecerse reanudarla (RF-SES-07)
check(
  'terminar: sin aviso de sesión interrumpida',
  (await page.locator('.resume-card').count()) === 0,
);

const overflows = await page.evaluate(
  () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
);
check('mobile: sin scroll horizontal', !overflows);

// ── Historial: `/history` volvió a tener contenido propio (T-838) ──
// Redirigía a `/progress` desde T-802; corregir una sesión pasada vivía solo dentro de un
// bottom sheet. Ahora es una pantalla con su ruta, y `/charts` sigue redirigiendo.
await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('historial: /history tiene pantalla propia', page.url().endsWith('/history'));
// En MÓVIL el historial son tarjetas, no la tabla de escritorio (T-840): la tabla partía
// los nombres en cuatro líneas y gastaba una columna en una duración casi siempre vacía.
check('historial: tarjetas de sesión en móvil', (await page.locator('.hist-card').count()) > 1);
check('historial: sin tabla en móvil', (await page.locator('.hist-table').count()) === 0);
check(
  'historial: filtro por día como selector',
  (await page.locator('.hist-select option').count()) > 1,
);

// Y la tarjeta se abre EN su sitio, sin salir de la lista.
await page.locator('.hist-card-head').first().click();
await page.waitForTimeout(400);
check('historial: la tarjeta se despliega', (await page.locator('.hist-card-body').count()) === 1);
check(
  'historial: la lista sigue entera al desplegar',
  (await page.locator('.hist-card').count()) > 1,
);
await page.locator('.hist-card-head').first().click();
await page.waitForTimeout(300);

await page.goto(`${BASE}/charts`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('progreso: /charts sigue redirigiendo', page.url().endsWith('/progress'));

// ── Progreso ──
await page.goto(`${BASE}/progress`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('progreso: calendario', (await page.locator('.cal-grid').count()) === 1);
check('progreso: adherencia y duración', (await page.locator('.stat-grid .stat').count()) >= 2);
check(
  'historial: día entrenado es botón',
  (await page.locator('button.cal-day.trained').count()) > 0,
);
check('progreso: selector + gráfico', (await page.locator('.hist-ex-select').count()) === 1);
const hit = page.locator('.chart-hit').first();
if (await hit.count()) {
  await hit.click();
  await page.waitForTimeout(300);
  check(
    'progreso: tap en punto muestra detalle',
    (await page.locator('.chart-point-info').count()) === 1,
  );
}
await page.screenshot({ path: `${OUT}/08-history.png`, fullPage: true });

// ── Perfil ──
await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('perfil: peso editable', (await page.locator('#weight-today').count()) === 1);
check('perfil: nivel', (await page.locator('.profile-chips--level').count()) === 1);
check('perfil: equipo', (await page.locator('.profile-chips--equipment').count()) === 1);
check('perfil: objetivo', (await page.locator('.profile-chips--goal').count()) === 1);
await page.screenshot({ path: `${OUT}/09-profile.png`, fullPage: true });

// ── Rutinas (R1) ──
await page.goto(`${BASE}/routines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('rutinas: rutina activa destacada', (await page.locator('.card--hi').count()) >= 1);
check('rutinas: 3 caminos para crear', (await page.locator('.rt-create-btn').count()) === 3);
await page.screenshot({ path: `${OUT}/11-routines.png`, fullPage: true });

// ── Coach (C1/C2/C3) ──
await page.goto(`${BASE}/coach`, { waitUntil: 'networkidle' });
await page.waitForTimeout(700);
check('coach: tres pestañas', (await page.locator('.coach-tabs button').count()) === 3);
check('coach: presupuesto visible', (await page.locator('.coach-usage').count()) === 1);
await page.locator('.coach-tabs button').nth(1).click();
await page.waitForTimeout(300);
check('coach: chat sin key queda bloqueado', (await page.locator('.coach-blocked').count()) === 1);
check(
  'coach: enviar deshabilitado sin key',
  await page.locator('.coach-send').first().isDisabled(),
);
await page.screenshot({ path: `${OUT}/12-coach.png`, fullPage: true });

// ── Ajustes como tab (A1) ──
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('ajustes: menú de 6 filas', (await page.locator('.main .li').count()) === 6);
await page.screenshot({ path: `${OUT}/13-settings.png`, fullPage: true });

// ── R2: los días de la rutina y "añadir día" viven en el tab de Rutinas ──
await page.goto(`${BASE}/routines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.card--hi').first().click();
await page.waitForTimeout(400);
check('rutina: días de la rutina listados', (await page.locator('.rt-day').count()) > 0);
check('rutina: botón añadir día', (await page.locator('.rt-wide').count()) >= 1);
await page.screenshot({ path: `${OUT}/10-routine.png`, fullPage: true });

// Inicio ya no duplica la gestión de rutinas: es UNA decisión
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
check('home: sin gestión de rutinas duplicada', (await page.locator('.routine-bar').count()) === 0);

// ── Escritorio: la columna de sección dice SIEMPRE dónde estás (T-839) ──
//
// Regresión real: al entrar a una sección sin `?vista=` no se marcaba ninguna fila, aunque
// la pantalla ya estuviera enseñando una de sus vistas. La fila se encendía solo al pulsarla,
// así que la columna dejaba de responder a lo único que tiene que responder.
await page.setViewportSize({ width: 1440, height: 900 });

for (const [name, url] of [
  ['progreso', '/progress'],
  ['coach', '/coach'],
]) {
  await page.goto(`${BASE}${url}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  const marked = await page.locator('.sr-row--on').count();
  check(`escritorio: ${name} entra con su fila marcada`, marked === 1);
}

// Ajustes en escritorio es una PÁGINA: un bottom sheet ahí es el patrón del pulgar
// puesto donde hay ratón y 1440px de ancho.
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check(
  'escritorio: ajustes es página, no hoja',
  (await page.locator('.settings-inline').count()) === 1,
);
check('escritorio: ajustes sin backdrop', (await page.locator('.sheet-backdrop').count()) === 0);

// La tabla del historial es de escritorio y ahí se queda: en móvil son tarjetas.
await go(`${BASE}/history`);
await page.waitForTimeout(600);
check(
  'escritorio: el historial sigue siendo tabla',
  (await page.locator('.hist-table').count()) === 1,
);

// Rutinas: la lista de días y el día elegido conviven.
await page.goto(`${BASE}/routines`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check(
  'escritorio: rutinas maestro-detalle',
  (await page.locator('.rt-desk-master .rt-day').count()) > 0 &&
    (await page.locator('.rt-tbl .rt-tr').count()) > 0,
);

// Hojas centradas: el asa de arrastre no promete un gesto que no existe.
await go(`${BASE}/settings`);
await page.waitForTimeout(500);
check(
  'escritorio: sin asa de arrastre en las hojas',
  (await page.locator('.sheet-handle:visible').count()) === 0,
);

// El editor de dia se abre EN la pagina de Rutinas.
await go(`${BASE}/routines`);
await page.waitForTimeout(700);
await page.locator('.rt-desk-detail-head .btn').first().click();
await page.waitForTimeout(700);
check(
  'escritorio: editor de dia en panel',
  (await page.locator('.rt-desk-detail .day-editor-inline').count()) === 1 &&
    (await page.locator('.sheet-backdrop').count()) === 0,
);
check(
  'escritorio: la lista de dias no se pierde al editar',
  (await page.locator('.rt-desk-master .rt-day').count()) > 0,
);

/*
 * Sesion de escritorio: tres columnas y el descanso como PANEL, no como velo.
 *
 * Va la ULTIMA de las comprobaciones de escritorio y limpia el estado antes de empezar:
 * a estas alturas la sesion de hoy ya se cerro y el panel no ofrece "Empezar". Y termina
 * saltando el descanso a proposito, porque `gt_rest_timer` sobrevive a la recarga y un
 * temporizador vivo se convierte en un velo que se come los clics del resto del guion.
 */
await go(`${BASE}`);
await page.evaluate(() => localStorage.clear());
await go(`${BASE}`);
await page.waitForTimeout(1000);
await page.locator('.today-cta').first().click();
await page.waitForTimeout(1200);
const cols = await page.evaluate(() => {
  const w = (s) => {
    const el = document.querySelector(s);
    return el ? Math.round(el.getBoundingClientRect().width) : 0;
  };
  return { lista: w('.training-sidebar'), centro: w('.session-main'), ctx: w('.session-context') };
});
check(
  'escritorio: sesion en tres columnas',
  cols.lista > 0 && cols.centro > 0 && cols.ctx > 0 && cols.lista < 400,
);
check(
  'escritorio: sin pildoras duplicando la lista',
  !(await page
    .locator('.session-queue')
    .first()
    .isVisible()
    .catch(() => false)),
);
await page.locator('.asc-done-btn').first().click();
await page.waitForTimeout(900);
check(
  'escritorio: el descanso es panel, no velo',
  (await page.locator('.session-context .rest-panel').count()) === 1 &&
    (await page.locator('.rest-overlay').count()) === 0,
);
await page
  .locator('.rest-skip')
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(400);

await page.setViewportSize({ width: 390, height: 844 });

/*
 * T-704 / T-840 · Objetivos táctiles de 44 px, medidos de verdad.
 *
 * Esto medía `height < MIN && width < MIN`: solo marcaba lo que era pequeño en LAS DOS
 * dimensiones, así que un chip de 148×32 pasaba y un stepper de 28×44 también. Decía
 * "0 pequeños" mientras había decenas, y por eso se fueron acumulando.
 *
 * La regla real es 44×44: falla si CUALQUIERA de las dos se queda corta. Y se mide en
 * TODAS las pantallas, no en la última que quedara abierta.
 *
 * `data-tap-exempt` es la única salida, y obliga a escribir por qué en el marcado: sirve
 * para enlaces de texto dentro de un párrafo, donde un bloque de 44 px rompería la línea.
 */
const TAP_AUDIT = () => {
  const MIN = 44;
  const bad = [];
  const sel = 'button, a[href], select, input, textarea, [role="button"]';
  for (const el of document.querySelectorAll(sel)) {
    if (el.closest('[data-tap-exempt]')) continue;
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width === 0 || r.height === 0) continue;
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (r.height < MIN || r.width < MIN) {
      const label = (el.getAttribute('aria-label') || el.textContent || el.tagName)
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 24);
      bad.push(`${label} ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
  }
  return bad;
};

// El medidor va al final del guion, donde el viewport ya está en escritorio: se vuelve a
// móvil A PROPÓSITO. Sin esta línea medía 1440 px y decía "0 pequeños" con razón —y sin
// mirar el teléfono, que es de lo que trata la comprobación.
await page.setViewportSize({ width: 390, height: 844 });

const tapPantallas = [
  ['inicio', '/'],
  ['progreso', '/progress'],
  ['rutinas', '/routines'],
  ['coach', '/coach'],
  ['ajustes', '/settings'],
  ['perfil', '/profile'],
  ['historial', '/history'],
];
const smallTargets = [];
for (const [nombre, ruta] of tapPantallas) {
  await go(`${BASE}${ruta}`);
  await page.waitForTimeout(500);
  for (const t of await page.evaluate(TAP_AUDIT)) smallTargets.push(`${nombre}: ${t}`);
}
// Y la sesión, que es donde más se pulsa. Se limpia el estado: a estas alturas del guion
// la sesión de hoy ya se cerró y el panel no ofrece "Empezar".
await go(`${BASE}`);
await page.evaluate(() => localStorage.clear());
await go(`${BASE}`);
await page.waitForTimeout(800);
if (await page.locator('.today-cta').count()) {
  await page.locator('.today-cta').first().click();
  await page.waitForTimeout(1200);
  for (const t of await page.evaluate(TAP_AUDIT)) smallTargets.push(`sesion: ${t}`);
  await page
    .locator('.session-view-toggle, .sv-toggle')
    .first()
    .click()
    .catch(() => {});
  await page.waitForTimeout(700);
  for (const t of await page.evaluate(TAP_AUDIT)) smallTargets.push(`sesion-lista: ${t}`);
}
check(`mobile: targets de 44px (${smallTargets.length} pequeños)`, smallTargets.length === 0);
if (smallTargets.length) console.log('   targets pequeños:', smallTargets.slice(0, 40));

check('cero errores de página', consoleErrors.length === 0);
if (consoleErrors.length) console.log('pageerrors:', consoleErrors.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
process.exit(failures ? 1 : 0);
