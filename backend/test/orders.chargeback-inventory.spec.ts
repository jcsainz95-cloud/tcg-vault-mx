import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.21.2 (T1, §M3 / ARCHITECTURE §4.21c-bis) — DESENLACE HUMANO de una pieza congelada por un
 * contracargo con envío vivo (caso vi de §4.21h). Sin este endpoint la pieza congelada se queda
 * congelada para siempre; con él, quien decide es el operador que mira el estante, no una
 * heurística de estados.
 */
function build(
  opts: {
    order?: Record<string, unknown> | null;
    frozen?: { id: string; status: string }[];
    priceResolves?: boolean;
    /** Estado compartido del flag, para simular DOS llamadas concurrentes sobre la misma orden. */
    shared?: { needsManual: boolean };
    activeShipment?: unknown;
  } = {},
) {
  const shared = opts.shared ?? {
    needsManual: (opts.order?.chargebackNeedsManual as boolean | undefined) ?? true,
  };
  const order =
    opts.order === null
      ? null
      : {
          id: 'order-1',
          orderNumber: 'TCG-000123',
          fulfillmentMode: 'direct_ship',
          status: 'chargeback',
          disputeOutcome: null,
          shippingAddressSnapshot: { city: 'CDMX', recipientName: 'Juan Pérez' },
          items: [{ inventoryItemId: 'item-1' }],
          ...(opts.order ?? {}),
        };
  const frozen = opts.frozen ?? [{ id: 'item-1', status: 'picking' }];
  const created: any = { shipments: [], movements: [], itemUpdates: [], claims: 0 };

  // TODO el flujo corre DENTRO de una transacción: el doble de `tx` es el que importa.
  const tx: any = {
    order: {
      findUnique: jest.fn(async () => order),
      // CLAIM atómico: `updateMany` con `chargebackNeedsManual: true` solo puede ganar UNA vez
      // (mismo patrón que la reserva de piezas únicas).
      updateMany: jest.fn(async ({ where }: any) => {
        created.claims += 1;
        if (where.chargebackNeedsManual === true && !shared.needsManual) return { count: 0 };
        shared.needsManual = false;
        return { count: 1 };
      }),
    },
    inventoryItem: {
      findMany: jest.fn(async () => frozen),
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
    shipmentRequest: {
      findFirst: jest.fn(async () => opts.activeShipment ?? null),
      create: jest.fn(async ({ data }: any) => {
        created.shipments.push(data);
        return { id: `shp-nuevo-${created.shipments.length}`, ...data };
      }),
    },
  };
  const prisma: any = {
    // La transacción REVIERTE al lanzar: se simula restaurando el flag reclamado.
    $transaction: jest.fn(async (cb: any) => {
      const before = shared.needsManual;
      try {
        return await cb(tx);
      } catch (e) {
        shared.needsManual = before;
        created.itemUpdates.length = 0;
        created.movements.length = 0;
        created.shipments.length = 0;
        throw e;
      }
    }),
    inventoryItem: {
      findUnique: jest.fn(async () => ({
        id: 'item-1',
        status: 'picking',
        listPriceCents: opts.priceResolves === false ? null : 10000,
        card: { rarity: 'Common', set: {} },
      })),
    },
  };
  const pricing: any = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
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
  return { svc, prisma, tx, created, shared };
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
    // El flag se reclamó (true→false) DENTRO de la transacción, no después.
    expect(created.claims).toBe(1);
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
    expect(res.shipmentId).toBe('shp-nuevo-1');
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
  });

  /**
   * Techlead — el guard se leía FUERA de la transacción y se escribía DENTRO: dos llamadas
   * concurrentes (doble submit; el endpoint no lleva Idempotency-Key) pasaban ambas, y `reexpedir`
   * creaba DOS `ShipmentRequest` para la misma orden, rompiendo «a lo más un envío activo por
   * orden» (§4-G.10) y duplicando la pieza en `pickingList()`.
   */
  it('ATOMICIDAD: dos `reexpedir` concurrentes ⇒ solo UNO crea envío; el otro recibe 409', async () => {
    const shared = { needsManual: true };
    const wonOrder = { status: 'settled', disputeOutcome: 'won' };
    const a = build({ order: wonOrder, shared });
    const b = build({ order: wonOrder, shared });

    const [resA, resB] = await Promise.allSettled([
      a.svc.resolveChargebackInventory('order-1', 'reexpedir'),
      b.svc.resolveChargebackInventory('order-1', 'reexpedir'),
    ]);
    const fulfilled = [resA, resB].filter((r) => r.status === 'fulfilled');
    const rejected = [resA, resB].filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'CONFLICT' });
    // UN solo envío entre ambas llamadas.
    expect(a.created.shipments.length + b.created.shipments.length).toBe(1);
  });

  it('un desenlace RECHAZADO no consume la decisión (la transacción revierte el claim)', async () => {
    const shared = { needsManual: true };
    const { svc } = build({ shared }); // orden aún en `chargeback` ⇒ `reexpedir` inválido
    await expect(svc.resolveChargebackInventory('order-1', 'reexpedir')).rejects.toMatchObject({
      code: 'CONFLICT',
    });
    // El flag vuelve a `true`: el operador todavía puede resolverlo con el desenlace correcto.
    expect(shared.needsManual).toBe(true);
  });
});
