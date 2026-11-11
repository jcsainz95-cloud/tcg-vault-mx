/**
 * MKT-V2 (docs/specs/MKT_PANEL_V2.md): pantalla r, avisos, tráfico propio, tipo de página, c6 sin PII, correo del lunes.
 * Zona sensible por privacidad: r3 solo con `exact`; c6 no guarda datos personales; el correo solo lleva agregados.
 */
import * as fs from 'fs';
import * as path from 'path';
import { GA4_UNFILTERED_NOTE, INTERNAL_UTM_RE, ga4InternalExclusion, isInternalUtm, withInternalExclusion } from '../src/modules/marketing/internal-traffic';
import { AV1_MIN_CHECKOUTS, evaluateAlerts, type AlertInputs } from '../src/modules/marketing/marketing-alerts';
import { deltaCells, nvrCells, sumIfVisible } from '../src/modules/marketing/marketing-summary';
import { PAGE_TYPE_LABEL, landingRows, pageTypeOf } from '../src/modules/marketing/marketing-ga4';
import { MarketingSearchMissService, normalizeSearchTerm, qualifyingSearchMisses } from '../src/modules/marketing/marketing-search-miss.service';
import { termInVocabulary } from '../src/modules/marketing/marketing-search-vocabulary';
import { Logger } from '@nestjs/common';
import { MarketingWeeklyDigestService, recipientKeyOf } from '../src/modules/marketing/marketing-weekly-digest.service';
import { weekRangeLabel, weeklyDigestMail } from '../src/modules/marketing/marketing-weekly-digest.mail';
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExternalSources, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { marketingPeriodOptions, resolveMarketingPeriod, type MarketingPeriod } from '../src/modules/marketing/marketing-period';
import { REGION_REST_LABEL, foldRegionRest, type CellPrivacy } from '../src/modules/marketing/small-cells';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const ownerExact = (): CellPrivacy => 'exact' as CellPrivacy;
const WEEK: MarketingPeriod = { kind: 'week', from: '2027-02-08', to: '2027-02-14', prev: { from: '2027-02-01', to: '2027-02-07' }, label: '2027-W06' };
const MONTH: MarketingPeriod = { kind: 'month', from: '2027-02-01', to: '2027-02-28', prev: { from: '2027-01-01', to: '2027-01-31' }, label: '2027-02' };
const NOW = new Date('2027-03-10T12:00:00.000Z');
const SA = JSON.stringify({ client_email: 'panel@tienda.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });
/** Vocabulario del doble: solo estas palabras son del catálogo. */
const VOCAB_WORDS = new Set(['umbreon', 'vmax', 'charizard', 'ex', '151', 'pikachu', 'raro']);
const VOCAB = { allows: jest.fn(async (t: string) => termInVocabulary(t, VOCAB_WORDS)) };
const by = (ts: AggTable[], id: string) => ts.find((t) => t.id === id)!;

describe('tráfico propio (§4)', () => {
  it.each(['diag-lighthouse', 'QA-playwright', 'e2e-run', 'smoke-1', 'Test-1', 'probe-x', 'internal-a'])('utm_source %s ⇒ propio', (v) => {
    expect(INTERNAL_UTM_RE.test(v)).toBe(true);
    expect(isInternalUtm(v, null)).toBe(true);
  });
  it.each(['diag', 'qa', 'test', 'e2e', 'smoke', 'probe', 'internal', 'QA_playwright', 'e2e.run', 'diag-', 'instagram', 'diagnostico', 'qa2', 'testing', 'attest', 'google', '', null])('utm_source %s ⇒ NO es propio', (v) => {
    expect(isInternalUtm(v as string | null, null)).toBe(false);
  });
  it('utm_medium NUNCA cuenta como tráfico propio (criterio 10)', () => {
    expect(isInternalUtm('instagram', 'test-x')).toBe(false);
    expect(isInternalUtm('qa', 'test-x')).toBe(false);
    expect(isInternalUtm('qa-x', 'paid')).toBe(true);
  });
  it('el filtro de GA4 es NOT(sessionSource FULL_REGEXP) sin sessionMedium y se combina con inList en un andGroup', () => {
    const nx = ga4InternalExclusion() as { notExpression: { filter: { fieldName: string; stringFilter: { matchType: string; value: string } } } };
    expect(nx.notExpression.filter.fieldName).toBe('sessionSource');
    expect(nx.notExpression.filter.stringFilter).toEqual({ matchType: 'FULL_REGEXP', value: '(?i)(diag|qa|e2e|smoke|test|probe|internal)-.+' });
    expect(JSON.stringify(nx)).not.toContain('sessionMedium');
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
    expect(a.filter((x) => x.regla === 'AV6').map((x) => x.accion)).toEqual(['Buscan "umbreon vmax" 7 personas y no hay resultado: ¿falta en el catálogo?']);
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
    searchNoResultDaily: { findMany: jest.fn(async () => [{ termNormalized: 'umbreon vmax', people: 3 }, { termNormalized: 'umbreon vmax', people: 2 }, { termNormalized: 'umbreon vmax', people: 2 }, { termNormalized: 'raro', people: 2 }, { termNormalized: 'raro', people: 2 }, { termNormalized: 'maria lopez', people: 4 }, { termNormalized: 'maria lopez', people: 4 }]) },
  };
  const env = fullEnv({ MEASUREMENT_MODE: 'on', MKT_GOOGLE_SA_JSON: SA, MKT_GA4_PROPERTY_ID: '123456789', MKT_SEARCH_CONSOLE_SITE: 'sc-domain:tcghunt.mx' });
  const sales = { report: jest.fn(async () => ({ totals: { orders: 0, chargedCents: 0, avgTicketCents: null, piecesPerOrder: null }, previousTotals: { orders: 7, chargedCents: 700000, avgTicketCents: 100000, piecesPerOrder: 1 }, comparison: { orders: { diff: 0, pct: 0 }, chargedCents: { diff: 0, pct: 0 } } })) };
  const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never, new MeasurementService(prisma as never, fakeConfig(env)), new MarketingExternalSources(fakeConfig(env), port), new MarketingSearchMissService(prisma as never, VOCAB as never));
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
    const prisma = { marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []) }, order: { count: jest.fn(async () => 0), findMany: jest.fn(async () => []) }, buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) }, configSetting: { findUnique: jest.fn(async () => null) }, searchNoResultDaily: { findMany: jest.fn(async () => []) } };
    const sales = { report: jest.fn(async () => ({ totals: { orders: 0, chargedCents: 0 }, previousTotals: { orders: 0, chargedCents: 0 } })) };
    const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never);
    const p = await svc.screen('r', WEEK, NOW, 'small_cells');
    const r1 = by(p.tables, 'r1');
    expect(r1.rows.find((x) => x.cifra === 'Fichas vistas')).toMatchObject({ actual: 'NO MEDIDO — GA4 sin encender', delta_abs: null });
    const r2 = by(p.tables, 'r2');
    // Con fuentes sin medir NO se afirma «Sin avisos»: se dice que no se pudo evaluar.
    expect(r2.rows.map((x) => x.titulo)).toEqual(['No se pudo evaluar esta semana por completo', 'No se evaluó: GA4 sin encender', 'No se evaluó: Search Console sin conectar']);
  });
});

