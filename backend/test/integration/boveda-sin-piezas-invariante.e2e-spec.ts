/**
 * boveda-sin-piezas-invariante.e2e-spec.ts — §BOVEDA-COBRADA-SIN-PIEZAS, criterio 1: tras CUALQUIER secuencia de
 * {reservar, vencer/barrer, `succeeded`, `succeeded` repetido, segundo comprador, sustitución, reembolso}:
 *   «pedido de bóveda `settled` ⇒ cada pieza suya está `in_custody`, de ESE comprador, y ningún otro pedido liquidado la reclama»
 * (o la línea quedó «requiere atención»: visible, ⛔ nunca «liquidada normal» sin pieza), y cada pieza tiene EXACTAMENTE un dueño.
 * ≥ 200 secuencias aleatorias de semilla fija contra Postgres real. 0 movimientos de dinero.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { PaymentsService } from '../../src/modules/payments/payments.service';
import { OrdersService } from '../../src/modules/orders/orders.service';

const RUN = Date.now().toString(36);
const SEQUENCES = 250;
const SEED = 20261125;

/** mulberry32: PRNG determinista (semilla fija ⇒ la misma batería en cada corrida). */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('§BOVEDA-COBRADA-SIN-PIEZAS — criterio 1: la invariante en ≥ 200 secuencias aleatorias', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, RUN);
    await fx.init();
  });
  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await h.close();
    }
  });

  it(`${SEQUENCES} secuencias (semilla ${SEED}): la invariante y «un solo dueño» se cumplen siempre; 0 dinero`, async () => {
    h.stripe.cancelOutcome = 'canceled';
    const payments = h.app.get(PaymentsService);
    const orders = h.app.get(OrdersService);
    const rnd = rng(SEED);
    const pick = <T,>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)];
    const failures: string[] = [];
    const allOrderIds: string[] = [];
    const opCount: Record<string, number> = {};
    let settledSeen = 0;
    let attentionSeen = 0;

    for (let s = 0; s < SEQUENCES; s += 1) {
      const u1 = await fx.user('p1');
      const u2 = await fx.user('p2');
      const cx = await fx.card('px');
      const cy = await fx.card('py');
      const pieces = [await fx.piece(cx.id), await fx.piece(cx.id), await fx.piece(cy.id)];
      if (rnd() < 0.5) pieces.push(await fx.piece(cx.id)); // una copia equivalente de reserva
      const ords: { id: string; pi: string; userId: string }[] = [];
      const mkOrder = async (userId: string, ps: { id: string }[]) => {
        const o = await fx.order({ userId, pieces: ps });
        ords.push({ id: o.order.id, pi: o.pi as string, userId });
        allOrderIds.push(o.order.id);
        return o;
      };
      await mkOrder(u1.id, [pieces[0], pieces[2]]);
      await mkOrder(u1.id, [pieces[1]]);
      const ops: string[] = [];
      const steps = 4 + Math.floor(rnd() * 6);
      for (let k = 0; k < steps; k += 1) {
        const op = pick(['expire', 'pay', 'pay', 'payTwice', 'rival', 'supersede', 'refund', 'retry']);
        ops.push(op);
        opCount[op] = (opCount[op] ?? 0) + 1;
        try {
          if (op === 'expire') {
            await h.prisma.inventoryItem.updateMany({ where: { id: { in: pieces.map((p) => p.id) }, status: 'reserved' }, data: { reservedUntil: new Date(Date.now() - 1000) } });
            await orders.sweepExpiredReservations();
          } else if (op === 'pay' || op === 'payTwice') {
            const o = pick(ords);
            const pi = { id: o.pi, amount: 100, amount_received: 100, currency: 'mxn' } as never;
            await payments.onPaymentSucceeded(pi);
            if (op === 'payTwice') await payments.onPaymentSucceeded(pi);
          } else if (op === 'rival') {
            const free = await h.prisma.inventoryItem.findMany({ where: { id: { in: pieces.map((p) => p.id) }, status: 'listed' } });
            if (free.length > 0) await mkOrder(u2.id, [pick(free)]);
          } else if (op === 'retry') {
            const free = await h.prisma.inventoryItem.findMany({ where: { id: { in: pieces.map((p) => p.id) }, status: 'listed' } });
            if (free.length > 0) await mkOrder(u1.id, [pick(free)]);
          } else if (op === 'supersede') {
            // La sustitución del mismo cliente: la vieja `pending` pasa a `failed`, suelta, y la nueva retiene (la carrera de la causa raíz).
            const old = pick(ords.filter((o) => o.userId === u1.id));
            const row = await h.prisma.order.findUniqueOrThrow({ where: { id: old.id }, include: { items: true } });
            if (row.status === 'pending') {
              await h.prisma.order.update({ where: { id: old.id }, data: { status: 'failed' } });
              await h.prisma.inventoryItem.updateMany({
                where: { reservedByOrderId: old.id, status: 'reserved' },
                data: { status: 'listed', ownerType: 'platform', ownerUserId: null, ownershipStatus: null, reservedByOrderId: null, reservedUntil: null },
              });
              await mkOrder(u1.id, row.items.map((i) => ({ id: i.inventoryItemId })));
            }
          } else if (op === 'refund') {
            const settled = await h.prisma.order.findMany({ where: { id: { in: ords.map((o) => o.id) }, status: 'settled' }, include: { items: true } });
            if (settled.length > 0) {
              const o = pick(settled);
              await h.prisma.order.update({ where: { id: o.id }, data: { status: 'refunded' } });
              await h.prisma.inventoryItem.updateMany({
                where: { id: { in: o.items.map((i) => i.inventoryItemId) }, ownerUserId: o.userId, status: 'in_custody' },
                data: { status: 'listed', ownerType: 'platform', ownerUserId: null, ownershipStatus: null },
              });
            }
          }
        } catch (e) {
          failures.push(`seq ${s} (${ops.join('>')}): la operación ${op} lanzó ${(e as Error).message}`);
        }
      }
      // Cada pieza de esta secuencia (incluidas las copias que la reposición tomó) + todos sus pedidos.
      const v = [...(await fx.violations(ords.map((o) => o.id)))];
      const settledRows = await h.prisma.order.findMany({ where: { id: { in: ords.map((o) => o.id) }, status: 'settled' }, include: { items: true } });
      settledSeen += settledRows.length;
      attentionSeen += settledRows.flatMap((o) => o.items).filter((l) => l.fulfillmentFailedAt).length;
      if (v.length > 0) failures.push(`seq ${s} (${ops.join('>')}): ${v.join(' | ')}`);
    }
    const owners = await fx.ownerViolations();
    expect(failures.slice(0, 5)).toEqual([]);
    expect(owners.slice(0, 5)).toEqual([]);
    expect(await h.prisma.paymentRefund.count({ where: { orderId: { in: allOrderIds } } })).toBe(0);
    expect(h.stripe.refundCreateCalls).toHaveLength(0);
    // La batería ejercitó de verdad lo que se mide (si no, el verde no diría nada).
    expect(settledSeen).toBeGreaterThan(SEQUENCES / 2);
    expect(Object.keys(opCount).length).toBe(7);
    // eslint-disable-next-line no-console
    console.log(`INVARIANTE: ${SEQUENCES - new Set(failures.map((f) => f.split(' ')[1])).size}/${SEQUENCES} secuencias OK · pedidos liquidados ${settledSeen} · líneas «requiere atención» ${attentionSeen} · ops ${JSON.stringify(opCount)}`);
  }, 900_000);
});
