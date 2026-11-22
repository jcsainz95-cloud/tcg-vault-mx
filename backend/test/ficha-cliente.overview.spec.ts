/**
 * §FICHA-CLIENTE §1 — `CustomerOverviewService` (unitario): sumas, estados, valor de bóveda con piezas sin precio,
 * número CONSTANTE de consultas (sin N+1) y candado de claves (lista blanca R-1).
 */
import { CustomerOverviewService } from '../src/modules/admin/customer-overview.service';

const D = (s: string) => new Date(s);

function build(opts: { pieces: number; priced: Record<string, { c: number; d: string }>; shipments?: number; role?: string } = { pieces: 0, priced: {} }) {
  const calls: string[] = [];
  const spy = <T>(name: string, v: T) => jest.fn(async () => (calls.push(name), v));
  const nShip = opts.shipments ?? 0;
  const tx: any = {
    user: { findUnique: spy('user', { role: opts.role ?? 'customer', createdAt: D('2026-01-01T00:00:00Z'), wishlistAlertsPausedAt: D('2026-05-01T00:00:00Z'), _count: { wishlistItems: 4 } }) },
    order: {
      groupBy: spy('order.groupBy', [
        { status: 'settled', _count: { _all: 2 }, _sum: { totalCents: 15000 }, _max: { settledAt: D('2026-11-01T10:00:00Z') } },
        { status: 'pending', _count: { _all: 1 }, _sum: { totalCents: 777 }, _max: { settledAt: null } },
        { status: 'failed', _count: { _all: 3 }, _sum: { totalCents: 5 }, _max: { settledAt: null } },
      ]),
    },
    sellRequest: {
      groupBy: spy('sell.groupBy', [
        { status: 'pagada', _count: { _all: 2 }, _sum: { approvedTotalCents: 9500 }, _max: { createdAt: D('2026-10-10T00:00:00Z') } },
        { status: 'recibida', _count: { _all: 1 }, _sum: { approvedTotalCents: null }, _max: { createdAt: D('2026-11-10T00:00:00Z') } },
        { status: 'aprobada', _count: { _all: 1 }, _sum: { approvedTotalCents: 3500 }, _max: { createdAt: D('2026-09-10T00:00:00Z') } },
        { status: 'ofertada', _count: { _all: 1 }, _sum: { approvedTotalCents: null }, _max: { createdAt: D('2026-08-10T00:00:00Z') } },
      ]),
      findMany: spy('sell.open', [
        { approvedTotalCents: null, quotedTotalCents: 3000 },
        { approvedTotalCents: 3500, quotedTotalCents: 4000 },
        { approvedTotalCents: null, quotedTotalCents: 500 },
      ]),
    },
    shipmentRequest: {
      groupBy: spy('ship.groupBy', [
        { status: 'picking', _count: { _all: 1 } },
        { status: 'enviado', _count: { _all: 2 } },
        { status: 'entregado', _count: { _all: 5 } },
        { status: 'cancelado', _count: { _all: 1 } },
      ]),
      findMany: spy(
        'ship.rows',
        Array.from({ length: nShip }, (_, i) => ({
          id: `s${i}`, status: 'enviado', orderId: i % 2 ? 'o1' : null, order: i % 2 ? { orderNumber: 'N1' } : null, totalCents: 100, carrier: 'X', trackingNumber: 'T', trackingUrl: null,
          requestedAt: D('2026-11-01T00:00:00Z'), shippedAt: null, deliveredAt: null, _count: { items: 2 },
        })),
      ),
    },
    dispute: { groupBy: spy('dispute.groupBy', [{ status: 'abierta', _count: { _all: 1 } }, { status: 'en_revision', _count: { _all: 2 } }, { status: 'rechazada', _count: { _all: 4 } }]) },
    paymentRefund: {
      groupBy: spy('pr.groupBy', [
        { status: 'succeeded', _count: { _all: 2 }, _sum: { amountCents: 1000 } },
        { status: 'requested', _count: { _all: 1 }, _sum: { amountCents: 200 } },
        { status: 'submitted', _count: { _all: 1 }, _sum: { amountCents: 50 } },
        { status: 'failed', _count: { _all: 1 }, _sum: { amountCents: 9999 } },
      ]),
      findMany: spy('pr.rows', [{ id: 'p1', status: 'succeeded', amountCents: 1000, orderId: 'o1', createdAt: D('2026-11-03T00:00:00Z') }]),
    },
    manualRefund: {
      groupBy: spy('mr.groupBy', [
        { status: 'paid', _count: { _all: 1 }, _sum: { amountCents: 300 } },
        { status: 'pending', _count: { _all: 2 }, _sum: { amountCents: 95 } },
        { status: 'cancelled', _count: { _all: 1 }, _sum: { amountCents: 7777 } },
      ]),
      findMany: spy('mr.rows', [{ id: 'm1', status: 'paid', amountCents: 300, orderId: null, createdAt: D('2026-11-05T00:00:00Z') }]),
    },
    inventoryItem: { findMany: spy('items', Array.from({ length: opts.pieces }, (_, i) => ({ id: `i${i}`, cardId: 'c' }))) },
  };
  const prisma: any = { $transaction: jest.fn(async (fn: any) => fn(tx)) };
  const patrimony: any = {
    valuePieces: jest.fn(async (items: { id: string }[]) => {
      const m = new Map();
      for (const it of items) m.set(it.id, opts.priced[it.id] ? { status: 'priced', referenceMxnCents: opts.priced[it.id].c, capturedDate: opts.priced[it.id].d } : { status: 'pending' });
      return m;
    }),
  };
  return { svc: new CustomerOverviewService(prisma, patrimony), calls, prisma, patrimony };
}

