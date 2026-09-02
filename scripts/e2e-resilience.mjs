/**
 * E2E de resiliencia: los casos límite que el smoke no cubre y que hasta T-831 nunca se
 * habían comprobado — sin conexión, sin espacio y con dos pestañas peleando por escribir.
 *
 *   npm run build && npm run e2e:resilience
 *
 * Corre contra el build de PRODUCCIÓN servido como estático, no contra `ng serve`: el dev
 * server no registra el service worker, así que ahí el modo offline no se puede probar —
 * era justo el hueco que dejaba la validación anterior.
 *
 * Requiere: playwright-core (ya en node_modules) + Microsoft Edge instalado.
 */
import { chromium } from 'playwright-core';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const ROOT = process.env.E2E_DIST ?? 'dist/GYM-2.0/browser';
const PORT = Number(process.env.E2E_PORT ?? 4321);
const EDGE = process.env.E2E_EDGE ?? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const BASE = `http://localhost:${PORT}`;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

let failures = 0;
const check = (name, cond, extra = '') => {
  console.log(`${cond ? 'ok  ' : 'FAIL'} — ${name}${extra ? ` :: ${extra}` : ''}`);
  if (!cond) failures++;
};

/** Estático mínimo: el service worker exige orígenes reales y tipos MIME correctos. */
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]);
  const candidates = [join(ROOT, normalize(url)), join(ROOT, 'index.html')];
  for (const file of candidates) {
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': MIME[extname(file)] ?? 'application/octet-stream',
        // El SW necesita poder controlar todo el scope y no quedarse cacheado por el navegador.
        'Cache-Control': 'no-cache',
      });
      res.end(body);
      return;
    } catch {
      /* siguiente candidato */
    }
  }
  res.writeHead(404).end('no encontrado');
});
await new Promise((r) => server.listen(PORT, r));

const seedFlags = () => {
  localStorage.setItem('gym_onboarding_done_v1', '1');
  localStorage.setItem('gym_legal_accepted_v1', '1');
  localStorage.setItem('gym_hiw_dismissed', '1');
  localStorage.setItem('gym_backup_dismissed', '2099-01-01');
};

const browser = await chromium.launch({ executablePath: EDGE, headless: true });

// ═══ 1 · Sin conexión: la promesa central de una PWA de gimnasio ═══
console.log('\n── Sin conexión ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(seedFlags);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  const registered = await page
    .waitForFunction(() => navigator.serviceWorker?.controller !== null, null, { timeout: 45000 })
    .then(() => true)
    .catch(() => false);
  check('el service worker toma el control', registered);

  // La key se siembra ANTES de cortar la red: sin ella `blockedBy()` responde 'no_key' y
  // nunca llega a mirar la conexión, así que el mensaje de red no se estaría probando.
  // Va donde la app la tenga en ese momento: tras el primer arranque, el blob legacy.
  await page.evaluate(() => {
    const legacy = localStorage.getItem('gym_app_state_v2');
    if (legacy) {
      const st = JSON.parse(legacy);
      st.settings.apiKey = 'gsk_de_prueba';
      localStorage.setItem('gym_app_state_v2', JSON.stringify(st));
      return;
    }
    const ai = JSON.parse(localStorage.getItem('gt_ai') ?? '{"keys":{}}');
    ai.keys.groq = 'gsk_de_prueba';
    localStorage.setItem('gt_ai', JSON.stringify(ai));
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  await ctx.setOffline(true);

  // La primera navegación sin red puede caer en la página de error del navegador antes de
  // que el service worker responda; se reintenta en vez de dar el arranque por fallido.
  let booted = false;
  for (let i = 0; i < 3 && !booted; i++) {
    await page.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.waitForTimeout(2000);
    booted = (await page.locator('.today-cta, .empty').count()) > 0;
  }
  check('la app ARRANCA sin red', booted);

  if (booted) {
    await page
      .locator('.today-cta')
      .click()
      .catch(() => {});
    await page.waitForTimeout(1200);
    check(
      'se puede entrar en la sesión sin red',
      (await page.locator('.asc, .exercise-card, .session-header').count()) > 0,
    );

    await page
      .goto(`${BASE}/routines?gen=1&days=3`, { waitUntil: 'domcontentloaded' })
      .catch(() => {});
    await page.waitForTimeout(1800);
    const genMsg = await page
      .locator('.rt-error')
      .first()
      .innerText()
      .catch(() => '');
    check(
      'el generador explica que no hay conexión',
      /conexi|offline/i.test(genMsg),
      genMsg.slice(0, 70),
    );
  }

  check('cero errores de página sin red', errors.length === 0, errors.slice(0, 2).join(' | '));
  await ctx.setOffline(false);
  await ctx.close();
}

// ═══ 2 · Sin espacio: que el fallo se vea y NO corrompa lo guardado ═══
console.log('\n── Cuota agotada ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(seedFlags);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);

  // 1) Cuota agotada de verdad, con bloques cada vez más finos: con un solo tamaño queda
  //    hueco libre y la comprobación no valdría nada.
  const lleno = await page.evaluate(() => {
    let n = 0;
    for (const kb of [512, 64, 8, 1]) {
      const chunk = 'x'.repeat(kb * 1024);
      try {
        for (let i = 0; i < 5000; i++, n++) localStorage.setItem(`__relleno_${n}`, chunk);
      } catch {
        /* siguiente tamaño */
      }
    }
    try {
      localStorage.setItem('__sonda', 'x'.repeat(2048));
      localStorage.removeItem('__sonda');
      return false;
    } catch {
      return true;
    }
  });
  check('la cuota queda agotada para claves nuevas', lleno);

  await page
    .locator('.today-cta')
    .click()
    .catch(() => {});
  await page.waitForTimeout(2000);

  // Sobrescribir una clave que YA existe libera su valor anterior, así que la app sigue
  // guardando aunque no quepa ninguna clave nueva. Eso es una virtud del diseño —una sola
  // clave por partición en vez de crecer— y hay que fijarla para que no se pierda.
  const after = await page.evaluate(
    () => localStorage.getItem('gym_app_state_v2') ?? localStorage.getItem('gt_routines'),
  );
  check('sigue guardando pese a la cuota (sobrescribe, no crece)', !!after);
  check('lo ya guardado NO se corrompe', !!after && after.length > 0 && after !== 'undefined');

  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('__relleno_')) localStorage.removeItem(k);
    }
  });

  await ctx.close();
}

