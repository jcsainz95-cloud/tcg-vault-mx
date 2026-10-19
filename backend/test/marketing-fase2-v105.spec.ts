/**
 * Panel con Fase 2 — cierre v1.105⟨mkt-fase2-cierre⟩ (API_CONTRACT §MKT.H.9 y §MKT.H.13). Sin BD (Prisma mockeado) y sin red
 * (puerto de Google doble que registra cada `runReport`).
 *
 *  (1) f1/f3/g1 y las columnas BD de b1-b3 se miden con `on` **o** con `off` si el periodo ya tiene datos de medición
 *      (canario del contrato: `off` + un pedido con consentimiento ⇒ f3 `measured:true`).
 *  (2) f3: filas `true`, `false` («la rechazaron») y `NULL` («Sin elección registrada …»).
 *  (3) Línea de cobertura: dos literales según el modo.
 *  (4) GA4: forma de cada `runReport` (dimensiones, métricas, filtro) y cálculo de a4, b4, a5, c1, c5, d1 (vistas), d2, e3;
 *      una consulta que falla deja SU tabla «sin conectar», no la pantalla.
 *  (5) Diferidas c2, c3, c4, c8 con su motivo literal; b1-b3 solo de BD.
 */
import { MarketingAnalyticsService, COVERAGE_NOTE, COVERAGE_NOTE_ON, sealHiddenRows } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExternalSources, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { SMALL_CELL_HIDDEN, SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import { a4Group, b4Group, c1Rows, fichaOf } from '../src/modules/marketing/marketing-ga4';
import type { MarketingPeriod, MarketingScreen } from '../src/modules/marketing/marketing-period';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const week: MarketingPeriod = { kind: 'week', from: '2026-10-05', to: '2026-10-11', prev: { from: '2026-09-28', to: '2026-10-04' }, label: '2026-W41' };
const NOW = new Date('2026-10-14T12:00:00.000Z');
const SA = JSON.stringify({ client_email: 'panel@tienda.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });
const by = (ts: AggTable[], id: string) => {
  const t = ts.find((x) => x.id === id);
  if (!t) throw new Error(`tabla ${id} ausente`);
  return t;
};

type Body = { dimensions: { name: string }[]; metrics: { name: string }[]; dimensionFilter?: unknown; orderBys?: unknown };
const dimsOf = (b: Body) => b.dimensions.map((d) => d.name).join(',');

/** Respuestas del doble de GA4, por la lista de dimensiones pedida. */
function ga4Answer(body: Body): unknown {
  const r = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });
  switch (dimsOf(body)) {
    case 'sessionSource,sessionMedium,sessionDefaultChannelGroup':
      return {
        rows: [
          r(['instagram', 'bio', 'Organic Social'], [40]),
          r(['l.instagram.com', 'referral', 'Organic Social'], [10]),
          r(['instagram', 'paid', 'Paid Social'], [20]),
          r(['google', 'organic', 'Organic Search'], [30]),
          r(['chatgpt.com', 'referral', 'Referral'], [6]),
          r(['(direct)', '(none)', 'Direct'], [25]),
          r(['pokebeach.com', 'referral', 'Referral'], [7]),
        ],
      };
    case 'eventName':
      return { rows: [r(['view_item'], [500]), r(['add_to_cart'], [50]), r(['begin_checkout'], [20]), r(['purchase'], [8])] };
    case '':
      return { rows: [r([], [1000])] };
    case 'pagePath':
      return {
        rows: [
          r(['/es/catalog/card-1'], [300, 120, 9000]),
          r(['/es/guias/que-es-nm'], [80, 60, 4000]),
          r(['/es'], [50, 40, 500]),
          r(['/es/sellado/inv-9'], [12, 3, 100]),
        ],
      };
    case 'deviceCategory,browser':
      return { rows: [r(['mobile', 'Instagram'], [70]), r(['desktop', 'Chrome'], [30])] };
    case 'itemId':
      return { rows: [r(['c_card-1'], [400, 40]), r(['c_card-2'], [25, 5]), r(['s_sp-9'], [10, 1])] };
    case 'sessionSource,landingPage':
      return { rows: [r(['claude.ai', '/es/como-funciona'], [9]), r(['chatgpt.com', '/es/guias/que-es-nm'], [6]), r(['perplexity.ai', '/es'], [2])] };
    default:
      throw new Error(`consulta inesperada ${dimsOf(body)}`);
  }
}

function build(opts: { mode?: string; ga4?: boolean; failDims?: string; consentRows?: number; counterRows?: number } = {}) {
  const calls: Body[] = [];
  const port: GoogleReadPort = {
    postJson: jest.fn(async (_k, _s, _u, body) => {
      const b = body as Body;
      calls.push(b);
      if (opts.failDims !== undefined && dimsOf(b) === opts.failDims) throw new Error('403');
      return ga4Answer(b);
    }),
  };
  const orderCount = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const c = where.measurementConsentAnalytics as unknown;
    if (c && typeof c === 'object' && 'not' in (c as object)) return opts.consentRows ?? 0;
    if ('firstUtmSource' in where) return 3;
    if (c === true) return 4;
    if (c === false) return 1;
    if (c === null) return 2;
    return 10;
  });
  const prisma = {
    marketingBannerConsentCounter: {
      count: jest.fn(async () => opts.counterRows ?? 0),
      groupBy: jest.fn(async () => [{ response: 'accept', device: 'móvil', _sum: { count: 3 } }]),
    },
    order: {
      count: orderCount,
      aggregate: jest.fn(async () => ({ _count: { _all: 6 }, _sum: { totalCents: 600000 } })),
      findMany: jest.fn(async () => [
        ...Array.from({ length: 5 }, () => ({ firstUtmSource: 'instagram', firstUtmMedium: 'bio', firstUtmContent: 'reel-1', totalCents: 10000 })),
        ...Array.from({ length: 5 }, () => ({ firstUtmSource: 'instagram', firstUtmMedium: 'dm', firstUtmContent: 'chat-7', totalCents: 5000 })),
      ]),
    },
    sellRequest: {
      aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _sum: { quotedTotalCents: 0, payoutNetCents: 0 } })),
      findMany: jest.fn(async () => [{ firstUtmSource: 'instagram', firstUtmMedium: 'dm', firstUtmContent: 'chat-8', quotedTotalCents: 250000 }]),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    orderItem: {
      findMany: jest.fn(async (arg: { select: Record<string, unknown> }) =>
        'inventoryItem' in arg.select
          ? Array.from({ length: 6 }, () => ({ unitPriceCents: 1000, inventoryItem: { cardId: 'card-1', card: { name: 'Charizard', number: '4', set: { name: '151' } } } }))
          : [{ cardSnapshot: { cardId: 'card-1', productType: 'raw' } }],
      ),
    },
    inventoryItem: {
      groupBy: jest.fn(async () => []),
      findMany: jest.fn(async () => [{ id: 'inv-9', sealedProduct: { name: 'ETB Prismatic' }, card: { name: 'x', number: '1', set: { name: 's' } } }]),
    },
    card: {
      findMany: jest.fn(async () => [
        { id: 'card-1', name: 'Charizard', number: '4', set: { name: '151' } },
        { id: 'card-2', name: 'Pikachu', number: '25', set: { name: 'Base' } },
      ]),
    },
    sealedProduct: { findMany: jest.fn(async () => [{ id: 'sp-9', name: 'ETB Prismatic' }]) },
    wishlistItem: { groupBy: jest.fn(async () => []) },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) },
  };
  const env = fullEnv({ MEASUREMENT_MODE: opts.mode, MKT_GOOGLE_SA_JSON: opts.ga4 ? SA : undefined, MKT_GA4_PROPERTY_ID: opts.ga4 ? '123456789' : undefined });
  const measurement = new MeasurementService(prisma as never, fakeConfig(env));
  const external = new MarketingExternalSources(fakeConfig(env), port);
  const totals = { orders: 6, chargedCents: 600000, avgTicketCents: 100000, piecesPerOrder: 1 };
  const sales = { report: jest.fn(async () => ({ totals, previousTotals: totals, comparison: { orders: { diff: 0, pct: 0 }, chargedCents: { diff: 0, pct: 0 } } })) };
  const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never, measurement, external);
  const screen = async (s: MarketingScreen) => svc.screen(s, week, NOW, 'small_cells');
  return { svc, prisma, calls, screen };
}

