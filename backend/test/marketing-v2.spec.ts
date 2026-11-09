/**
 * MKT-V2 (docs/specs/MKT_PANEL_V2.md): pantalla r, avisos, tráfico propio, tipo de página, c6 sin PII, correo del lunes.
 * Zona sensible por privacidad: r3 solo con `exact`; c6 no guarda datos personales; el correo solo lleva agregados.
 */
import * as fs from 'fs';
import * as path from 'path';
import { INTERNAL_UTM_RE, ga4InternalExclusion, isInternalUtm, withInternalExclusion } from '../src/modules/marketing/internal-traffic';
import { AV1_MIN_CHECKOUTS, evaluateAlerts, type AlertInputs } from '../src/modules/marketing/marketing-alerts';
import { deltaCells, nvrCells, sumIfVisible } from '../src/modules/marketing/marketing-summary';
import { PAGE_TYPE_LABEL, landingRows, pageTypeOf } from '../src/modules/marketing/marketing-ga4';
import { MarketingSearchMissService, normalizeSearchTerm } from '../src/modules/marketing/marketing-search-miss.service';
import { MarketingWeeklyDigestService } from '../src/modules/marketing/marketing-weekly-digest.service';
import { weekRangeLabel, weeklyDigestMail } from '../src/modules/marketing/marketing-weekly-digest.mail';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExternalSources, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { marketingPeriodOptions, resolveMarketingPeriod, type MarketingPeriod } from '../src/modules/marketing/marketing-period';
import type { CellPrivacy } from '../src/modules/marketing/small-cells';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const ownerExact = (): CellPrivacy => 'exact' as CellPrivacy;
const WEEK: MarketingPeriod = { kind: 'week', from: '2027-02-08', to: '2027-02-14', prev: { from: '2027-02-01', to: '2027-02-07' }, label: '2027-W06' };
const MONTH: MarketingPeriod = { kind: 'month', from: '2027-02-01', to: '2027-02-28', prev: { from: '2027-01-01', to: '2027-01-31' }, label: '2027-02' };
const NOW = new Date('2027-03-10T12:00:00.000Z');
const SA = JSON.stringify({ client_email: 'panel@tienda.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });
const by = (ts: AggTable[], id: string) => ts.find((t) => t.id === id)!;

describe('tráfico propio (§4)', () => {
  it.each(['diag', 'diag-lighthouse', 'QA_playwright', 'e2e.run', 'smoke', 'Test-1', 'probe-x', 'internal'])('%s ⇒ propio', (v) => {
    expect(INTERNAL_UTM_RE.test(v)).toBe(true);
    expect(isInternalUtm(v, null)).toBe(true);
    expect(isInternalUtm('instagram', v)).toBe(true);
  });
  it.each(['instagram', 'diagnostico', 'qa2', 'testing', 'attest', 'google', '', null])('%s ⇒ NO es propio', (v) => {
    expect(isInternalUtm(v as string | null, null)).toBe(false);
  });
  it('el filtro de GA4 es NOT(source OR medium) y se combina con inList en un andGroup', () => {
    const nx = ga4InternalExclusion() as { notExpression: { orGroup: { expressions: { filter: { fieldName: string } }[] } } };
    expect(nx.notExpression.orGroup.expressions.map((e) => e.filter.fieldName)).toEqual(['sessionSource', 'sessionMedium']);
    const inList = { filter: { fieldName: 'eventName', inListFilter: { values: ['a'] } } };
    expect(withInternalExclusion(inList)).toEqual({ andGroup: { expressions: [inList, ga4InternalExclusion()] } });
    expect(withInternalExclusion()).toEqual(ga4InternalExclusion());
  });
});

describe('pageTypeOf (§6.1)', () => {
  it.each([
    ['/es', 'home'], ['/en/', 'home'], ['/es/catalog', 'catalogo'], ['/es/compra', 'catalogo'], ['/en/catalog/abc?x=1#y', 'ficha-carta'],
    ['/es/sellado', 'sellado'], ['/es/sellado/inv-9', 'ficha-sellado'], ['/es/checkout', 'checkout'], ['/es/buylist', 'buylist'],
    ['/es/account/orders', 'cuenta'], ['/card-show', 'card-show'], ['/es/guias/x', 'otras'], ['', 'otras'],
  ] as const)('%s ⇒ %s', (p, t) => expect(pageTypeOf(p)).toBe(t));
  it('c3: abandono = 1 − engaged/sessions por tipo, es/en juntos', () => {
    const rows = landingRows([
      { dimensions: ['/es/catalog/a'], metrics: [10, 6] },
      { dimensions: ['/en/catalog/b'], metrics: [10, 4] },
      { dimensions: ['/es'], metrics: [0, 0] },
    ]);
    expect(rows.find((r) => r.key === PAGE_TYPE_LABEL['ficha-carta'])).toMatchObject({ count: 20, money: { abandono: 50 } });
    expect(rows.find((r) => r.key === PAGE_TYPE_LABEL.home)?.money.abandono).toBeNull();
  });
});

describe('avisos (§2)', () => {
  const base: AlertInputs = { checkoutStarts: 4, paidOrders: 1, groups: [], items: [], scPages: [], buylist: [], searchMisses: [], exact: true };
  it('todo bajo umbral ⇒ una fila «Sin avisos esta semana»', () => {
    expect(evaluateAlerts(base)).toEqual([{ regla: '—', gravedad: 'info', titulo: 'Sin avisos esta semana', evidencia: 'Ninguna regla pasó su umbral.', accion: '' }]);
  });
  it('AV1: ≥ 5 inicios de pago y 0 pedidos ⇒ texto exacto', () => {
    const a = evaluateAlerts({ ...base, checkoutStarts: AV1_MIN_CHECKOUTS, paidOrders: 0 });
    expect(a).toHaveLength(1);
    expect(a[0]).toMatchObject({ regla: 'AV1', gravedad: 'alta', accion: 'Iniciaron 5 pagos y nadie pagó: prueba el pago tú mismo.' });
  });
  it('AV2: Instagram orgánico 11 → 1 en exact cita −91 %; en small_cells NO cita el 1', () => {
    const groups = [{ name: 'Instagram orgánico', cur: 1, prev: 11 }];
    expect(evaluateAlerts({ ...base, groups })[0].accion).toBe('Instagram orgánico bajó de 11 a 1 (−91 %): revisa que la historia lleve el enlace.');
    const mail = evaluateAlerts({ ...base, groups, exact: false })[0];
    expect(JSON.stringify(mail)).not.toMatch(/a 1\b|\b1 sesiones/);
    expect(mail.accion).toContain('menos de 5');
  });
  it('AV2 no dispara con previa < 10 ni con caída ≤ 50 % no cumplida', () => {
    expect(evaluateAlerts({ ...base, groups: [{ name: 'Google orgánico', cur: 0, prev: 9 }, { name: 'Directo/otros', cur: 6, prev: 10 }] })[0].regla).toBe('—');
  });
  it('AV3/AV4/AV5/AV6: textos exactos y tope de 3 por regla (cifra desc, clave asc)', () => {
    const a = evaluateAlerts({
      ...base,
      items: [{ name: 'Z', views: 10, carts: 0, sold: false }, { name: 'A', views: 30, carts: 1, sold: false }, { name: 'B', views: 30, carts: 0, sold: false }, { name: 'C', views: 12, carts: 0, sold: false }, { name: 'V', views: 99, carts: 0, sold: true }, { name: 'W', views: 99, carts: 2, sold: false }],
      scPages: [{ label: 'Charizard · 151 4', impressions: 25, clicks: 0, position: 8.34 }],
      buylist: [{ name: 'Pikachu', quotes: 6, listed: 0 }, { name: 'Mew', quotes: 9, listed: 2 }],
      searchMisses: [{ term: 'umbreon vmax', count: 7, days: 3 }, { term: 'solo un dia', count: 9, days: 1 }],
    });
    expect(a.filter((x) => x.regla === 'AV3').map((x) => x.accion)).toEqual([
      'A: 30 vistas, 0 ventas: revisa precio, foto y descripción.',
      'B: 30 vistas, 0 ventas: revisa precio, foto y descripción.',
      'C: 12 vistas, 0 ventas: revisa precio, foto y descripción.',
    ]);
    expect(a.find((x) => x.regla === 'AV4')!.accion).toBe('Charizard · 151 4 salió 25 veces en Google sin clics (posición 8.3): mejora título y descripción de esa ficha.');
    expect(a.find((x) => x.regla === 'AV5')!.accion).toBe('Te la cotizan 6 veces y no tienes a la venta: súbela de oferta o consíguela.');
    expect(a.filter((x) => x.regla === 'AV6').map((x) => x.accion)).toEqual(['Buscan "umbreon vmax" 7 veces y no hay resultado: ¿falta en el catálogo?']);
  });
});

describe('celdas de r1', () => {
  it('delta: nuevo, neutro (< 5 ambos) y normal', () => {
    expect(deltaCells(10, 0)).toEqual({ delta_abs: 10, delta_pct: null });
    expect(deltaCells(3, 4)).toEqual({ delta_abs: null, delta_pct: null });
    expect(deltaCells(0, 0)).toEqual({ delta_abs: null, delta_pct: null });
    expect(deltaCells(15, 10)).toEqual({ delta_abs: 5, delta_pct: 50 });
    expect(deltaCells('NO MEDIDO — x', 5)).toEqual({ delta_abs: null, delta_pct: null });
    expect(deltaCells(1000, 1200, [2, 3])).toEqual({ delta_abs: null, delta_pct: null }); // MX$ con ruido de pedidos
  });
  it('nuevos/recurrentes: si una sale «< 5», la otra se oculta (el total es exacto); exact las deja tal cual', () => {
    expect(nvrCells({ nuevos: 3, recurrentes: 40 }, false)).toEqual(['< 5', 'oculta']);
    expect(nvrCells({ nuevos: 3, recurrentes: 2 }, false)).toEqual(['< 5', '< 5']);
    expect(nvrCells({ nuevos: 30, recurrentes: 40 }, false)).toEqual([30, 40]);
    expect(nvrCells({ nuevos: 3, recurrentes: 40 }, true)).toEqual([3, 40]);
  });
  it('suma de celdas ya saneadas: una oculta ⇒ «oculta»', () => {
    expect(sumIfVisible([6, 9])).toBe(15);
    expect(sumIfVisible([6, '< 5'])).toBe('oculta');
  });
});

// ───────────────────────── screen('r') con dobles de GA4 / Search Console ─────────────────────────

type Body = { dimensions?: { name: string }[]; dateRanges: { startDate: string }[]; dimensionFilter?: unknown };
type ScBody = { dimensions?: string[] };
function build(opts: { tz?: string; nvrNew?: number } = {}) {
  const calls: Body[] = [];
  const r = (dims: string[], mets: number[]) => ({ dimensionValues: dims.map((value) => ({ value })), metricValues: mets.map((m) => ({ value: String(m) })) });
  const port: GoogleReadPort = {
    postJson: jest.fn(async (_k, _s, url, body) => {
      if (url.includes('searchconsole')) {
        const dims = ((body as ScBody).dimensions ?? []).join(',');
        if (dims === 'page') return { rows: [{ keys: ['https://www.tcghunt.mx/es/catalog/card-1'], clicks: 0, impressions: 25, ctr: 0, position: 8.3 }] };
        return { rows: [{ clicks: 12, impressions: 300, ctr: 0.04, position: 5 }] };
      }
      const b = body as Body;
      calls.push(b);
      const cur = b.dateRanges[0].startDate === WEEK.from;
      const dims = (b.dimensions ?? []).map((d) => d.name).join(',');
      const tz = { metadata: { timeZone: opts.tz ?? 'America/Mexico_City' } };
      switch (dims) {
        case '':
          return { rows: [r([], cur ? [1000, 100] : [900, 80])], ...tz };
        case 'newVsReturning':
          return { rows: [r(['new'], [cur ? (opts.nvrNew ?? 60) : 50]), r(['returning'], [cur ? 40 : 30])], ...tz };
        case 'eventName':
          return { rows: [r(['view_item'], [cur ? 500 : 400]), r(['add_to_cart'], [cur ? 50 : 40]), r(['begin_checkout'], [cur ? 20 : 10])], ...tz };
        case 'sessionSource,sessionMedium,sessionDefaultChannelGroup':
          return { rows: [r(['instagram', 'bio', 'Organic Social'], [cur ? 1 : 11]), r(['instagram', 'paid', 'Paid Social'], [cur ? 0 : 0]), r(['google', 'organic', 'Organic Search'], [30])], ...tz };
        case 'date,newVsReturning':
          return { rows: [r(['20270208', 'new'], [4]), r(['20270208', 'returning'], [2]), r(['20270209', 'new'], [7])], ...tz };
        case 'date,sessionSource,sessionMedium,sessionDefaultChannelGroup':
          return { rows: [r(['20270208', 'instagram', 'bio', 'Organic Social'], [3]), r(['20270209', 'google', 'organic', 'Organic Search'], [5])], ...tz };
        case 'itemId':
          return { rows: [r(['c_card-1'], [40, 0])], ...tz };
        case 'pagePath':
          return { rows: [r(['/es/catalog/card-1'], [300, 120, 9000])], ...tz };
        case 'deviceCategory,browser':
          return { rows: [r(['mobile', 'Instagram'], [70])], ...tz };
        case 'sessionSource,landingPage':
          return { rows: [], ...tz };
        default:
          return { rows: [], ...tz };
      }
    }),
  };
  const prisma = {
    marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => [{ response: 'accept', _sum: { count: 8 } }, { response: 'necessary_only', _sum: { count: 2 } }]) },
    order: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _sum: { totalCents: 0 } })) },
    sellRequest: { findMany: jest.fn(async () => []), aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _sum: { quotedTotalCents: 0, payoutNetCents: 0 } })) },
    orderItem: { findMany: jest.fn(async () => []) },
    card: { findMany: jest.fn(async () => [{ id: 'card-1', name: 'Charizard', number: '4', set: { name: '151' } }]) },
    sealedProduct: { findMany: jest.fn(async () => []) },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => [{ cardId: 'card-1', _sum: { count: 6 } }]) },
    wishlistItem: { groupBy: jest.fn(async () => []) },
    sellRequestItem: { findMany: jest.fn(async () => []), groupBy: jest.fn(async () => []) },
    configSetting: { findUnique: jest.fn(async () => null) },
    searchNoResultDaily: { groupBy: jest.fn(async () => [{ termNormalized: 'umbreon vmax', _sum: { count: 7 }, _count: { _all: 3 } }, { termNormalized: 'raro', _sum: { count: 2 }, _count: { _all: 2 } }]) },
  };
  const env = fullEnv({ MEASUREMENT_MODE: 'on', MKT_GOOGLE_SA_JSON: SA, MKT_GA4_PROPERTY_ID: '123456789', MKT_SEARCH_CONSOLE_SITE: 'sc-domain:tcghunt.mx' });
  const sales = { report: jest.fn(async () => ({ totals: { orders: 0, chargedCents: 0, avgTicketCents: null, piecesPerOrder: null }, previousTotals: { orders: 7, chargedCents: 700000, avgTicketCents: 100000, piecesPerOrder: 1 }, comparison: { orders: { diff: 0, pct: 0 }, chargedCents: { diff: 0, pct: 0 } } })) };
  const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never, new MeasurementService(prisma as never, fakeConfig(env)), new MarketingExternalSources(fakeConfig(env), port));
  return { svc, prisma, calls, port };
}

