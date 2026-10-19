/**
 * 🔒 CANDADO MKT-TL2 (a) — prueba 1 de API_CONTRACT §MKT.H.14 (v1.107): el REGISTRO de poblaciones.
 *
 * Las 8 pantallas × semana/mes × medición off/on (con dobles de GA4 y Search Console) ⇒
 *  - todo `tables[].id` emitido tiene fila en `MARKETING_TABLES`;
 *  - toda columna que no es `text` está en un componente (conteo o MX$/derivada) o declarada exacta;
 *  - lo registrado existe (ninguna columna fantasma en una tabla medida);
 *  - toda población del registro tiene oráculo en `test/support/disclosure-audit.ts`;
 *  - `MARKETING_TABLES` = el catálogo de §MKT.G.4 (leído del contrato), en su orden.
 * Canario: una tabla `zz` que `screenRaw` emite sin registrarla ⇒ el comprobador la denuncia (rojo).
 * Determinista (sin reloj real ni azar): N=1.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExternalSources, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { MARKETING_POPULATIONS, MARKETING_TABLES, registeredColumns } from '../src/modules/marketing/marketing-populations';
import type { MarketingPeriod, MarketingScreen } from '../src/modules/marketing/marketing-period';
import type { ScreenPayload } from '../src/modules/marketing/marketing-aggregates.types';
import { POPULATION_ORACLES, type AuditWorld } from './support/disclosure-audit';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const SCREENS: MarketingScreen[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
const WEEK: MarketingPeriod = { kind: 'week', from: '2027-02-08', to: '2027-02-14', prev: { from: '2027-02-01', to: '2027-02-07' }, label: '2027-W06' };
const MONTH: MarketingPeriod = { kind: 'month', from: '2027-02-01', to: '2027-02-28', prev: { from: '2027-01-01', to: '2027-01-31' }, label: '2027-02' };
const NOW = new Date('2027-03-10T12:00:00.000Z');
const SA = JSON.stringify({ client_email: 'panel@tienda.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });

type Body = { dimensions?: { name: string }[] };
function googleAnswer(url: string, body: Body): unknown {
  if (url.includes('searchconsole')) {
    return { rows: [{ keys: ['charizard 151'], clicks: 40, impressions: 900, ctr: 0.044, position: 3.2 }, { keys: ['tcg hunt'], clicks: 2, impressions: 30, ctr: 0.066, position: 1.1 }] };
  }
  const r = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });
  switch ((body.dimensions ?? []).map((d) => d.name).join(',')) {
    case 'sessionSource,sessionMedium,sessionDefaultChannelGroup':
      return { rows: [r(['instagram', 'bio', 'Organic Social'], [40]), r(['google', 'organic', 'Organic Search'], [30]), r(['chatgpt.com', 'referral', 'Referral'], [3])] };
    case 'eventName':
      return { rows: [r(['view_item'], [500]), r(['purchase'], [8])] };
    case '':
      return { rows: [r([], [1000])] };
    case 'pagePath':
      return { rows: [r(['/es/catalog/card-1'], [300, 120, 9000]), r(['/es'], [50, 3, 500])] };
    case 'deviceCategory,browser':
      return { rows: [r(['mobile', 'Instagram'], [70]), r(['desktop', 'Chrome'], [2])] };
    case 'itemId':
      return { rows: [r(['c_card-1'], [400, 40]), r(['c_card-2'], [25, 5])] };
    case 'sessionSource,landingPage':
      return { rows: [r(['claude.ai', '/es/como-funciona'], [9]), r(['perplexity.ai', '/es'], [2])] };
    default:
      return { rows: [] };
  }
}

function build(mode: 'on' | 'off') {
  const port: GoogleReadPort = { postJson: jest.fn(async (_k, _s, url, body) => googleAnswer(url, body as Body)) };
  const orders = [
    ...Array.from({ length: 6 }, (_, i) => ({ id: `o${i}`, firstUtmSource: 'instagram', firstUtmMedium: 'paid', firstUtmContent: 'reel-1', totalCents: 10000, fulfillmentMode: 'ship', shippingAddressSnapshot: { state: 'Jalisco' } })),
    { id: 'o9', firstUtmSource: 'instagram', firstUtmMedium: 'dm', firstUtmContent: null, totalCents: 5000, fulfillmentMode: 'vault', shippingAddressSnapshot: null },
  ];
  const prisma = {
    marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => [{ response: 'accept', device: 'móvil', _sum: { count: 3 } }]) },
    order: {
      // `mode=off` sin pedidos con consentimiento ⇒ Fase 0 (b1-b3, f3, g1 «NO MEDIDO»).
      count: jest.fn(async () => (mode === 'on' ? 7 : 0)),
      aggregate: jest.fn(async () => ({ _count: { _all: 6 }, _sum: { totalCents: 60000 } })),
      findMany: jest.fn(async () => orders),
    },
    sellRequest: {
      aggregate: jest.fn(async () => ({ _count: { _all: 3 }, _sum: { quotedTotalCents: 30000, payoutNetCents: 20000 } })),
      findMany: jest.fn(async () => [{ firstUtmSource: 'instagram', firstUtmMedium: 'bio', firstUtmContent: 'reel-2', quotedTotalCents: 7000 }]),
    },
    sellRequestItem: { findMany: jest.fn(async () => [{ cardId: 'card-1', sellRequestId: 'r1', card: { name: 'Charizard', number: '4', set: { name: '151' } } }]) },
    orderItem: {
      findMany: jest.fn(async (arg: { select: Record<string, unknown> }) =>
        'inventoryItem' in arg.select
          ? Array.from({ length: 6 }, (_, i) => ({ orderId: `o${i}`, unitPriceCents: 1000, inventoryItem: { cardId: 'card-1', card: { name: 'Charizard', number: '4', set: { name: '151' } } } }))
          : [{ cardSnapshot: { cardId: 'card-1', productType: 'raw' } }],
      ),
    },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    card: {
      findMany: jest.fn(async () => [
        { id: 'card-1', name: 'Charizard', number: '4', set: { name: '151' } },
        { id: 'card-2', name: 'Pikachu', number: '25', set: { name: 'Base' } },
      ]),
    },
    sealedProduct: { findMany: jest.fn(async () => []) },
    wishlistItem: { groupBy: jest.fn(async () => [{ cardId: 'card-2', userId: 'u1', _count: { _all: 2 } }]) },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => [{ cardId: 'card-1', _sum: { count: 12 } }]) },
  };
  const env = fullEnv({ MEASUREMENT_MODE: mode, MKT_GOOGLE_SA_JSON: SA, MKT_GA4_PROPERTY_ID: '123456789', MKT_SEARCH_CONSOLE_SITE: 'sc-domain:tcghunt.mx' });
  const totals = { orders: 7, chargedCents: 65000, avgTicketCents: 9286, piecesPerOrder: 1 };
  const sales = { report: jest.fn(async () => ({ totals, previousTotals: totals, comparison: { orders: { diff: 0, pct: 0 }, chargedCents: { diff: 0, pct: 0 } } })) };
  const annotations = { forPeriod: jest.fn(async () => [{ date: '2027-02-10', kind: 'promo', label: 'Promo', destino: null }]) };
  return new MarketingAnalyticsService(
    prisma as never,
    sales as never,
    annotations as never,
    new MeasurementService(prisma as never, fakeConfig(env)),
    new MarketingExternalSources(fakeConfig(env), port),
  );
}

/** El comprobador de la prueba 1: lo que el registro NO cubre de un payload. Vacío = verde. */
function violations(p: ScreenPayload): string[] {
  const out: string[] = [];
  for (const t of p.tables) {
    if (!MARKETING_TABLES[t.id]) {
      out.push(`${t.id}: tabla sin fila en MARKETING_TABLES`);
      continue;
    }
    const reg = registeredColumns(t.id);
    for (const col of t.columns.filter((c) => c.kind !== 'text')) {
      if (!reg.has(col.key)) out.push(`${t.id}.${col.key}: columna ${col.kind} sin componente ni «exacta»`);
    }
    if (t.measured) {
      const emitted = new Set(t.columns.map((c) => c.key));
      for (const k of reg) if (!emitted.has(k)) out.push(`${t.id}.${k}: registrada pero la tabla no la emite`);
    }
  }
  return out;
}