describe('(1) con `off`, el periodo con datos de medición se mide', () => {
  it('canario §MKT.H.13: off + un pedido pagado con consentimiento registrado ⇒ f3 measured:true (y g1, b1-b3)', async () => {
    const w = build({ mode: 'off', consentRows: 1 });
    expect(by((await w.screen('f')).tables, 'f3').measured).toBe(true);
    expect(by((await w.screen('g')).tables, 'g1').measured).toBe(true);
    const b = (await w.screen('b')).tables;
    expect(['b1', 'b2', 'b3'].map((id) => by(b, id).measured)).toEqual([true, true, true]);
  });
  it('off sin datos ⇒ f3/g1/b1-b3 siguen NO MEDIDO', async () => {
    const w = build({ mode: 'off', consentRows: 0 });
    expect(by((await w.screen('f')).tables, 'f3').measured).toBe(false);
    expect(by((await w.screen('g')).tables, 'g1').measured).toBe(false);
    expect(by((await w.screen('b')).tables, 'b1').measured).toBe(false);
  });
  it('f1: off + alguna fila del contador en el periodo ⇒ medida; sin filas ⇒ NO MEDIDO', async () => {
    expect(by((await build({ mode: 'off', counterRows: 1 }).screen('f')).tables, 'f1').measured).toBe(true);
    expect(by((await build({ mode: 'off', counterRows: 0 }).screen('f')).tables, 'f1').measured).toBe(false);
  });
});