describe("screen('r')", () => {
  it('r1: 12 filas (8 cifras + sublíneas) con delta; r2 con AV1 y AV2; r3 solo en exact', async () => {
    const { svc } = build();
    const p = await svc.screen('r', WEEK, NOW, ownerExact());
    expect(p.tables.map((t) => t.id)).toEqual(['r1', 'r2', 'r3']);
    const r1 = by(p.tables, 'r1');
    expect(r1.columns.map((c) => c.key)).toEqual(['cifra', 'actual', 'anterior', 'delta_abs', 'delta_pct']);
    const row = (label: string) => r1.rows.find((x) => x.cifra === label)!;
    expect(row('Visitantes reales (que aceptaron cookies)')).toMatchObject({ actual: 100, anterior: 80, delta_abs: 20, delta_pct: 25 });
    expect(row('Inicios de pago')).toMatchObject({ actual: 20, anterior: 10, delta_pct: 100 });
    expect(row('Pedidos pagados')).toMatchObject({ actual: 0, anterior: 7, delta_abs: -7, delta_pct: -100 });
    expect(row('Google: clics')).toMatchObject({ actual: 12 });
    expect(row('Aceptación de cookies (%)')).toMatchObject({ actual: 80 });
    const reglas = by(p.tables, 'r2').rows.map((x) => x.regla);
    expect(reglas).toEqual(expect.arrayContaining(['AV1', 'AV2', 'AV3', 'AV4', 'AV5', 'AV6']));
    const r3 = by(p.tables, 'r3');
    expect(r3.measured).toBe(true);
    expect(r3.rows).toHaveLength(7);
    expect(r3.rows[0]).toMatchObject({ dia: '2027-02-08', nuevos: 4, recurrentes: 2, ses_instagram_organico: 3 });
    expect(r3.notes).toContain('Solo visible para ti.');
  });
  it('privacidad: en small_cells NO hay r3 (ni sus columnas) y en un mes tampoco, ni siquiera exact', async () => {
    const { svc } = build();
    const cells = await svc.screen('r', WEEK, NOW, 'small_cells');
    expect(cells.tables.map((t) => t.id)).toEqual(['r1', 'r2']);
    expect(JSON.stringify(cells)).not.toMatch(/ses_instagram_organico|Día por día|ses_directo_otros/);
    const month = await svc.screen('r', MONTH, NOW, ownerExact());
    expect(month.tables.map((t) => t.id)).toEqual(['r1', 'r2']);
  });
  it('small_cells: nuevos 3 ⇒ «< 5» y recurrentes «oculta»; Instagram con una celda < 5 ⇒ «oculta»; AV2 no cita el 1', async () => {
    const { svc } = build({ nvrNew: 3 });
    const r1 = by((await svc.screen('r', WEEK, NOW, 'small_cells')).tables, 'r1');
    const row = (l: string) => r1.rows.find((x) => x.cifra === l)!;
    expect([row('· Nuevos').actual, row('· Recurrentes').actual]).toEqual(['< 5', 'oculta']);
    expect(row('Sesiones desde Instagram').actual).not.toBe(1);
    const av2 = by((await svc.screen('r', WEEK, NOW, 'small_cells')).tables, 'r2').rows.filter((x) => x.regla === 'AV2');
    expect(JSON.stringify(av2)).not.toMatch(/ a 1[ ).]/);
  });
  it('r3 con zona horaria de GA4 distinta de CDMX ⇒ NO MEDIDO', async () => {
    const r3 = by((await build({ tz: 'America/Los_Angeles' }).svc.screen('r', WEEK, NOW, ownerExact())).tables, 'r3');
    expect([r3.measured, r3.notMeasuredReason]).toEqual([false, 'NO MEDIDO — la zona horaria de GA4 no es CDMX']);
  });
  it('TODA consulta de GA4 lleva la exclusión de tráfico propio', async () => {
    const { svc, calls } = build();
    await svc.screen('r', WEEK, NOW, ownerExact());
    await svc.screen('c', WEEK, NOW, ownerExact());
    expect(calls.length).toBeGreaterThan(8);
    for (const c of calls) expect(JSON.stringify(c.dimensionFilter)).toContain(JSON.stringify(ga4InternalExclusion()).slice(1, -1));
  });
  it('presupuesto: la vista fría del Resumen hace ≤ 30 consultas a Google', async () => {
    const { svc, port } = build();
    await svc.screen('r', WEEK, NOW, ownerExact());
    expect((port.postJson as jest.Mock).mock.calls.length).toBeLessThanOrEqual(30);
  });
  it('sin GA4 ni Search Console: las filas GA4 llevan el motivo NO MEDIDO y r2 dice «No se evaluó»', async () => {
    const prisma = { marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []) }, order: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) }, buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) }, configSetting: { findUnique: jest.fn(async () => null) }, searchNoResultDaily: { groupBy: jest.fn(async () => []) } };
    const sales = { report: jest.fn(async () => ({ totals: { orders: 0, chargedCents: 0 }, previousTotals: { orders: 0, chargedCents: 0 } })) };
    const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never);
    const p = await svc.screen('r', WEEK, NOW, 'small_cells');
    const r1 = by(p.tables, 'r1');
    expect(r1.rows.find((x) => x.cifra === 'Fichas vistas')).toMatchObject({ actual: 'NO MEDIDO — GA4 sin encender', delta_abs: null });
    const r2 = by(p.tables, 'r2');
    expect(r2.rows.map((x) => x.titulo)).toEqual(['Sin avisos esta semana', 'No se evaluó: GA4 sin encender', 'No se evaluó: Search Console sin conectar']);
  });
});

