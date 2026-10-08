/**
 * accessories-lock-order.e2e-spec.ts — 💰 **C-1 de los gates de §AC sobre `dd26ae79`** (BACKEND_NOTES §83.gates):
 * orden de candados de `Accessory` entre los verbos de `accessory-stock.ts`, contra Postgres REAL.
 * Propiedad: backend.
 *
 * ## El defecto (reproducido por QA 10/10 con entrelazado forzado)
 * `reserveAccessories` bloquea los accesorios por `accessoryId` ASCENDENTE (ARCHITECTURE §4.AC (e)). `settleAccessories`
 * (camino `reserved` y recuperación `released`) y `restockAccessoriesOnFullRefund` los bloqueaban **renglón por
 * renglón** (orden de `OrderAccessoryLine.id`), y solo ordenaban DENTRO de cada renglón. Con dos renglones de ids
 * cruzados —L1 (id menor) toca B, L2 (id mayor) toca A, A < B— el verbo pedía B y luego A; una compra que aparta A y B
 * pedía A y luego B ⇒ interbloqueo `40P01` y Postgres mata a una de las dos (si muere el settle, Stripe reintenta; si
 * muere la compra, el cliente ve un 500).
 *
 * ## El entrelazado se FUERZA (helpers/row-lock-barrier.ts — nada de `sleep`)
 * ```
 * tercera conexión:  BEGIN; SELECT … FROM "Accessory" WHERE id = B FOR UPDATE   ⇐ B retenida
 * verbo:             (settle/restock del pedido 1) … se bloquea en B            ⇐ comprobado en pg_stat_activity
 *                     · antes del arreglo: sin tener A (lo pide DESPUÉS de B)
 *                     · con el arreglo:    teniendo A (bloqueó {A,B} de una vez, id asc.)
 * compra:            reserveAccessories(pedido 2, {A,B}) … se bloquea            ⇐ comprobado (2 bloqueadas)
 *                     · antes: teniendo A, esperando B  ⇒ al soltar B: ciclo ⇒ 40P01
 *                     · con el arreglo: esperando A      ⇒ al soltar B: el verbo termina y la compra sigue
 * tercera conexión:  COMMIT
 * ```
 * Medido N=`ACL_N` (10 por defecto) rondas por verbo; la proporción se imprime (`[AC-LOCK …] k/N`).
 * Antes del arreglo: 40P01 en N/N de cada verbo. Después: 0/N.
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { diferida, esperarBloqueoDeFila } from './helpers/row-lock-barrier';
import { reserveAccessories, restockAccessoriesOnFullRefund, settleAccessories } from '../../src/modules/orders/accessory-stock';
import type { PrismaService } from '../../src/prisma/prisma.service';

jest.setTimeout(180_000);

const N = Number(process.env.ACL_N ?? 10);
type Verb = 'settle_reserved' | 'settle_recovery' | 'restock';

describe('💰 C-1 · orden de candados de Accessory (settle / recuperación / reposición vs apartar) — Postgres real', () => {
  const db = new PrismaClient();
  const locker = new PrismaClient();
  const made = { accessories: [] as string[], orders: [] as string[] };

  afterAll(async () => {
    const o = made.orders;
    const a = made.accessories;
    await db.$executeRaw`DELETE FROM "ShipmentAccessoryLine" WHERE "shipmentRequestId" IN (SELECT id FROM "ShipmentRequest" WHERE "orderId" = ANY(${o}::text[]))`;
    await db.$executeRaw`DELETE FROM "AccessoryStockMovement" WHERE "accessoryId" = ANY(${a}::text[])`;
    await db.$executeRaw`DELETE FROM "OrderAccessoryLine" WHERE "orderId" = ANY(${o}::text[])`;
    await db.$executeRaw`DELETE FROM "ShipmentRequest" WHERE "orderId" = ANY(${o}::text[])`;
    await db.$executeRaw`DELETE FROM "Order" WHERE id = ANY(${o}::text[])`;
    await db.$executeRaw`DELETE FROM "Accessory" WHERE id = ANY(${a}::text[])`;
    await db.$disconnect();
    await locker.$disconnect();
  });

  const sorted2 = (): [string, string] => {
    const [x, y] = [randomUUID(), randomUUID()].sort();
    return [x, y];
  };

  async function mkOrder(tag: string) {
    const o = await db.order.create({
      data: {
        guestEmail: `acl.${tag}.${randomUUID()}@e2e.local`,
        fulfillmentMode: 'direct_ship',
        status: 'pending',
        subtotalCents: 200,
        shippingFeeCents: 0,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents: 200,
        priceConvention: 'IVA_INCLUSIVE',
        shippingAddressSnapshot: { line1: 'x' },
      } as never,
    });
    made.orders.push(o.id);
    return o.id;
  }

  /** Una ronda: A < B; pedido 1 con L1 (id menor) → B y L2 (id mayor) → A en el estado que el verbo consume. */
  async function round(verb: Verb): Promise<string> {
    const [A, B] = sorted2();
    const reservedQty = verb === 'settle_reserved' ? 1 : 0;
    for (const id of [A, B]) {
      await db.$executeRawUnsafe(
        `INSERT INTO "Accessory" (id, name, category, "stockQty", "reservedQty", "priceCents", "updatedAt") VALUES ($1, 'ACL', 'sleeves', 10, $2, 100, now())`,
        id,
        reservedQty,
      );
      made.accessories.push(id);
    }
    const order1 = await mkOrder('o1');
    const order2 = await mkOrder('o2');
    const [L1, L2] = sorted2();
    const status = verb === 'settle_reserved' ? 'reserved' : verb === 'settle_recovery' ? 'released' : 'sold';
    for (const [lid, acc] of [
      [L1, B],
      [L2, A],
    ]) {
      await db.$executeRawUnsafe(
        `INSERT INTO "OrderAccessoryLine" (id, "orderId", kind, "accessoryId", quantity, "unitPriceCents", snapshot, status, "reservedUntil", "soldAt")
         VALUES ($1, $2, 'accessory', $3, 1, 100, '{}'::jsonb, $4::"AccessoryLineStatus", now() + interval '1 hour', $5)`,
        lid,
        order1,
        acc,
        status,
        status === 'sold' ? new Date() : null,
      );
    }
    const sr = await db.shipmentRequest.create({
      data: { orderId: order1, addressSnapshot: { line1: 'x' }, status: 'picking', pickingAt: new Date(), shippingFeeCents: 0, priceConvention: 'IVA_INCLUSIVE' } as never,
    });

    // Tercera conexión: retiene B.
    const held = diferida();
    const done = diferida();
    const lockerTx = locker.$transaction(
      async (lt) => {
        await lt.$queryRaw`SELECT id FROM "Accessory" WHERE id = ${B} FOR UPDATE`;
        held.abrir();
        await done.promesa;
      },
      { timeout: 60_000 },
    );
    await held.promesa;

    const tag = (who: string) => (e: unknown) => {
      const msg = String((e as { message?: string })?.message ?? e);
      return `${who}:${/40P01|deadlock/i.test(msg) ? '40P01' : msg.slice(0, 80)}`;
    };
    const verbP = db
      .$transaction<unknown>(
        (tx) =>
          verb === 'restock'
            ? restockAccessoriesOnFullRefund(tx, order1, new Date())
            : settleAccessories(tx, { id: order1, orderNumber: null }, sr.id, new Date()),
        { timeout: 60_000 },
      )
      .then(() => `${verb}:ok`, tag(verb));
    await esperarBloqueoDeFila(db as unknown as PrismaService, 'Accessory', 1);
    const reserveP = db
      .$transaction((tx) => reserveAccessories(tx, order2, new Map([[A, 1], [B, 1]])), { timeout: 60_000 })
      .then(() => 'reserve:ok', tag('reserve'));
    await esperarBloqueoDeFila(db as unknown as PrismaService, 'Accessory', 2);
    done.abrir();
    await lockerTx;
    const out = await Promise.all([verbP, reserveP]);

    // Estado final (solo si ambas terminaron): el verbo movió lo suyo y la compra apartó 1 de cada uno.
    if (out.every((s) => s.endsWith(':ok'))) {
      const rows = await db.accessory.findMany({ where: { id: { in: [A, B] } }, select: { id: true, stockQty: true, reservedQty: true } });
      const expected =
        verb === 'restock' ? { stockQty: 11, reservedQty: 1 } : { stockQty: 9, reservedQty: 1 };
      for (const r of rows) expect({ stockQty: r.stockQty, reservedQty: r.reservedQty }).toEqual(expected);
      const lines = await db.orderAccessoryLine.findMany({ where: { orderId: order1 }, select: { status: true } });
      expect(lines.map((l) => l.status)).toEqual(verb === 'restock' ? ['restocked', 'restocked'] : ['sold', 'sold']);
    }
    return out.join(',');
  }

  it.each<Verb>(['settle_reserved', 'settle_recovery', 'restock'])('%s vs reserveAccessories con renglones de ids cruzados: 0/N con 40P01', async (verb) => {
    const res: string[] = [];
    for (let i = 0; i < N; i += 1) res.push(await round(verb));
    const dl = res.filter((r) => r.includes('40P01')).length;
    // eslint-disable-next-line no-console
    console.log(`[AC-LOCK ${verb}] ${dl}/${N} con 40P01 · N=${N} · ${res.join(' | ')}`);
    expect(dl).toBe(0);
    expect(res.every((r) => r === `${verb}:ok,reserve:ok`)).toBe(true);
  });
});