describe('(2) f3 con las tres respuestas de consentimiento', () => {
  it('pagados, con origen, aceptaron, la rechazaron y «Sin elección registrada …»', async () => {
    const f3 = by((await build({ mode: 'on' }).screen('f')).tables, 'f3');
    expect(f3.rows.map((r) => [r.concepto, r.pedidos, r.pct])).toEqual([
      ['Pedidos pagados del periodo', 10, 100],
      ['Con origen registrado (first_utm_source)', 3, 30],
      ['Aceptaron la analítica', 4, 40],
      ['La rechazaron', 1, 10],
      ['Sin elección registrada (no respondió al aviso, o pedido anterior a la medición)', 2, 20],
    ]);
  });
});

describe('(3) línea de cobertura por modo (literal)', () => {
  it('off ⇒ texto de off; on ⇒ texto de on; en toda pantalla', async () => {
    expect(COVERAGE_NOTE).toBe('Cobertura: GA4 sin encender; el origen de los pedidos aún no se registra.');
    expect(COVERAGE_NOTE_ON).toBe('Cobertura: GA4 y el origen de los pedidos solo cuentan a quien aceptó la analítica; la proporción está en f3.');
    for (const s of ['a', 'h'] as const) {
      expect((await build({ mode: 'off' }).screen(s)).notes).toEqual([COVERAGE_NOTE]);
      expect((await build({ mode: 'on' }).screen(s)).notes).toEqual([COVERAGE_NOTE_ON]);
    }
  });
});

