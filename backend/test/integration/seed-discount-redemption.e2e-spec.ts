/**
 * seed-discount-redemption.e2e-spec.ts — el SEED sintético resiembra tras un USO de código de descuento. Propiedad: backend.
 *
 * Hallazgo de frontend (medido en `798f54f6`, N=1, determinista): después de una corrida real de
 * `frontend/e2e/discount-codes.spec.ts`, `stack-native.sh up --seed` moría con
 * `P2003 DiscountRedemption_shipmentRequestId_fkey`. `seedE2E` borra los `ShipmentRequest` y `Order` de los usuarios del
 * fixture (y los pedidos de invitado `@example.com`), y `DiscountRedemption` cuelga de ambos con FK `Restrict` (M-92).
 *
 * Esta prueba deja, sobre una BD ya sembrada, los tres usos que una corrida E2E puede dejar —sobre una orden de un
 * usuario del fixture, sobre un retiro de un usuario del fixture y sobre un pedido de invitado— más un bloqueo
 * `user:<id>` del límite de intentos, y exige que la resiembra:
 *   1. no reviente (el `P2003` de arriba);
 *   2. borre esos usos y el bloqueo por usuario del fixture (si no, el cliente E2E nace bloqueado en la siguiente corrida);
 *   3. quede ACOTADA: el uso de un cliente ajeno al fixture, su orden y su bloqueo siguen ahí; el código también.
 * Determinista (N=1 dicho como tal). Postgres real por Prisma, sin app.
 */
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = `sdr${Date.now().toString(36)}`;
const TAG = RUN.slice(-6).toUpperCase();

describe('E2E — el SEED resiembra tras usos de códigos de descuento (FK Restrict de M-92)', () => {
  const prisma = new PrismaClient();
  let codeId: string;
  let outsiderId: string;
  let outsiderOrderId: string;

  const address = { recipientName: 'Seed DSC', line1: 'x', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '1' };
  const orderData = {
    fulfillmentMode: 'vault' as const,
    status: 'pending' as const,
    subtotalCents: 10000,
    processingFeeCents: 0,
    ivaCents: 0,
    totalCents: 10000,
    priceConvention: 'IVA_INCLUSIVE' as const,
    ivaTransferPct: 100,
    locale: 'es' as const,
  };

  beforeAll(async () => {
    await prisma.$connect();
    await seedE2E(prisma);
    const admin = await prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } });
    const code = await prisma.discountCode.create({
      data: { code: `SDR${TAG}`, kind: 'percent', percentPct: 10, startsAt: new Date(Date.now() - 60_000), createdByUserId: admin.id, maxUsesPerCustomer: null },
    });
    codeId = code.id;
    const outsider = await prisma.user.create({
      data: { email: `${RUN}-ajeno@seed-dsc.test`, passwordHash: 'x', name: 'Ajeno DSC', role: 'customer', locale: 'es', emailVerified: true },
    });
    outsiderId = outsider.id;
  });

  afterAll(async () => {
    await prisma.discountRedemption.deleteMany({ where: { codeId } });
    await prisma.discountCode.deleteMany({ where: { id: codeId } });
    await prisma.discountCodeThrottle.deleteMany({ where: { key: `user:${outsiderId}` } });
    if (outsiderOrderId) await prisma.order.deleteMany({ where: { id: outsiderOrderId } });
    await prisma.user.deleteMany({ where: { id: outsiderId } });
    // Deja la BD como la suite espera encontrarla.
    await seedE2E(prisma);
    await prisma.$disconnect();
  });

  it('resiembra sin P2003, borra los usos y el bloqueo de los usuarios del fixture y deja intacto lo ajeno', async () => {
    const customer = await prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } });

    // Uso sobre una ORDEN de un usuario del fixture (sesión de checkout de bóveda).
    const order = await prisma.order.create({ data: { userId: customer.id, ...orderData } });
    // Uso sobre un RETIRO de un usuario del fixture (envío gratis, §DSC retiro) — el P2003 que vio frontend.
    const shipment = await prisma.shipmentRequest.create({
      data: {
        userId: customer.id,
        addressSnapshot: address,
        status: 'picking',
        pickingAt: new Date(),
        shippingFeeCents: 0,
        ivaCents: 0,
        processingFeeCents: 0,
        totalCents: 0,
        priceConvention: 'IVA_INCLUSIVE',
      },
    });
    // Uso sobre un pedido de INVITADO (`@example.com`, el dominio que el paso 3-pre del seed purga).
    const guestEmail = `${RUN}@example.com`;
    const guestOrder = await prisma.order.create({ data: { userId: null, guestEmail, ...orderData, fulfillmentMode: 'direct_ship', shippingAddressSnapshot: address } });
    // Uso de un cliente AJENO al fixture: la resiembra no lo toca.
    const outsiderOrder = await prisma.order.create({ data: { userId: outsiderId, ...orderData } });
    outsiderOrderId = outsiderOrder.id;

    const now = new Date();
    await prisma.discountRedemption.createMany({
      data: [
        { id: randomUUID(), codeId, orderId: order.id, status: 'reserved', customerUserId: customer.id },
        { id: randomUUID(), codeId, shipmentRequestId: shipment.id, status: 'consumed', consumedAt: now, customerUserId: customer.id },
        { id: randomUUID(), codeId, orderId: guestOrder.id, status: 'released', releasedAt: now, customerEmail: guestEmail },
        { id: randomUUID(), codeId, orderId: outsiderOrder.id, status: 'reserved', customerUserId: outsiderId },
      ],
    });
    const blockedUntil = new Date(now.getTime() + 15 * 60_000);
    await prisma.discountCodeThrottle.createMany({
      data: [
        { key: `user:${customer.id}`, failures: 10, windowStartedAt: now, blockedUntil },
        { key: `user:${outsiderId}`, failures: 10, windowStartedAt: now, blockedUntil },
      ],
    });

    // 1. Antes del arreglo: P2003 DiscountRedemption_shipmentRequestId_fkey (o el de orderId).
    await expect(seedE2E(prisma)).resolves.toBeUndefined();

    // 2. Los usos de los padres que el seed borra ya no existen, ni sus padres; el bloqueo del cliente E2E tampoco.
    const left = await prisma.discountRedemption.findMany({ where: { codeId }, select: { orderId: true, shipmentRequestId: true } });
    expect(left).toEqual([{ orderId: outsiderOrder.id, shipmentRequestId: null }]);
    expect(await prisma.order.count({ where: { id: { in: [order.id, guestOrder.id] } } })).toBe(0);
    expect(await prisma.shipmentRequest.count({ where: { id: shipment.id } })).toBe(0);
    expect(await prisma.discountCodeThrottle.count({ where: { key: `user:${customer.id}` } })).toBe(0);

    // 3. Acotado: lo ajeno sigue (orden, bloqueo y el código mismo).
    expect(await prisma.order.count({ where: { id: outsiderOrder.id } })).toBe(1);
    expect(await prisma.discountCodeThrottle.count({ where: { key: `user:${outsiderId}` } })).toBe(1);
    expect(await prisma.discountCode.count({ where: { id: codeId } })).toBe(1);
  });
});