describe('c2/c3/c4/c8/c9/e2/c6/d1', () => {
  it('c2, c3, c8, c9 y e2 se miden; c4 espera su evento; c6 lista solo lo que pasa el umbral', async () => {
    const { svc } = build();
    const c = (await svc.screen('c', WEEK, NOW, ownerExact())).tables;
    expect(['c2', 'c3', 'c8', 'c9'].map((id) => by(c, id).measured)).toEqual([true, true, true, true]);
    expect(by(c, 'c4').notMeasuredReason).toBe('NO MEDIDO — el evento del botón COMPRAR todavía no se envía');
    expect(by(c, 'c2').rows[0]).toMatchObject({ tipo: PAGE_TYPE_LABEL['ficha-carta'] });
    // 'raro' (2 búsquedas) no llega al umbral aunque el doble lo devuelva: el filtro es del servicio.
    expect(by(c, 'c6').rows).toEqual([{ termino: 'umbreon vmax', busquedas: 7, dias: 3 }]);
  });
  it('d1: aparecen las cartas más vistas aunque no se hayan vendido (vendidas = 0 exacto)', async () => {
    const { svc } = build();
    const d = (await svc.screen('d', WEEK, NOW, ownerExact())).tables;
    expect(by(d, 'd1').rows).toEqual([{ carta: 'Charizard · 151 4', vistas: 40, unidadesVendidas: 0, mxn: 0, aLaVentaHoy: 0 }]);
  });
  it('e2: páginas de Google por ficha, sin consultas', async () => {
    const { svc } = build();
    const e = (await svc.screen('e', WEEK, NOW, ownerExact())).tables;
    expect(by(e, 'e2').rows[0]).toMatchObject({ pagina: 'Charizard · 151 4', clics: 0, impresiones: 25 });
    expect(JSON.stringify(by(e, 'e2'))).not.toContain('charizard 151');
  });
});

