import { DisputesService } from '../src/modules/disputes/disputes.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * Fix 3 (POLÍTICA DEL HUMANO — VENTAS FINALES): la recompra (repurchase) es una COMPENSACIÓN
 * al precio pagado; el cliente CONSERVA la carta y la carta NO regresa al inventario. Por eso
 * `resolve('repurchase')` NO debe tocar el InventoryItem ni crear un InventoryMovement.
 */
describe('DisputesService.resolve — repurchase NO revierte la carta al inventario', () => {
  let prisma: any;
  let service: DisputesService;

  beforeEach(() => {
    // v1.68 · §M8: `resolve` escribe con `updateMany` guardado por estado (no `update({where:{id}})`)
    // y relee la fila para responder. El fake mínimo de aquí sólo mira QUÉ se escribe; la guarda
    // (el `where` evaluado de verdad) se prueba en `disputes.resolve-guard.spec.ts`.
    prisma = {
      dispute: {
        findUnique: jest.fn().mockResolvedValue({ id: 'd1', inventoryItemId: 'item1', status: 'abierta' }),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn(),
      },
      orderItem: { findFirst: jest.fn().mockResolvedValue({ unitPriceCents: 12500 }) },
      inventoryItem: { update: jest.fn(), findUnique: jest.fn() },
      inventoryMovement: { create: jest.fn() },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    service = new DisputesService(prisma as PrismaService, {} as StripeService);
  });

  it('marks resuelta_recompra WITHOUT reverting the item or creating a movement', async () => {
    await service.resolve('d1', 'repurchase', 'daño confirmado', 'admin1');
    // La carta se queda con el cliente: no se toca el inventario.
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.inventoryMovement.create).not.toHaveBeenCalled();
    // Dispute cerrada como recompra, con el precio pagado registrado.
    expect(prisma.dispute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'd1' }),
        data: expect.objectContaining({
          status: 'resuelta_recompra',
          resolution: expect.stringContaining('12500'),
        }),
      }),
    );
    expect(prisma.dispute.update).not.toHaveBeenCalled();
  });

  it('reject → rechazada (sin tocar inventario)', async () => {
    await service.resolve('d1', 'reject', 'sin evidencia', 'admin1');
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
    expect(prisma.dispute.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'rechazada' }) }),
    );
  });
});
