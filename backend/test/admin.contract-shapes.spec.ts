import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * Fija los SHAPES de salida exigidos por API_CONTRACT §M7/§M9, de modo que un mismatch
 * de nombres de campo lo atrape un test unitario y no solo el runtime/QA.
 */
describe('AdminService — shapes del contrato (M7 IVA / M9 launch-metrics)', () => {
  function buildService(overrides: Record<string, any> = {}) {
    const prisma: any = {
      order: { findMany: jest.fn().mockResolvedValue([]), count: jest.fn().mockResolvedValue(0) },
      sellRequest: { count: jest.fn().mockResolvedValue(0) },
      shipmentRequest: { count: jest.fn().mockResolvedValue(0) },
      user: { count: jest.fn().mockResolvedValue(0) },
      ...overrides,
    };
    return new AdminService(
      prisma as unknown as PrismaService,
      {} as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as any,
    );
  }

  it('ivaReport: cada item de byOrder expone `orderId` (no `id`)', async () => {
    const settledAt = new Date('2026-01-15');
    const service = buildService({
      order: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'ord_1', ivaCents: 1600, settledAt, status: 'settled' },
          { id: 'ord_2', ivaCents: 800, settledAt, status: 'refunded' },
        ]),
      },
    });

    const res = await service.ivaReport('2026-01-01', '2026-02-01');

    // Solo las settled suman al IVA cobrado.
    expect(res.ivaCollectedCents).toBe(1600);
    expect(res.byOrder).toHaveLength(2);
    const item: any = res.byOrder[0];
    expect(item.orderId).toBe('ord_1');
    expect(item.id).toBeUndefined();
    // Conserva el resto de campos del contrato.
    expect(item.ivaCents).toBe(1600);
    expect(item.settledAt).toBe(settledAt);
    expect(item.status).toBe('settled');
  });

  it('launchMetrics: `goals` es null cuando no hay metas fijadas (no un objeto de nulos)', async () => {
    const service = buildService();
    const res = await service.launchMetrics();
    expect(res.goals).toBeNull();
    // Sigue exponiendo las métricas base.
    expect(res).toMatchObject({
      users: 0,
      salesSettled: 0,
      buylistPaid: 0,
      withdrawalsNoDispute: 0,
    });
  });
});
