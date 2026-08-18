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
        // Honra las DOS formas de guardia como haría Prisma contra la fila real: escalar
        // (`status: 'reserved'`) y lista (`status: { in: [...] }`). Un mock que ignore la escalar
        // deja pasar justo el bug de T1-b (re-listar una pieza en `picking`).
        const expected = where.status;
        if (expected != null) {
          const matches =
            typeof expected === 'string'
              ? itemState.status === expected
              : Array.isArray(expected.in) && expected.in.includes(itemState.status);
          if (!matches) return { count: 0 };
        }
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
    // Monótono (T1-b): no se escribe `false`; simplemente no se toca el flag.
    expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: undefined });
  });

  it('envío `cancelado` con la pieza en `reserved`: vuelve al inventario (nunca salió del estante)', async () => {
    const { svc, itemState, orderUpdates } = build({
      shipment: { id: 'shp-1', status: 'cancelado' },
      itemStatus: 'reserved',
    });
    await svc.onChargeDispute(dispute);
    expect(itemState.status).toBe('listed');
    // Monótono: no se baja el flag, solo se omite (no había nada que decidir).
    expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: undefined });
  });

  /**
   * T1-b (techlead) — la fila 1 de la tabla normativa autoriza SOLO `reserved → listed`. Una pieza
   * en `picking` pertenece a un pedido LIQUIDADO que el operador ya sacó del estante: que su envío
   * esté `cancelado` NO prueba que la carta volviera a su slot.
   */
  it('T1-b: envío `cancelado` con la pieza en `picking` ⇒ SIGUE CONGELADA (no se re-lista)', async () => {
    const { svc, itemState, itemUpdates, orderUpdates } = build({
      shipment: { id: 'shp-1', status: 'cancelado' },
      itemStatus: 'picking',
    });
    await svc.onChargeDispute(dispute);
    expect(itemState.status).toBe('picking');
    expect(['listed', 'in_stock']).not.toContain(itemState.status);
    expect(itemUpdates).toHaveLength(0);
    // Y el caso sigue exigiendo desenlace humano.
    expect(orderUpdates[0]).toEqual({ status: 'chargeback', chargebackNeedsManual: true });
  });

  /**
   * T1-b — el camino 100% automático que reabría el double-sell: una SEGUNDA disputa (otro
   * `event.id`, así que la idempotencia por evento no la filtra) encontraba el envío ya
   * `cancelado`, caía en la rama de "sin envío" y re-listaba la pieza congelada, borrando además
   * la única señal de que faltaba una decisión humana.
   */
  it('T1-b: una SEGUNDA `charge.dispute.created` no descongela la pieza ni baja el flag', async () => {
    // 1ª disputa: envío vivo ⇒ congela.
    const first = build({ shipment: { id: 'shp-1', status: 'picking' }, itemStatus: 'picking' });
    await first.svc.onChargeDispute(dispute);
    expect(first.orderUpdates[0].chargebackNeedsManual).toBe(true);

    // 2ª disputa: el envío ya está `cancelado` y la pieza congelada.
    const second = build({
      shipment: { id: 'shp-1', status: 'cancelado' },
      itemStatus: 'picking',
      order: { chargebackNeedsManual: true },
    });
    await second.svc.onChargeDispute(dispute);
    expect(second.itemState.status).toBe('picking'); // NO vuelve a la venta
    expect(second.itemUpdates).toHaveLength(0);
    // NUNCA baja: el caso no puede desaparecer de la cola de M3 por un webhook.
    expect(second.orderUpdates[0].chargebackNeedsManual).not.toBe(false);
  });

  it('T1-b: el flag es MONÓTONO — el webhook nunca escribe `false`', async () => {
    for (const scenario of [
      { shipment: { id: 'shp-1', status: 'picking' }, itemStatus: 'picking' },
      { shipment: { id: 'shp-1', status: 'enviado' }, itemStatus: 'shipped' },
      { shipment: null, itemStatus: 'reserved' },
      { shipment: { id: 'shp-1', status: 'cancelado' }, itemStatus: 'picking' },
    ]) {
      const { svc, orderUpdates } = build(scenario as never);
      await svc.onChargeDispute(dispute);
      expect(orderUpdates[0].chargebackNeedsManual).not.toBe(false);
    }
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