describe('c6 sin datos personales (§7)', () => {
  it.each(['juan@correo.com', '@usuario', 'GOMC800101HDFRRR09', 'ABCD800101AB1', '5512345678', '55 1234 5678', '4111-1111-1111-1111', 'a'.repeat(81), '', 'x', 123, null])('%p ⇒ no se guarda', (t) => {
    expect(normalizeSearchTerm(t)).toBeNull();
  });
  it.each([['Umbreon VMAX', 'umbreon vmax'], ['  Pikachú   ex  ', 'pikachu ex'], ['Año Nuevo', 'año nuevo'], ['charizard 151', 'charizard 151']])('%p ⇒ %p', (t, out) => {
    expect(normalizeSearchTerm(t)).toBe(out);
  });
  it('record: PII ⇒ ninguna escritura; término válido ⇒ un INSERT … ON CONFLICT; flag apagado ⇒ nada; el SQL no lleva IP ni usuario', async () => {
    const prisma = { configSetting: { findUnique: jest.fn(async () => null) }, $executeRaw: jest.fn(async () => 1) };
    const svc = new MarketingSearchMissService(prisma as never);
    expect(await svc.record('mi correo es a@b.mx')).toBe(false);
    expect(await svc.record('GOMC800101HDFRRR09')).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(await svc.record('Umbreon VMAX', NOW)).toBe(true);
    const [strings, ...vals] = prisma.$executeRaw.mock.calls[0] as unknown as [string[], ...unknown[]];
    expect(strings.join('?')).toContain('ON CONFLICT ("termNormalized", "day") DO UPDATE');
    expect(vals).toEqual(['umbreon vmax', '2027-03-10']);
    prisma.configSetting.findUnique.mockResolvedValueOnce({ valueJson: 'off' } as never);
    prisma.$executeRaw.mockClear();
    expect(await svc.record('umbreon vmax')).toBe(false);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
  });
  it('estático: el modelo no guarda IP, usuario ni cookie', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
    const m = /model SearchNoResultDaily \{([\s\S]*?)\n\}/.exec(schema)![1];
    expect(m).not.toMatch(/ip|user|cookie|session|device/i);
  });
});

