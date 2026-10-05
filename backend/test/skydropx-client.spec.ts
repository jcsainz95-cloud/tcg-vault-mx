/**
 * PS-91 · PS-92 · PS-93 — el cliente servidor de Skydropx (API_CONTRACT §M4-SHIP.19.19.3, §19.19.16).
 *
 * Mutaciones que estas pruebas ponen rojas (escritas en el contrato):
 *  - PS-91: quitar el `User-Agent` en una ruta; tratar el `403` del borde como transitorio.
 *  - PS-92: pedir token por llamada; reintentar el `401` sin límite.
 *  - PS-93: envolver la compra en el reintento genérico ⇒ 2+ `POST /api/v2/shipments`.
 * Todo contra un transporte GRABADOR (⛔ cero red; PS-99 (c) además veta Skydropx). La matriz de la COMPRA se prueba
 * abriendo el candado de ejecución SOLO dentro de `withSpendGateOpen` y SOLO con el grabador.
 */
import { downloadLabelPdf } from '../src/modules/shipping-provider/label-proxy';
import { SkydropxClient, SKYDROPX_USER_AGENT } from '../src/modules/shipping-provider/http/skydropx-client';
import { skydropxOrigin } from '../src/modules/shipping-provider/http/skydropx-origin';
import { SkydropxAdapter } from '../src/modules/shipping-provider/skydropx.adapter';
import {
  ShippingProviderError,
  ShippingProviderPurchaseInFlightError,
} from '../src/modules/shipping-provider/shipping-provider.errors';
import { completedQuotationFixture, pendingQuotationFixture } from '../src/modules/shipping-provider/fixtures/skydropx-quotation.fixture';
import {
  CapturedLogger,
  FAKE_CLIENT_ID,
  FAKE_SECRET,
  FakeClock,
  jsonResponse,
  RECORDER_ORIGIN,
  RecorderTransport,
  textResponse,
  TOKEN_VALUE,
  withSpendGateOpen,
} from './helpers/skydropx-recorder';

function setup(opts: { baseUrl?: string; rps?: number } = {}) {
  const clock = new FakeClock();
  const rec = new RecorderTransport(clock);
  const logger = new CapturedLogger();
  const client = new SkydropxClient({
    baseUrl: opts.baseUrl ?? `${RECORDER_ORIGIN}/api/v1`,
    clientId: FAKE_CLIENT_ID,
    clientSecret: FAKE_SECRET,
    rps: opts.rps,
    transport: rec.transport,
    clock,
    logger,
    random: () => 0,
    timeouts: { defaultMs: 40, purchaseMs: 60 },
  });
  const adapter = new SkydropxAdapter({ client, clock, logger });
  rec.on('GET', '/api/v1/finance/credits', () => jsonResponse(200, { data: { balance: 965.16, currency: 'MXN' } }));
  return { clock, rec, logger, client, adapter };
}

const QUOTE_INPUT = {
  from: { templateId: 'tpl-verapaz' },
  to: { countryCode: 'MX' as const, postalCode: '06600', state: 'CDMX', city: 'Cuauhtémoc', neighborhood: 'Juárez' },
  parcel: { lengthCm: 25, widthCm: 18, heightCm: 3, weightKg: 1, coverageCents: 250000 },
};

const PURCHASE_INPUT = {
  rateId: 'fixture-rate-05',
  printingFormat: 'standard' as const,
  from: { templateId: 'tpl-verapaz', snapshot: null },
  to: { street1: 'Calle Falsa 123', name: 'Ana Pérez', company: 'Ana Pérez', phone: '5512345678', email: 'ana@example.com', reference: 'Pedido ENV-000045-01' },
  package: { coverageCents: 250000, consignmentNote: '49101600', packageType: '5H4' },
  idempotencyKey: 'label:s1:r1',
};

async function caught(p: Promise<unknown>): Promise<ShippingProviderError> {
  try {
    await p;
  } catch (e) {
    return e as ShippingProviderError;
  }
  throw new Error('se esperaba un error');
}

