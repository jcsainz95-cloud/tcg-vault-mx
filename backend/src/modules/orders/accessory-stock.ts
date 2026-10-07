/**
 * accessory-stock.ts — 💰 EXISTENCIAS DE ACCESORIOS: un cuerpo por verbo (API_CONTRACT §AC.6, I-AC-2).
 *
 * Todas reciben el `tx` del llamador. ⛔ Ninguna lee y luego escribe: la condición va en el `UPDATE` (dos sesiones
 * que apartan la última unidad: una gana el `WHERE`, la otra recibe 0 filas). Orden de candados: por `accessoryId`
 * ascendente (dos pedidos que apartan los mismos dos accesorios no se bloquean en cruz).
 *
 *  1. `reserveAccessories`  — §AC.4 paso 2: `reservedQty += q` ⇔ `stockQty − reservedQty ≥ q`; 0 filas ⇒
 *     `409 ACCESSORY_INSUFFICIENT_STOCK {accessoryId, availableQty}` y el llamador deshace TODO (piezas incluidas).
 *  2. `releaseAccessoryReservations` — CAS por renglón `reserved → released` y `reservedQty −= Σ`. Dos soltadas del
 *     mismo pedido ⇒ una sola resta (el `WHERE status = 'reserved'`). Llamadores obligatorios: candado AC-B37.
 *  3. `renewAccessoryReservations` — el reuso renueva `reservedUntil` de los renglones (§4-R.2 regla 4).
 *  4. `settleAccessories` — en la tx del settle del directo: `reserved → sold` + `stockQty −= q, reservedQty −= q`
 *     (movimiento `sale`); renglón ya `released` (el barrido ganó y el pago llegó tarde) ⇒ recuperación con
 *     `stockQty − reservedQty ≥ q` (`settle_recovery`) o, sin existencias, `settledWithoutStock` (bitácora fuera de la
 *     tx, la escribe quien llama). Nacen las `ShipmentAccessoryLine` en el envío que nace ahí.
 *  5. `restockAccessoriesOnFullRefund` — reembolso total SIN envío salido: `sold → restocked` y vuelven
 *     `quantity − missingQty` (0 si `settledWithoutStock`), movimiento `restock`. ⛔ Difiere de las cartas a propósito.
 *  6. `accessoryReservedDrift` — conteo de reconciliación (solo lectura): `reservedQty` vs Σ de lo `reserved`.
 *
 * Movimientos (`AccessoryStockMovement`): solo cambios de `stockQty` (apartar/soltar NO son existencias); actor `null`
 * ⇔ lo movió el sistema.
 */
import { Prisma } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';

type Tx = Prisma.TransactionClient;

const byId = <T>(m: ReadonlyMap<string, T>) => [...m].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/** Las partes de un renglón: el accesorio suelto, o los componentes del paquete. */
function partsOf(line: { kind: string; accessoryId: string | null; quantity: number }, components: { accessoryId: string; quantity: number }[]): Map<string, number> {
  const m = new Map<string, number>();
  if (line.kind === 'accessory') {
    if (line.accessoryId) m.set(line.accessoryId, line.quantity);
    return m;
  }
  for (const c of components) m.set(c.accessoryId, (m.get(c.accessoryId) ?? 0) + c.quantity);
  return m;
}

// ================================================================ 1. apartar

export async function reserveAccessories(tx: Tx, orderId: string, wants: ReadonlyMap<string, number>): Promise<void> {
  for (const [accessoryId, q] of byId(wants)) {
    if (q <= 0) continue;
    const n = await tx.$executeRaw`
      UPDATE "Accessory" SET "reservedQty" = "reservedQty" + ${q}::int
       WHERE id = ${accessoryId} AND "stockQty" - "reservedQty" >= ${q}::int`;
    if (n !== 1) {
      const row = await tx.accessory.findUnique({ where: { id: accessoryId }, select: { stockQty: true, reservedQty: true } });
      throw BusinessException.conflict('ACCESSORY_INSUFFICIENT_STOCK', `Not enough stock for accessory ${accessoryId} (order ${orderId})`, {
        accessoryId,
        availableQty: row ? Math.max(0, row.stockQty - row.reservedQty) : 0,
      });
    }
  }
}

// ================================================================ 2. soltar