describe('correo del lunes (§3)', () => {
  const mk = (rows: Record<string, unknown>[]): AggTable => ({ id: 'x', title: 't', source: 'mixed', columns: [], rows: rows as never, measured: true });
  it('asunto, texto y HTML: solo agregados; el HTML se escapa', () => {
    const m = weeklyDigestMail(
      mk([{ cifra: 'Pedidos pagados', actual: 3, anterior: 7, delta_abs: null, delta_pct: null }]),
      mk([{ titulo: '<b>x</b>', evidencia: 'e', accion: 'a' }]),
      '2026-11-02',
      '2026-11-08',
      'https://tcghunt.mx/es/admin/marketing',
    );
    expect(m.subject).toBe('Tu semana en TCG HUNT: 2–8 nov');
    expect(weekRangeLabel('2026-10-27', '2026-11-02')).toBe('27 oct–2 nov');
    expect(m.html).toContain('&lt;b&gt;x&lt;/b&gt;');
    expect(m.text).toContain('https://tcghunt.mx/es/admin/marketing');
  });

  function digest(opts: { recipients?: boolean; sendFails?: number } = {}) {
    const state: { row: { weekStart: Date; status: string; attempts: number; claimedAt: Date | null; sentAt: Date | null } | null } = { row: null };
    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    let fails = opts.sendFails ?? 0;
    const prisma = {
      configSetting: { findUnique: jest.fn(async () => null) },
      user: { findMany: jest.fn(async () => (opts.recipients === false ? [] : [{ id: 'o', isOwner: true, email: 'dueno@tcghunt.mx', name: 'JC', nameSource: 'user', locale: 'es', role: 'super_admin', status: 'active', deletedAt: null, emailVerifiedAt: new Date() }])) },
      $executeRaw: jest.fn(async (_s: unknown, wk: string) => {
        if (!state.row) state.row = { weekStart: new Date(`${wk}T00:00:00.000Z`), status: 'pending', attempts: 0, claimedAt: null, sentAt: null };
        return 1;
      }),
      marketingWeeklyDigest: {
        updateMany: jest.fn(async ({ where, data }: { where: { status: string; OR: { claimedAt: unknown }[] }; data: { claimedAt: Date } }) => {
          const r = state.row;
          const staleBefore = (where.OR[1].claimedAt as { lt: Date }).lt;
          if (!r || r.status !== where.status || (r.claimedAt !== null && r.claimedAt >= staleBefore)) return { count: 0 };
          r.claimedAt = data.claimedAt;
          return { count: 1 };
        }),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const r = state.row!;
          if (data.status) r.status = data.status as string;
          if ('claimedAt' in data) r.claimedAt = data.claimedAt as Date | null;
          if (data.sentAt) r.sentAt = data.sentAt as Date;
          if (data.attempts) r.attempts += 1;
          return r;
        }),
      },
    };
    const analytics = {
      screen: jest.fn(async () => ({
        tables: [
          { ...mk([{ cifra: 'Pedidos pagados', actual: 3, anterior: 7, delta_abs: null, delta_pct: null }]), id: 'r1' },
          { ...mk([{ titulo: 'Sin avisos esta semana', evidencia: '', accion: '' }]), id: 'r2' },
        ],
      })),
    };
    const mail = { send: jest.fn(async (m: { to: string; subject: string; text: string; html: string }) => { if (fails > 0) { fails--; throw new Error('resend 500'); } sent.push(m); return {}; }) };
    const svc = new MarketingWeeklyDigestService(prisma as never, analytics as never, undefined, mail as never);
    return { svc, state, sent, analytics, prisma };
  }
  const MONDAY = new Date('2026-11-09T15:00:00.000Z'); // lunes 9 nov, 09:00 CDMX ⇒ semana 2–8 nov

  it('2 ejecuciones la misma semana ⇒ 1 envío; la 2ª es no-op', async () => {
    const d = digest();
    expect((await d.svc.run(MONDAY)).outcome).toBe('sent');
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('noop');
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].subject).toBe('Tu semana en TCG HUNT: 2–8 nov');
    expect(d.state.row).toMatchObject({ status: 'sent' });
    // ⛔ siempre small_cells
    const args = (d.analytics.screen as jest.Mock).mock.calls[0];
    expect([args[0], args[3]]).toEqual(['r', 'small_cells']);
  });
  it('fallo de correo ⇒ attempts+1, sigue pending y el siguiente tick reintenta sin duplicar', async () => {
    const d = digest({ sendFails: 1 });
    expect((await d.svc.run(MONDAY)).outcome).toBe('failed');
    expect(d.state.row).toMatchObject({ status: 'pending', attempts: 1, claimedAt: null });
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('sent');
    expect(d.sent).toHaveLength(1);
  });
  it('sin cuenta de dueño ⇒ skipped (sin reintento infinito)', async () => {
    const d = digest({ recipients: false });
    expect((await d.svc.run(MONDAY)).outcome).toBe('skipped');
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('noop');
    expect(d.sent).toHaveLength(0);
  });
  it('flag marketing_weekly_digest=off ⇒ no hace nada', async () => {
    const d = digest();
    d.prisma.configSetting.findUnique.mockResolvedValueOnce({ valueJson: 'off' } as never);
    expect((await d.svc.run(MONDAY)).outcome).toBe('off');
    expect(d.sent).toHaveLength(0);
  });
  it('la semana del correo y del selector es la última cerrada: lunes 9 nov 00:00 CDMX ⇒ 2 nov; domingo 8 nov 23:59 CDMX ⇒ 26 oct (§6.10)', () => {
    expect(marketingPeriodOptions(new Date('2026-11-09T06:00:00.000Z')).closedWeeks[0].weekStart).toBe('2026-11-02');
    expect(marketingPeriodOptions(new Date('2026-11-09T05:59:00.000Z')).closedWeeks[0].weekStart).toBe('2026-10-26');
    expect(resolveMarketingPeriod({ weekStart: '2026-11-02' }, MONDAY).label).toBe('2026-11-02');
  });
});

describe('r3 nunca sale por exports, tokens ni correo (estático)', () => {
  const read = (rel: string) => fs.readFileSync(path.join(__dirname, '../src/modules/marketing', rel), 'utf8');
  it('toda llamada a screen() fuera del panel pasa el literal small_cells', () => {
    const ctrl = read('marketing.controller.ts');
    const calls = ctrl.split('\n').filter((l) => /\.screen\(/.test(l) && !l.trim().startsWith('//') && !l.trim().startsWith('*'));
    const nonPanel = calls.filter((l) => !/privacy\)/.test(l));
    expect(nonPanel.length).toBeGreaterThanOrEqual(3);
    for (const l of nonPanel) expect(l).toContain("'small_cells'");
    const dig = read('marketing-weekly-digest.service.ts').split('\n').filter((l) => /analytics\.screen\(/.test(l));
    expect(dig).toHaveLength(1);
    expect(dig[0]).toContain("'small_cells'");
    const mailCode = read('marketing-weekly-digest.mail.ts').split('\n').filter((l) => !/^\s*(\/\*\*|\*|\/\/)/.test(l)).join('\n');
    expect(mailCode).not.toMatch(/r3|ses_instagram|Día por día/);
  });
});
