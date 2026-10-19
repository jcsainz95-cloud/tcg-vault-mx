/**
 * Panel con Fase 2 (API_CONTRACT §MKT.H.9; ARCHITECTURE §14.9) — sin BD (Prisma mockeado) y sin red (puerto de Google doble).
 *
 *  - f1/f2: con `MEASUREMENT_MODE=off` ⇒ NO MEDIDO (el banner no existe); con `on` ⇒ de `MarketingBannerConsentCounter`,
 *    cuatro respuestas (con `custom`) y columnas por dispositivo; tasa = accept / total.
 *  - f3/g1: con `on` ⇒ medidos desde las columnas de consentimiento / `firstUtm*`; g1 con «< 5» si N<5.
 *  - e1 (Search Console): sin credenciales, con credenciales mal formadas o con error de la API ⇒ «NO MEDIDO — Search
 *    Console sin conectar» (fail-closed); con el doble ⇒ filas con celdas pequeñas sobre los clics.
 *  - GA4: off ⇒ «GA4 sin encender»; on sin credenciales ⇒ «GA4 sin conectar»; ⛔ nunca «0».
 */
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MarketingExternalSources, parseServiceAccount, type GoogleReadPort } from '../src/modules/marketing/marketing-external-sources';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import { SMALL_CELL_SENTINEL } from '../src/modules/marketing/small-cells';
import type { MarketingPeriod } from '../src/modules/marketing/marketing-period';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const week: MarketingPeriod = { kind: 'week', from: '2026-10-05', to: '2026-10-11', prev: { from: '2026-09-28', to: '2026-10-04' }, label: '2026-W41' };
const NOW = new Date('2026-10-14T12:00:00.000Z');
const SA = JSON.stringify({ client_email: 'panel@tienda.iam.gserviceaccount.com', private_key: '-----BEGIN PRIVATE KEY-----\nFAKE\n-----END PRIVATE KEY-----\n' });
const by = (ts: AggTable[], id: string) => ts.find((t) => t.id === id)!;

function build(opts: { mode?: string; sc?: boolean; ga4?: boolean; port?: GoogleReadPort } = {}) {
  const counters = [
    { response: 'accept', device: 'móvil', _sum: { count: 6 } },
    { response: 'accept', device: 'escritorio', _sum: { count: 2 } },
    { response: 'necessary_only', device: 'móvil', _sum: { count: 3 } },
    { response: 'custom', device: 'tableta', _sum: { count: 1 } },
    { response: 'no_response', device: null, _sum: { count: 4 } },
  ];
  const orderCount = jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
    const c = where.measurementConsentAnalytics as unknown;
    if (c && typeof c === 'object') return 0; // v1.105: «¿el periodo tiene datos de medición?» ⇒ no (Fase 0 con off)
    if (c === false) return 1;
    if ('firstUtmSource' in where) return 3;
    if (where.measurementConsentAnalytics === true) return 4;
    if (where.measurementConsentAnalytics === null) return 2;
    return 10;
  });
  const prisma = {
    marketingBannerConsentCounter: { groupBy: jest.fn(async () => counters), count: jest.fn(async () => 0) },
    order: { count: orderCount, aggregate: jest.fn(async () => ({ _count: { _all: 3 }, _sum: { totalCents: 300000 } })) },
  };
  const env = fullEnv({
    MEASUREMENT_MODE: opts.mode,
    MKT_GOOGLE_SA_JSON: opts.sc || opts.ga4 ? SA : undefined,
    MKT_SEARCH_CONSOLE_SITE: opts.sc ? 'sc-domain:tcghunt.mx' : undefined,
    MKT_GA4_PROPERTY_ID: opts.ga4 ? '123456789' : undefined,
  });
  const measurement = new MeasurementService(prisma as never, fakeConfig(env));
  const external = new MarketingExternalSources(fakeConfig(env), opts.port);
  const svc = new MarketingAnalyticsService(prisma as never, {} as never, { forPeriod: jest.fn(async () => []) } as never, measurement, external);
  return { svc, prisma };
}

describe('f1/f2 · banner', () => {
  it('off ⇒ f1 NO MEDIDO y no lee el contador', async () => {
    const { svc, prisma } = build({ mode: 'off' });
    const f1 = by((await svc.screen('f', week, NOW, 'small_cells')).tables, 'f1');
    expect(f1.measured).toBe(false);
    expect(f1.notMeasuredReason).toMatch(/^NO MEDIDO — /);
    expect(prisma.marketingBannerConsentCounter.groupBy).not.toHaveBeenCalled();
  });
  it('on ⇒ cuatro respuestas (con «Configurar»), columnas por dispositivo y tasa accept/total', async () => {
    const { svc } = build({ mode: 'on' });
    const f1 = by((await svc.screen('f', week, NOW, 'small_cells')).tables, 'f1');
    expect(f1.measured).toBe(true);
    expect(f1.rows).toEqual([
      { respuesta: 'Aceptar', total: 8, movil: 6, escritorio: 2, tableta: 0, sinDato: 0 },
      { respuesta: 'Solo lo necesario', total: 3, movil: 3, escritorio: 0, tableta: 0, sinDato: 0 },
      { respuesta: 'Configurar (elección mixta)', total: 1, movil: 0, escritorio: 0, tableta: 1, sinDato: 0 },
      { respuesta: 'Sin respuesta', total: 4, movil: 0, escritorio: 0, tableta: 0, sinDato: 4 },
    ]);
    expect(f1.notes![0]).toContain('50% (8 de 16)');
  });
});

