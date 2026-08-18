import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { BusinessException } from '../src/common/business.exception';

/**
 * Fix correctness #1: la reserva de checkout debe ser ATÓMICA (pieza única). Dos
 * checkouts concurrentes del mismo item → solo una orden gana la transición a `reserved`.
 */
describe('OrdersService.createSession — reserva atómica (fix #1)', () => {
  const item = {
    id: 'item1',
    folio: 'INV-000001',
    cardId: 'card1',
    productType: 'raw',
    status: 'listed',
    ownerType: 'platform',
    listPriceCents: 10000,
    card: { id: 'card1', name: 'Charizard', number: '4', set: { name: 'Base' } },
  };

  function buildService(sharedState: { available: boolean }) {
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([item]),
        // updateMany atómico: solo "gana" si el item sigue disponible; luego lo marca tomado.
        updateMany: jest.fn(async ({ where }: any) => {
          if (where.status?.in?.includes('listed') && sharedState.available) {
            sharedState.available = false;
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      billingProfile: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn() },
      order: { create: jest.fn(async () => ({ id: `order-${Math.random()}` })), update: jest.fn() },
      // v1.21 (M-25): todo pedido nuevo reserva su número legible de la secuencia Postgres.
      $queryRawUnsafe: jest.fn(async () => [{ nextval: 1n }]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const settings: any = {
      getNumber: jest.fn().mockResolvedValue(16),
      getStripeFee: jest
        .fn()
        .mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    };
    const stripe: any = {
      createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_1', clientSecret: 'cs_1' }),
    };
    const pricing = {} as PricingService;
    const catalog = {} as CatalogService;
    return new OrdersService(
      prisma as PrismaService,
      pricing,
      settings as SettingsService,
      stripe as StripeService,
      catalog,
    );
  }

  it('reserves with count check: second concurrent checkout of the same item fails', async () => {
    // Ambos servicios comparten el mismo estado de disponibilidad (simula la fila única en DB).
    const shared = { available: true };
    const svcA = buildService(shared);
    const svcB = buildService(shared);

    const resA = await svcA.createSession('userA', ['item1'], undefined);
    expect(resA.orderId).toBeDefined();

    // Segundo checkout sobre el item ya reservado → ITEM_UNAVAILABLE (count !== 1).
    await expect(svcB.createSession('userB', ['item1'], undefined)).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
    });
  });

  it('uses updateMany (atomic guard), not an unconditional update', async () => {
    const shared = { available: true };
    const svc = buildService(shared);
    await svc.createSession('userA', ['item1'], undefined);
    const prisma = (svc as any).prisma;
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 'item1', status: { in: ['listed', 'in_stock'] } }),
        data: expect.objectContaining({ status: 'reserved', ownershipStatus: 'pending' }),
      }),
    );
  });
});

/**
 * A2 (cierra BE-7): el PaymentIntent es transaccional con la reserva. Si Stripe falla tras
 * reservar, se compensa (libera la reserva → item vendible, orden `failed`) y se devuelve un
 * error de reintento; los errores de negocio legibles (CARD_DECLINED) se propagan tal cual.
 */
describe('OrdersService.createSession — rollback del PaymentIntent (A2 / BE-7)', () => {
  const item = {
    id: 'item1',
    folio: 'INV-000001',
    cardId: 'card1',
    productType: 'raw',
    status: 'listed',
    ownerType: 'platform',
    listPriceCents: 10000,
    card: { id: 'card1', name: 'Charizard', number: '4', set: { name: 'Base' } },
  };

  function buildService(stripeReject: unknown) {
    const released: unknown[] = [];
    const prisma: any = {
      inventoryItem: {
        findMany: jest.fn().mockResolvedValue([item]),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (data.status === 'reserved') return { count: 1 };
          if (data.status === 'listed') {
            released.push(where);
            return { count: 1 };
          }
          return { count: 0 };
        }),
      },
      billingProfile: { findUnique: jest.fn().mockResolvedValue(null), findFirst: jest.fn() },
      order: { create: jest.fn(async () => ({ id: 'order-1' })), update: jest.fn() },
      // v1.21 (M-25): todo pedido nuevo reserva su número legible de la secuencia Postgres.
      $queryRawUnsafe: jest.fn(async () => [{ nextval: 1n }]),
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    const settings: any = {
      getNumber: jest.fn().mockResolvedValue(16),
      getStripeFee: jest
        .fn()
        .mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    };
    const stripe: any = { createPaymentIntent: jest.fn().mockRejectedValue(stripeReject) };
    const svc = new OrdersService(
      prisma as PrismaService,
      {} as PricingService,
      settings as SettingsService,
      stripe as StripeService,
      {} as CatalogService,
    );
    return { svc, prisma, released };
  }

  it('releases the reservation and returns a retriable error on PI provider failure', async () => {
    const { svc, prisma, released } = buildService(new Error('stripe network down'));
    await expect(svc.createSession('userA', ['item1'], undefined)).rejects.toMatchObject({
      code: 'PAYMENT_PROVIDER_UNAVAILABLE',
    });
    // Reserva liberada (item → listed) y orden marcada `failed`.
    expect(released.length).toBe(1);
    expect(released[0]).toMatchObject({ status: 'reserved' });
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
  });

  it('propagates a business error (CARD_DECLINED) as-is after releasing the reservation', async () => {
    const declined = BusinessException.validation('CARD_DECLINED', 'Card was declined');
    const { svc, prisma, released } = buildService(declined);
    await expect(svc.createSession('userA', ['item1'], undefined)).rejects.toMatchObject({
      code: 'CARD_DECLINED',
    });
    expect(released.length).toBe(1); // igual se compensa la reserva
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'failed' } }),
    );
  });
});