describe('(4) GA4 con credenciales (doble): forma de cada runReport y cálculo', () => {
  it('clasificadores puros de a4/b4 y rutas de ficha', () => {
    expect(a4Group('instagram', 'bio', 'Organic Social')).toBe('Instagram orgánico');
    expect(a4Group('instagram', 'paid', 'Paid Social')).toBe('Instagram pagado');
    expect(a4Group('google', 'organic', 'Organic Search')).toBe('Google orgánico');
    expect(a4Group('claude.ai', 'referral', 'Referral')).toBe('Asistentes de IA');
    expect(a4Group('(direct)', '(none)', 'Direct')).toBe('Directo/otros');
    expect(b4Group('pokebeach.com', 'referral', 'Referral')).toBe('Referencia: pokebeach.com');
    expect(b4Group('instagram', 'bio', 'Organic Social')).toBeNull();
    expect(fichaOf('/es/catalog/card-1')).toEqual({ kind: 'card', id: 'card-1' });
    expect(fichaOf('/en/sellado/inv-9?x=1')).toEqual({ kind: 'sealed', id: 'inv-9' });
    expect(fichaOf('/es/guias/x')).toBeNull();
  });

  it('a4 (5 grupos) y a5 (embudo con % y «Compras (BD)»; paso sin evento ⇒ null con nota)', async () => {
    const w = build({ mode: 'on', ga4: true });
    const a = (await w.screen('a')).tables;
    expect(by(a, 'a4').rows).toEqual([
      { grupo: 'Instagram orgánico', sesiones: 50 },
      { grupo: 'Instagram pagado', sesiones: 20 },
      { grupo: 'Google orgánico', sesiones: 30 },
      { grupo: 'Asistentes de IA', sesiones: 6 },
      { grupo: 'Directo/otros', sesiones: 32 },
    ]);
    const a5 = by(a, 'a5');
    expect(a5.rows).toEqual([
      { paso: 'Sesiones', n: 1000, pct: null },
      { paso: 'view_item', n: 500, pct: 50 },
      { paso: 'add_to_cart', n: 50, pct: 10 },
      { paso: 'begin_checkout', n: 20, pct: 40 },
      { paso: 'add_payment_info', n: null, pct: null },
      { paso: 'purchase', n: 8, pct: null },
      { paso: 'Compras (BD)', n: 10, pct: null },
    ]);
    expect(a5.notes!.join(' ')).toContain('add_payment_info');
    const shapes = w.calls.map((c) => [dimsOf(c), c.metrics.map((m) => m.name).join(',')]);
    expect(shapes).toEqual(
      expect.arrayContaining([
        ['sessionSource,sessionMedium,sessionDefaultChannelGroup', 'sessions'],
        ['eventName', 'eventCount'],
        ['', 'sessions'],
      ]),
    );
    const ev = w.calls.find((c) => dimsOf(c) === 'eventName')!;
    expect(ev.dimensionFilter).toEqual({
      filter: { fieldName: 'eventName', inListFilter: { values: ['view_item', 'add_to_cart', 'begin_checkout', 'add_payment_info', 'purchase'] } },
    });
  });

  it('b4, c1, c5, d1 (vistas), d2 y e3', async () => {
    const w = build({ mode: 'on', ga4: true });
    expect(by((await w.screen('b')).tables, 'b4').rows).toEqual([
      { canal: 'Google orgánico', sesiones: 30 },
      { canal: 'Directo', sesiones: 25 },
      { canal: 'Referencia: pokebeach.com', sesiones: 7 },
      { canal: 'Asistentes de IA', sesiones: 6 },
    ]);
    const c = (await w.screen('c')).tables;
    expect(by(c, 'c1').rows).toEqual([
      { pagina: 'Charizard · 151 4', vistas: 300, usuarios: 120, tiempoMedio: 30 },
      { pagina: '/es/guias/que-es-nm', vistas: 80, usuarios: 60, tiempoMedio: 50 },
      // la ficha de sellado (3 usuarios) sola oculta ⇒ supresión complementaria con la siguiente más chica (`/es`).
      { pagina: 'Otros (< 5 c/u)', vistas: 'oculta', usuarios: SMALL_CELL_SENTINEL, tiempoMedio: 'oculta' },
    ]);
    expect(by(c, 'c5').rows).toEqual([
      { dispositivo: 'mobile · Instagram', sesiones: 70 },
      { dispositivo: 'desktop · Chrome', sesiones: 30 },
    ]);
    expect(w.calls.find((x) => dimsOf(x) === 'pagePath')!.orderBys).toEqual([{ metric: { metricName: 'screenPageViews' }, desc: true }]);
    const d = (await w.screen('d')).tables;
    expect(by(d, 'd1').rows[0]).toMatchObject({ carta: 'Charizard · 151 4', vistas: 400, unidadesVendidas: 6 });
    expect(by(d, 'd2').rows).toEqual([{ producto: 'Pikachu · Base 25', vistas: 25, carritoPct: 20 }]);
    const e3 = by((await w.screen('e')).tables, 'e3');
    expect(e3.rows).toEqual([
      { fuente: 'claude.ai · /es/como-funciona', sesiones: 9 },
      // perplexity (2) sola oculta ⇒ se agrupa con la siguiente más chica (chatgpt) en «Otros».
      { fuente: 'Otros (< 5 c/u)', sesiones: SMALL_CELL_SENTINEL },
    ]);
    const ai = w.calls.find((x) => dimsOf(x) === 'sessionSource,landingPage')!;
    expect(ai.dimensionFilter).toEqual({
      filter: { fieldName: 'sessionSource', inListFilter: { values: ['chatgpt.com', 'perplexity.ai', 'gemini.google.com', 'copilot.microsoft.com', 'claude.ai'] } },
    });
    expect(w.calls.find((x) => dimsOf(x) === 'itemId')!.metrics.map((m) => m.name)).toEqual(['itemsViewed', 'itemsAddedToCart']);
    expect(w.calls.find((x) => dimsOf(x) === 'deviceCategory,browser')!.metrics.map((m) => m.name)).toEqual(['sessions']);
  });

  it('una consulta que falla deja SU tabla «sin conectar»; las demás de la pantalla siguen medidas', async () => {
    const w = build({ mode: 'on', ga4: true, failDims: 'pagePath' });
    const c = (await w.screen('c')).tables;
    expect([by(c, 'c1').measured, by(c, 'c1').notMeasuredReason]).toEqual([false, 'NO MEDIDO — GA4 sin conectar']);
    expect(by(c, 'c5').measured).toBe(true);
  });

  it('on sin credenciales ⇒ «GA4 sin conectar»; off ⇒ «GA4 sin encender»; 0 llamadas en ambos', async () => {
    for (const [mode, reason] of [['on', 'NO MEDIDO — GA4 sin conectar'], ['off', 'NO MEDIDO — GA4 sin encender']] as const) {
      const w = build({ mode, ga4: false });
      const c1 = by((await w.screen('c')).tables, 'c1');
      expect([c1.measured, c1.notMeasuredReason]).toEqual([false, reason]);
      expect(w.calls).toEqual([]);
    }
  });
});