describe('PS-91 🔒 — User-Agent propio en TODA petición; 403 del borde ⇒ 502 edge_blocked sin reintento', () => {
  it('el User-Agent es tcg-hunt/<versión> (+https://tcghunt.mx)', () => {
    expect(SKYDROPX_USER_AGENT).toMatch(/^tcg-hunt\/\d+\.\d+\.\d+ \(\+https:\/\/tcghunt\.mx\)$/);
  });

  it('token, cotización, CADA sondeo, compra, cancelación, protección y descarga al host de la API llevan el UA', async () => {
    const { rec, adapter, client } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    rec.on('GET', /^\/api\/v1\/quotations\//, (_c, n) =>
      jsonResponse(200, n < 3 ? pendingQuotationFixture() : completedQuotationFixture()),
    );
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(201, [{ data: { id: 'sh-1', attributes: {} } }]));
    rec.on('POST', /\/cancellations$/, () => jsonResponse(200, { data: { id: 'sh-1' } }));
    rec.on('POST', /\/protect$/, () => jsonResponse(200, { data: { id: 'sh-1' } }));
    await adapter.quote(QUOTE_INPUT);
    await withSpendGateOpen(rec, async () => {
      await adapter.purchase(PURCHASE_INPUT);
      await adapter.cancel('sh-1', 'reissue');
      await adapter.protect('sh-1', 250000);
    });
    const labelHeaders: Record<string, string>[] = [];
    await downloadLabelPdf(`${RECORDER_ORIGIN}/labels/sh-1.pdf`, {
      api: client,
      allowedHosts: [client.apiHost],
      fetchImpl: async (_url, init) => {
        labelHeaders.push(init.headers as Record<string, string>);
        return new Response(Buffer.from('%PDF-1.4'), { status: 200, headers: { 'content-type': 'application/pdf' } });
      },
    });
    const paths = rec.calls.map((c) => `${c.method} ${c.path}`);
    expect(paths).toEqual(
      expect.arrayContaining([
        'POST /api/v1/oauth/token',
        'POST /api/v1/quotations',
        'POST /api/v2/shipments',
        'POST /api/v1/shipments/sh-1/cancellations',
        'POST /api/v1/shipments/sh-1/protect',
      ]),
    );
    expect(rec.callsTo('GET', /^\/api\/v1\/quotations\//)).toHaveLength(3);
    for (const c of rec.calls) expect(c.headers['User-Agent']).toMatch(/^tcg-hunt\//);
    expect(labelHeaders).toHaveLength(1);
    expect(labelHeaders[0]['User-Agent']).toMatch(/^tcg-hunt\//);
  });

  it.each([
    ['HTML de Cloudflare «error code: 1010»', textResponse(403, '<html>error code: 1010</html>')],
    ['JSON con browser_signature_banned', jsonResponse(403, { error: 'browser_signature_banned' })],
    ['cuerpo vacío (no JSON)', textResponse(403, '')],
  ])('lectura con 403 del borde (%s) ⇒ 502 {reason:edge_blocked} y UNA sola llamada', async (_l, response) => {
    const { rec, client, logger } = setup();
    rec.on('GET', '/api/v1/finance/credits', () => response);
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err).toBeInstanceOf(ShippingProviderError);
    expect(err.httpStatus).toBe(502);
    expect(err.code).toBe('SHIPPING_PROVIDER_ERROR');
    expect(err.details).toEqual({ provider: 'skydropx', op: 'balance', status: 403, reason: 'edge_blocked' });
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(1);
    expect(logger.lines.some((l) => l.startsWith('error ') && l.includes('reason=edge_blocked'))).toBe(true);
  });

  it('el 403 del borde en el TOKEN ⇒ 502 edge_blocked, una sola petición de token', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v1/oauth/token', () => textResponse(403, 'Error 1010: Access denied'));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.details).toMatchObject({ op: 'token', status: 403, reason: 'edge_blocked' });
    expect(rec.callsTo('POST', '/api/v1/oauth/token')).toHaveLength(1);
  });

  it('el 403 del borde en la COMPRA ⇒ 502 edge_blocked, 1 llamada y NO «en vuelo»', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => textResponse(403, 'error code: 1010'));
    const err = await withSpendGateOpen(rec, () =>
      caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })),
    );
    expect(err.details).toMatchObject({ op: 'purchase', status: 403, reason: 'edge_blocked' });
    expect(err).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it('un 403 JSON de la API (no del borde) ⇒ 502 sin reason, sin reintento', async () => {
    const { rec, client } = setup();
    rec.on('GET', '/api/v1/finance/credits', () => jsonResponse(403, { message: 'forbidden' }));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.details).toEqual({ provider: 'skydropx', op: 'balance', status: 403 });
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(1);
  });
});

