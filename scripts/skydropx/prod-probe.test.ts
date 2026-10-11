/**
 * prod-probe.test.ts — 🔒 la prueba propia de la sonda (PS-99 (d), API_CONTRACT §M4-SHIP.19.19.17):
 * `prod-probe.ts` NO PUEDE llamar a ningún endpoint de compra, cancelación ni protección, ni a ninguna otra
 * escritura, y no imprime credenciales.                                                         · devops
 *
 * Corre con `node:test` (sin jest: vive fuera de `backend/`) a través de ts-node del backend:
 *     scripts/skydropx/run-prod-probe.sh test
 * En CI: job `backend` de ci.yml, paso «Sonda Skydropx: prueba de solo lectura». ⛔ Sin red: todo contra el doble.
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  M_PRD_1_VALUES,
  PROBE_ALLOWED_POST_SUFFIXES,
  ProbeForbiddenRequestError,
  ProbeTransport,
  Redactor,
  assertReadOnlyRequest,
  parseArgs,
  preflight,
  runProbe,
} from './prod-probe';
import { STUB_SECRETS, createStubSkydropx } from './probe-stub';

const ORIGIN = 'https://pro.skydropx.com';

/** Las escrituras que la sonda jamás puede hacer: compra, cancelación, protección y el resto de §19.19.3 (6). */
const MUST_REJECT: Array<[string, string]> = [
  ['POST', `${ORIGIN}/api/v2/shipments`], // 💰 COMPRA
  ['POST', `${ORIGIN}/api/v1/shipments`],
  ['POST', `${ORIGIN}/api/v1/shipments/abc-123/cancellations`],
  ['POST', `${ORIGIN}/api/v1/shipments/abc-123/protect`],
  ['POST', `${ORIGIN}/api/v1/pickups`],
  ['POST', `${ORIGIN}/api/v1/rate/shipments`],
  ['POST', `${ORIGIN}/api/v1/orders`],
  ['POST', `${ORIGIN}/api/v1/address_templates`],
  ['POST', `${ORIGIN}/api/v1/address_templates/1/verify_by_carriers`],
  ['POST', `${ORIGIN}/api/v1/external_shipments`],
  ['POST', `${ORIGIN}/api/v1/oauth/revoke`],
  ['POST', `${ORIGIN}/oauth/token`], // fuera del prefijo /api/v1
  ['PATCH', `${ORIGIN}/api/v1/address_templates/1`],
  ['PUT', `${ORIGIN}/api/v1/settings/notifications`],
  ['DELETE', `${ORIGIN}/api/v1/address_templates/1`],
  ['DELETE', `${ORIGIN}/api/v1/shipments/abc-123`],
  ['HEAD', `${ORIGIN}/api/v1/finance/credits`],
  ['OPTIONS', `${ORIGIN}/api/v1/quotations`],
  // Trucos de ruta: se comparan DESPUÉS de normalizar.
  ['POST', `${ORIGIN}/api/v1/quotations/../shipments`],
  ['POST', `${ORIGIN}/api/v2/quotations/%2e%2e/shipments`],
  ['POST', `${ORIGIN}/api/v1/quotations/`],
  ['POST', `${ORIGIN}/api/v1/quotations?then=shipments`],
  ['POST', `${ORIGIN}/api/v2/quotations/q-1/shipments`],
  ['POST', `${ORIGIN}/API/V2/SHIPMENTS`],
  ['post', `${ORIGIN}/api/v2/shipments`],
  // Otro host, http, credenciales en la URL.
  ['POST', 'https://evil.example/api/v1/quotations'],
  ['GET', 'https://evil.example/api/v1/finance/credits'],
  ['GET', 'http://pro.skydropx.com/api/v1/finance/credits'],
  ['GET', 'https://user:pw@pro.skydropx.com/api/v1/finance/credits'],
  ['GET', 'https://pro.skydropx.com.evil.example/api/v1/finance/credits'],
];

const MUST_ALLOW: Array<[string, string]> = [
  ['POST', `${ORIGIN}/api/v1/oauth/token`],
  ['POST', `${ORIGIN}/api/v1/quotations`],
  ['POST', `${ORIGIN}/api/v2/quotations`],
  ['GET', `${ORIGIN}/api/v1/quotations/q-1`],
  ['GET', `${ORIGIN}/api/v1/finance/credits`],
  ['GET', `${ORIGIN}/api/v1/office_points?rate_id=r&direction=delivery`],
  ['GET', `${ORIGIN}/api/v1/shipments?page=1&per_page=5`],
];

