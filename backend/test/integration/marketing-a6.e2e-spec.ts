/**
 * 🔒 v1.116 C-B16 (integración; API_CONTRACT §MKT.G.4 a6, §MKT.H.11, §MKT.H.14 `PI_START`/`PI_START_PAID`) — tabla a6
 * «Pagos iniciados → pagados» contra Postgres real. El servicio es el de la app (`MarketingAnalyticsService` con su Prisma,
 * `SalesAnalyticsService` y anotaciones); el modo de medición se fija con un `MeasurementService` de prueba (`off`/`on`).
 *
 * Semana FIJA lejana (2033-W20: lun 16 – dom 22 may 2033, CDMX) para que ningún otro pedido de la BD compartida caiga dentro.
 * Sembrado (propio de la corrida, borrado al final): con PI creados DENTRO: pagado, `failed`, `pending`, reembolsado; uno DENTRO
 * sin PI (pagado); uno con PI creado la semana ANTERIOR y pagado en ésta ⇒ «Pagos iniciados» 4, «De esos, pagados» 2, 50 %.
 * Mutaciones que deben ponerlo rojo: contar por `settledAt` (cohorte cruzada) o incluir el pedido sin PI.
 */
import { randomBytes } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { MarketingAnalyticsService } from '../../src/modules/marketing/marketing-analytics.service';
import { MarketingAnnotationsService } from '../../src/modules/marketing/marketing-annotations.service';
import { SalesAnalyticsService } from '../../src/modules/sales-analytics/sales-analytics.service';
import { resolveMarketingPeriod } from '../../src/modules/marketing/marketing-period';
import type { AggTable } from '../../src/modules/marketing/marketing-aggregates.types';

const RUN = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
const NOW = new Date('2033-05-25T12:00:00.000Z');
const PERIOD = resolveMarketingPeriod({ week: '2033-W20' }, NOW);
/** Mediodía CDMX (UTC−6) del día dado. */
const mx = (ymd: string) => new Date(`${ymd}T18:00:00.000Z`);

describe('C-B16 · a6 «Pagos iniciados → pagados» contra Postgres', () => {
  let h: E2EHarness;
  const ids: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    expect([PERIOD.from, PERIOD.to]).toEqual(['2033-05-16', '2033-05-22']);
    const rows = [
      { tag: 'in-paid', createdAt: mx('2033-05-17'), settledAt: mx('2033-05-17'), status: 'settled', pi: true, consent: true },
      { tag: 'in-failed', createdAt: mx('2033-05-18'), settledAt: null, status: 'failed', pi: true, consent: false },
      { tag: 'in-pending', createdAt: mx('2033-05-19'), settledAt: null, status: 'pending', pi: true, consent: null },
      { tag: 'in-refunded', createdAt: mx('2033-05-22'), settledAt: mx('2033-05-22'), status: 'refunded', pi: true, consent: null },
      { tag: 'in-no-pi', createdAt: mx('2033-05-20'), settledAt: mx('2033-05-20'), status: 'settled', pi: false, consent: true },
      { tag: 'prev-paid-now', createdAt: mx('2033-05-15'), settledAt: mx('2033-05-17'), status: 'settled', pi: true, consent: true },
    ] as const;
    for (const r of rows) {
      const o = await h.prisma.order.create({
        data: {
          guestEmail: `a6.${RUN}.${r.tag}@example.com`,
          orderNumber: `A6-${RUN}-${r.tag}`,
          fulfillmentMode: 'direct_ship',
          shippingAddressSnapshot: { line1: 'x', city: 'x', state: 'x', postalCode: '01000', country: 'MX', phone: '5500000000', recipientName: 'x' },
          status: r.status,
          createdAt: r.createdAt,
          settledAt: r.settledAt,
          stripePaymentIntentId: r.pi ? `pi_a6_${RUN}_${r.tag}` : null,
          measurementConsentAnalytics: r.consent,
          subtotalCents: 10000,
          processingFeeCents: 0,
          ivaCents: 0,
          totalCents: 10000,
          priceConvention: 'IVA_INCLUSIVE',
        },
      });
      ids.push(o.id);
    }
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.order.deleteMany({ where: { id: { in: ids } } });
      await h.close();
    }
  });

  const service = (mode: 'off' | 'on') =>
    new MarketingAnalyticsService(h.prisma, h.app.get(SalesAnalyticsService), h.app.get(MarketingAnnotationsService), { mode } as never, undefined);
  const a6Of = async (mode: 'off' | 'on'): Promise<AggTable> => (await service(mode).screen('a', PERIOD, NOW, 'small_cells')).tables.find((t) => t.id === 'a6')!;

  it.each(['off', 'on'] as const)('medición %s: iniciados 4, de esos pagados 2, 50 %%', async (mode) => {
    const a6 = await a6Of(mode);
    expect(a6).toMatchObject({ id: 'a6', source: 'BD', measured: true });
    expect(a6.rows).toEqual([
      { paso: 'Pagos iniciados', n: 4, pct: null },
      { paso: 'De esos, pagados', n: 2, pct: 50 },
    ]);
  });

  it('sin columnas de consentimiento (todas NULL) ⇒ mismas cifras', async () => {
    await h.prisma.order.updateMany({ where: { id: { in: ids } }, data: { measurementConsentAnalytics: null } });
    expect((await a6Of('on')).rows).toEqual([
      { paso: 'Pagos iniciados', n: 4, pct: null },
      { paso: 'De esos, pagados', n: 2, pct: 50 },
    ]);
  });
});
