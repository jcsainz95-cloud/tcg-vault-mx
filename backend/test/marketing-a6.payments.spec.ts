/**
 * 🔒 v1.116 C-B16 (unitaria; API_CONTRACT §MKT.G.4 a6, §MKT.H.14 `PI_START`/`PI_START_PAID`; ARCHITECTURE §14.9) — tabla a6
 * «Pagos iniciados → pagados». El `MarketingAnalyticsService` es el REAL; `order.count` lo resuelve un evaluador en memoria del
 * `where` (rango de fechas, `not: null`, `in`) sobre pedidos sembrados, así que una consulta que cuente por `settledAt` o que no
 * exija PaymentIntent da otra cifra. La misma conducta contra Postgres: `test/integration/marketing-a6.e2e-spec.ts`.
 *
 * Semana fija 2026-W41 (lun 5 – dom 11 oct, CDMX). Sembrado: con PI creados DENTRO: pagado, `failed`, `pending`, reembolsado;
 * uno DENTRO sin PI (pagado); uno con PI creado la semana ANTERIOR y pagado en ésta ⇒ «Pagos iniciados» 4, «De esos, pagados» 2,
 * `pct` 50. Cifras iguales con medición `off` y `on`, y sin columnas de consentimiento.
 */
import { MarketingAnalyticsService } from '../src/modules/marketing/marketing-analytics.service';
import { resolveMarketingPeriod } from '../src/modules/marketing/marketing-period';
import type { AggTable } from '../src/modules/marketing/marketing-aggregates.types';
import type { CellPrivacy } from '../src/modules/marketing/small-cells';

const NOW = new Date('2026-10-14T12:00:00.000Z');
const PERIOD = resolveMarketingPeriod({ week: '2026-W41' }, NOW);
/** Mediodía CDMX (UTC−6) del día dado. */
const mx = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);

interface Row {
  id: string;
  createdAt: Date;
  settledAt: Date | null;
  status: string;
  stripePaymentIntentId: string | null;
  measurementConsentAnalytics: boolean | null;
}

const A6_ORDERS: Row[] = [
  { id: 'in-paid', createdAt: mx('2026-10-06'), settledAt: mx('2026-10-06'), status: 'settled', stripePaymentIntentId: 'pi_1', measurementConsentAnalytics: true },
  { id: 'in-failed', createdAt: mx('2026-10-07'), settledAt: null, status: 'failed', stripePaymentIntentId: 'pi_2', measurementConsentAnalytics: false },
  { id: 'in-pending', createdAt: mx('2026-10-08'), settledAt: null, status: 'pending', stripePaymentIntentId: 'pi_3', measurementConsentAnalytics: null },
  { id: 'in-refunded', createdAt: mx('2026-10-11'), settledAt: mx('2026-10-11'), status: 'refunded', stripePaymentIntentId: 'pi_4', measurementConsentAnalytics: null },
  { id: 'in-no-pi', createdAt: mx('2026-10-09'), settledAt: mx('2026-10-09'), status: 'settled', stripePaymentIntentId: null, measurementConsentAnalytics: true },
  { id: 'prev-paid-now', createdAt: mx('2026-10-04'), settledAt: mx('2026-10-06'), status: 'settled', stripePaymentIntentId: 'pi_5', measurementConsentAnalytics: true },
];

type Cond = { gte?: Date; lt?: Date; lte?: Date; not?: null; in?: string[] } | string | boolean | null;
function matches(row: Record<string, unknown>, where: Record<string, Cond>): boolean {
  return Object.entries(where).every(([k, c]) => {
    const v = row[k];
    if (c === null || typeof c !== 'object') return v === c;
    if ('not' in c && c.not === null && v === null) return false;
    if (c.in && !c.in.includes(v as string)) return false;
    if (c.gte || c.lt || c.lte) {
      if (!(v instanceof Date)) return false;
      if (c.gte && v < c.gte) return false;
      if (c.lt && v >= c.lt) return false;
      if (c.lte && v > c.lte) return false;
    }
    return true;
  });
}

function build(mode: 'off' | 'on', rows: Row[] = A6_ORDERS) {
  const prisma = {
    order: {
      count: jest.fn(async ({ where }: { where: Record<string, Cond> }) => rows.filter((r) => matches(r as never, where)).length),
      findMany: jest.fn(async () => []),
    },
    sellRequest: { aggregate: jest.fn(async () => ({ _count: { _all: 0 }, _sum: { quotedTotalCents: 0, payoutNetCents: 0 } })) },
    marketingBannerConsentCounter: { count: jest.fn(async () => 0) },
  };
  const sales = {
    report: jest.fn(async () => {
      const z = { orders: 0, chargedCents: 0, avgTicketCents: null, piecesPerOrder: null };
      return { totals: z, previousTotals: z, comparison: { orders: { diff: 0, pct: null }, chargedCents: { diff: 0, pct: null } } };
    }),
  };
  const annotations = { forPeriod: jest.fn(async () => []) };
  return new MarketingAnalyticsService(prisma as never, sales as never, annotations as never, { mode } as never, undefined);
}

/** Régimen exacto en prueba: cast EXPLÍCITO (D3; solo `panelPrivacy()` lo fabrica en `src/`). */
const ownerExact = (): CellPrivacy => 'exact' as CellPrivacy;
const a6Of = async (svc: MarketingAnalyticsService, privacy: CellPrivacy = 'small_cells'): Promise<AggTable> =>
  (await svc.screen('a', PERIOD, NOW, privacy)).tables.find((t) => t.id === 'a6')!;

describe('C-B16 · a6 «Pagos iniciados → pagados» (cohorte por creación, sin cookies)', () => {
  it.each(['off', 'on'] as const)('medición %s: iniciados 4, de esos pagados 2, 50 %%; medida, de BD, sin MX$', async (mode) => {
    const a6 = await a6Of(build(mode));
    expect(a6).toMatchObject({ id: 'a6', source: 'BD', measured: true });
    expect(a6.rows).toEqual([
      { paso: 'Pagos iniciados', n: 4, pct: null },
      { paso: 'De esos, pagados', n: 2, pct: 50 },
    ]);
    expect(a6.columns.some((c) => c.kind === 'money')).toBe(false);
  });

  it('total aceptado: `small_cells` y `exact` dan las mismas cifras (2 y 4 no se ocultan)', async () => {
    expect((await a6Of(build('off'), ownerExact())).rows).toEqual((await a6Of(build('off'), 'small_cells')).rows);
  });

  it('va justo después de a5 en la pantalla a', async () => {
    const ids = (await build('off').screen('a', PERIOD, NOW, 'small_cells')).tables.map((t) => t.id);
    expect(ids.slice(ids.indexOf('a5'))).toEqual(['a5', 'a6']);
  });

  it('sin columnas de consentimiento: borrarlas no cambia nada', async () => {
    const stripped = A6_ORDERS.map((r) => ({ ...r, measurementConsentAnalytics: null }));
    expect((await a6Of(build('on', stripped))).rows).toEqual((await a6Of(build('on'))).rows);
  });

  it('sin pedidos con PI ⇒ 0 y 0 con `pct` null (⛔ nunca NaN)', async () => {
    const a6 = await a6Of(build('off', A6_ORDERS.filter((r) => r.stripePaymentIntentId === null)));
    expect(a6.rows).toEqual([
      { paso: 'Pagos iniciados', n: 0, pct: null },
      { paso: 'De esos, pagados', n: 0, pct: null },
    ]);
  });
});
