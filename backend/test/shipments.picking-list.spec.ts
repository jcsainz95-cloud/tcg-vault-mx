import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * Fix QA #3: la picking-list solo debe incluir envíos YA LIQUIDADOS (status `picking`).
 * Un envío `solicitado` no está pagado (solo pasa a `picking` tras payment_intent.succeeded).
 */
describe('ShipmentsService.pickingList (fix QA #3)', () => {
  let prisma: any;
  let service: ShipmentsService;

  beforeEach(() => {
    prisma = { shipmentRequest: { findMany: jest.fn().mockResolvedValue([]) } };
    service = new ShipmentsService(
      prisma as unknown as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
  });

  it('filters by status = picking only (excludes solicitado / unpaid)', async () => {
    await service.pickingList();
    const arg = prisma.shipmentRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('picking');
    // Nunca debe incluir 'solicitado'.
    expect(JSON.stringify(arg.where)).not.toContain('solicitado');
  });

  it('does not return items from unpaid shipments', async () => {
    // El mock ya solo devolvería envíos picking; verificamos que el where no los pide.
    prisma.shipmentRequest.findMany.mockResolvedValue([
      {
        id: 's1',
        items: [
          { inventoryItemId: 'i1', inventoryItem: { folio: 'INV-000001', location: { label: 'C01-F01-S01' } } },
        ],
      },
    ]);
    const res = await service.pickingList();
    expect(res.data).toHaveLength(1);
    expect(res.data[0].folio).toBe('INV-000001');
    const arg = prisma.shipmentRequest.findMany.mock.calls[0][0];
    expect(arg.where.status).toBe('picking');
  });
});
