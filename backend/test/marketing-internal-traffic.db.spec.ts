/**
 * MKT-V2 §4 (qa IMPORTANTE, mutación M4): el tráfico propio (`utm_source=diag-…`) NO cuenta en las tablas de BD: b1-b3 (pedidos y
 * solicitudes), b5/b6 (Card Show), g1 (promociones) y f3 (cobertura). Se mide por DIFERENCIA: las mismas tablas con filas reales
 * + filas `diag-x` tienen que ser IDÉNTICAS a las de solo las reales. Quitar `isInternalUtm` de cualquiera de las cinco lecturas
 * (M4) pone esto en rojo. `utm_medium` NO cuenta como propio: una fila `instagram / test-x` sigue entrando.
 */
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { MeasurementService } from '../src/modules/measurement/measurement.service';
import type { MarketingPeriod } from '../src/modules/marketing/marketing-period';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import { fakeConfig, fullEnv } from './helpers/measurement-fixtures';

const week: MarketingPeriod = { kind: 'week', from: '2027-02-08', to: '2027-02-14', prev: { from: '2027-02-01', to: '2027-02-07' }, label: '2027-W06' };
const NOW = new Date('2027-03-10T12:00:00.000Z');
const DAY = new Date('2027-02-10T18:00:00.000Z');
const OWN = 'diag-x';

const orderRow = (src: string, med: string, extra: Record<string, unknown> = {}) => ({ firstUtmSource: src, firstUtmMedium: med, firstUtmContent: 'reel-1', totalCents: 10000, ...extra });
const lead = (i: number, src: string) => ({ confirmedAt: DAY, mailboxHmac: `${src}-${i}`, utmSource: src, utmMedium: 'bio', utmCampaign: null, utmContent: null });

function build(withOwn: boolean) {
  const own = (n: number, f: (i: number) => unknown) => (withOwn ? Array.from({ length: n }, (_, i) => f(i)) : []);
  const prisma = {
    marketingBannerConsentCounter: { count: jest.fn(async () => 0), groupBy: jest.fn(async () => []) },
    order: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ('firstUtmSource' in where ? 0 : 20)),
      aggregate: jest.fn(async () => ({ _count: { _all: 6 }, _sum: { totalCents: 60000 } })),
      findMany: jest.fn(async ({ where, select }: { where: Record<string, unknown>; select: Record<string, unknown> }) => {
        if ('firstUtmMedium' in where) return [...Array.from({ length: 6 }, () => orderRow('google', 'paid')), ...own(6, () => orderRow(OWN, 'paid'))]; // g1
        if (!('totalCents' in select)) return [...Array.from({ length: 6 }, () => ({ firstUtmSource: 'instagram', firstUtmMedium: 'bio' })), ...own(6, () => ({ firstUtmSource: OWN, firstUtmMedium: 'bio' }))]; // f3
        return [
          ...Array.from({ length: 6 }, () => orderRow('instagram', 'bio')),
          ...Array.from({ length: 5 }, () => orderRow('instagram', 'test-x')), // utm_medium de apariencia propia: SÍ cuenta
          ...own(6, () => orderRow(OWN, 'bio')),
        ];
      }),
    },
    sellRequest: {
      aggregate: jest.fn(async () => ({ _count: { _all: 6 }, _sum: { quotedTotalCents: 60000, payoutNetCents: 40000 } })),
      findMany: jest.fn(async () => [
        ...Array.from({ length: 6 }, () => ({ firstUtmSource: 'instagram', firstUtmMedium: 'dm', firstUtmContent: 'chat-7', quotedTotalCents: 5000 })),
        ...own(6, () => ({ firstUtmSource: OWN, firstUtmMedium: 'dm', firstUtmContent: 'chat-9', quotedTotalCents: 7000 })),
      ]),
    },
    sellRequestItem: { findMany: jest.fn(async () => []) },
    orderItem: { findMany: jest.fn(async () => []) },
    inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
    card: { findMany: jest.fn(async () => []) },
    sealedProduct: { findMany: jest.fn(async () => []) },
    wishlistItem: { groupBy: jest.fn(async () => []) },
    buylistQuoteDailyCount: { groupBy: jest.fn(async () => []) },
    cardShowLead: { findMany: jest.fn(async () => [...Array.from({ length: 6 }, (_, i) => lead(i, 'instagram')), ...own(6, (i) => lead(i, OWN))]) },
    cardShowPlayerSignup: { findMany: jest.fn(async () => [...Array.from({ length: 6 }, (_, i) => lead(i + 10, 'instagram')), ...own(6, (i) => lead(i + 10, OWN))]) },
    configSetting: { findUnique: jest.fn(async () => null) },
  };
  const env = fullEnv({ MEASUREMENT_MODE: 'on' });
  const totals = { orders: 6, chargedCents: 60000, avgTicketCents: 10000, piecesPerOrder: 1 };
  const sales = { report: jest.fn(async () => ({ totals, previousTotals: totals, comparison: { orders: { diff: 0, pct: 0 }, chargedCents: { diff: 0, pct: 0 } } })) };
  const svc = new MarketingAnalyticsService(prisma as never, sales as never, { forPeriod: jest.fn(async () => []) } as never, new MeasurementService(prisma as never, fakeConfig(env)));
  const tables = async (s: 'b' | 'f' | 'g') => (await svc.screen(s, week, NOW, 'small_cells')).tables;
  return { tables };
}

const pick = (ts: AggTable[], ids: string[]) => ids.map((id) => ts.find((t) => t.id === id));

describe('el tráfico propio no entra en las tablas de BD (MKT-V2 §4, M4)', () => {
  it.each([
    ['b', ['b1', 'b2', 'b3', 'b5', 'b6']],
    ['f', ['f3']],
    ['g', ['g1']],
  ] as const)('pantalla %s: con filas diag-x las tablas %p son IDÉNTICAS a las de solo tráfico real', async (screen, ids) => {
    const [real, mixed] = [await build(false).tables(screen), await build(true).tables(screen)];
    const [a, b] = [pick(real, [...ids]), pick(mixed, [...ids])];
    for (const t of a) expect(t).toBeDefined();
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(b)).not.toContain(OWN);
  });
  it('control: las tablas tienen datos (si no, la igualdad sería trivial) y utm_medium=test-x cuenta como real', async () => {
    const b = await build(true).tables('b');
    const b1 = b.find((t) => t.id === 'b1')!;
    expect(b1.rows.map((r) => r.origen)).toEqual(expect.arrayContaining(['instagram / bio', 'instagram / test-x']));
    expect(b.find((t) => t.id === 'b5')!.rows.length).toBeGreaterThan(0);
    expect((await build(true).tables('g')).find((t) => t.id === 'g1')!.rows[0]).toMatchObject({ pedidos: 6 });
  });
});