// ═══ 2b · Cuando el guardado SÍ falla, hay que decirlo ═══
// Se fuerza el fallo en vez de esperar a que el navegador lo provoque: así es determinista.
// En contexto limpio porque el bloque anterior deja una sesión empezada, y con una sesión
// en curso Inicio no ofrece "saltar día" — no habría forma de provocar una escritura.
console.log('\n── Guardado fallido ──');
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.addInitScript(seedFlags);
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2000);
  // Segundo arranque: es cuando la app migra al almacenamiento particionado, que es donde
  // acaba todo usuario real y donde el commit por journal tiene que revertir limpio.
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  await page.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('gt_') || String(k).startsWith('gym_app_state')) {
        throw new DOMException('lleno', 'QuotaExceededError');
      }
      return real.call(this, k, v);
    };
  });

  const antes = await page.evaluate(
    () => localStorage.getItem('gt_routines') ?? localStorage.getItem('gym_app_state_v2'),
  );
  await page.locator('.today-action-btn--muted').first().click();
  await page.waitForTimeout(500);
  await page.locator('.exit-confirm-panel button').last().click();
  await page.waitForTimeout(2500);

  const despues = await page.evaluate(
    () => localStorage.getItem('gt_routines') ?? localStorage.getItem('gym_app_state_v2'),
  );
  check('un guardado fallido NO deja el estado a medias', despues === antes);
  const avisó = await page.locator('.save-error-toast, .tab-conflict-toast').count();
  check('si el guardado falla, la app lo dice', avisó > 0, `avisos=${avisó}`);
  await ctx.close();
}

// ═══ 3 · Dos pestañas: solo una escribe ═══
console.log('\n── Dos pestañas a la vez ──');
{
  // MISMO contexto: el lock es por origen y perfil, con dos contextos no habría conflicto.
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const primaria = await ctx.newPage();
  await primaria.addInitScript(seedFlags);
  await primaria.goto(BASE, { waitUntil: 'networkidle' });
  await primaria.waitForTimeout(1500);

  const secundaria = await ctx.newPage();
  await secundaria.goto(BASE, { waitUntil: 'networkidle' });
  await secundaria.waitForTimeout(2500);

  const aviso = await secundaria.locator('.app-toast, [role="status"], .tab-conflict').count();
  check('la segunda pestaña avisa del conflicto', aviso > 0, `avisos=${aviso}`);

  await secundaria.goto(`${BASE}/settings`, { waitUntil: 'networkidle' }).catch(() => {});
  await secundaria.waitForTimeout(1200);
  check('la primaria sigue viva', (await primaria.locator('.today-cta, .empty').count()) > 0);
  await ctx.close();
}

await browser.close();
server.close();
console.log(failures ? `\n${failures} FALLOS` : '\nTODO OK');
process.exit(failures ? 1 : 0);
