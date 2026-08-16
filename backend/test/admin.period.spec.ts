import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

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
    service = new AdminService(
      prisma as unknown as PrismaService,
      {} as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as any,
    );
  });

  it('pnl scopes BOTH orders (settledAt) and shipments (pickingAt) by the period', async () => {
    await service.pnl('2026-01-01', '2026-02-01');
    const orderWhere = prisma.order.findMany.mock.calls[0][0].where;
    const shipWhere = prisma.shipmentRequest.findMany.mock.calls[0][0].where;
    expect(orderWhere.settledAt).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-02-01') });
    // Antes el filtro de envíos NO tenía rango: ahora usa pickingAt.
    expect(shipWhere.pickingAt).toEqual({ gte: new Date('2026-01-01'), lte: new Date('2026-02-01') });
  });

  it('launchMetrics scopes sales/buylist/withdrawals (not only users)', async () => {
    await service.launchMetrics('2026-01-01', '2026-02-01');
    const range = { gte: new Date('2026-01-01'), lte: new Date('2026-02-01') };
    expect(prisma.user.count.mock.calls[0][0].where.createdAt).toEqual(range);
    expect(prisma.order.count.mock.calls[0][0].where.settledAt).toEqual(range);
    expect(prisma.sellRequest.count.mock.calls[0][0].where.paidAt).toEqual(range);
    expect(prisma.shipmentRequest.count.mock.calls[0][0].where.deliveredAt).toEqual(range);
  });

  it('dashboard period cards (sales/buylist) are scoped; default = current UTC month', async () => {
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
    await service.dashboard('super_admin' as any, '2026-03-01', '2026-03-31');
    const settledWhere = prisma.order.count.mock.calls[0][0].where;
    expect(settledWhere.settledAt.gte).toEqual(new Date('2026-03-01'));
    expect(settledWhere.settledAt.lte).toEqual(new Date('2026-03-31'));
  });
});
