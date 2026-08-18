import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';

/**
 * v1.21.2 (T1, §M3 / ARCHITECTURE §4.21c-bis) — DESENLACE HUMANO de una pieza congelada por un
 * contracargo con envío vivo (caso vi de §4.21h). Sin este endpoint la pieza congelada se queda
 * congelada para siempre; con él, quien decide es el operador que mira el estante, no una
 * heurística de estados.
 */
function build(opts: {
  order?: Record<string, unknown> | null;
  frozen?: { id: string; status: string }[];
  priceResolves?: boolean;
} = {}) {
  const order =
    opts.order === null
      ? null
      : {
          id: 'order-1',
          orderNumber: 'TCG-000123',
          fulfillmentMode: 'direct_ship',
          status: 'chargeback',
          disputeOutcome: null,
          chargebackNeedsManual: true,
          shippingAddressSnapshot: { city: 'CDMX', recipientName: 'Juan Pérez' },
          items: [{ inventoryItemId: 'item-1' }],
          ...(opts.order ?? {}),
        };
  const frozen = opts.frozen ?? [{ id: 'item-1', status: 'picking' }];
  const created: any = { shipments: [], movements: [], itemUpdates: [], orderUpdates: [] };
  const tx: any = {
    shipmentRequest: {
      create: jest.fn(async ({ data }: any) => {
        created.shipments.push(data);
        return { id: 'shp-nuevo', ...data };
      }),
    },
    order: {
      update: jest.fn(async ({ data }: any) => {
        created.orderUpdates.push(data);
        return {};
      }),
    },
    inventoryItem: {
      updateMany: jest.fn(async ({ data }: any) => {
        created.itemUpdates.push(data);
        return { count: 1 };
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        created.movements.push(data);
        return data;
      }),
    },
  };
  const prisma: any = {
    order: {
      findUnique: jest.fn(async () => order),
      update: jest.fn(async ({ data }: any) => {
        created.orderUpdates.push(data);
        return {};
      }),
    },
    inventoryItem: {
      findMany: jest.fn(async () => frozen),
      findUnique: jest.fn(async () => ({
        id: 'item-1',
        status: 'picking',
        listPriceCents: opts.priceResolves === false ? null : 10000,
        card: { rarity: 'Common', set: {} },
      })),
    },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const pricing: any = {
    gradeKeyFor: jest.fn(() => 'nm'),
    getReference: jest.fn(async () => ({ status: 'pending' })),
    computeSalePriceForItem: jest.fn(async () => ({ salePriceCents: null })),
  };
  const svc = new OrdersService(
    prisma as PrismaService,
    pricing as PricingService,
    {} as SettingsService,
    {} as StripeService,
    {} as CatalogService,
  );
  return { svc, prisma, created };
}

describe('POST /admin/orders/:id/chargeback-inventory — `recuperada`', () => {
  it('devuelve la pieza a la venta con `chargeback_return` y cierra la gestión manual', async () => {
    const { svc, created } = build();
    const res = await svc.resolveChargebackInventory('order-1', 'recuperada');
    expect(res).toMatchObject({
      orderId: 'order-1',
      outcome: 'recuperada',
      inventoryItemIds: ['item-1'],
      chargebackNeedsManual: false,
    });
    expect(created.itemUpdates[0]).toMatchObject({
      status: 'listed',
      ownerType: 'platform',
      ownerUserId: null,
      ownershipStatus: null,
    });
    expect(created.movements[0]).toMatchObject({
      fromStatus: 'picking',
      toStatus: 'listed',
      reason: 'chargeback_return',
    });
    expect(created.orderUpdates).toContainEqual({ chargebackNeedsManual: false });
  });

  it('si el precio no resuelve, vuelve a `in_stock` (en Compra nunca se publica sin precio)', async () => {
    const { svc, created } = build({ priceResolves: false });
    await svc.resolveChargebackInventory('order-1', 'recuperada');
    expect(created.itemUpdates[0].status).toBe('in_stock');
  });

  it('sin pieza congelada ⇒ 409 CONFLICT (no hay nada que recuperar)', async () => {
    const { svc } = build({ frozen: [] });
    await expect(svc.resolveChargebackInventory('order-1', 'recuperada')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('POST /admin/orders/:id/chargeback-inventory — `no_recuperada`', () => {
  it('NO mueve inventario: la carta se queda donde está', async () => {
    const { svc, created } = build({ frozen: [{ id: 'item-1', status: 'shipped' }] });
    const res = await svc.resolveChargebackInventory('order-1', 'no_recuperada');
    expect(res.chargebackNeedsManual).toBe(false);
    expect(created.itemUpdates).toHaveLength(0);
    expect(created.movements).toHaveLength(0);
  });

  it('NO marca `lost`/`damaged` (no fue merma de almacén: ensuciaría los reportes de pérdida)', async () => {
    const { svc, created } = build({ frozen: [{ id: 'item-1', status: 'shipped' }] });
    await svc.resolveChargebackInventory('order-1', 'no_recuperada');
    expect(JSON.stringify(created)).not.toContain('lost');
    expect(JSON.stringify(created)).not.toContain('damaged');
  });
});

describe('POST /admin/orders/:id/chargeback-inventory — `reexpedir`', () => {
  it('con la disputa GANADA crea un envío nuevo con la forma del settle (montos en 0, sin userId)', async () => {
    const { svc, created } = build({ order: { status: 'settled', disputeOutcome: 'won' } });
    const res = await svc.resolveChargebackInventory('order-1', 'reexpedir');
    expect(res.shipmentId).toBe('shp-nuevo');
    expect(created.shipments[0]).toMatchObject({
      userId: null,
      orderId: 'order-1',
      status: 'picking',
      shippingFeeCents: 0,
      totalCents: 0,
      addressSnapshot: { city: 'CDMX', recipientName: 'Juan Pérez' },
    });
    expect(created.shipments[0].items.create).toEqual([{ inventoryItemId: 'item-1' }]);
  });

  it('con la orden todavía en `chargeback` ⇒ 409 CONFLICT (no se re-expide lo que no se ganó)', async () => {
    const { svc, created } = build();
    await expect(svc.resolveChargebackInventory('order-1', 'reexpedir')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    expect(created.shipments).toHaveLength(0);
  });

  it('con la disputa PERDIDA tampoco re-expide', async () => {
    const { svc } = build({ order: { status: 'chargeback', disputeOutcome: 'lost' } });
    await expect(svc.resolveChargebackInventory('order-1', 'reexpedir')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });
});

describe('POST /admin/orders/:id/chargeback-inventory — guardas comunes', () => {
  it('pedido inexistente ⇒ 404', async () => {
    const { svc } = build({ order: null });
    await expect(svc.resolveChargebackInventory('nope', 'recuperada')).rejects.toMatchObject({
      code: 'NOT_FOUND',
    });
  });

  it('pedido que no es `direct_ship` ⇒ 400 VALIDATION_ERROR', async () => {
    const { svc } = build({ order: { fulfillmentMode: 'vault' } });
    await expect(svc.resolveChargebackInventory('order-1', 'recuperada')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('IDEMPOTENCIA: repetir un desenlace ya aplicado ⇒ 409 y CERO efectos', async () => {
    const { svc, created } = build({ order: { chargebackNeedsManual: false } });
    for (const outcome of ['recuperada', 'no_recuperada', 'reexpedir'] as const) {
      await expect(svc.resolveChargebackInventory('order-1', outcome)).rejects.toMatchObject({
        code: 'CONFLICT',
      });
    }
    expect(created.itemUpdates).toHaveLength(0);
    expect(created.movements).toHaveLength(0);
    expect(created.shipments).toHaveLength(0);
    expect(created.orderUpdates).toHaveLength(0);
  });
});