describe('PS-92 — token: caché de 2 h, renovación, una sola petición en vuelo, 401 una vez; URL base normalizada', () => {
  it('50 llamadas en 1 h ⇒ 1 POST /oauth/token', async () => {
    const { rec, client, clock } = setup();
    for (let i = 0; i < 50; i += 1) {
      await client.get('balance', '/finance/credits');
      clock.advance(72_000);
    }
    expect(rec.callsTo('POST', '/api/v1/oauth/token')).toHaveLength(1);
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(50);
  });

  it('reloj a created_at + 7200 − 299 s ⇒ renueva; a − 301 s todavía no', async () => {
    const { rec, client, clock } = setup();
    const createdAt = Math.floor(clock.now() / 1000) - 10; // el proveedor lo emitió hace 10 s
    rec.tokenCreatedAt = () => createdAt;
    await client.get('balance', '/finance/credits');
    clock.set((createdAt + 7200 - 301) * 1000);
    await client.get('balance', '/finance/credits');
    expect(rec.tokenIssued).toBe(1);
    clock.set((createdAt + 7200 - 299) * 1000);
    rec.tokenCreatedAt = null;
    await client.get('balance', '/finance/credits');
    expect(rec.tokenIssued).toBe(2);
    const last = rec.callsTo('GET', '/api/v1/finance/credits').pop()!;
    expect(last.headers.Authorization).toBe(`Bearer ${TOKEN_VALUE}-2`);
  });

  it('10 llamadas concurrentes sin token ⇒ 1 petición de token', async () => {
    const { rec, client } = setup();
    await Promise.all(Array.from({ length: 10 }, () => client.get('balance', '/finance/credits')));
    expect(rec.callsTo('POST', '/api/v1/oauth/token')).toHaveLength(1);
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(10);
  });

  it('el token se pide form-urlencoded con grant_type=client_credentials', async () => {
    const { rec, client } = setup();
    await client.get('balance', '/finance/credits');
    const t = rec.callsTo('POST', '/api/v1/oauth/token')[0];
    expect(t.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
    const form = new URLSearchParams(t.body);
    expect(form.get('grant_type')).toBe('client_credentials');
    expect(form.get('client_id')).toBe(FAKE_CLIENT_ID);
    expect(form.get('client_secret')).toBe(FAKE_SECRET);
    expect(t.headers.Authorization).toBeUndefined();
  });

  it('401 ⇒ token nuevo y UN reintento (con el token nuevo)', async () => {
    const { rec, client } = setup();
    rec.on('GET', '/api/v1/finance/credits', (_c, n) =>
      n === 1 ? jsonResponse(401, { error: 'invalid_token' }) : jsonResponse(200, { data: { balance: 1, currency: 'MXN' } }),
    );
    await client.get('balance', '/finance/credits');
    const calls = rec.callsTo('GET', '/api/v1/finance/credits');
    expect(calls).toHaveLength(2);
    expect(rec.tokenIssued).toBe(2);
    expect(calls[0].headers.Authorization).toBe(`Bearer ${TOKEN_VALUE}-1`);
    expect(calls[1].headers.Authorization).toBe(`Bearer ${TOKEN_VALUE}-2`);
  });

  it('segundo 401 ⇒ 502 {status:401}; exactamente 2 llamadas (no reintenta sin límite)', async () => {
    const { rec, client } = setup();
    rec.on('GET', '/api/v1/finance/credits', () => jsonResponse(401, { error: 'invalid_token' }));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.httpStatus).toBe(502);
    expect(err.details).toMatchObject({ op: 'balance', status: 401 });
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(2);
  });

  it('401 en el TOKEN (credenciales malas) ⇒ 502 sin bucle', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v1/oauth/token', () => jsonResponse(401, { error: 'invalid_client' }));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.details).toMatchObject({ op: 'token', status: 401 });
    expect(rec.callsTo('POST', '/api/v1/oauth/token')).toHaveLength(1);
  });

  it('el log capturado no contiene el token ni el secreto (en éxito, en 401 y en error)', async () => {
    const { rec, client, adapter, logger } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, completedQuotationFixture()));
    await adapter.quote(QUOTE_INPUT);
    rec.on('GET', '/api/v1/finance/credits', (_c, n) => (n === 1 ? jsonResponse(401, {}) : jsonResponse(500, {})));
    await caught(client.get('balance', '/finance/credits'));
    const text = logger.text();
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain(TOKEN_VALUE);
    expect(text).not.toContain(FAKE_SECRET);
    expect(text).not.toContain(FAKE_CLIENT_ID);
    expect(text).not.toMatch(/Bearer/);
  });

  it.each([
    `${RECORDER_ORIGIN}/api/v1`,
    `${RECORDER_ORIGIN}/api/v1/`,
    `${RECORDER_ORIGIN}`,
    `${RECORDER_ORIGIN}/`,
    `${RECORDER_ORIGIN}/api/v2`,
  ])('SKYDROPX_BASE_URL=%s ⇒ las mismas URLs', async (baseUrl) => {
    const { rec, client } = setup({ baseUrl });
    await client.get('balance', '/finance/credits');
    expect(rec.calls.map((c) => c.url)).toEqual([
      `${RECORDER_ORIGIN}/api/v1/oauth/token`,
      `${RECORDER_ORIGIN}/api/v1/finance/credits`,
    ]);
  });

  it('origen: exige https y sin credenciales', () => {
    expect(skydropxOrigin('https://pro.example.test/api/v1')).toBe('https://pro.example.test');
    expect(() => skydropxOrigin('http://pro.example.test/api/v1')).toThrow(/https/);
    expect(() => skydropxOrigin('https://u:p@pro.example.test')).toThrow();
    expect(() => skydropxOrigin('no es url')).toThrow();
  });
});

