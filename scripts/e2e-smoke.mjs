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
check('home: nav de 3 tabs', (await page.locator('.bottom-nav .nav-item').count()) === 3);
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

// ── Historial ──
await page.goto(`${BASE}/history`, { waitUntil: 'networkidle' });
await page.waitForTimeout(600);
check('historial: calendario', (await page.locator('.cal-grid').count()) === 1);
check(
  'historial: día entrenado es botón',
  (await page.locator('button.cal-day.trained').count()) > 0,
);
check('historial: selector + gráfico', (await page.locator('.hist-ex-select').count()) === 1);
const hit = page.locator('.chart-hit').first();
if (await hit.count()) {
  await hit.click();
  await page.waitForTimeout(300);
  check(
    'historial: tap en punto muestra detalle',
    (await page.locator('.chart-point-info').count()) === 1,
  );
}
await page.screenshot({ path: `${OUT}/08-history.png`, fullPage: true });

// ── Perfil ──
await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
check('perfil: peso editable', (await page.locator('#weight-today').count()) === 1);
check('perfil: objetivo', (await page.locator('.profile-goal-chips').count()) === 1);
await page.screenshot({ path: `${OUT}/09-profile.png`, fullPage: true });

// ── "+ Nuevo día" siempre disponible ──
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(500);
await page.locator('.routine-section-header').click();
await page.waitForTimeout(300);
check('rutina: botón + nuevo día visible', (await page.locator('.routine-add-btn').count()) === 1);
await page.screenshot({ path: `${OUT}/10-routine.png`, fullPage: true });

check('cero errores de página', consoleErrors.length === 0);
if (consoleErrors.length) console.log('pageerrors:', consoleErrors.join(' | '));

await browser.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
process.exit(failures ? 1 : 0);