test('lista blanca: toda escritura que no sea token o cotización se veta (compra, cancelación, protección…)', () => {
  for (const [m, u] of MUST_REJECT) {
    assert.throws(() => assertReadOnlyRequest(m, u, ORIGIN), ProbeForbiddenRequestError, `${m} ${u} debía vetarse`);
  }
});

test('lista blanca: token, cotizaciones y GET sí pasan (si no, la sonda no mide nada)', () => {
  for (const [m, u] of MUST_ALLOW) assert.doesNotThrow(() => assertReadOnlyRequest(m, u, ORIGIN), `${m} ${u} debía pasar`);
  assert.deepEqual([...PROBE_ALLOWED_POST_SUFFIXES], ['/api/v1/oauth/token', '/api/v1/quotations', '/api/v2/quotations']);
});

test('el veto ocurre ANTES de la red: cero llamadas al transporte en cada rechazo', async () => {
  for (const [m, u] of MUST_REJECT) {
    let calls = 0;
    const t = new ProbeTransport({
      origin: ORIGIN,
      minIntervalMs: 0,
      sleep: async () => undefined,
      fetchImpl: async () => {
        calls += 1;
        return { status: 200, text: async () => '{}' };
      },
    });
    const path = u.startsWith(ORIGIN) ? u.slice(ORIGIN.length) : u;
    // Para los de otro host, se fuerza la URL completa sustituyendo el origen del transporte.
    const tt = u.startsWith(ORIGIN) ? t : Object.assign(t, { url: () => u });
    await assert.rejects(
      tt.request(m as 'GET' | 'POST', path, { json: {} }),
      ProbeForbiddenRequestError,
      `${m} ${u}: debía rechazarse`,
    );
    assert.equal(calls, 0, `${m} ${u}: llegó al transporte`);
    assert.equal(t.requests, 0);
  }
});

test('una corrida ENTERA contra el doble: solo token, cotizaciones y GET; cero compras', async () => {
  const stub = createStubSkydropx();
  const t = new ProbeTransport({ origin: stub.origin, fetchImpl: stub.fetch, minIntervalMs: 0, sleep: async () => undefined });
  const lines: string[] = [];
  const opts = { ...parseArgs([]), runId: 'test' };
  const cfg = { ok: true as const, origin: stub.origin, clientId: stub.clientId, clientSecret: stub.clientSecret, minIntervalMs: 0, baseUrlFrom: 'referencia' as const };
  const report = await runProbe(cfg, t, new Redactor(), opts, (l) => lines.push(l));

  assert.ok(stub.calls.length > 20, `no-vacuidad: la corrida hizo ${stub.calls.length} peticiones`);
  assert.equal(stub.calls.length, report.requests);
  for (const c of stub.calls) {
    assert.doesNotThrow(() => assertReadOnlyRequest(c.method, c.url, stub.origin), `${c.method} ${c.url}`);
    assert.ok(c.method === 'GET' || c.method === 'POST', c.method);
    const p = new URL(c.url).pathname;
    assert.ok(!/cancellations|\/protect\b|\/pickups|\/orders/.test(p), `ruta mutante: ${p}`);
    if (c.method === 'POST') assert.ok(!/shipments/.test(p), `POST a shipments: ${p}`);
    assert.equal(c.headers['User-Agent']?.startsWith('tcg-hunt-probe/'), true, 'User-Agent propio (PROD §2)');
  }
  // Mide lo que dice medir.
  const m1 = report['M-PRD-1'] as Array<{ declared: number; echoMatches: boolean }>;
  assert.deepEqual(m1.map((r) => r.declared), M_PRD_1_VALUES);
  assert.ok(m1.every((r) => r.echoMatches), 'el truco del alto esquiva la reutilización en el doble');
  const m2 = report['M-PRD-2'] as { controlReused: boolean };
  assert.equal(m2.controlReused, true, 'el control de reutilización se observa');
  const m3 = report['M-PRD-3'] as { variants: unknown[] };
  assert.equal(m3.variants.length, 2);
  assert.ok(report['M-PRD-4'] && report['M-PRD-5'] && report['M-PRD-6']);
  assert.equal(report.balanceUnchanged, true);
  // Las POST que hizo, exactamente las previstas: 1 token + 12 (+reintentos) M-PRD-1 + 4 M-PRD-2 + 2 M-PRD-3.
  const posts = stub.calls.filter((c) => c.method === 'POST').map((c) => new URL(c.url).pathname);
  assert.equal(posts.filter((p) => p.endsWith('/oauth/token')).length, 1);
  assert.equal(posts.length, 1 + M_PRD_1_VALUES.length + 4 + 2);
  // Cada cotización de M-PRD-1 pide seguro EXPLÍCITO (§19.19.4) con el valor de la fila.
  const m1Bodies = stub.calls.filter((c) => c.method === 'POST' && c.url.endsWith('/quotations')).slice(0, M_PRD_1_VALUES.length);
  m1Bodies.forEach((c, i) => {
    const parcel = JSON.parse(c.body as string).quotation.parcels[0];
    assert.equal(parcel.package_protected, true);
    assert.equal(parcel.declared_value, M_PRD_1_VALUES[i]);
  });

  // Redacción: ni credenciales, ni token, ni id de plantilla, ni PII de la plantilla en la salida.
  const out = lines.join('\n') + JSON.stringify(report);
  for (const [k, v] of Object.entries(STUB_SECRETS)) assert.ok(!out.includes(v), `la salida o el informe contienen ${k}`);
});

