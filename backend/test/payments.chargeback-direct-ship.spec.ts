import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';

/**
 * v1.21.2 (T1) — CONTRACARGO de un pedido `direct_ship`. Tabla normativa de API_CONTRACT §4-G.6 /
 * ARCHITECTURE §4.21c-bis: **el envío manda**. Un caso por fila (§4.21h, casos i–iv y vii).
 *
 * El bug que estas pruebas impiden que vuelva: con el envío en `picking`/`guia` el item volvía a
 * `listed` mientras el envío seguía en la cola de picking ⇒ la MISMA pieza única podía venderse a
 * un segundo comprador mientras el operador la metía en la caja del contracargo.
 */
function build(opts: {
  shipment?: { id: string; status: string } | null;
  itemStatus?: string;
  order?: Record<string, unknown>;
}) {
  const itemState = { id: 'item-1', status: opts.itemStatus ?? 'picking' };
  const shipmentUpdates: any[] = [];
  const itemUpdates: any[] = [];
  const movements: any[] = [];
  const orderUpdates: any[] = [];
  const tx: any = {
    order: {
      update: jest.fn(async ({ data }: any) => {
        orderUpdates.push(data);
        return {};
      }),
    },
    shipmentRequest: {
      findFirst: jest.fn(async () => opts.shipment ?? null),
      update: jest.fn(async ({ where, data }: any) => {
        shipmentUpdates.push({ where, data });
        return {};
      }),
    },
    inventoryItem: {
      findUnique: jest.fn(async () => ({ ...itemState })),
      update: jest.fn(async ({ data }: any) => {
        itemUpdates.push(data);
        Object.assign(itemState, data);
        return {};
      }),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const ok = where.status?.in ? where.status.in.includes(itemState.status) : true;
        if (!ok) return { count: 0 };
        itemUpdates.push(data);
        Object.assign(itemState, data);
        return { count: 1 };
      }),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        movements.push(data);
        return data;
      }),
    },
    shipmentItem: { findFirst: jest.fn(async () => null) },
  };
  const order = {
    id: 'order-1',
    orderNumber: 'TCG-000123',
    fulfillmentMode: 'direct_ship',
    status: 'settled',
    settledAt: new Date(),
    items: [{ inventoryItemId: 'item-1' }],
    ...(opts.order ?? {}),
  };
  const prisma: any = {
    order: { findUnique: jest.fn(async () => order), update: jest.fn(async () => ({})) },
    processedStripeEvent: { create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const svc = new PaymentsService(
    prisma as PrismaService,
    {} as StripeService,
    { sendConfirmation: jest.fn() } as unknown as GuestOrderMailService,
    { log: jest.fn() } as unknown as AuditService,
  );
  return { svc, prisma, tx, itemState, shipmentUpdates, itemUpdates, movements, orderUpdates };
}

const dispute = { payment_intent: 'pi_1' } as never;

describe('Contracargo direct_ship — envío NO terminal ⇒ congelar (casos i y ii de §4.21h)', () => {
  it.each([['picking'], ['guia'], ['solicitado']])(
    'envío en `%s`: el envío pasa a `cancelado` y la pieza NO se re-lista',
    async (status) => {
      const { svc, itemState, shipmentUpdates, itemUpdates, orderUpdates } = build({
        shipment: { id: 'shp-1', status },
        itemStatus: 'picking',
      });
      await svc.onChargeDispute(dispute);

      // El envío sale de la cola de picking EN LA MISMA transacción.
      expect(shipmentUpdates).toEqual([{ where: { id: 'shp-1' }, data: { status: 'cancelado' } }]);
      // La pieza queda CONGELADA: ni un solo write sobre el inventario.
      expect(itemUpdates).toHaveLength(0);
      expect(itemState.status).toBe('picking');
      // Assert explícito exigido por §4.21h: NUNCA vuelve a estar comprable.
      expect(['listed', 'in_stock']).not.toContain(itemState.status);
      // Y el caso queda escalado a un humano.
      expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: true });
    },
  );

  it('no registra movimiento de inventario al congelar (no pasó nada físico todavía)', async () => {
    const { svc, movements } = build({ shipment: { id: 'shp-1', status: 'picking' } });
    await svc.onChargeDispute(dispute);
    expect(movements).toHaveLength(0);
  });
});

