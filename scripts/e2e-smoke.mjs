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

// ── T-704 · Pase mobile-first: targets y ancho (Art. 1, CE-1) ──
const smallTargets = await page.evaluate(() => {
  const MIN = 44;
  const selectors = 'button, a[href], select, input[type="number"]';
  const bad = [];
  for (const el of document.querySelectorAll(selectors)) {
    const r = el.getBoundingClientRect();
    // Solo lo visible: lo que está oculto no se puede pulsar y no cuenta
    if (r.width === 0 || r.height === 0) continue;
    if (r.height < MIN && r.width < MIN) {
      bad.push(`${el.tagName}.${el.className}`.slice(0, 60));
    }
  }
  return bad;
});
check(`mobile: targets de 44px (${smallTargets.length} pequeños)`, smallTargets.length === 0);
if (smallTargets.length) console.log('   targets pequeños:', smallTargets.slice(0, 6));

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
check('historial: tabla de sesiones', (await page.locator('.hist-table').count()) === 1);
check('historial: filtros por día', (await page.locator('.hist-chip').count()) > 1);

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

check('cero errores de página', consoleErrors.length === 0);
if (consoleErrors.length) console.log('pageerrors:', consoleErrors.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
process.exit(failures ? 1 : 0);
