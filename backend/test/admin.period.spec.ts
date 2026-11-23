import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { withM61Defaults } from './helpers/m61-mock-defaults';
import { withPnlBuylistDoubles } from './helpers/pnl-buylist-doubles';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { withPatrimony } from './helpers/valuation-gate';

/**
 * Fix correctness #3: los reportes "del periodo" respetan el rango de fechas por su
 * fecha de realización (settledAt, pickingAt de envíos, paidAt de buylist, deliveredAt).
 */
describe('AdminService — acotado por periodo (fix #3)', () => {
  let prisma: any;
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { totalCents: 0 } }),
      },
      shipmentRequest: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
      sellRequest: {
        count: jest.fn().mockResolvedValue(0),
        aggregate: jest.fn().mockResolvedValue({ _sum: { approvedTotalCents: 0 } }),
      },
      dispute: { count: jest.fn().mockResolvedValue(0) },
      pendingPriceEntry: { count: jest.fn().mockResolvedValue(0) },
      priceReference: { findFirst: jest.fn().mockResolvedValue(null) },
      fxRate: { findFirst: jest.fn().mockResolvedValue(null) },
      user: { count: jest.fn().mockResolvedValue(0) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([]) },
    };
    service = withPatrimony(new AdminService(
      withPnlBuylistDoubles(withM61Defaults(prisma)) as unknown as PrismaService,
      { sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor } as unknown as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as any,
    ), { sealedSourceOnFor: PricingService.prototype.sealedSourceOnFor } as unknown as PricingService);
  });

  it('pnl scopes BOTH orders (settledAt) and shipments (pickingAt) by the period', async () => {
    await service.pnl('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const orderWhere = prisma.order.findMany.mock.calls[0][0].where;
    const shipWhere = prisma.shipmentRequest.findMany.mock.calls[0][0].where;
    expect(orderWhere.settledAt).toEqual({ gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-02-01T00:00:00.000Z') });
    // Antes el filtro de envíos NO tenía rango: ahora usa pickingAt.
    expect(shipWhere.pickingAt).toEqual({ gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-02-01T00:00:00.000Z') });
  });

  it('launchMetrics scopes sales/buylist/withdrawals (not only users)', async () => {
    await service.launchMetrics('2026-01-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z');
    const range = { gte: new Date('2026-01-01T00:00:00.000Z'), lte: new Date('2026-02-01T00:00:00.000Z') };
    expect(prisma.user.count.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(prisma.order.count.mock.calls[0][0].where.settledAt).toEqual(range);
    expect(prisma.sellRequest.count.mock.calls[0][0].where.paidAt).toEqual(range);
    expect(prisma.shipmentRequest.count.mock.calls[0][0].where.deliveredAt).toEqual(range);
  });

  it('dashboard period cards (sales/buylist) are scoped; default = current MX month', async () => {
    await service.dashboard('super_admin' as any);
    // La primera consulta de order.count del dashboard lleva settledAt con rango.
    const settledWhere = prisma.order.count.mock.calls[0][0].where;
    expect(settledWhere.status).toBe('settled');
    expect(settledWhere.settledAt).toBeDefined();
    expect(settledWhere.settledAt.gte).toBeInstanceOf(Date);
    // buylist del periodo también acotado por paidAt.
    const buylistAggWhere = prisma.sellRequest.aggregate.mock.calls[0][0].where;
    expect(buylistAggWhere.paidAt).toBeDefined();
  });

  it('dashboard honors explicit from/to', async () => {
    await service.dashboard('super_admin' as any, '2026-03-01T00:00:00.000Z', '2026-03-31T00:00:00.000Z');
    const settledWhere = prisma.order.count.mock.calls[0][0].where;
    expect(settledWhere.settledAt.gte).toEqual(new Date('2026-03-01T00:00:00.000Z'));
    expect(settledWhere.settledAt.lte).toEqual(new Date('2026-03-31T00:00:00.000Z'));
  });

  // §REPORTES-CEO F1 (CR-3): `YYYY-MM-DD` = días civiles de México, semiabierto [00:00 MX de from, 00:00 MX del día siguiente a to).
  describe('F1 — periodo en hora de México', () => {
    const MX = { gte: new Date('2026-01-01T06:00:00.000Z'), lt: new Date('2026-02-01T06:00:00.000Z') };

    it('pnl con YYYY-MM-DD: el 31-ene 23:30 MX (=01-feb 05:30Z) cae en enero; el 1-feb 00:00 MX no', async () => {
      await service.pnl('2026-01-01', '2026-01-31');
      expect(prisma.order.findMany.mock.calls[0][0].where.settledAt).toEqual(MX);
      expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where.pickingAt).toEqual(MX);
      expect(new Date('2026-02-01T05:30:00.000Z') < MX.lt).toBe(true);
      expect(new Date('2026-02-01T06:00:00.000Z') < MX.lt).toBe(false);
    });

    it('cambio de año: 31-dic 23:59 MX queda en diciembre', async () => {
      await service.launchMetrics('2026-12-01', '2026-12-31');
      expect(prisma.order.count.mock.calls[0][0].where.settledAt).toEqual({
        gte: new Date('2026-12-01T06:00:00.000Z'),
        lt: new Date('2027-01-01T06:00:00.000Z'),
      });
    });

    it('un solo día (from = to) y rango invertido', async () => {
      await service.pnl('2026-03-05', '2026-03-05');
      expect(prisma.order.findMany.mock.calls[0][0].where.settledAt).toEqual({
        gte: new Date('2026-03-05T06:00:00.000Z'),
        lt: new Date('2026-03-06T06:00:00.000Z'),
      });
      await expect(service.pnl('2026-03-06', '2026-03-05')).rejects.toThrow();
    });

    it('IVA acepta YYYY-MM-DD con el mismo filtro', async () => {
      await service.ivaReport('2026-01-01', '2026-01-31');
      expect(prisma.order.findMany.mock.calls[0][0].where.settledAt).toEqual(MX);
    });

    it('dashboard con YYYY-MM-DD usa el semiabierto de México', async () => {
      await service.dashboard('super_admin' as any, '2026-01-01', '2026-01-31');
      expect(prisma.order.count.mock.calls[0][0].where.settledAt).toEqual(MX);
      expect(prisma.sellRequest.aggregate.mock.calls[0][0].where.paidAt).toEqual(MX);
      expect(prisma.order.findMany.mock.calls[0][0].where.settledAt).toEqual(MX);
    });

    it('dashboard sin from/to: mes en curso de México (reloj en 1-feb 03:00Z = 31-ene 21:00 MX sigue siendo enero)', async () => {
      jest.useFakeTimers({ now: new Date('2026-02-01T03:00:00.000Z'), doNotFake: ['nextTick', 'setImmediate', 'setTimeout'] });
      try {
        await service.dashboard('super_admin' as any);
      } finally {
        jest.useRealTimers();
      }
      expect(prisma.order.count.mock.calls[0][0].where.settledAt).toEqual(MX);
    });

    it('fecha basura sigue siendo VALIDATION_ERROR', async () => {
      await expect(service.pnl('2026-13-45', '2026-14-01')).rejects.toThrow();
    });

    it.each(['2026-02-30', '2026-11-31', '2019-12-31', '9999-12-31', '2099-01-01'])('YYYY-MM-DD inexistente o fuera de 2020..año+1 (%s) ⇒ 422 con details.field, en range()', async (bad) => {
      for (const call of [() => service.pnl(bad, undefined), () => service.ivaReport(undefined, bad), () => service.launchMetrics(bad, bad)]) {
        await expect(call()).rejects.toMatchObject({ response: { details: { field: expect.stringMatching(/^(from|to)$/) } } });
      }
    });

    it('I-6: la ganancia del dashboard usa el periodo del dashboard (explícito y por defecto)', async () => {
      const spy = jest.spyOn(service, 'pnl');
      await service.dashboard('super_admin' as any, '2026-01-01', '2026-01-31');
      expect(spy.mock.calls[0].slice(0, 2)).toEqual(['2026-01-01', '2026-01-31']);
      spy.mockClear();
      await service.dashboard('super_admin' as any);
      const [f, t] = spy.mock.calls[0];
      expect(f).toMatch(/^\d{4}-\d{2}-01$/);
      expect(t).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });

    it('I-4: el operador no recibe dinero del periodo: todo *Cents de la respuesta es null (clave conservada, conteos visibles)', async () => {
      prisma.order.count.mockResolvedValue(3);
      prisma.sellRequest.count.mockResolvedValue(2);
      prisma.order.findMany.mockResolvedValue([{ priceConvention: 'IVA_EXCLUSIVE', items: [], accessoryLines: [], totalCents: 1000, subtotalCents: 800, ivaCents: 100, processingFeeCents: 10, shippingCents: 0 }]);
      prisma.sellRequest.aggregate.mockResolvedValue({ _sum: { approvedTotalCents: 5000 } });
      const res: any = await service.dashboard('vault_operator' as any);
      const bad: string[] = [];
      const walk = (v: any, path: string) => {
        if (v && typeof v === 'object' && !(v instanceof Date)) {
          for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
        } else if (/Cents$/.test(path.split('.').pop()!) && v !== null) bad.push(path);
      };
      walk(res, 'dashboard');
      expect(bad).toEqual([]);
      expect(res.salesPeriod).toEqual({ count: 3, grossAmountCents: null });
      expect(res.buylistPeriod).toEqual({ count: 2, amountCents: null });
      const adm: any = await service.dashboard('super_admin' as any);
      expect(adm.buylistPeriod.amountCents).toBe(5000);
    });
  });
});