describe('Contracargo direct_ship — envío ya salido (caso iii de §4.21h)', () => {
  it.each([['enviado'], ['entregado']])(
    'envío en `%s`: no se toca inventario ni envío, y queda gestión manual',
    async (status) => {
      const { svc, itemUpdates, shipmentUpdates, orderUpdates } = build({
        shipment: { id: 'shp-1', status },
        itemStatus: status === 'enviado' ? 'shipped' : 'delivered',
      });
      await svc.onChargeDispute(dispute);
      expect(itemUpdates).toHaveLength(0);
      expect(shipmentUpdates).toHaveLength(0);
      expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: true });
    },
  );
});

describe('Contracargo direct_ship — sin envío o envío cancelado (caso iv de §4.21h)', () => {
  it('orden `pending` sin envío: `reserved → listed` + `chargeback_return` y NO requiere humano', async () => {
    const { svc, itemState, itemUpdates, movements, orderUpdates } = build({
      shipment: null,
      itemStatus: 'reserved',
      order: { status: 'pending' },
    });
    await svc.onChargeDispute(dispute);
    expect(itemState.status).toBe('listed');
    expect(itemUpdates[0]).toMatchObject({
      status: 'listed',
      ownerType: 'platform',
      ownerUserId: null,
      ownershipStatus: null,
    });
    expect(movements[0]).toMatchObject({ toStatus: 'listed', reason: 'chargeback_return' });
    expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: false });
  });

  it('envío ya `cancelado`: la pieza vuelve al inventario (su envío ya no está vivo)', async () => {
    const { svc, itemState, orderUpdates } = build({
      shipment: { id: 'shp-1', status: 'cancelado' },
      itemStatus: 'picking',
    });
    await svc.onChargeDispute(dispute);
    expect(itemState.status).toBe('listed');
    expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: false });
  });
});

describe('Cierre de la disputa — ganar NO re-expide solo (caso vii de §4.21h)', () => {
  function buildClosed(fulfillmentMode: string, needsManual = true) {
    const updates: any[] = [];
    const prisma: any = {
      order: {
        findUnique: jest.fn(async () => ({
          id: 'order-1',
          fulfillmentMode,
          status: 'chargeback',
          settledAt: new Date(),
          chargebackNeedsManual: needsManual,
        })),
        update: jest.fn(async ({ data }: any) => {
          updates.push(data);
          return {};
        }),
      },
    };
    const svc = new PaymentsService(
      prisma as PrismaService,
      {} as StripeService,
      {} as GuestOrderMailService,
      { log: jest.fn() } as unknown as AuditService,
    );
    return { svc, updates };
  }

  it('`direct_ship` + won: vuelve a `settled` pero MANTIENE `chargebackNeedsManual`', async () => {
    const { svc, updates } = buildClosed('direct_ship');
    await svc.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'won' } as never, 'won');
    expect(updates[0]).toMatchObject({ status: 'settled', disputeOutcome: 'won' });
    // NO se limpia: el envío original fue cancelado y la pieza sigue congelada. Re-expedir lo
    // decide un humano con POST /admin/orders/:id/chargeback-inventory.
    expect(updates[0].chargebackNeedsManual).toBeUndefined();
  });

  it('`direct_ship` + lost: tampoco limpia el flag (la pieza congelada necesita desenlace)', async () => {
    const { svc, updates } = buildClosed('direct_ship');
    await svc.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'lost' } as never);
    expect(updates[0]).toMatchObject({ status: 'chargeback', disputeOutcome: 'lost' });
    expect(updates[0].chargebackNeedsManual).toBeUndefined();
  });

  it('`vault`: comportamiento v1.21 sin regresión (el flag se limpia)', async () => {
    const { svc, updates } = buildClosed('vault');
    await svc.onChargeDisputeClosed({ payment_intent: 'pi_1', status: 'won' } as never, 'won');
    expect(updates[0]).toMatchObject({ status: 'settled', chargebackNeedsManual: false });
  });
});

describe('D4 — el contracargo ramifica por `fulfillmentMode`, no por la forma de los datos', () => {
  it('un `fulfillmentMode` no soportado LANZA (nunca aplica el reverso de otra ruta)', async () => {
    const { svc } = build({ order: { fulfillmentMode: 'pickup_in_store' } });
    await expect(svc.onChargeDispute(dispute)).rejects.toThrow(/Unsupported fulfillmentMode/);
  });
});