describe('TL-MKT2-D5 · c1 agrega por la etiqueta (una ficha en dos idiomas es UNA fila)', () => {
  const row = (path: string, views: number, users: number, dur: number) => ({ dimensions: [path], metrics: [views, users, dur] });
  const label = (p: string) => (p.endsWith('/catalog/card-1') ? 'Charizard · 151 4' : p);

  it('/es/catalog/card-1 y /en/catalog/card-1 ⇒ una sola fila con vistas, usuarios y duración sumados; claves únicas', () => {
    const out = c1Rows([row('/es/catalog/card-1', 300, 120, 9000), row('/es', 200, 90, 1000), row('/en/catalog/card-1', 100, 30, 3000)], label);
    expect(out).toEqual([
      { key: 'Charizard · 151 4', count: 150, money: { vistas: 400, tiempoMedio: 30 } },
      { key: '/es', count: 90, money: { vistas: 200, tiempoMedio: 5 } },
    ]);
    expect(new Set(out.map((r) => r.key)).size).toBe(out.length);
  });

  it('celda pequeña: dos idiomas con 3 + 3 usuarios ⇒ la unión puede ser 3 ⇒ count < 5 (no se publica la suma 6); 5 + 3 ⇒ 8', () => {
    expect(c1Rows([row('/es/catalog/card-1', 10, 3, 0), row('/en/catalog/card-1', 10, 3, 0)], label)[0].count).toBe(3);
    expect(c1Rows([row('/es/catalog/card-1', 10, 5, 0), row('/en/catalog/card-1', 10, 3, 0)], label)[0].count).toBe(8);
  });

  it('el corte de 50 se hace DESPUÉS de agregar (la suma de dos idiomas puede entrar en el top)', () => {
    const rows = Array.from({ length: 50 }, (_, i) => row(`/es/p${i}`, 100, 10, 0));
    rows.push(row('/es/catalog/card-1', 60, 6, 0), row('/en/catalog/card-1', 60, 6, 0));
    const out = c1Rows(rows, label);
    expect(out).toHaveLength(50);
    expect(out[0]).toMatchObject({ key: 'Charizard · 151 4', money: { vistas: 120 } });
  });
});