export async function releaseAccessoryReservations(tx: Tx, orderId: string): Promise<{ lines: number; units: number }> {
  const candidates = await tx.orderAccessoryLine.findMany({
    where: { orderId, status: 'reserved' },
    select: { id: true, kind: true, accessoryId: true, quantity: true, components: { select: { accessoryId: true, quantity: true } } },
    orderBy: { id: 'asc' },
  });
  if (candidates.length === 0) return { lines: 0, units: 0 };
  // CAS por renglón `reserved → released`: dos soltadas concurrentes del mismo pedido ⇒ cada renglón lo gana UNA.
  const total = new Map<string, number>();
  let lines = 0;
  for (const l of candidates) {
    const won = await tx.orderAccessoryLine.updateMany({ where: { id: l.id, status: 'reserved' }, data: { status: 'released' } });
    if (won.count !== 1) continue;
    lines += 1;
    for (const [id, q] of partsOf(l, l.components)) total.set(id, (total.get(id) ?? 0) + q);
  }
  let units = 0;
  for (const [accessoryId, q] of byId(total)) {
    // ⛔ Nunca por debajo de lo real: si el contador ya está corrido (deriva), NO se resta — soltar de más es peor que
    // soltar de menos (se vendería lo que otro pedido tiene apartado). Lo denuncia el conteo de reconciliación.
    const n = await tx.$executeRaw`
      UPDATE "Accessory" SET "reservedQty" = "reservedQty" - ${q}::int
       WHERE id = ${accessoryId} AND "reservedQty" >= ${q}::int`;
    if (n === 1) units += q;
  }
  return { lines, units };
}

// ================================================================ 3. renovar

export async function renewAccessoryReservations(tx: Tx, orderId: string, reservedUntil: Date): Promise<void> {
  await tx.orderAccessoryLine.updateMany({ where: { orderId, status: 'reserved' }, data: { reservedUntil } });
}

// ================================================================ 4. liquidar

export interface UnbackedAccessoryLine {
  lineId: string;
  accessoryId: string | null;
  quantity: number;
}

export async function settleAccessories(
  tx: Tx,
  order: { id: string; orderNumber: string | null },
  shipmentRequestId: string,
  now: Date,
): Promise<{ unbacked: UnbackedAccessoryLine[] }> {
  const lines = await tx.orderAccessoryLine.findMany({
    where: { orderId: order.id },
    include: { components: { select: { accessoryId: true, quantity: true } } },
    orderBy: { id: 'asc' },
  });
  const unbacked: UnbackedAccessoryLine[] = [];
  const soldIds: { id: string; quantity: number }[] = [];
  for (const line of lines) {
    const parts = partsOf(line, line.components);
    if (line.status === 'reserved') {
      const cas = await tx.orderAccessoryLine.updateMany({ where: { id: line.id, status: 'reserved' }, data: { status: 'sold', soldAt: now } });
      if (cas.count !== 1) continue;
      for (const [accessoryId, q] of byId(parts)) {
        const rows = await tx.$queryRaw<{ stockQty: number }[]>`
          UPDATE "Accessory" SET "stockQty" = "stockQty" - ${q}::int, "reservedQty" = "reservedQty" - ${q}::int
           WHERE id = ${accessoryId} AND "reservedQty" >= ${q}::int AND "stockQty" >= ${q}::int
          RETURNING "stockQty"`;
        if (rows.length !== 1) {
          // Invariante I-AC-2 rota (un renglón `reserved` siempre está contado): ruidoso; Stripe reintenta y se ve.
          throw new Error(`settleAccessories: accessory ${accessoryId} reservation not backed for line ${line.id} (order ${order.orderNumber ?? order.id})`);
        }
        await tx.accessoryStockMovement.create({
          data: { accessoryId, kind: 'sale', delta: -q, stockBefore: rows[0].stockQty + q, stockAfter: rows[0].stockQty, actorUserId: null, orderId: order.id },
        });
      }
      soldIds.push({ id: line.id, quantity: line.quantity });
    } else if (line.status === 'released') {
      // Recuperación (el barrido soltó y el pago llegó tarde): igual que las piezas — el pedido PAGADO manda si hay de
      // dónde; si no, se marca y lo resuelve quien prepara (faltante).
      const done: [string, number, number][] = [];
      let ok = true;
      for (const [accessoryId, q] of byId(parts)) {
        const rows = await tx.$queryRaw<{ stockQty: number }[]>`
          UPDATE "Accessory" SET "stockQty" = "stockQty" - ${q}::int
           WHERE id = ${accessoryId} AND "stockQty" - "reservedQty" >= ${q}::int
          RETURNING "stockQty"`;
        if (rows.length !== 1) {
          ok = false;
          break;
        }
        done.push([accessoryId, q, rows[0].stockQty]);
      }
      if (!ok) {
        for (const [accessoryId, q] of done) await tx.$executeRaw`UPDATE "Accessory" SET "stockQty" = "stockQty" + ${q}::int WHERE id = ${accessoryId}`;
      }
      const cas = await tx.orderAccessoryLine.updateMany({
        where: { id: line.id, status: 'released' },
        data: { status: 'sold', soldAt: now, settledWithoutStock: !ok },
      });
      if (cas.count !== 1) {
        if (ok) for (const [accessoryId, q] of done) await tx.$executeRaw`UPDATE "Accessory" SET "stockQty" = "stockQty" + ${q}::int WHERE id = ${accessoryId}`;
        continue;
      }
      if (ok) {
        for (const [accessoryId, q, after] of done) {
          await tx.accessoryStockMovement.create({
            data: { accessoryId, kind: 'settle_recovery', delta: -q, stockBefore: after + q, stockAfter: after, actorUserId: null, orderId: order.id },
          });
        }
      } else {
        unbacked.push({ lineId: line.id, accessoryId: line.accessoryId, quantity: line.quantity });
      }
      soldIds.push({ id: line.id, quantity: line.quantity });
    }
  }
  if (soldIds.length > 0) {
    await tx.shipmentAccessoryLine.createMany({
      data: soldIds.map((l) => ({ shipmentRequestId, orderAccessoryLineId: l.id, quantity: l.quantity })),
      skipDuplicates: true,
    });
  }
  return { unbacked };
}