describe('f3/g1 · desde las columnas de consentimiento', () => {
  it('off ⇒ NO MEDIDO (como Fase 0)', async () => {
    const { svc } = build({ mode: 'off' });
    expect(by((await svc.screen('f', week, NOW, 'small_cells')).tables, 'f3').measured).toBe(false);
    expect(by((await svc.screen('g', week, NOW, 'small_cells')).tables, 'g1').measured).toBe(false);
  });
  it('on ⇒ f3 con pagados, con origen, con analítica y «antes de Fase 2»; g1 con N<5 ⇒ «< 5» sin MX$', async () => {
    const { svc } = build({ mode: 'on' });
    const f3 = by((await svc.screen('f', week, NOW, 'small_cells')).tables, 'f3');
    expect(f3.rows.map((r) => [r.pedidos, r.pct])).toEqual([[10, 100], [3, 30], [4, 40], [1, 10], [2, 20]]);
    const g1 = by((await svc.screen('g', week, NOW, 'small_cells')).tables, 'g1');
    expect(g1.rows).toEqual([{ concepto: expect.any(String), pedidos: SMALL_CELL_SENTINEL, mxn: null }]);
  });
});

describe('e1 · Search Console, fail-closed', () => {
  const rows = [
    { keys: ['charizard 151'], clicks: 40, impressions: 900, ctr: 0.0444, position: 3.21 },
    { keys: ['tcg hunt'], clicks: 12, impressions: 50, ctr: 0.24, position: 1.04 },
    { keys: ['juan perez cartas'], clicks: 2, impressions: 9, ctr: 0.2222, position: 7 },
  ];
  it('sin credenciales ⇒ «NO MEDIDO — Search Console sin conectar» (con cualquier modo) y 0 llamadas', async () => {
    for (const mode of ['off', 'on']) {
      const port = { postJson: jest.fn() };
      const { svc } = build({ mode, port });
      const e1 = by((await svc.screen('e', week, NOW, 'small_cells')).tables, 'e1');
      expect([e1.measured, e1.notMeasuredReason]).toEqual([false, 'NO MEDIDO — Search Console sin conectar']);
      expect(port.postJson).not.toHaveBeenCalled();
    }
  });
  it.each([['{no json'], ['{}'], [JSON.stringify({ client_email: 'x', private_key: 'y' })]])('llave mal formada %p ⇒ null (fail-closed)', (raw) => {
    expect(parseServiceAccount(raw)).toBeNull();
  });
  it('la API falla ⇒ NO MEDIDO sin conectar (nunca 0) y el error no se cachea', async () => {
    const port = { postJson: jest.fn().mockRejectedValueOnce(new Error('403 forbidden https://x?key=SECRET')).mockResolvedValue({ rows }) };
    const { svc } = build({ mode: 'off', sc: true, port });
    const e1 = by((await svc.screen('e', week, NOW, 'small_cells')).tables, 'e1');
    expect([e1.measured, e1.notMeasuredReason, e1.rows]).toEqual([false, 'NO MEDIDO — Search Console sin conectar', []]);
    const again = by((await svc.screen('e', week, NOW, 'small_cells')).tables, 'e1');
    expect(again.measured).toBe(true);
  });
  it('con el doble ⇒ consultas por clics; N<5 ⇒ «< 5» sin el resto de cifras; con caché de 6 h', async () => {
    const port = { postJson: jest.fn().mockResolvedValue({ rows }) };
    const { svc } = build({ mode: 'off', sc: true, port });
    const e1 = by((await svc.screen('e', week, NOW, 'small_cells')).tables, 'e1');
    expect(e1.measured).toBe(true);
    expect(e1.rows).toEqual([
      { consulta: 'charizard 151', clics: 40, impresiones: 900, ctr: 4.4, posicion: 3.2 },
      { consulta: 'Otros (< 5 c/u)', clics: SMALL_CELL_SENTINEL, impresiones: null, ctr: null, posicion: null },
    ]);
    expect(JSON.stringify(e1.rows)).not.toContain('juan perez');
    expect(port.postJson).toHaveBeenCalledTimes(1);
    const [, scope, url, body] = port.postJson.mock.calls[0];
    expect(scope).toBe('https://www.googleapis.com/auth/webmasters.readonly');
    expect(url).toBe('https://searchconsole.googleapis.com/webmasters/v3/sites/sc-domain%3Atcghunt.mx/searchAnalytics/query');
    expect(body).toEqual({ startDate: '2026-10-05', endDate: '2026-10-11', dimensions: ['query'], rowLimit: 50 });
    await svc.screen('e', week, NOW, 'small_cells');
    expect(port.postJson).toHaveBeenCalledTimes(1);
  });
});

describe('GA4 · motivo según estado, nunca «0»', () => {
  it.each([
    ['off', false, 'NO MEDIDO — GA4 sin encender'],
    ['on', false, 'NO MEDIDO — GA4 sin conectar'],
  ])('modo %s, credenciales %p ⇒ %s en a4/a5/c1/e3', async (mode, ga4, reason) => {
    const { svc } = build({ mode, ga4 });
    for (const [screen, id] of [['c', 'c1'], ['c', 'c5'], ['e', 'e3']] as const) {
      const t = by((await svc.screen(screen, week, NOW, 'small_cells')).tables, id);
      expect([t.measured, t.notMeasuredReason, t.rows]).toEqual([false, reason, []]);
    }
  });
});