describe('CustomerOverviewService.overview', () => {
  it('totales de vida, atención y refunds según el contrato', async () => {
    const o = await build().svc.overview('u1');
    expect(o.summary.lifetime).toEqual({
      purchasesCount: 2,
      purchasesCents: 15000,
      refundedCents: 1000 + 300, // succeeded + paid; ni failed, ni pending, ni cancelled
      salesPaidCount: 2,
      salesPaidCents: 9500,
      salesInProgressCents: 3000 + 3500 + 500, // aprobado ?? cotizado
    });
    expect(o.attention).toEqual({
      ordersPending: 1,
      shipmentsOpen: 3, // picking + enviado; ni entregado ni cancelado
      sellRequestsOpen: 3,
      sellRequestsNeedingStore: 2, // recibida + aprobada
      disputesOpen: 3, // abierta + en_revision
      refundsOpen: 2 + 2, // requested+submitted, y SPEI pending
    });
    expect(o.totals).toEqual({ orders: 6, sellRequests: 5, disputes: 7, ownedItems: 0 });
    expect(o.summary).toMatchObject({ customerSince: '2026-01-01T00:00:00.000Z', lastOrderAt: '2026-11-01T10:00:00.000Z', lastSellRequestAt: '2026-11-10T00:00:00.000Z' });
    expect(o.shipments.total).toBe(9);
    expect(o.refunds.total).toBe(5 + 4);
    expect(o.refunds.items.map((r) => `${r.channel}:${r.id}`)).toEqual(['spei:m1', 'card:p1']); // mezclados por fecha desc
    expect(o.wishlist).toEqual({ itemCount: 4, alertsPaused: true });
  });

  it('bóveda: suma SOLO las piezas con precio; asOf = fecha más antigua; ninguna con precio ⇒ null (jamás 0)', async () => {
    const mixed = await build({ pieces: 3, priced: { i0: { c: 1000, d: '2026-11-20' }, i2: { c: 550, d: '2026-11-10' } } }).svc.overview('u1');
    expect(mixed.vault).toEqual({ piecesCount: 3, valueCents: 1550, pricedCount: 2, asOf: '2026-11-10' });
    const none = await build({ pieces: 2, priced: {} }).svc.overview('u1');
    expect(none.vault).toEqual({ piecesCount: 2, valueCents: null, pricedCount: 0, asOf: null });
    const empty = await build({ pieces: 0, priced: {} }).svc.overview('u1');
    expect(empty.vault.valueCents).toBeNull();
  });

  it('shipments: modo por orderId y trackingUrl solo la guardada', async () => {
    const o = await build({ pieces: 0, priced: {}, shipments: 2 }).svc.overview('u1');
    expect(o.shipments.items.map((s) => s.mode)).toEqual(['withdrawal', 'direct_ship']);
    expect(o.shipments.items[1]).toMatchObject({ orderNumber: 'N1', itemsCount: 2, trackingUrl: null });
  });

  it('SIN N+1: las consultas son las mismas con 1 o con 200 piezas/envíos', async () => {
    const small = build({ pieces: 1, priced: {}, shipments: 1 });
    const big = build({ pieces: 200, priced: {}, shipments: 5 });
    await small.svc.overview('u1');
    await big.svc.overview('u1');
    expect(big.calls).toEqual(small.calls);
    expect(big.patrimony.valuePieces).toHaveBeenCalledTimes(1);
    expect(big.prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('inexistente o proveedor ⇒ 404', async () => {
    await expect(build({ pieces: 0, priced: {}, role: 'supplier' }).svc.overview('u1')).rejects.toMatchObject({ status: 404 });
  });

  it('candado de claves: ninguna llave prohibida en el cuerpo', async () => {
    const o = await build({ pieces: 1, priced: { i0: { c: 1, d: '2026-01-01' } }, shipments: 2 }).svc.overview('u1');
    const keys: string[] = [];
    const walk = (v: unknown) => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) (keys.push(k), walk(x));
    };
    walk(o);
    expect(keys.filter((k) => /address|clabe|rfc|stripe|idempotency|ine|snapshot|note|passwordHash|email|phone/i.test(k))).toEqual([]);
  });
});
