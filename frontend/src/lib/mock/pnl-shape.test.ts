import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mockPnlCalendar, mockPnlReport } from './pnl-lines';
import { config } from '../config';
import { asApiError, setRefreshToken, setToken } from '../api-client';
import { getPnlCalendar, getPnlReport } from '../api';
import { PNL_FIGURES, PNL_LINES, type PnlColumnDTO } from '@/types/reports-pnl';

/**
 * CANDADO DE FORMA (F2b): el mock tiene EXACTAMENTE las claves que devuelve el backend real. Las listas de abajo se contrastaron
 * con el JSON capturado de `GET /admin/reports/finance/pnl` y `…/pnl/series` (stack nativo, 2026-11-24, commit 7ead889b): mock y
 * real daban el mismo esqueleto (claves y tipos; `null` en `marginBps`/`deltaBps`/`dataSince` según los datos). Si el servidor
 * cambia una clave, esta prueba y el mock se actualizan juntos.
 */
const COLUMN = ['cogsCents', 'contributionCents', 'discountsCents', 'grossProfitCents', 'grossSalesCents', 'marginBps', 'netSalesCents', 'refundsCents', 'sellingCosts'];
const TOTAL_COLUMN = [...COLUMN, 'fixedCostsCents', 'resultCents'].sort();
const DELTA = ['cents', 'deltaBps', 'deltaCents', 'previousCents'];
const keys = (o: object) => Object.keys(o).sort();

function expectLine(c: PnlColumnDTO) {
  expect(keys(c)).toEqual(COLUMN); // en líneas y cubos NO viajan fixedCostsCents/resultCents
  expect(keys(c.sellingCosts)).toEqual(['paymentFeeCents', 'shippingResultCents']);
}
function expectTotal(c: PnlColumnDTO) {
  expect(keys(c)).toEqual(TOTAL_COLUMN);
  expect(c.fixedCostsCents).toBeNull();
  expect(c.resultCents).toBeNull();
}
function expectDeltas(r: Record<string, object>) {
  expect(keys(r)).toEqual([...PNL_FIGURES].sort()); // 9 renglones
  for (const d of Object.values(r)) expect(keys(d)).toEqual(DELTA);
}

describe('forma real · GET /admin/reports/finance/pnl', () => {
  const r = mockPnlReport({ from: '2026-11-01', to: '2026-11-24', kind: 'month' });
  it('null de fijos/resultado solo en total, own.total y previous.total; líneas sin esas claves', () => {
    expectTotal(r.total);
    expectTotal(r.own.total);
    expectTotal(r.previous!.total);
    for (const l of PNL_LINES) {
      expectLine(r.own[l]);
      expectLine(r.previous!.own[l]);
    }
    expect(keys(r.previous!.own)).toEqual([...PNL_LINES, 'total'].sort());
    expect(keys(r.previous!)).toEqual(['own', 'total']);
  });
  it('comparison.total y byLine.<línea>: Record de 9 renglones → {cents,previousCents,deltaCents,deltaBps|null}', () => {
    expect(keys(r.comparison!)).toEqual(['basis', 'byLine', 'dataSince', 'total']);
    expectDeltas(r.comparison!.total);
    expect(keys(r.comparison!.byLine)).toEqual([...PNL_LINES].sort());
    for (const l of PNL_LINES) expectDeltas(r.comparison!.byLine[l]);
    expect(keys(r.period!)).toEqual(['days', 'from', 'kind', 'timezone', 'to', 'toDate']);
    expect(keys(r.previousPeriod!)).toEqual(['clamped', 'from', 'to']);
  });
  it('histórico (sin from/to): period, previousPeriod, previous y comparison = null', () => {
    const all = mockPnlReport({});
    expect([all.period, all.previousPeriod, all.previous, all.comparison]).toEqual([null, null, null, null]);
    expectTotal(all.total);
  });
});

describe('forma real · …/pnl/series?groupBy=month|quarter|semester|year', () => {
  it.each(['month', 'quarter', 'semester', 'year'] as const)('%s: count+1 cubos, el último en curso; cubos sin fixedCostsCents salvo total', (unit) => {
    const c = mockPnlCalendar({ unit, count: 3, asOf: '2026-11-24' });
    expect(keys(c)).toEqual(['asOf', 'buckets', 'fiscalYearStartMonth', 'unit']);
    expect(c.buckets).toHaveLength(4);
    expect(c.buckets.at(-1)!.toDate).toBe(true);
    expect(c.buckets.at(-1)!.to).toBe('2026-11-24');
    for (const b of c.buckets) {
      expect(keys(b)).toEqual(['comparison', 'days', 'from', 'kind', 'own', 'to', 'toDate', 'total']);
      expectTotal(b.total);
      expectTotal(b.own.total);
      for (const l of PNL_LINES) expectLine(b.own[l]);
      expect(keys(b.comparison)).toEqual(['basis', 'byLine', 'dataSince', 'previous', 'total']);
      expect(keys(b.comparison.previous)).toEqual(['clamped', 'from', 'to']);
      expectDeltas(b.comparison.total);
      for (const l of PNL_LINES) expectDeltas(b.comparison.byLine[l]);
    }
  });
});

describe('cable y errores reales de las rutas nuevas', () => {
  const original = config.useMocks;
  let fetchMock: ReturnType<typeof vi.fn>;
  const reply = (status: number, body: unknown) =>
    ({ status, ok: status < 400, json: async () => body, text: async () => JSON.stringify(body), headers: new Headers() }) as unknown as Response;
  beforeEach(() => {
    config.useMocks = false;
    setToken('t');
    setRefreshToken('r');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    config.useMocks = original;
    setToken(null);
    setRefreshToken(null);
    vi.unstubAllGlobals();
  });
  const lastUrl = () => new URL(String((fetchMock.mock.calls.at(-1) as [string])[0]), 'http://x');

  it('rutas y consultas: finance/pnl?from&to&kind y finance/pnl/series?groupBy&count (sin from/to)', async () => {
    fetchMock.mockResolvedValue(reply(200, {}));
    await getPnlReport({ from: '2026-11-01', to: '2026-11-24', kind: 'month' });
    expect(lastUrl().pathname.endsWith('/admin/reports/finance/pnl')).toBe(true);
    expect([...lastUrl().searchParams.keys()].sort()).toEqual(['from', 'kind', 'to']);
    await getPnlCalendar({ unit: 'quarter', count: 1 });
    expect(lastUrl().pathname.endsWith('/admin/reports/finance/pnl/series')).toBe(true);
    expect(lastUrl().searchParams.get('groupBy')).toBe('quarter');
    expect(lastUrl().searchParams.get('count')).toBe('1');
    expect(lastUrl().searchParams.has('from')).toBe(false);
  });
  it.each([
    [403, 'FORBIDDEN', {}],
    [400, 'VALIDATION_ERROR', { field: 'count' }],
    [422, 'VALIDATION_ERROR', { field: 'from' }],
  ])('%i %s llega como ApiClientError con status y code', async (status, code, details) => {
    fetchMock.mockResolvedValue(reply(status, { error: { code, message: 'x', details } }));
    const e = await getPnlReport({ from: '2026-11-01', to: '2026-11-24' }).catch((x) => x);
    expect(asApiError(e)?.status).toBe(status);
    expect(asApiError(e)?.code).toBe(code);
  });
});
