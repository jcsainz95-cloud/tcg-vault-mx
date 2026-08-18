import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';

const GUEST_ORDER = {
  id: 'order-guest-1',
  orderNumber: 'TCG-000123',
  userId: null,
  guestEmail: 'juan@example.com',
  locale: 'es',
  fulfillmentMode: 'direct_ship',
  status: 'pending',
  totalCents: 51812,
  stripePaymentIntentId: 'pi_guest_1',
  shippingAddressSnapshot: { city: 'CDMX', recipientName: 'Juan Pérez' },
  items: [
    { inventoryItemId: 'item-1', cardSnapshot: { name: 'Charizard', setName: 'Base', number: '4' } },
  ],
};

function build(opts: { order?: any; itemStatus?: string; existingShipment?: any; card?: any } = {}) {
  const itemState = { status: opts.itemStatus ?? 'reserved', ownerType: 'platform', ownerUserId: null };
  const created: any = { shipments: [], movements: [], orderUpdates: [] };
  const tx: any = {
    order: {
      update: jest.fn(async ({ data }: any) => {
        created.orderUpdates.push(data);
        return {};
      }),
    },
    inventoryItem: {
      findUnique: jest.fn(async () => ({ id: 'item-1', ...itemState })),
      updateMany: jest.fn(async ({ where, data }: any) => {
        if (where.status && itemState.status !== where.status) return { count: 0 };
        itemState.status = data.status;
        return { count: 1 };
      }),
      update: jest.fn(async () => ({})),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        created.movements.push(data);
        return data;
      }),
    },
    shipmentRequest: {
      findFirst: jest.fn(async () => opts.existingShipment ?? null),
      create: jest.fn(async ({ data }: any) => {
        created.shipments.push(data);
        return data;
      }),
    },
    shipmentItem: { findFirst: jest.fn(async () => null) },
  };
  const prisma: any = {
    order: { findUnique: jest.fn(async () => opts.order ?? GUEST_ORDER), update: jest.fn() },
    shipmentRequest: { findUnique: jest.fn(async () => null), update: jest.fn() },
    processedStripeEvent: { create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const stripe: any = {
    getCardDetails: jest.fn(async () => ('card' in opts ? opts.card : { brand: 'visa', last4: '4242' })),
  };
  const mail: any = { sendConfirmation: jest.fn(async () => undefined) };
  const svc = new PaymentsService(
    prisma as PrismaService,
    stripe as StripeService,
    mail as GuestOrderMailService,
  );
  return { svc, prisma, tx, stripe, mail, created, itemState };
}

/**
 * Liquidación de un pedido de INVITADO (§4-G.6, ARCHITECTURE §4.21c). La ruta de bóveda no cambia
 * (la cubre payments.service.spec.ts); aquí se blinda la SEGUNDA ruta de fulfillment.
 */
describe('PaymentsService — settle de un pedido direct_ship', () => {
  it('los items pasan reserved → picking y NUNCA entran a bóveda (invariante §4-G.0-1)', async () => {
    const { svc, tx, itemState } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(itemState.status).toBe('picking');
    const data = tx.inventoryItem.updateMany.mock.calls[0][0].data;
    expect(data).toEqual({ status: 'picking' });
    // Jamás in_custody / ownerType=customer / ownershipStatus=settled.
    expect(JSON.stringify(data)).not.toContain('in_custody');
    expect(data).not.toHaveProperty('ownerType');
    expect(data).not.toHaveProperty('ownerUserId');
    expect(data).not.toHaveProperty('ownershipStatus');
  });

  it('registra el movimiento de inventario reserved → picking', async () => {
    const { svc, created } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.movements[0]).toMatchObject({
      itemId: 'item-1',
      fromStatus: 'reserved',
      toStatus: 'picking',
      reason: 'settle',
    });
  });

  it('marca la orden settled y captura SOLO marca + últimos 4 de la tarjeta', async () => {
    const { svc, created } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.orderUpdates[0]).toMatchObject({
      status: 'settled',
      paymentMethodBrand: 'visa',
      paymentMethodLast4: '4242',
    });
    // Nunca se persiste nada más de la tarjeta.
    expect(Object.keys(created.orderUpdates[0])).toEqual([
      'status',
      'settledAt',
      'paymentMethodBrand',
      'paymentMethodLast4',
    ]);
  });

  it('si Stripe no devuelve datos de tarjeta, liquida igual (best-effort)', async () => {
    const { svc, created } = build({ card: null });
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.orderUpdates[0]).toMatchObject({ status: 'settled' });
    expect(created.orderUpdates[0]).not.toHaveProperty('paymentMethodBrand');
  });

  it('CREA el ShipmentRequest de fulfillment: userId=null, orderId, nace en `picking`', async () => {
    const { svc, created } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.shipments).toHaveLength(1);
    expect(created.shipments[0]).toMatchObject({
      userId: null,
      orderId: 'order-guest-1',
      status: 'picking',
      addressSnapshot: { city: 'CDMX', recipientName: 'Juan Pérez' },
    });
    expect(created.shipments[0].items.create).toEqual([{ inventoryItemId: 'item-1' }]);
  });

  it('el envío de fulfillment lleva montos en CERO (el ingreso ya está en Order.shippingFeeCents)', async () => {
    const { svc, created } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    // ARCHITECTURE §4.21b: si repitiera la tarifa, el P&L de M7 la contaría dos veces.
    expect(created.shipments[0]).toMatchObject({
      shippingFeeCents: 0,
      ivaCents: 0,
      processingFeeCents: 0,
      totalCents: 0,
    });
    expect(created.shipments[0].stripePaymentIntentId).toBeUndefined();
  });

  it('es IDEMPOTENTE: una orden ya `settled` no vuelve a tocar nada', async () => {
    const { svc, prisma, created } = build({ order: { ...GUEST_ORDER, status: 'settled' } });
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(created.shipments).toHaveLength(0);
  });

  it('no duplica el envío si ya existe uno activo para la orden', async () => {
    const { svc, created } = build({ existingShipment: { id: 'shp-1' } });
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.shipments).toHaveLength(0);
  });

  it('no re-avanza una pieza que ya no está `reserved` (reintento del webhook)', async () => {
    const { svc, created } = build({ itemStatus: 'picking' });
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.movements).toHaveLength(0);
  });

  it('envía el correo de confirmación con el enlace tokenizado (post-commit)', async () => {
    const { svc, mail } = build();
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(mail.sendConfirmation).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'order-guest-1',
        orderNumber: 'TCG-000123',
        guestEmail: 'juan@example.com',
        locale: 'es',
        totalCents: 51812,
        items: [{ name: 'Charizard', setName: 'Base', number: '4' }],
      }),
    );
  });

  it('un fallo del correo NO revierte el pago ni hace fallar el webhook (best-effort)', async () => {
    const { svc, mail, created } = build();
    mail.sendConfirmation.mockRejectedValue(new Error('resend caído'));
    await expect(svc.onPaymentSucceeded('pi_guest_1')).resolves.toBeUndefined();
    expect(created.orderUpdates[0]).toMatchObject({ status: 'settled' });
  });

  it('un pedido de BÓVEDA sigue por la ruta de siempre (no crea envío ni toca `picking`)', async () => {
    const vaultOrder = {
      ...GUEST_ORDER,
      fulfillmentMode: 'vault',
      guestEmail: null,
      userId: 'user-1',
    };
    const { svc, created, tx } = build({ order: vaultOrder });
    await svc.onPaymentSucceeded('pi_guest_1');
    expect(created.shipments).toHaveLength(0);
    expect(tx.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'in_custody', ownershipStatus: 'settled' } }),
    );
  });
});