describe('C-P1 (v1.106 §MKT.G.5) · null = «sin dato»; en una fila oculta toda celda no texto es «oculta»', () => {
  const hiddenRow = (r: Record<string, unknown>) => Object.values(r).some((v) => v === SMALL_CELL_SENTINEL || v === SMALL_CELL_HIDDEN);

  it('small_cells, GA4 encendido: en a-g, ninguna fila con conteo oculto lleva null en una columna no texto (c1, d1, d2, g1 y las de BD incluidas)', async () => {
    const w = build({ mode: 'on', ga4: true });
    // d1 con una carta de 2 unidades (oculta ⇒ «Otros» con card-1). d2 no puede tener filas ocultas: su conteo son vistas ≥ 20.
    const card = (id: string, name: string, number: string) => ({ unitPriceCents: 1000, inventoryItem: { cardId: id, card: { name, number, set: { name: '151' } } } });
    w.prisma.orderItem.findMany.mockImplementation(async (arg: { select: Record<string, unknown> }) =>
      'inventoryItem' in arg.select
        ? [...Array.from({ length: 6 }, () => card('card-1', 'Charizard', '4')), card('card-2', 'Pikachu', '25'), card('card-2', 'Pikachu', '25')]
        : [{ cardSnapshot: { cardId: 'card-1', productType: 'raw' } }],
    );
    const seen = new Set<string>();
    for (const s of ['a', 'b', 'c', 'd', 'e', 'f', 'g'] as const) {
      for (const t of (await w.screen(s)).tables) {
        const nonText = t.columns.filter((c) => c.kind !== 'text').map((c) => c.key);
        for (const r of t.rows.filter(hiddenRow)) {
          seen.add(t.id);
          for (const k of nonText) expect({ table: t.id, col: k, v: r[k] ?? null }).not.toEqual({ table: t.id, col: k, v: null });
        }
      }
    }
    // El fixture tiene filas ocultas en estas (si no, la prueba no prueba nada).
    for (const id of ['a3', 'c1', 'd1']) expect([id, seen.has(id)]).toEqual([id, true]);
  });

  it('d1/d2 cruzan GA4 por itemId canónico: c_card-1 llena las vistas de d1; d2 nombra c_/s_ desde BD', async () => {
    const d = (await build({ mode: 'on', ga4: true }).screen('d')).tables;
    expect(by(d, 'd1').rows[0]).toMatchObject({ carta: 'Charizard · 151 4', vistas: 400 });
    expect(by(d, 'd2').rows).toEqual([{ producto: 'Pikachu · Base 25', vistas: 25, carritoPct: 20 }]);
  });

  it('sealHiddenRows: null ⇒ «oculta» solo en filas ocultas y solo en columnas no texto; null fuera de ellas se queda «—»', () => {
    const t = sealHiddenRows({
      id: 'x',
      title: 'x',
      source: 'BD',
      measured: true,
      columns: [
        { key: 'k', labelEs: 'k', kind: 'text' },
        { key: 'n', labelEs: 'n', kind: 'count' },
        { key: 'm', labelEs: 'm', kind: 'money' },
      ],
      rows: [
        { k: null, n: SMALL_CELL_SENTINEL, m: null },
        { k: 'b', n: 7, m: null },
      ],
    });
    expect(t.rows).toEqual([
      { k: null, n: SMALL_CELL_SENTINEL, m: SMALL_CELL_HIDDEN },
      { k: 'b', n: 7, m: null },
    ]);
  });
});

describe('(5) diferidas con su motivo literal y b1-b3 solo de BD', () => {
  it('c2, c3, c4, c8 ⇒ measured:false con el motivo de §MKT.H.9 (también con credenciales)', async () => {
    const c = (await build({ mode: 'on', ga4: true }).screen('c')).tables;
    expect(['c2', 'c3', 'c4', 'c8'].map((id) => [id, by(c, id).measured, by(c, id).notMeasuredReason])).toEqual([
      ['c2', false, 'NO MEDIDO — la clasificación por tipo de página no está definida todavía'],
      ['c3', false, 'NO MEDIDO — la consulta de abandono no está definida todavía'],
      ['c4', false, 'NO MEDIDO — el evento del botón COMPRAR todavía no se envía'],
      ['c8', false, 'NO MEDIDO — la clasificación por tipo de página no está definida todavía'],
    ]);
  });
  it('b1/b2/b3 de pedidos y solicitudes por first_utm_*; dm en una sola fila; sin GA4', async () => {
    const w = build({ mode: 'on', ga4: true });
    const b = (await w.screen('b')).tables;
    expect(by(b, 'b1').rows).toEqual([
      { origen: 'instagram / dm', pedidos: 5, mxnPedidos: 250, solicitudes: 1, mxnOfertado: 2500 },
      { origen: 'instagram / bio', pedidos: 5, mxnPedidos: 500, solicitudes: 0, mxnOfertado: 0 },
    ]);
    expect(by(b, 'b2').rows.map((r) => r.puerta)).toEqual(['Mensaje directo', 'Bio']);
    expect(by(b, 'b3').rows.map((r) => r.pieza)).toEqual(['Mensaje directo (dm)', 'reel-1']);
    expect(['b1', 'b2', 'b3'].map((id) => by(b, id).source)).toEqual(['BD', 'BD', 'BD']);
    expect(by(b, 'b1').notes!.join(' ')).toContain('Sesiones por primer origen');
  });
});