describe('PS-93 💰 — cubeta ≤ 2 req/s y matriz de reintentos: la compra NUNCA se reintenta salvo 401/429', () => {
  function gaps(times: number[]): number[] {
    return times.slice(1).map((t, i) => t - times[i]);
  }

  it('10 llamadas concurrentes ⇒ espaciado ≥ 500 ms con reloj falso (incluido el token)', async () => {
    const { rec, client } = setup({ rps: 2 });
    await Promise.all(Array.from({ length: 10 }, () => client.get('balance', '/finance/credits')));
    const times = rec.calls.map((c) => c.at);
    expect(times).toHaveLength(11);
    for (const g of gaps(times)) expect(g).toBeGreaterThanOrEqual(500);
  });

  it('las consultas del SONDEO también pasan por la cubeta', async () => {
    const { rec, adapter } = setup({ rps: 2 });
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    rec.on('GET', /^\/api\/v1\/quotations\//, (_c, n) =>
      jsonResponse(200, n < 3 ? pendingQuotationFixture() : completedQuotationFixture()),
    );
    // Con rps = 0.5 (1 cada 2 s) el sondeo de 1.5 s queda limitado por la cubeta, no por su intervalo.
    const slow = setup({ rps: 0.5 });
    slow.rec.on('POST', '/api/v1/quotations', () => jsonResponse(201, pendingQuotationFixture()));
    slow.rec.on('GET', /^\/api\/v1\/quotations\//, (_c, n) =>
      jsonResponse(200, n < 3 ? pendingQuotationFixture() : completedQuotationFixture()),
    );
    await adapter.quote(QUOTE_INPUT);
    await slow.adapter.quote(QUOTE_INPUT);
    for (const g of gaps(rec.calls.map((c) => c.at))) expect(g).toBeGreaterThanOrEqual(500);
    for (const g of gaps(slow.rec.calls.map((c) => c.at))) expect(g).toBeGreaterThanOrEqual(2000);
  });

  it('compra con TIMEOUT ⇒ 1 sola llamada y «compra en vuelo» (503)', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => 'timeout');
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(err.httpStatus).toBe(503);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it('compra con error de RED ⇒ 1 llamada, en vuelo', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => 'network');
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it.each([500, 502, 503, 504])('compra con %i ⇒ 1 llamada, en vuelo (503)', async (status) => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(status, {}));
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(err.httpStatus).toBe(503);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it('compra con 404 ⇒ 1 llamada, 502 y en vuelo', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(404, {}));
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(err.httpStatus).toBe(502);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  // ⭐ v1.80.12.1 (API_CONTRACT §M4-SHIP.19.21.4) — PS-109 gana tres filas: en la COMPRA, todo lo que no prueba que no se
  // procesó es «en vuelo» (reclamo conservado ⇒ `200 {outcome:'in_flight'}` en D2c), con UNA llamada.
  it.each([
    ['3xx (302 con Location, no se sigue)', () => jsonResponse(302, {}, { location: 'https://pro.skydropx.com/api/v2/shipments/sh-x' })],
    ['409', () => jsonResponse(409, { error: 'conflict' })],
    ['403 JSON que NO es del borde', () => jsonResponse(403, { message: 'forbidden' })],
  ])('PS-109 — compra con %s ⇒ 1 llamada y «en vuelo»', async (_l, response) => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', response);
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(err).toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(err.httpStatus).toBe(502);
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(1);
  });

  it('el 403 JSON no-borde SIGUE siendo `502` sin «en vuelo» fuera de la compra (cotización y cancelación)', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v1/quotations', () => jsonResponse(403, { message: 'forbidden' }));
    const q = await caught(client.createQuotation({}));
    expect(q).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(q.details).toEqual({ provider: 'skydropx', op: 'quote', status: 403 });
    rec.on('POST', /\/cancellations$/, () => jsonResponse(403, { message: 'forbidden' }));
    const c = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'cancel', providerShipmentId: 'sh-1', body: { reason: 'x' } })));
    expect(c).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(c.details).toMatchObject({ op: 'cancel', status: 403 });
  });

  it('compra con 401 ⇒ 2 llamadas (token renovado) y éxito', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', (_c, n) =>
      n === 1 ? jsonResponse(401, {}) : jsonResponse(201, [{ data: { id: 'sh-1' } }]),
    );
    await withSpendGateOpen(rec, () => client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' }));
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(2);
    expect(rec.tokenIssued).toBe(2);
  });

  it('compra con 429 ⇒ espera (Retry-After) y reintenta; 422 ⇒ rechazo SIN «en vuelo»', async () => {
    const { rec, client, clock } = setup();
    rec.on('POST', '/api/v2/shipments', (_c, n) =>
      n === 1 ? jsonResponse(429, {}, { 'retry-after': '2' }) : jsonResponse(422, { errors: { rate_id: ['inválida'] } }),
    );
    const err = await withSpendGateOpen(rec, () => caught(client.mutate({ op: 'purchase', body: {}, idempotencyKey: 'k' })));
    expect(rec.callsTo('POST', '/api/v2/shipments')).toHaveLength(2);
    expect(clock.sleeps).toContain(2000);
    expect(err.httpStatus).toBe(422);
    expect(err.code).toBe('SHIPPING_PROVIDER_REJECTED');
    expect(err.details).toMatchObject({ op: 'purchase', providerMessage: 'rate_id: inválida' });
    expect(err).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
  });

  it('la compra se manda con timeout de 30 s (no 10 s): por omisión del cliente', () => {
    // El valor lo fija el contrato (§19.19.3 (5)); aquí se ancla la constante.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mod = require('../src/modules/shipping-provider/http/skydropx-client');
    expect(mod.SKYDROPX_PURCHASE_TIMEOUT_MS).toBe(30_000);
    expect(mod.SKYDROPX_DEFAULT_TIMEOUT_MS).toBe(10_000);
  });

  it('lectura con 5xx ⇒ 3 llamadas (≤ 2 reintentos) y 503 SHIPPING_PROVIDER_BUSY', async () => {
    const { rec, client } = setup();
    rec.on('GET', '/api/v1/finance/credits', () => jsonResponse(500, {}));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.httpStatus).toBe(503);
    expect(err.code).toBe('SHIPPING_PROVIDER_BUSY');
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(3);
  });

  it('lectura con timeout ⇒ 3 llamadas y 503; la tercera puede salir bien', async () => {
    const { rec, client } = setup();
    rec.on('GET', '/api/v1/finance/credits', (_c, n) =>
      n < 3 ? 'timeout' : jsonResponse(200, { data: { balance: 1, currency: 'MXN' } }),
    );
    await expect(client.get('balance', '/finance/credits')).resolves.toMatchObject({ status: 200 });
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(3);
  });

  it('429 sostenido ⇒ 3 esperas (backoff 500·2^n) y 503; 4 llamadas', async () => {
    const { rec, client, clock } = setup();
    rec.on('GET', '/api/v1/finance/credits', () => jsonResponse(429, {}));
    const err = await caught(client.get('balance', '/finance/credits'));
    expect(err.code).toBe('SHIPPING_PROVIDER_BUSY');
    expect(rec.callsTo('GET', '/api/v1/finance/credits')).toHaveLength(4);
    expect(clock.sleeps.filter((s) => s >= 500)).toEqual(expect.arrayContaining([500, 1000, 2000]));
  });

  it('400/422 de lectura o cotización ⇒ 422 REJECTED sin reintento', async () => {
    const { rec, adapter } = setup();
    rec.on('POST', '/api/v1/quotations', () =>
      jsonResponse(422, { errors: { parcel: { weight: ['no puede estar en blanco'] } } }),
    );
    const err = await caught(adapter.quote(QUOTE_INPUT));
    expect(err.httpStatus).toBe(422);
    expect(err.details).toMatchObject({ op: 'quote', providerMessage: 'parcel.weight: no puede estar en blanco' });
    expect(rec.callsTo('POST', '/api/v1/quotations')).toHaveLength(1);
  });

  it('cancelación con 5xx ⇒ 1 llamada, 503 y NO «en vuelo» (el sello se conserva en el dominio)', async () => {
    const { rec, client } = setup();
    rec.on('POST', /\/cancellations$/, () => jsonResponse(503, {}));
    const err = await withSpendGateOpen(rec, () =>
      caught(client.mutate({ op: 'cancel', providerShipmentId: 'sh-1', body: {} })),
    );
    expect(err.httpStatus).toBe(503);
    expect(err).not.toBeInstanceOf(ShippingProviderPurchaseInFlightError);
    expect(rec.callsTo('POST', /\/cancellations$/)).toHaveLength(1);
  });

  it('la compra manda Idempotency-Key y el cuerpo JSON', async () => {
    const { rec, client } = setup();
    rec.on('POST', '/api/v2/shipments', () => jsonResponse(201, [{ data: { id: 'sh-1' } }]));
    await withSpendGateOpen(rec, () => client.mutate({ op: 'purchase', body: { a: 1 }, idempotencyKey: 'label:s:r' }));
    const c = rec.callsTo('POST', '/api/v2/shipments')[0];
    expect(c.headers['Idempotency-Key']).toBe('label:s:r');
    expect(c.headers['Content-Type']).toBe('application/json');
    expect(JSON.parse(c.body!)).toEqual({ a: 1 });
  });
});