// ================================================================ 5. reponer (reembolso total sin envío salido)

export async function restockAccessoriesOnFullRefund(tx: Tx, orderId: string, now: Date): Promise<{ lines: number; units: number }> {
  const lines = await tx.orderAccessoryLine.findMany({
    where: { orderId, status: 'sold' },
    include: { components: { select: { accessoryId: true, quantity: true } }, shipmentLine: { select: { missingQty: true } } },
    orderBy: { id: 'asc' },
  });
  let n = 0;
  let units = 0;
  for (const line of lines) {
    const cas = await tx.orderAccessoryLine.updateMany({ where: { id: line.id, status: 'sold' }, data: { status: 'restocked', restockedAt: now } });
    if (cas.count !== 1) continue;
    n += 1;
    if (line.settledWithoutStock) continue;
    const missing = line.shipmentLine?.missingQty ?? 0;
    const back = line.quantity - missing;
    if (back <= 0) continue;
    // Paquete: entero o nada (quantity 1); suelto: `quantity − missingQty` unidades del accesorio.
    const parts = line.kind === 'accessory' ? new Map([[line.accessoryId as string, back]]) : partsOf(line, line.components);
    for (const [accessoryId, q] of byId(parts)) {
      const rows = await tx.$queryRaw<{ stockQty: number }[]>`
        UPDATE "Accessory" SET "stockQty" = "stockQty" + ${q}::int WHERE id = ${accessoryId} RETURNING "stockQty"`;
      await tx.accessoryStockMovement.create({
        data: { accessoryId, kind: 'restock', delta: q, stockBefore: rows[0].stockQty - q, stockAfter: rows[0].stockQty, actorUserId: null, orderId },
      });
      units += q;
    }
  }
  return { lines: n, units };
}

// ================================================================ 6. reconciliación

export interface ReservedDrift {
  accessoryId: string;
  reservedQty: number;
  countedQty: number;
}

/** `reservedQty` de cada accesorio vs Σ de lo `reserved` (sueltos + componentes). Solo lectura; ⛔ no corrige. */
export async function accessoryReservedDrift(db: Pick<Tx, 'accessory' | 'orderAccessoryLine' | 'orderEnergyBundleComponent'>): Promise<ReservedDrift[]> {
  const [accessories, loose, comps] = await Promise.all([
    db.accessory.findMany({ select: { id: true, reservedQty: true } }),
    db.orderAccessoryLine.groupBy({ by: ['accessoryId'], where: { status: 'reserved', kind: 'accessory' }, _sum: { quantity: true } }),
    db.orderEnergyBundleComponent.groupBy({ by: ['accessoryId'], where: { line: { status: 'reserved' } }, _sum: { quantity: true } }),
  ]);
  const counted = new Map<string, number>();
  for (const r of loose) if (r.accessoryId) counted.set(r.accessoryId, (counted.get(r.accessoryId) ?? 0) + (r._sum.quantity ?? 0));
  for (const r of comps) counted.set(r.accessoryId, (counted.get(r.accessoryId) ?? 0) + (r._sum.quantity ?? 0));
  return accessories
    .map((a) => ({ accessoryId: a.id, reservedQty: a.reservedQty, countedQty: counted.get(a.id) ?? 0 }))
    .filter((d) => d.reservedQty !== d.countedQty);
}

/** §AC.6 (3) — los pedidos `pending` con algún renglón `reserved` vencido (segunda fuente del barrido). */
export async function expiredAccessoryOrderIds(db: Pick<Tx, 'orderAccessoryLine'>, now: Date): Promise<string[]> {
  const rows = await db.orderAccessoryLine.findMany({
    where: { status: 'reserved', reservedUntil: { lt: now }, order: { status: 'pending' } },
    select: { orderId: true },
    distinct: ['orderId'],
  });
  return rows.map((r) => r.orderId);
}
