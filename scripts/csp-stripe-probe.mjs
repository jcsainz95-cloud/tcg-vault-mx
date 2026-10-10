#!/usr/bin/env node
// =============================================================================
// csp-stripe-probe.mjs — «¿la CSP en `enforce` deja cargar Stripe.js y montar el
//                         PaymentElement?»                     · devops · CL-1
// =============================================================================
// DE DÓNDE VIENE (CL-1 / SEC-HDR-2, 2026-10-10). Al pasar `CSP_MODE` a 'enforce'
// (`frontend/src/security/csp.ts`) el riesgo de negocio es uno: que la política
// bloquee el pago. Ningún E2E existente lo mide: el `@real comprar` de
// `checkout.spec.ts` comprueba que se abre el modal, no que el iframe de Stripe
// cargue, y desde el contenedor de los agentes js.stripe.com da 403 (proxy).
// Esta sonda corre en un runner de GitHub (con red) — `csp-stripe-probe.yml`.
//
// QUÉ HACE
//   · Sirve en 127.0.0.1 una página con la cabecera `Content-Security-Policy`
//     que produce `buildCsp(nonce, env, 'enforce')` — la MISMA función que usa el
//     middleware (importada del .ts, sin copiarla) con un entorno de producción
//     (`VERCEL_ENV=production`, API https en un host `.invalid`: ningún informe
//     sale hacia producción).
//   · Un `<script nonce>` hace lo que hace `loadStripe` (`@stripe/stripe-js`):
//     inserta `<script src="https://js.stripe.com/v3/">` por DOM (lo valida
//     `'strict-dynamic'`), y monta un PaymentElement en modo diferido
//     (`mode:'payment'`, MXN): no hace falta PaymentIntent ni backend.
//   · Escucha `securitypolicyviolation` en el documento y los errores CSP de la
//     consola.
//   · AUTOPRUEBA (sin red): la misma página provoca DOS violaciones a propósito
//     (un `<script>` en línea sin nonce y un iframe a un origen no permitido). Si
//     la sonda no las ve, no sabe ver violaciones ⇒ rc 2, no un verde.
//
// RESULTADO (rc)
//   0  Stripe.js cargó, hay iframe de js.stripe.com y CERO violaciones fuera de
//      las dos plantadas.
//   1  alguna violación no plantada (directiva + origen bloqueado impresos), o
//      Stripe.js bloqueado por la CSP.
//   2  no concluyente: la autoprueba no vio sus violaciones, o Stripe.js no
//      cargó SIN violación (red), o falta el navegador.
//   «PaymentElement ready» se informa aparte: exige una `pk_test_` válida
//   (STRIPE_PK). Sin ella Stripe responde 401 dentro de SU iframe, que no es
//   nuestra CSP.
//
// LO QUE NO CUBRE (declarado): el reto 3-D Secure real (iframe del banco DENTRO
// del de Stripe: lo rige la CSP de Stripe, no la nuestra; el marco de Stripe que
// lo aloja es js.stripe.com/hooks.stripe.com, en `frame-src`), Google Identity,
// y la navegación de `return_url` (navegación de primer nivel: no la rige CSP).
//
// Uso:  STRIPE_PK=pk_test_… node scripts/csp-stripe-probe.mjs [--timeout 30]
//       (Chromium: el de Playwright de frontend/node_modules, o
//        PLAYWRIGHT_CHROMIUM_PATH)
// =============================================================================
import http from 'node:http';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const TIMEOUT_S = Number(args[args.indexOf('--timeout') + 1] || 0) || 30;
const PK = (process.env.STRIPE_PK || '').trim();
const PLANT_FRAME = 'https://plantado.example.invalid';

const say = (s) => console.log(s);
const out = (rc, msg) => {
  say(msg);
  process.exit(rc);
};

if (PK && !/^pk_test_[A-Za-z0-9_]+$/.test(PK)) out(2, '::error::STRIPE_PK debe ser una pk_test_ (nunca live). NO concluyente.');

const csp = await import(pathToFileURL(path.join(ROOT, 'frontend/src/security/csp.ts')).href).catch((e) =>
  out(2, `::error::no pude importar frontend/src/security/csp.ts (${e.message}). Hace falta Node ≥ 22.18 (tipos nativos). NO concluyente.`),
);
// API en un host `.invalid` (RFC 2606, nunca resuelve): la política tiene la MISMA forma que en producción
// (https ⇒ `upgrade-insecure-requests`), pero los informes de las violaciones PLANTADAS no llegan a
// `POST /telemetry/csp` de producción: no ensucian la búsqueda de `CSP_VIOLATION` del dueño en Railway.
const ENV = {
  apiBaseUrl: 'https://api.csp-probe.invalid/api/v1',
  uploadOrigin: null,
  vercelEnv: 'production',
  nodeEnv: 'production',
};

const require = createRequire(path.join(ROOT, 'frontend/package.json'));
let chromium;
try {
  ({ chromium } = require('@playwright/test'));
} catch (e) {
  out(2, `::error::no encuentro @playwright/test en frontend/node_modules (npm ci en frontend). NO concluyente.`);
}