describe('c2/c3/c4/c8/c9/e2/c6/d1', () => {
  it('c2, c3, c8, c9 y e2 se miden; c4 espera su evento; c6 lista solo lo que pasa el umbral', async () => {
    const { svc } = build();
    const c = (await svc.screen('c', WEEK, NOW, ownerExact())).tables;
    expect(['c2', 'c3', 'c8', 'c9'].map((id) => by(c, id).measured)).toEqual([true, true, true, true]);
    expect(by(c, 'c4').notMeasuredReason).toBe('NO MEDIDO — el evento del botón COMPRAR todavía no se envía');
    expect(by(c, 'c2').rows[0]).toMatchObject({ tipo: PAGE_TYPE_LABEL['ficha-carta'] });
    // 'raro' (4 personas) no llega al umbral aunque el doble lo devuelva: el filtro es del servicio.
    // 'maria lopez' (8 personas, 2 días) tiene volumen pero NO es vocabulario del catálogo ⇒ se descarta AL LEER.
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
  it.each([
    'juan@correo.com', '@usuario', 'GOMC800101HDFRRR09', 'ABCD800101AB1', '5512345678', '55 1234 5678', '4111-1111-1111-1111',
    // MKV2 bloqueante: el guion bajo también es separador (si no, evadía el filtro)
    'gomc_800101_hdfrrr09', 'gome_800101_ab1', '5512_3456', '1234_567', 'gomc 800101 hdfrrr09',
    'a'.repeat(81), '', 'x', 123, null,
    'uno dos tres cuatro cinco', // > 4 palabras
  ])('%p ⇒ no se guarda', (t) => {
    expect(normalizeSearchTerm(t)).toBeNull();
  });
  it.each([['Umbreon VMAX', 'umbreon vmax'], ['  Pikachú   ex  ', 'pikachu ex'], ['Año Nuevo', 'año nuevo'], ['charizard 151', 'charizard 151'], ['charizard 4/102', 'charizard 4 102']])('%p ⇒ %p', (t, out) => {
    expect(normalizeSearchTerm(t)).toBe(out);
  });
  it('vocabulario: solo palabras del catálogo o números de carta', () => {
    expect(termInVocabulary('charizard ex 151', VOCAB_WORDS)).toBe(true);
    expect(termInVocabulary('maria lopez', VOCAB_WORDS)).toBe(false);
    expect(termInVocabulary('calle reforma 12', VOCAB_WORDS)).toBe(false);
    expect(termInVocabulary('tcghunt mx', VOCAB_WORDS)).toBe(false);
    expect(termInVocabulary('', VOCAB_WORDS)).toBe(false);
  });
  it('umbral por PERSONAS: ≥ 5 en total y ≥ 2 días con ≥ 2 personas; un solo cliente (1/día) nunca califica', () => {
    const rows = (...p: number[]) => p.map((people) => ({ termNormalized: 't', people }));
    expect(qualifyingSearchMisses(rows(1, 1, 1, 1, 1, 1, 1, 1))).toEqual([]); // 8 días de 1 persona
    expect(qualifyingSearchMisses(rows(5))).toEqual([]); // un solo día
    expect(qualifyingSearchMisses(rows(4, 1))).toEqual([]); // solo 1 día con ≥ 2
    expect(qualifyingSearchMisses(rows(3, 2))).toEqual([{ term: 't', people: 5, days: 2 }]);
    expect(qualifyingSearchMisses(rows(2, 2))).toEqual([]); // 4 personas
  });
  function recorder(opts: { allow?: boolean; flagOff?: boolean; exec?: number } = {}) {
    const prisma = {
      configSetting: {
        findUnique: jest.fn(async () => (opts.flagOff ? { valueJson: 'off' } : null)),
        findUniqueOrThrow: jest.fn(async () => ({ valueJson: 'sal-del-dia' })),
      },
      $executeRaw: jest.fn(async () => opts.exec ?? 1),
      $queryRaw: jest.fn(async () => []),
      $transaction: jest.fn(async (qs: Promise<unknown>[]) => Promise.all(qs)),
    };
    const vocab = { allows: jest.fn(async () => opts.allow ?? true) };
    return { prisma, svc: new MarketingSearchMissService(prisma as never, vocab as never) };
  }
  it('record: PII o fuera de vocabulario ⇒ ninguna escritura; válido ⇒ un INSERT en SearchNoResultSeen con hash de 16 hex (sin IP/UA en claro)', async () => {
    const r = recorder();
    expect(await r.svc.record('mi correo es a@b.mx')).toBe(false);
    expect(await r.svc.record('gomc_800101_hdfrrr09')).toBe(false);
    expect(r.prisma.$executeRaw).not.toHaveBeenCalled();
    const off = recorder({ allow: false });
    expect(await off.svc.record('maria lopez', { ip: '1.2.3.4' })).toBe(false);
    expect(off.prisma.$executeRaw).not.toHaveBeenCalled();
    expect(await r.svc.record('Umbreon VMAX', { ip: '203.0.113.7', userAgent: 'UA-secreto' }, NOW)).toBe(true);
    const calls = r.prisma.$executeRaw.mock.calls as unknown as [string[], ...unknown[]][];
    const ins = calls.find((c) => c[0].join('?').includes('INSERT INTO "SearchNoResultSeen"'))!;
    expect(ins[0].join('?')).toContain('ON CONFLICT DO NOTHING');
    const [term, day, h] = [ins[1], ins[2], ins[3]];
    expect([term, day]).toEqual(['umbreon vmax', '2027-03-10']);
    expect(String(h)).toMatch(/^[0-9a-f]{16}$/);
    expect(JSON.stringify(calls)).not.toMatch(/203\.0\.113\.7|UA-secreto/);
  });
  it('el mismo IP+UA da el mismo hash en el día (1 persona); otro IP, otro hash', async () => {
    const hashes: string[] = [];
    const r = recorder();
    r.prisma.$executeRaw.mockImplementation(async (...a: unknown[]) => {
      if ((a[0] as string[]).join('?').includes('SearchNoResultSeen')) hashes.push(String(a[3]));
      return 1;
    });
    for (let i = 0; i < 50; i++) await r.svc.record('umbreon vmax', { ip: '1.1.1.1', userAgent: 'ua' }, NOW);
    await r.svc.record('umbreon vmax', { ip: '2.2.2.2', userAgent: 'ua' }, NOW);
    expect(new Set(hashes.slice(0, 50)).size).toBe(1);
    expect(hashes[50]).not.toBe(hashes[0]);
  });
  it('topes: el INSERT lleva ≤ 200 hashes por término y ≤ 300 términos por día en la misma sentencia; sin escribir ⇒ false (204)', async () => {
    const r = recorder({ exec: 0 });
    expect(await r.svc.record('umbreon vmax', { ip: 'x' }, NOW)).toBe(false);
    const ins = (r.prisma.$executeRaw.mock.calls as unknown as [string[], ...unknown[]][]).find((c) => c[0].join('?').includes('INSERT INTO "SearchNoResultSeen"'))!;
    expect(ins.slice(1)).toEqual(expect.arrayContaining([200, 300]));
  });
  it('flag apagado ⇒ nada; BD caída ⇒ false sin lanzar', async () => {
    const off = recorder({ flagOff: true });
    expect(await off.svc.record('umbreon vmax', {}, NOW)).toBe(false);
    expect(off.prisma.$executeRaw).not.toHaveBeenCalled();
    const down = recorder();
    down.prisma.configSetting.findUnique.mockRejectedValueOnce(new Error('db down'));
    await expect(down.svc.record('umbreon vmax', {}, NOW)).resolves.toBe(false);
  });
  it('cierre: vuelca COUNT(h) a SearchNoResultDaily, borra hashes y la sal de días pasados, y es idempotente', async () => {
    const r = recorder();
    r.prisma.$queryRaw.mockResolvedValueOnce([{ d: '2027-03-09' }] as never);
    const tx: string[] = [];
    (r.prisma as Record<string, unknown>).$transaction = jest.fn(async (qs: unknown[]) => qs);
    r.prisma.$executeRaw.mockImplementation(async (...a: unknown[]) => { tx.push((a[0] as string[]).join('?')); return 1; });
    expect(await r.svc.closePastDays(NOW)).toBe(1);
    const all = tx.join('\n');
    expect(all).toContain('INSERT INTO "SearchNoResultDaily"');
    expect(all).toContain('count(*)');
    expect(all).toContain('DELETE FROM "SearchNoResultSeen"');
    expect(all).toContain('DELETE FROM "ConfigSetting"');
    expect(await r.svc.closePastDays(NOW)).toBe(0); // sin hashes abiertos no hay nada que volcar
  });
  it('estático: ningún modelo de c6 guarda IP, usuario ni cookie', () => {
    const schema = fs.readFileSync(path.join(__dirname, '../prisma/schema.prisma'), 'utf8');
    for (const model of ['SearchNoResultDaily', 'SearchNoResultSeen']) {
      const m = new RegExp(`model ${model} \\{([\\s\\S]*?)\\n\\}`).exec(schema)![1];
      expect(m.replace(/\/\/.*$/gm, '')).not.toMatch(/\bip\b|user|cookie|session|device|agent/i);
    }
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

  type Row = { weekStart: Date; recipientKey: string; status: string; attempts: number; claimedAt: Date | null; sentAt: Date | null };
  function digest(opts: { emails?: string[]; failFor?: Record<string, number>; inspection?: { markNotified: jest.Mock } } = {}) {
    const emails = opts.emails ?? ['dueno@tcghunt.mx'];
    const rows = new Map<string, Row>();
    const sent: { to: string; subject: string; text: string; html: string }[] = [];
    const fails: Record<string, number> = { ...(opts.failFor ?? {}) };
    const owner = (email: string, i: number) => ({ id: `o${i}`, isOwner: true, email, name: 'JC', nameSource: 'user', locale: 'es', role: 'super_admin', status: 'active', deletedAt: null, emailVerifiedAt: new Date() });
    const prisma = {
      configSetting: { findUnique: jest.fn(async () => null) },
      user: { findMany: jest.fn(async () => emails.map(owner)) },
      $executeRaw: jest.fn(async (_s: unknown, wk: string, key: string, status: string) => {
        if (rows.has(key)) return 0;
        rows.set(key, { weekStart: new Date(`${wk}T00:00:00.000Z`), recipientKey: key, status, attempts: 0, claimedAt: null, sentAt: null });
        return 1;
      }),
      marketingWeeklyDigest: {
        updateMany: jest.fn(async ({ where, data }: { where: { recipientKey: string; status: string; OR: { claimedAt: unknown }[] }; data: { claimedAt: Date } }) => {
          const r = rows.get(where.recipientKey);
          const staleBefore = (where.OR[1].claimedAt as { lt: Date }).lt;
          if (!r || r.status !== where.status || (('sentAt' in where) && r.sentAt !== null) || (r.claimedAt !== null && r.claimedAt >= staleBefore)) return { count: 0 };
          r.claimedAt = data.claimedAt;
          return { count: 1 };
        }),
        update: jest.fn(async ({ where, data }: { where: { weekStart_recipientKey: { recipientKey: string } }; data: Record<string, unknown> }) => {
          const r = rows.get(where.weekStart_recipientKey.recipientKey)!;
          if (data.status) r.status = data.status as string;
          if ('claimedAt' in data) r.claimedAt = data.claimedAt as Date | null;
          if ('sentAt' in data) r.sentAt = data.sentAt as Date | null;
          if (data.attempts) r.attempts += 1;
          return { ...r };
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
    const mail = {
      send: jest.fn(async (m: { to: string; subject: string; text: string; html: string }) => {
        if ((fails[m.to] ?? 0) > 0) { fails[m.to]--; throw new Error(`resend 500 para ${m.to}`); }
        sent.push(m);
        return {};
      }),
    };
    const svc = new MarketingWeeklyDigestService(prisma as never, analytics as never, undefined, mail as never, opts.inspection as never);
    return { svc, rows, sent, analytics, prisma, mail };
  }
  const only = (d: ReturnType<typeof digest>) => [...d.rows.values()][0];
  const MONDAY = new Date('2026-11-09T15:00:00.000Z'); // lunes 9 nov, 09:00 CDMX ⇒ semana 2–8 nov

  it('2 ejecuciones la misma semana ⇒ 1 envío; la 2ª es no-op; la clave es un hash (sin el correo)', async () => {
    const d = digest();
    expect((await d.svc.run(MONDAY)).outcome).toBe('sent');
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('noop');
    expect(d.sent).toHaveLength(1);
    expect(d.sent[0].subject).toBe('Tu semana en TCG HUNT: 2–8 nov');
    expect(only(d)).toMatchObject({ status: 'sent', recipientKey: recipientKeyOf('DUENO@tcghunt.mx') });
    expect(only(d).recipientKey).toMatch(/^[0-9a-f]{16}$/);
    // ⛔ siempre small_cells
    const args = (d.analytics.screen as jest.Mock).mock.calls[0];
    expect([args[0], args[3]]).toEqual(['r', 'small_cells']);
  });
  it('AV7 (§GSHOP.A): el correo pide el aviso en modo correo y, tras enviar, marca las URLs avisadas; si no envía, no marca', async () => {
    const inspection = { markNotified: jest.fn(async () => 1) };
    const d = digest({ inspection });
    await d.svc.run(MONDAY);
    expect((d.analytics.screen as jest.Mock).mock.calls[0][4]).toEqual({ forEmail: true });
    expect(inspection.markNotified).toHaveBeenCalledTimes(1);
    expect(inspection.markNotified).toHaveBeenCalledWith(MONDAY);
    const failing = { markNotified: jest.fn(async () => 1) };
    const f = digest({ inspection: failing, failFor: { 'dueno@tcghunt.mx': 1 } });
    await f.svc.run(MONDAY);
    expect(failing.markNotified).not.toHaveBeenCalled();
  });
  it('fallo de correo ⇒ attempts+1, sigue pending y el siguiente tick reintenta sin duplicar', async () => {
    const d = digest({ failFor: { 'dueno@tcghunt.mx': 1 } });
    expect((await d.svc.run(MONDAY)).outcome).toBe('failed');
    expect(only(d)).toMatchObject({ status: 'pending', attempts: 1, claimedAt: null });
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('sent');
    expect(d.sent).toHaveLength(1);
  });
  it('2 destinatarios, fallo de uno ⇒ el otro NO se reenvía (criterio 9)', async () => {
    const d = digest({ emails: ['a@tcghunt.mx', 'b@tcghunt.mx'], failFor: { 'b@tcghunt.mx': 1 } });
    expect((await d.svc.run(MONDAY)).outcome).toBe('failed');
    expect(d.sent.map((m) => m.to)).toEqual(['a@tcghunt.mx']);
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('sent');
    expect(d.sent.map((m) => m.to)).toEqual(['a@tcghunt.mx', 'b@tcghunt.mx']); // a una sola vez
    expect([...d.rows.values()].map((r) => r.status)).toEqual(['sent', 'sent']);
  });
  it('enviado pero el update a «sent» falla ⇒ NO se reenvía en el siguiente tick (marca intermedia sentAt)', async () => {
    const d = digest();
    const orig = d.prisma.marketingWeeklyDigest.update.getMockImplementation()!;
    d.prisma.marketingWeeklyDigest.update.mockImplementation(async (a: { data: Record<string, unknown> }) => {
      if (a.data.status === 'sent') throw new Error('db caída');
      return orig(a as never);
    });
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    await d.svc.run(MONDAY);
    expect(d.sent).toHaveLength(1);
    d.prisma.marketingWeeklyDigest.update.mockImplementation(orig);
    await d.svc.run(new Date(MONDAY.getTime() + 3600_000));
    await d.svc.run(new Date(MONDAY.getTime() + 9 * 3600_000)); // incluso con el reclamo vencido
    spy.mockRestore();
    expect(d.sent).toHaveLength(1);
  });
  it('5 fallos ⇒ failed y ya no se reintenta; el registro no lleva el correo ni el mensaje del proveedor', async () => {
    const d = digest({ failFor: { 'dueno@tcghunt.mx': 99 } });
    const logged: string[] = [];
    const spy = jest.spyOn(Logger.prototype, 'error').mockImplementation((m: unknown) => { logged.push(String(m)); });
    for (let i = 0; i < 5; i++) await d.svc.run(new Date(MONDAY.getTime() + i * 3600_000));
    expect(only(d)).toMatchObject({ status: 'failed', attempts: 5 });
    const calls = d.mail.send.mock.calls.length;
    expect((await d.svc.run(new Date(MONDAY.getTime() + 6 * 3600_000))).outcome).toBe('noop');
    expect(d.mail.send.mock.calls.length).toBe(calls);
    spy.mockRestore();
    expect(logged.length).toBeGreaterThan(0);
    expect(logged.join('\n')).not.toMatch(/dueno@|tcghunt\.mx|resend 500/);
  });
  it('sin cuenta de dueño ⇒ una fila none/skipped (sin reintento infinito)', async () => {
    const d = digest({ emails: [] });
    expect((await d.svc.run(MONDAY)).outcome).toBe('skipped');
    expect((await d.svc.run(new Date(MONDAY.getTime() + 3600_000))).outcome).toBe('noop');
    expect(d.sent).toHaveLength(0);
    expect(only(d)).toMatchObject({ recipientKey: 'none', status: 'skipped' });
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

// ───────────────────────── MKV2: filtro GA4, semáforo, nota sin filtro, c9 ─────────────────────────

describe('GA4: reintento sin filtro SOLO ante 400 de compatibilidad (§4, criterio 10)', () => {
  const gaxios = (status: number, gstatus: string, message: string) => Object.assign(new Error(message), { response: { status, data: { error: { code: status, status: gstatus, message } } } });
  const src = (port: GoogleReadPort) => new MarketingExternalSources(fakeConfig(fullEnv({ MEASUREMENT_MODE: 'on', MKT_GOOGLE_SA_JSON: SA, MKT_GA4_PROPERTY_ID: '123456789' })), port);
  const spec = { dimensions: ['itemId'], metrics: ['itemsViewed'] } as const;
  const ok = { rows: [{ dimensionValues: [{ value: 'c_1' }], metricValues: [{ value: '5' }] }] };

  it('400 INVALID_ARGUMENT "incompatible" ⇒ reintenta SIN filtro y marca unfiltered', async () => {
    const bodies: { dimensionFilter?: unknown }[] = [];
    const port: GoogleReadPort = { postJson: jest.fn(async (_k, _s, _u, b) => { bodies.push(b as never); if (bodies.length === 1) throw gaxios(400, 'INVALID_ARGUMENT', 'Dimensions: sessionSource is incompatible with metrics: itemsViewed'); return ok; }) };
    const r = await src(port).ga4Report(spec, '2027-02-08', '2027-02-14', NOW);
    expect(r).toMatchObject({ ok: true, unfiltered: true });
    expect(bodies[0].dimensionFilter).toEqual(ga4InternalExclusion());
    expect(bodies[1].dimensionFilter).toBeUndefined();
  });
  it.each([
    ['403', gaxios(403, 'PERMISSION_DENIED', 'no permission')],
    ['429', gaxios(429, 'RESOURCE_EXHAUSTED', 'quota')],
    ['500', gaxios(500, 'INTERNAL', 'boom')],
    ['400 que no es de compatibilidad', gaxios(400, 'INVALID_ARGUMENT', 'Field foo is not a valid dimension')],
    ['400 con otro estado', gaxios(400, 'FAILED_PRECONDITION', 'incompatible')],
    ['red', Object.assign(new Error('x'), { code: 'ECONNRESET' })],
  ])('%s ⇒ NO MEDIDO, sin segundo intento', async (_n, err) => {
    const port: GoogleReadPort = { postJson: jest.fn(async () => { throw err; }) };
    const r = await src(port).ga4Report(spec, '2027-02-08', '2027-02-14', NOW);
    expect(r).toEqual({ ok: false });
    expect((port.postJson as jest.Mock).mock.calls).toHaveLength(1);
  });
  it.each(Array.from({ length: 14 }, (_, i) => i))('semáforo: al liberarse un cupo, una llegada %i microtareas después NO se cuela (nunca 5 a la vez)', async (ticks) => {
    let live = 0;
    let peak = 0;
    const gates: (() => void)[] = [];
    const port: GoogleReadPort = {
      postJson: jest.fn(async () => {
        live++;
        peak = Math.max(peak, live);
        await new Promise<void>((res) => gates.push(res));
        live--;
        return ok;
      }),
    };
    const s = src(port);
    const day = (n: number) => `2026-02-${String(n + 1).padStart(2, '0')}`;
    const runs = Array.from({ length: 5 }, (_, i) => s.ga4Report(spec, day(i), '2026-03-01', NOW)); // 4 corren, 1 espera
    await new Promise((res) => setImmediate(res));
    expect(gates).toHaveLength(4);
    gates.shift()!(); // se libera un cupo: pasa al que espera
    for (let t = 0; t < ticks; t++) await Promise.resolve();
    runs.push(s.ga4Report(spec, day(9), '2026-03-01', NOW)); // llegada nueva justo en ese momento
    for (let i = 0; i < 40 && runs.length > 0; i++) {
      await new Promise((res) => setImmediate(res));
      while (gates.length) gates.shift()!();
    }
    await Promise.all(runs);
    expect(peak).toBeLessThanOrEqual(4);
  });
});

describe('tabla servida sin filtro lleva la nota fija (§4)', () => {
  it('d1 y d2 llevan GA4_UNFILTERED_NOTE cuando la lectura de ítems salió sin filtro; con filtro no', async () => {
    for (const unfiltered of [true, false]) {
      const { svc } = build();
      const ext = (svc as unknown as { external: { ga4Report: (...a: unknown[]) => Promise<unknown> } }).external;
      const orig = ext.ga4Report.bind(ext);
      ext.ga4Report = async (spec: unknown, ...rest: unknown[]) => {
        const r = (await orig(spec, ...rest)) as Record<string, unknown>;
        return (spec as { dimensions: string[] }).dimensions[0] === 'itemId' && unfiltered ? { ...r, unfiltered: true } : r;
      };
      const d = (await svc.screen('d', WEEK, NOW, ownerExact())).tables;
      for (const id of ['d1', 'd2']) expect(by(d, id).notes?.includes(GA4_UNFILTERED_NOTE)).toBe(unfiltered);
    }
  });
});

describe('nota sin filtro en TODA tabla/aviso leído sin filtro (§4, I-1)', () => {
  const NOTE_TEXT = 'Puede incluir tráfico propio de antes de que se excluyera';
  function withUnfiltered(pred: (spec: { dimensions: string[]; metrics?: string[] }) => boolean) {
    const b = build();
    const ext = (b.svc as unknown as { external: { ga4Report: (...a: unknown[]) => Promise<unknown> } }).external;
    const orig = ext.ga4Report.bind(ext);
    ext.ga4Report = async (spec: unknown, ...rest: unknown[]) => {
      const r = (await orig(spec, ...rest)) as Record<string, unknown>;
      return r.ok && pred(spec as { dimensions: string[] }) ? { ...r, unfiltered: true } : r;
    };
    return b.svc;
  }
  const has = (t: { notes?: string[]; measured: boolean }) => t.notes?.includes(NOTE_TEXT) === true;
  it('el texto es exactamente el del spec, sin fecha', () => {
    expect(GA4_UNFILTERED_NOTE).toBe(NOTE_TEXT);
  });
  it('todo sin filtro ⇒ cada tabla medida de GA4 (c1-c5,c8,c9,r1,r2; a4/a5/b4/e3 usan los mismos ayudantes) lleva la nota', async () => {
    const svc = withUnfiltered(() => true);
    const tables = [
      ...(await svc.screen('c', WEEK, NOW, ownerExact())).tables,
      ...(await svc.screen('r', WEEK, NOW, ownerExact())).tables,
    ];
    const ga4 = tables.filter((t) => t.measured && ['a4', 'a5', 'b4', 'c1', 'c2', 'c3', 'c4', 'c5', 'c8', 'c9', 'e3', 'r1', 'r2', 'r3'].includes(t.id));
    expect(ga4.map((t) => t.id).sort()).toEqual(expect.arrayContaining(['c1', 'c2', 'c3', 'c5', 'c8', 'c9', 'r1', 'r2']));
    for (const t of ga4) expect([t.id, has(t)]).toEqual([t.id, true]);
  });
  it('solo la consulta de ítems sin filtro ⇒ r2 (AV3) lleva la nota y r1 no (mata «quitar la nota en AV3»)', async () => {
    const svc = withUnfiltered((s) => s.dimensions[0] === 'itemId');
    const r = (await svc.screen('r', WEEK, NOW, ownerExact())).tables;
    expect(has(by(r, 'r2'))).toBe(true);
    expect(has(by(r, 'r1'))).toBe(false);
  });
  it('c9: region y funnelSessions con distinto estado de filtro ⇒ c9 NO MEDIDO (small_cells)', async () => {
    const svc = withUnfiltered((s) => s.dimensions[0] === 'region');
    const c9 = by((await svc.screen('c', WEEK, NOW, 'small_cells')).tables, 'c9');
    expect(c9.measured).toBe(false);
  });
  it('sin ninguna lectura sin filtro ⇒ ninguna nota', async () => {
    const svc = withUnfiltered(() => false);
    const r = (await svc.screen('r', WEEK, NOW, ownerExact())).tables;
    for (const t of r) expect(has(t)).toBe(false);
  });
});

describe('c9: supresión complementaria contra r1 (§5, criterio 8)', () => {
  it('el resto nunca sale < 5: se pliega el estado visible más pequeño hasta que sea ≥ 5', () => {
    // 100 visitantes; visibles 60 + 37 = 97 ⇒ resto 3 (< 5) ⇒ se pliega el menor (37) ⇒ resto 40
    const r = foldRegionRest([{ key: 'Jalisco', count: 60 }, { key: 'Nuevo León', count: 37 }], 100);
    expect(r).toEqual({ rows: [{ key: 'Jalisco', count: 60 }], rest: 40 });
  });
  it('resto ya ≥ 5 ⇒ no se pliega nada; resto 0 ⇒ sin fila de resto; total < 5 ⇒ centinela, nunca la cifra', () => {
    expect(foldRegionRest([{ key: 'A', count: 10 }], 20)).toEqual({ rows: [{ key: 'A', count: 10 }], rest: 10 });
    expect(foldRegionRest([{ key: 'A', count: 10 }], 10)).toEqual({ rows: [{ key: 'A', count: 10 }], rest: null });
    expect(foldRegionRest([{ key: 'A', count: 5 }], 8)).toEqual({ rows: [], rest: 8 });
    expect(foldRegionRest([], 3)).toEqual({ rows: [], rest: '< 5' });
  });
  it('nunca se puede despejar: para toda combinación, total − visibles = el resto publicado (≥ 5) o el resto es el centinela', () => {
    for (let total = 0; total <= 40; total++) {
      for (const a of [0, 5, 6, 9, 20]) {
        for (const b of [0, 5, 7, 12]) {
          const visible = [a, b].map((count, i) => ({ key: `E${i}`, count })).filter((x) => x.count >= 5 && x.count <= total);
          const { rows, rest } = foldRegionRest(visible, total);
          const shown = rows.reduce((s, x) => s + x.count, 0);
          if (typeof rest === 'number') expect(rest).toBeGreaterThanOrEqual(5);
          if (rest === null) expect(total - shown).toBeLessThanOrEqual(0);
        }
      }
    }
  });
  it('c9 en small_cells publica «Otros estados y sin dato» y en exact no pliega', async () => {
    const { svc } = build();
    const cells = by((await svc.screen('c', WEEK, NOW, 'small_cells')).tables, 'c9');
    expect(cells.rows[cells.rows.length - 1]).toMatchObject({ estado: REGION_REST_LABEL });
    for (const r of cells.rows) if (typeof r.usuarios === 'number') expect(r.usuarios).toBeGreaterThanOrEqual(5);
  });
});
