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

/**
 * T2 (techlead, 2026-08-18) — la reserva atómica y la compensación del PaymentIntent vivían
 * DUPLICADAS en `OrdersService` (bóveda) y `GuestCheckoutService` (envío directo), y las copias ya
 * habían divergido: la de invitado tenía el guard `ownerType='platform'` y la de bóveda NO,
 * confiando en el chequeo pre-transaccional de `priceCartLines` (ventana TOCTOU).
 *
 * Ahora hay una sola implementación (`OrdersService.reserveItems`), con la titularidad como
 * parámetro. Esta suite fija el comportamiento que NO puede volver a perderse.
 */
describe('OrdersService.reserveItems — fuente única de la reserva (T2)', () => {
  function buildTx() {
    const calls: { where: any; data: any }[] = [];
    const tx: any = {
      inventoryItem: {
        updateMany: jest.fn(async ({ where, data }: any) => {
          calls.push({ where, data });
          // Simula la fila real: solo casa si la pieza es de plataforma y está vendible.
          const matches =
            where.ownerType === 'platform' && where.status?.in?.includes('listed');
          return { count: matches ? 1 : 0 };
        }),
      },
    };
    const svc = new OrdersService(
      {} as PrismaService,
      {} as PricingService,
      {} as SettingsService,
      {} as StripeService,
      {} as CatalogService,
    );
    return { svc, tx, calls };
  }

  const items = [{ id: 'item1', folio: 'INV-000001' }];

  it('SIEMPRE exige `ownerType=platform` (cierra la ventana TOCTOU de la ruta de bóveda)', async () => {
    const { svc, tx, calls } = buildTx();
    await svc.reserveItems(tx, items, {
      ownerType: 'customer',
      ownerUserId: 'user-1',
      ownershipStatus: 'pending',
    });
    expect(calls[0].where).toEqual({
      id: 'item1',
      ownerType: 'platform',
      status: { in: ['listed', 'in_stock'] },
    });
  });

  it('con titularidad (bóveda) escribe ownerType/ownerUserId/ownershipStatus', async () => {
    const { svc, tx, calls } = buildTx();
    await svc.reserveItems(tx, items, {
      ownerType: 'customer',
      ownerUserId: 'user-1',
      ownershipStatus: 'pending',
    });
    expect(calls[0].data).toEqual({
      status: 'reserved',
      ownerType: 'customer',
      ownerUserId: 'user-1',
      ownershipStatus: 'pending',
    });
  });

  it('con `null` (envío directo) NO escribe titularidad: la pieza sigue siendo de la plataforma', async () => {
    const { svc, tx, calls } = buildTx();
    await svc.reserveItems(tx, items, null);
    expect(calls[0].data).toEqual({ status: 'reserved' });
    // Invariante §4-G.0-1: un pedido de invitado NUNCA convierte la pieza en bóveda de nadie.
    expect(calls[0].data).not.toHaveProperty('ownerType');
    expect(calls[0].data).not.toHaveProperty('ownerUserId');
    expect(calls[0].data).not.toHaveProperty('ownershipStatus');
  });

  it('`count !== 1` ⇒ ITEM_UNAVAILABLE con el folio de la pieza (mensaje operable)', async () => {
    const { svc, tx } = buildTx();
    tx.inventoryItem.updateMany = jest.fn(async () => ({ count: 0 }));
    await expect(svc.reserveItems(tx, items, null)).rejects.toMatchObject({
      code: 'ITEM_UNAVAILABLE',
      message: expect.stringContaining('INV-000001'),
    });
  });

  it('reserva TODAS las piezas del carrito, una por una y de forma atómica', async () => {
    const { svc, tx, calls } = buildTx();
    await svc.reserveItems(
      tx,
      [
        { id: 'item1', folio: 'INV-000001' },
        { id: 'item2', folio: 'INV-000002' },
      ],
      null,
    );
    expect(calls.map((c) => c.where.id)).toEqual(['item1', 'item2']);
  });
});
