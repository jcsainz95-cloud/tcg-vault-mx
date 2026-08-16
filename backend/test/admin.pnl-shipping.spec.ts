import { ConfigService } from '@nestjs/config';
import { AdminService } from '../src/modules/admin/admin.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * v1.4-finance (M-16): el P&L separa INGRESO de envío (shippingFeeCents, lo que paga el
 * cliente) de COSTO de envío (shippingCostCents, lo que la plataforma paga al carrier) y
 * lo RESTA de la ganancia. La clave `shippingCents` se renombró a `shippingRevenueCents`.
 * Fórmula: profit = income + shippingRevenue − cogs − stripeFees − shippingCost.
 */
describe('AdminService.pnl — ingreso vs costo de envío (v1.4-finance)', () => {
  let prisma: any;
  let service: AdminService;

  beforeEach(() => {
    prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            subtotalCents: 100000,
            processingFeeCents: 4000,
            items: [{ inventoryItem: { acquisitionCostCents: 30000 } }],
          },
        ]),
      },
      shipmentRequest: {
        findMany: jest.fn().mockResolvedValue([
          // Envío con costo capturado: ingreso 17500, costo real 9000.
          { shippingFeeCents: 17500, shippingCostCents: 9000, processingFeeCents: 800 },
          // Envío histórico/sin captura: costo = 0 (default de columna), no rompe el cálculo.
          { shippingFeeCents: 17500, shippingCostCents: 0, processingFeeCents: 800 },
        ]),
      },
    };
    service = new AdminService(
      prisma as unknown as PrismaService,
      {} as PricingService,
      new PiiCryptoService(new ConfigService({})),
      {} as any,
    );
  });

  it('returns the 6-key shape and subtracts shippingCostCents', async () => {
    const p = await service.pnl();
    // income = 100000 ; shippingRevenue = 17500 + 17500 = 35000
    // cogs = 30000 ; stripeFees = 4000 + 800 + 800 = 5600 ; shippingCost = 9000 + 0 = 9000
    expect(p).toEqual({
      incomeCents: 100000,
      shippingRevenueCents: 35000,
      cogsCents: 30000,
      stripeFeesCents: 5600,
      shippingCostCents: 9000,
      profitCents: 100000 + 35000 - 30000 - 5600 - 9000,
    });
    // No debe existir la clave vieja.
    expect(p).not.toHaveProperty('shippingCents');
  });

  it('subtracting the shipping cost lowers profit vs treating it as 0', async () => {
    const withCost = await service.pnl();
    prisma.shipmentRequest.findMany.mockResolvedValue([
      { shippingFeeCents: 17500, shippingCostCents: 0, processingFeeCents: 800 },
      { shippingFeeCents: 17500, shippingCostCents: 0, processingFeeCents: 800 },
    ]);
    const withoutCost = await service.pnl();
    expect(withoutCost.profitCents - withCost.profitCents).toBe(9000);
  });

  it('exportCsv(pnl) mirrors the new 6-column shape', async () => {
    const csv = await service.exportCsv('pnl');
    const [header, row] = csv.trim().split('\n');
    expect(header).toBe(
      'report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,profitCents',
    );
    expect(row).toBe(`pnl,100000,35000,30000,5600,9000,${100000 + 35000 - 30000 - 5600 - 9000}`);
  });
});
