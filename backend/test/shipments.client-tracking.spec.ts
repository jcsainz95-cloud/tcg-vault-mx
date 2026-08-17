import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';

/**
 * v1.17 — Vista de rastreo del cliente (API_CONTRACT §5) y transición terminal (§M4).
 */
describe('ShipmentsService — ClientShipmentDTO enriquecido (v1.17)', () => {
  const enrichedItem = {
    id: 'shi1',
    shipmentRequestId: 'shp1',
    inventoryItemId: 'i1',
    inventoryItem: {
      folio: 'INV-000001',
      finish: 'reverse_holo',
      card: {
        id: 'c1',
        name: 'Charizard',
        number: '4',
        imageSmallUrl: 'http://img/small.png',
        set: { name: 'Base Set' },
      },
    },
  };
  const row = {
    id: 'shp1',
    userId: 'u1',
    status: 'enviado',
    addressSnapshot: { city: 'CDMX', country: 'MX' },
    shippingFeeCents: 17500,
    shippingCostCents: 9000, // costo interno — NO debe exponerse
    ivaCents: 2800,
    processingFeeCents: 1000,
    totalCents: 21300,
    carrier: 'DHL',
    trackingNumber: 'TRK123',
    requestedAt: new Date('2026-08-10'),
    pickingAt: new Date('2026-08-11'),
    shippedAt: new Date('2026-08-12'),
    deliveredAt: null,
    items: [enrichedItem],
  };

  function makeService(prismaOver: any) {
    return new ShipmentsService(
      prismaOver as unknown as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
  }

  it('listMine devuelve envelope { data } con items enriquecidos y sin shippingCostCents', async () => {
    const prisma: any = { shipmentRequest: { findMany: jest.fn().mockResolvedValue([row]) } };
    const svc = makeService(prisma);
    const res = await svc.listMine('u1');
    expect(Array.isArray(res.data)).toBe(true);
    const dto = res.data[0];
    expect(dto).not.toHaveProperty('shippingCostCents');
    expect(dto.status).toBe('enviado');
    expect(dto.carrier).toBe('DHL');
    expect(dto.trackingNumber).toBe('TRK123');
    const item = dto.items[0];
    expect(item).toEqual({
      inventoryItemId: 'i1',
      folio: 'INV-000001',
      finish: 'reverse_holo',
      card: {
        id: 'c1',
        name: 'Charizard',
        setName: 'Base Set',
        number: '4',
        imageSmallUrl: 'http://img/small.png',
      },
    });
    // Scoping por usuario.
    expect(prisma.shipmentRequest.findMany.mock.calls[0][0].where).toEqual({ userId: 'u1' });
  });

  it('getMine hace scoping por ownerUserId (404 si no es del usuario)', async () => {
    const prisma: any = {
      shipmentRequest: { findUnique: jest.fn().mockResolvedValue({ ...row, userId: 'otro' }) },
    };
    const svc = makeService(prisma);
    await expect(svc.getMine('u1', 'shp1')).rejects.toMatchObject({});
  });

  it('getMine devuelve el DTO del propio usuario con items enriquecidos', async () => {
    const prisma: any = {
      shipmentRequest: { findUnique: jest.fn().mockResolvedValue(row) },
    };
    const svc = makeService(prisma);
    const dto = await svc.getMine('u1', 'shp1');
    expect(dto.id).toBe('shp1');
    expect(dto.items[0].card.setName).toBe('Base Set');
    expect(dto).not.toHaveProperty('shippingCostCents');
  });
});

describe('ShipmentsService.updateStatus — transición terminal a entregado (v1.17)', () => {
  function makeTx(items: any[], itemState: Record<string, any>) {
    return {
      shipmentRequest: { update: jest.fn(async ({ data }: any) => ({ id: 'shp1', ...data })) },
      shipmentItem: { findMany: jest.fn().mockResolvedValue(items) },
      inventoryItem: {
        findUnique: jest.fn(async ({ where }: any) => itemState[where.id] ?? null),
        update: jest.fn().mockResolvedValue({}),
      },
      inventoryMovement: { create: jest.fn().mockResolvedValue({}) },
    };
  }

  function makeService(shipment: any, tx: any) {
    const prisma: any = {
      shipmentRequest: { findUnique: jest.fn().mockResolvedValue(shipment) },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    };
    const svc = new ShipmentsService(
      prisma as unknown as PrismaService,
      {} as SettingsService,
      {} as StripeService,
    );
    return { svc, prisma };
  }

  it('entregado ⇒ cada item in_custody → withdrawn con InventoryMovement (transacción), conservando owner', async () => {
    const tx = makeTx(
      [{ inventoryItemId: 'i1' }, { inventoryItemId: 'i2' }],
      {
        i1: { id: 'i1', status: 'in_custody', ownerType: 'customer', ownerUserId: 'u1' },
        i2: { id: 'i2', status: 'in_custody', ownerType: 'customer', ownerUserId: 'u1' },
      },
    );
    const { svc, prisma } = makeService({ id: 'shp1', status: 'enviado' }, tx);
    await svc.updateStatus('shp1', 'entregado' as any);

    // Todo dentro de UNA transacción.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.inventoryItem.update).toHaveBeenCalledTimes(2);
    // Solo cambia status (no toca ownerType/ownerUserId/ownershipStatus).
    const updateData = tx.inventoryItem.update.mock.calls[0][0].data;
    expect(updateData).toEqual({ status: 'withdrawn' });
    // Movimiento de retiro por cada item.
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(2);
    const mov = tx.inventoryMovement.create.mock.calls[0][0].data;
    expect(mov.reason).toBe('withdrawal');
    expect(mov.toStatus).toBe('withdrawn');
    expect(mov.fromStatus).toBe('in_custody');
  });

  it('idempotente: un item ya withdrawn no duplica movimiento', async () => {
    const tx = makeTx([{ inventoryItemId: 'i1' }], {
      i1: { id: 'i1', status: 'withdrawn', ownerType: 'customer', ownerUserId: 'u1' },
    });
    const { svc } = makeService({ id: 'shp1', status: 'enviado' }, tx);
    await svc.updateStatus('shp1', 'entregado' as any);
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('transiciones no terminales (enviado) NO tocan el inventario', async () => {
    const tx = makeTx([{ inventoryItemId: 'i1' }], {
      i1: { id: 'i1', status: 'in_custody' },
    });
    const { svc } = makeService({ id: 'shp1', status: 'guia' }, tx);
    await svc.updateStatus('shp1', 'enviado' as any);
    expect(tx.shipmentItem.findMany).not.toHaveBeenCalled();
    expect(tx.inventoryItem.update).not.toHaveBeenCalled();
    expect(tx.inventoryMovement.create).not.toHaveBeenCalled();
  });

  it('transición inválida lanza CONFLICT sin abrir transacción', async () => {
    const tx = makeTx([], {});
    const { svc, prisma } = makeService({ id: 'shp1', status: 'entregado' }, tx);
    await expect(svc.updateStatus('shp1', 'entregado' as any)).rejects.toMatchObject({});
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