test('pre-vuelo: reutiliza evaluateMutationGate y no arranca donde se podría gastar, en CI ni bajo pruebas', () => {
  const creds = { SKYDROPX_CLIENT_ID: 'x'.repeat(10), SKYDROPX_CLIENT_SECRET: 'y'.repeat(10) };
  const reason = (env: Record<string, string | undefined>): string => {
    const r = preflight(env);
    return r.ok ? 'ok' : r.reason.split(':')[0];
  };
  assert.equal(reason({ ...creds, NODE_ENV: 'production', SKYDROPX_ALLOW_SPEND: 'true' }), 'spend_key_present');
  assert.equal(reason({ ...creds, SKYDROPX_ALLOW_SPEND: 'false' }), 'spend_key_present');
  assert.equal(reason({ ...creds, CI: 'true' }), 'ci');
  assert.equal(reason({ ...creds, JEST_WORKER_ID: '1' }), 'test_runtime');
  assert.equal(reason({ ...creds, NODE_ENV: 'test' }), 'test_runtime');
  assert.equal(reason({}), 'missing_credentials');
  assert.equal(reason({ ...creds, SKYDROPX_BASE_URL: 'http://pro.skydropx.com/api/v1' }), 'bad_base_url');
  const ok = preflight({ ...creds });
  assert.ok(ok.ok && ok.origin === ORIGIN && ok.baseUrlFrom === 'referencia');
  const fast = preflight({ ...creds, SKYDROPX_RPS: '50' });
  assert.ok(fast.ok && fast.minIntervalMs >= 500, 'nunca más de 2 req/s');
});

test('estático: la ÚNICA llamada a la red está en request() y detrás de assertReadOnlyRequest', () => {
  const src = readFileSync(join(__dirname, 'prod-probe.ts'), 'utf8');
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const sites = code.match(/this\.fetchImpl\s*\(/g) ?? [];
  assert.equal(sites.length, 1, 'una sola llamada al transporte');
  const reqStart = code.indexOf('async request(');
  const guard = code.indexOf('assertReadOnlyRequest(', reqStart);
  const call = code.indexOf('this.fetchImpl(', reqStart);
  const pace = code.indexOf('this.pace()', reqStart);
  assert.ok(reqStart > 0 && guard > reqStart && guard < pace && pace < call, 'orden: veto → ritmo → red');
  // El `fetch` global aparece una sola vez: como implementación inyectada al transporte en main().
  const globalFetch = code.match(/(?<![.\w])fetch\s*\(/g) ?? [];
  assert.equal(globalFetch.length, 1);
  assert.match(code, /fetchImpl = \(url, init\) => fetch\(/);
  // Ni rutas mutantes ni la llave de gasto escritas en la sonda.
  assert.doesNotMatch(code, /cancellations|\/protect\b|\/pickups|api\/v2\/shipments/);
});