async function allPayloads(svc: MarketingAnalyticsService): Promise<ScreenPayload[]> {
  const out: ScreenPayload[] = [];
  for (const period of [WEEK, MONTH]) for (const s of SCREENS) out.push(await svc.screen(s, period, NOW, 'small_cells'));
  return out;
}

/** Los `id` de la tabla de §MKT.G.4, en orden, leídos del contrato (la fuente; no una copia). */
function catalogIds(): string[] {
  const doc = readFileSync(resolve(__dirname, '../../docs/API_CONTRACT.md'), 'utf8');
  const from = doc.indexOf('#### MKT.G.4 ');
  const to = doc.indexOf('#### MKT.G.5 ', from);
  expect([from > 0, to > from]).toEqual([true, true]);
  return [...doc.slice(from, to).matchAll(/^\| [a-h] \| `([a-z0-9]+)` \|/gm)].map((m) => m[1]);
}

describe('MKT-TL2 (a) · registro de poblaciones (§MKT.H.14, prueba 1)', () => {
  it.each(['off', 'on'] as const)('medición %s: 8 pantallas × semana/mes ⇒ toda tabla y toda columna no texto registradas', async (mode) => {
    const payloads = await allPayloads(build(mode));
    expect(payloads).toHaveLength(16);
    expect(payloads.flatMap(violations)).toEqual([]);
    // El fixture mide de verdad lo que el modo enciende (si no, la prueba no prueba nada).
    const measured = new Set(payloads.flatMap((p) => p.tables.filter((t) => t.measured).map((t) => t.id)));
    const mustMeasure = mode === 'on' ? ['a1', 'a3', 'a4', 'a5', 'b1', 'b2', 'b3', 'b4', 'c1', 'c5', 'c7', 'd1', 'd2', 'd3', 'd4b', 'e1', 'e3', 'f3', 'g1'] : ['a1', 'a3', 'c7', 'd1', 'd3', 'd4', 'd4b', 'e1'];
    expect(mustMeasure.filter((id) => !measured.has(id))).toEqual([]);
  });

  it('MARKETING_TABLES = catálogo de §MKT.G.4 (mismos ids, mismo orden) y las 8 pantallas no emiten otro id', async () => {
    const catalog = catalogIds();
    expect(catalog.length).toBeGreaterThanOrEqual(28);
    expect(Object.keys(MARKETING_TABLES)).toEqual(catalog);
    const emitted = new Set((await allPayloads(build('on'))).flatMap((p) => p.tables.map((t) => t.id)));
    expect([...emitted].sort()).toEqual([...catalog].sort());
  });

  it('toda población usada por un componente existe en MARKETING_POPULATIONS y tiene oráculo; y no sobra ningún oráculo', () => {
    const used = new Set(Object.values(MARKETING_TABLES).flatMap((t) => t.components.map((c) => c.population)));
    expect([...used].filter((p) => !(p in MARKETING_POPULATIONS))).toEqual([]);
    expect(Object.keys(POPULATION_ORACLES).sort()).toEqual(Object.keys(MARKETING_POPULATIONS).sort());
  });

  it('los oráculos cuentan SUJETOS: PAID_ORIGIN deja fuera el pedido sin origen; WISH cuenta usuarios, no altas', () => {
    const d = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);
    const o = (id: string, src: string | null) => ({ id, settledAt: d('2027-02-10'), status: 'settled', firstUtmSource: src, firstUtmMedium: 'paid', firstUtmContent: null, measurementConsentAnalytics: true, totalCents: 1 });
    const w: AuditWorld = {
      orders: [o('p1', 'instagram'), o('p2', null), { ...o('p3', 'instagram'), status: 'pending' }],
      requests: [],
      wishes: [1, 2, 3].map(() => ({ cardId: 'X', userId: 'u1', createdAt: d('2027-02-10') })).concat([{ cardId: 'X', userId: 'u2', createdAt: d('2027-02-11') }]),
      listedCardIds: new Set(),
      ga4: {},
      sc: [],
    };
    const r = { from: WEEK.from, to: WEEK.to };
    expect(POPULATION_ORACLES.PAID(w, r).map((s) => s.id)).toEqual(['p1', 'p2']);
    expect(POPULATION_ORACLES.PAID_ORIGIN(w, r).map((s) => s.id)).toEqual(['p1']);
    expect(POPULATION_ORACLES.WISH(w, r)).toHaveLength(2);
  });

  it('CANARIO: una tabla `zz` que `screenRaw` emite sin registrar ⇒ el comprobador la denuncia', async () => {
    const svc = build('on');
    const real = (svc as unknown as { screenRaw: (...a: unknown[]) => Promise<ScreenPayload> }).screenRaw.bind(svc);
    jest.spyOn(svc as unknown as { screenRaw: (...a: unknown[]) => Promise<ScreenPayload> }, 'screenRaw').mockImplementation(async (...a: unknown[]) => {
      const p = await real(...a);
      return { ...p, tables: [...p.tables, { id: 'zz', title: 'zz', source: 'BD', measured: true, columns: [{ key: 'n', labelEs: 'n', kind: 'count' }], rows: [{ n: 9 }] }] };
    });
    const found = (await svc.screen('a', WEEK, NOW, 'small_cells')).tables.map((t) => t.id);
    expect(found).toContain('zz');
    expect(violations(await svc.screen('a', WEEK, NOW, 'small_cells'))).toEqual(['zz: tabla sin fila en MARKETING_TABLES']);
  });
});