const page = (nonce) => `<!doctype html><html><head><meta charset="utf-8"><title>csp-stripe-probe</title>
<script nonce="${nonce}">
  window.__v = []; window.__s = {};
  document.addEventListener('securitypolicyviolation', function (e) {
    window.__v.push({ d: e.effectiveDirective, b: e.blockedURI, disp: e.disposition, sample: e.sample || '' });
  });
</script></head><body>
<div id="pe"></div>
<script nonce="${nonce}">
  // Igual que loadStripe: <script> insertado por DOM desde un script de confianza.
  var s = document.createElement('script');
  s.src = 'https://js.stripe.com/v3/';
  s.onerror = function () { window.__s.scriptError = true; };
  s.onload = function () {
    window.__s.scriptLoaded = typeof window.Stripe === 'function';
    try {
      var stripe = window.Stripe(${JSON.stringify(PK || 'pk_test_csp_probe_sin_clave')});
      var el = stripe.elements({ mode: 'payment', amount: 10000, currency: 'mxn' });
      var pe = el.create('payment');
      pe.on('ready', function () { window.__s.ready = true; });
      pe.on('loaderror', function (e) { window.__s.loaderror = (e && e.error && (e.error.code || e.error.type)) || 'loaderror'; });
      pe.mount('#pe');
      window.__s.mounted = true;
    } catch (e) { window.__s.mountError = String(e && e.message || e); }
  };
  document.head.appendChild(s);
  // AUTOPRUEBA 1/2: iframe a un origen que frame-src NO permite (se bloquea antes de la red).
  var f = document.createElement('iframe'); f.src = '${PLANT_FRAME}/'; document.body.appendChild(f);
</script>
<!-- AUTOPRUEBA 2/2: script en línea SIN nonce. -->
<script>window.__s.plantedInlineRan = true;</script>
</body></html>`;

let lastPolicy = '';
const server = http.createServer((req, res) => {
  if (req.url !== '/') {
    res.writeHead(404).end();
    return;
  }
  const nonce = randomBytes(16).toString('base64');
  lastPolicy = csp.buildCsp(nonce, ENV, 'enforce');
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', [csp.cspHeaderName('enforce')]: lastPolicy });
  res.end(page(nonce));
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/`;

let browser;
try {
  browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  );
} catch (e) {
  server.close();
  out(2, `::error::no pude lanzar Chromium (${e.message.split('\n')[0]}). NO concluyente.`);
}
const ctx = await browser.newContext();
const pg = await ctx.newPage();
const consoleCsp = [];
pg.on('console', (m) => {
  if (/Content Security Policy/i.test(m.text())) consoleCsp.push(m.text().slice(0, 300));
});
await pg.goto(url, { waitUntil: 'load' });
const deadline = Date.now() + TIMEOUT_S * 1000;
let st = {};
while (Date.now() < deadline) {
  st = await pg.evaluate(() => window.__s);
  if (st.scriptError || st.ready || st.loaderror || st.mountError) break;
  await pg.waitForTimeout(500);
}
await pg.waitForTimeout(2000); // deja llegar violaciones tardías (iframes de Stripe)
st = await pg.evaluate(() => window.__s);
const viol = await pg.evaluate(() => window.__v);
const stripeFrames = pg.frames().map((f) => f.url()).filter((u) => u.startsWith('https://js.stripe.com/'));
await browser.close();
server.close();

say(`  política servida (enforce, entorno de producción):\n    ${lastPolicy}`);
const planted = (v) =>
  (v.d === 'frame-src' && v.b.startsWith(PLANT_FRAME)) || (/^script-src/.test(v.d) && v.b === 'inline');
const ajenas = viol.filter((v) => !planted(v));
const vioFrame = viol.some((v) => v.d === 'frame-src' && v.b.startsWith(PLANT_FRAME));
const vioInline = viol.some((v) => /^script-src/.test(v.d) && v.b === 'inline');
say(`  autoprueba: iframe plantado bloqueado=${vioFrame} · script en línea sin nonce bloqueado=${vioInline} (se ejecutó=${!!st.plantedInlineRan})`);
say(`  Stripe.js cargado=${!!st.scriptLoaded} · error de carga=${!!st.scriptError} · montado=${!!st.mounted} · ready=${!!st.ready}${st.loaderror ? ` · loaderror=${st.loaderror}` : ''}${st.mountError ? ` · mountError=${st.mountError}` : ''}`);
say(`  iframes de js.stripe.com: ${stripeFrames.length}${stripeFrames.length ? ` (p. ej. ${stripeFrames[0].split('#')[0].slice(0, 90)})` : ''}`);
for (const v of ajenas) say(`  ✗ VIOLACIÓN ${v.disp} · ${v.d} · bloqueado=${v.b}`);
for (const c of consoleCsp.slice(0, 5)) say(`    consola: ${c}`);

if (!vioFrame || !vioInline || st.plantedInlineRan)
  out(2, '::error::AUTOPRUEBA FALLIDA: la sonda no vio sus dos violaciones plantadas (o la CSP no se aplicó). NO concluyente.');
if (ajenas.length)
  out(1, `::error::CL-1: la CSP en enforce produce ${ajenas.length} violación(es) en la página de pago. Arreglo: origen EXACTO en frontend/src/security/csp.ts (dueño: frontend), nunca comodín de esquema.`);
if (!st.scriptLoaded)
  out(2, '::error::Stripe.js no cargó y NO hubo violación CSP: es red, no política. NO concluyente.');
if (!stripeFrames.length)
  out(2, '::error::Stripe.js cargó pero no apareció ningún iframe de js.stripe.com. NO concluyente.');
say(`  ✔ CL-1: con la CSP en enforce Stripe.js carga y monta su iframe sin violaciones.${st.ready ? ' PaymentElement ready.' : ' (ready NO medido: hace falta STRIPE_PK pk_test_ válida)'}`);
process.exit(0);
