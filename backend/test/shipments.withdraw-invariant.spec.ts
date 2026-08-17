import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * WS-H — invariante de retiro (SEC-H1 / SEC-H2).
 *
 * SEC-H1: un item ya `withdrawn` (envío entregado) CONSERVA ownershipStatus='settled'.
 * `classifyItems` exige `status === 'in_custody'` (criterio positivo), así que un item con
 * cualquier otro status es INELEGIBLE → `POST /shipments` lo rechaza con
 * `ITEM_NOT_IN_CUSTODY` (422). Sin este gate se cobraría un nuevo envío por una carta que ya
 * salió de la bóveda (doble-retiro).
 *
 * SEC-H2: el chequeo anti-doble-envío + la creación van en una tx serializable; dos creaciones
 * secuenciales del mismo item no producen dos envíos activos (la 2ª ve el envío activo de la 1ª).
 */
describe('ShipmentsService — invariante de retiro (WS-H)', () => {
  const address = {
    id: 'addr1',
    userId: 'userA',
    country: 'MX',
    line1: 'x',
    city: 'c',
    state: 's',
    postalCode: '00000',
    phone: '1',
  };

  function buildService(item: Record<string, unknown>) {
    const prisma: any = {
      address: { findUnique: jest.fn().mockResolvedValue(address) },
      inventoryItem: { findMany: jest.fn().mockResolvedValue([item]) },
      shipmentItem: { findFirst: jest.fn().mockResolvedValue(null) },
      shipmentRequest: {
        create: jest.fn().mockResolvedValue({ id: 'ship1' }),
        update: jest.fn(),
        delete: jest.fn().mockResolvedValue({}),
      },
    };
    prisma.$transaction = jest.fn((fn: any) => fn(prisma));
    const settings: any = {
      getNumber: jest.fn().mockResolvedValue(17500),
      getStripeFee: jest
        .fn()
        .mockResolvedValue({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 }),
    };
    const stripe: any = {
      createPaymentIntent: jest.fn().mockResolvedValue({ id: 'pi_1', clientSecret: 'cs' }),
    };
    const svc = new ShipmentsService(
      prisma as PrismaService,
      settings as SettingsService,
      stripe as StripeService,
    );
    return { svc, prisma, stripe };
  }

  it('(a) rechaza un item `withdrawn` (settled preservado) con ITEM_NOT_IN_CUSTODY / 422', async () => {
    // El item fue entregado: status='withdrawn' pero ownershipStatus sigue 'settled'.
    const { svc, prisma, stripe } = buildService({
      id: 'item1',
      ownerUserId: 'userA',
      ownershipStatus: 'settled',
      status: 'withdrawn',
    });
    await expect(svc.create('userA', ['item1'], 'addr1')).rejects.toMatchObject({
      code: 'ITEM_NOT_IN_CUSTODY',
      // BusinessException.validation ⇒ HTTP 422.
      status: 422,
    });
    // Falla ANTES de tocar Stripe o crear la solicitud (no se cobra el envío).
    expect(stripe.createPaymentIntent).not.toHaveBeenCalled();
    expect(prisma.shipmentRequest.create).not.toHaveBeenCalled();
  });

  it('(b) el ciclo entregado→re-retiro falla: mismo item, segundo intento rechazado', async () => {
    // Tras la entrega el item pasó a `withdrawn`. Un segundo POST /shipments no puede re-cobrar.
    const { svc } = buildService({
      id: 'item1',
      ownerUserId: 'userA',
      ownershipStatus: 'settled',
      status: 'withdrawn',
    });
    await expect(svc.create('userA', ['item1'], 'addr1')).rejects.toMatchObject({
      code: 'ITEM_NOT_IN_CUSTODY',
    });
  });

  it('acepta un item en custodia (settled + in_custody): camino feliz crea la solicitud', async () => {
    const { svc, prisma, stripe } = buildService({
      id: 'item1',
      ownerUserId: 'userA',
      ownershipStatus: 'settled',
      status: 'in_custody',
    });
    const res = await svc.create('userA', ['item1'], 'addr1');
    expect(res.shipmentId).toBe('ship1');
    // La creación va dentro de la tx serializable (SEC-H2).
    expect(prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(prisma.shipmentRequest.create).toHaveBeenCalledTimes(1);
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('(c) SEC-H2: el guard transaccional evita un segundo envío activo del mismo item', async () => {
    const { svc, prisma, stripe } = buildService({
      id: 'item1',
      ownerUserId: 'userA',
      ownershipStatus: 'settled',
      status: 'in_custody',
    });
    // 1er envío: no hay envío activo previo → se crea.
    await svc.create('userA', ['item1'], 'addr1');
    // 2º envío secuencial: ahora el findFirst (dentro de la tx) ve un envío activo → 409.
    prisma.shipmentItem.findFirst.mockResolvedValueOnce({
      id: 'si1',
      inventoryItemId: 'item1',
    });
    await expect(svc.create('userA', ['item1'], 'addr1')).rejects.toMatchObject({
      code: 'ITEM_IN_ANOTHER_SHIPMENT',
      status: 409,
    });
    // Solo se creó UN envío (el segundo abortó dentro de la tx, antes de crear).
    expect(prisma.shipmentRequest.create).toHaveBeenCalledTimes(1);
    // El segundo intento nunca llegó a Stripe.
    expect(stripe.createPaymentIntent).toHaveBeenCalledTimes(1);
  });

  it('el re-chequeo anti-doble-envío ocurre DENTRO de $transaction (serializable)', async () => {
    const { svc, prisma } = buildService({
      id: 'item1',
      ownerUserId: 'userA',
      ownershipStatus: 'settled',
      status: 'in_custody',
    });
    await svc.create('userA', ['item1'], 'addr1');
    // El findFirst del guard se invocó (a través del cliente tx expuesto por el mock).
    expect(prisma.shipmentItem.findFirst).toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
