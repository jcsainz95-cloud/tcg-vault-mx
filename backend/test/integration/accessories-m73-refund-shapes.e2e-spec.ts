/**
 * accessories-m73-refund-shapes.e2e-spec.ts — 💰 **AC-B47…AC-B51** (errata v1.86.2⟨accesorios⟩, API_CONTRACT §AC.18) contra
 * Postgres REAL. Propiedad: backend.
 *
 * Las formas de `PaymentRefund` de M-61/M-70 (`PaymentRefund_item_missing_chk`, `PaymentRefund_item_delivered_shape_chk`)
 * se reescriben en M-73 para admitir el RENGLÓN de accesorio, y `payment_refund_accessory_shape` impide que cualquier
 * otro `kind` lo lleve (§AC.18.2/.3). La reversa repone los textos de M-61/M-70 ANTES de quitar columnas (§AC.18.4):
 * un `DROP COLUMN` borra en silencio todo CHECK que la nombre.
 *
 * - AC-B47 `item_missing` · AC-B48 `item_delivered` · AC-B49 ningún otro `kind` lleva renglón: filas reales con FK
 *   reales (pedido `direct_ship` liquidado con 1 carta + su `ShipmentItem` y 1 renglón ×3 + su línea de envío).
 *   «Rechaza» = código `23514` Y el nombre del CHECK (exacto, o dentro del conjunto que §AC.18.5 da).
 * - AC-B50 el TEXTO de M-73 (DROP/ADD de los tres nombres), la definición viva, la segunda aplicación ENTERA de M-73 sin
 *   error, y la parte `PaymentRefund` de M-73 aplicada sobre una tabla con forma M-72 y una fila de carta de CADA `kind`.
 * - AC-B51 el bloque de reversa ENTERO (extraído del fichero entre `REVERSA:BEGIN`/`REVERSA:END`) deja los dos CHECK de
 *   la carta vivos y sin columnas de accesorio, y siguen mordiendo.
 *
 * Todo corre en transacciones que SIEMPRE se deshacen (el DDL de Postgres es transaccional): la BD queda como estaba.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS } from '../../prisma/e2e-fixtures';

jest.setTimeout(120_000);

const RUN = `acr${Date.now().toString(36)}`;
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M73_DIR = readdirSync(MIGRATIONS).find((d) => /_m73_accessories$/.test(d));
const M73 = M73_DIR ? readFileSync(join(MIGRATIONS, M73_DIR, 'migration.sql'), 'utf8') : '';
const ROLLBACK = Symbol('rollback');

/**
 * Parte un script SQL en sentencias: respeta `--` comentarios, literales `'…'` y cuerpos `$$…$$` (los `DO` y la
 * función del disparador llevan `;` dentro).
 */
function splitSql(sql: string): string[] {
  const out: string[] = [];
  let cur = '';
  let i = 0;
  let inStr = false;
  let inDollar = false;
  while (i < sql.length) {
    const c = sql[i];
    const two = sql.slice(i, i + 2);
    if (!inStr && !inDollar && two === '--') {
      const nl = sql.indexOf('\n', i);
      i = nl < 0 ? sql.length : nl;
      continue;
    }
    if (!inStr && two === '$$') {
      inDollar = !inDollar;
      cur += two;
      i += 2;
      continue;
    }
    if (!inDollar && c === "'") inStr = !inStr;
    if (!inStr && !inDollar && c === ';') {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
      i += 1;
      continue;
    }
    cur += c;
    i += 1;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** El bloque de reversa del fichero, ejecutable: líneas entre los marcadores, sin el `-- ` inicial. */
function reversaSql(sql: string): string {
  const m = /^-- REVERSA:BEGIN[^\n]*\n([\s\S]*?)^-- REVERSA:END/m.exec(sql);
  if (!m) throw new Error('M-73 no trae el bloque REVERSA:BEGIN … REVERSA:END');
  return m[1]
    .split('\n')
    .map((l) => l.replace(/^--(?: |$)/, ''))
    .join('\n');
}

/** Las sentencias de M-73 que tocan `PaymentRefund` (columnas, índices, FK y CHECKs). */
const touchesRefund = (s: string) => /^ALTER TABLE "PaymentRefund"|^CREATE (UNIQUE )?INDEX [^;]* ON "PaymentRefund"/.test(s);

/** Nombre del CHECK que reventó y el código, del mensaje de Prisma. */
function violated(e: unknown): { code: string | null; name: string | null } {
  const msg = String((e as Error)?.message ?? e);
  return {
    code: /Code: `(\d{5})`/.exec(msg)?.[1] ?? null,
    name: /check constraint \\?"([A-Za-z0-9_]+)\\?"/.exec(msg)?.[1] ?? null,
  };
}

describe('💰 AC-B47…B51 — formas de PaymentRefund para accesorios (M-73, §AC.18)', () => {
  const prisma = new PrismaClient();
  let cardId: string;
  let locationId: string | null;

  beforeAll(async () => {
    await seedE2E(prisma);
    const base = await prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard }, select: { cardId: true, locationId: true } });
    cardId = base.cardId;
    locationId = base.locationId;
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function rolledBack(body: (tx: any) => Promise<void>): Promise<void> {
    try {
      await prisma.$transaction(
        async (tx) => {
          await body(tx);
          throw ROLLBACK;
        },
        { timeout: 60_000 },
      );
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }

  let seq = 0;
  type Fx = { orderId: string; orderItemId: string; shipmentItemId: string; lineId: string; slId: string; shipmentId: string };

  /** Pedido `direct_ship` liquidado: 1 carta + su `ShipmentItem`; 1 renglón ×3 + su `ShipmentAccessoryLine`. */
  async function fixture(tx: any): Promise<Fx> {
    seq += 1;
    const piece = await tx.inventoryItem.create({
      data: {
        folio: `ACR-${RUN}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        locationId,
        status: 'picking',
        ownerType: 'platform',
      },
    });
    const order = await tx.order.create({
      data: {
        guestEmail: `acr.${RUN}.${seq}@e2e.local`,
        fulfillmentMode: 'direct_ship',
        status: 'settled',
        settledAt: new Date(),
        subtotalCents: 50000 + 3 * 8900,
        shippingFeeCents: 17500,
        processingFeeCents: 3000,
        ivaCents: 13000,
        totalCents: 50000 + 3 * 8900 + 17500 + 3000,
        priceConvention: 'IVA_INCLUSIVE',
        shippingAddressSnapshot: { line1: 'Calle 1' },
      },
    });
    const oi = await tx.orderItem.create({ data: { orderId: order.id, inventoryItemId: piece.id, cardSnapshot: { name: 'Charizard' }, unitPriceCents: 50000 } });
    const sr = await tx.shipmentRequest.create({
      data: {
        orderId: order.id,
        addressSnapshot: { line1: 'Calle 1' },
        status: 'picking',
        pickingAt: new Date(),
        shippingFeeCents: 0,
        priceConvention: 'IVA_INCLUSIVE',
        items: { create: [{ inventoryItemId: piece.id }] },
      },
      include: { items: true },
    });
    const accId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "Accessory" (id, name, category, "stockQty", "reservedQty", "priceCents", "updatedAt") VALUES ($1, 'Funda', 'sleeves', 10, 0, 8900, now())`,
      accId,
    );
    const lineId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "OrderAccessoryLine" (id, "orderId", kind, "accessoryId", quantity, "unitPriceCents", "unitCostCents", snapshot, status, "soldAt", "reservedUntil")
       VALUES ($1, $2, 'accessory', $3, 3, 8900, 4000, '{}'::jsonb, 'sold', now(), now())`,
      lineId,
      order.id,
      accId,
    );
    const slId = randomUUID();
    await tx.$executeRawUnsafe(
      `INSERT INTO "ShipmentAccessoryLine" (id, "shipmentRequestId", "orderAccessoryLineId", quantity) VALUES ($1, $2, $3, 3)`,
      slId,
      sr.id,
      lineId,
    );
    return { orderId: order.id, orderItemId: oi.id, shipmentItemId: sr.items[0].id, lineId, slId, shipmentId: sr.id };
  }

  /** Inserta una fila del libro (importe 8900 = mercancía) con `row` encima de los campos obligatorios. */
  async function refund(tx: any, row: Record<string, unknown>): Promise<void> {
    const full: Record<string, unknown> = {
      id: randomUUID(),
      idempotencyKey: `acr:${randomUUID()}`,
      amountCents: 8900,
      merchandiseCents: 8900,
      merchandiseIvaCents: 1228,
      shippingCents: 0,
      shippingIvaCents: 0,
      processingFeeCents: 0,
      requestedByUserId: 'u-acr',
      requestedByRole: 'super_admin',
      ...row,
    };
    for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
    const cols = Object.keys(full);
    const casts: Record<string, string> = {
      kind: '::"PaymentRefundKind"',
      requestedByRole: '::"Role"',
      missingReason: '::"MissingReason"',
      deliveredReason: '::"ShippedRefundReason"',
    };
    await tx.$executeRawUnsafe(
      `INSERT INTO "PaymentRefund" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c, i) => `$${i + 1}${casts[c] ?? ''}`).join(', ')})`,
      ...cols.map((c) => full[c]),
    );
  }

  // Formas (§AC.18.2)
  const cardMissing = (f: Fx) => ({ kind: 'item_missing', orderId: f.orderId, orderItemId: f.orderItemId, shipmentItemId: f.shipmentItemId, missingReason: 'not_found' });
  const cardDelivered = (f: Fx) => ({ kind: 'item_delivered', orderId: f.orderId, orderItemId: f.orderItemId, shipmentItemId: f.shipmentItemId, deliveredReason: 'not_arrived', reason: 'nota' });
  const accMissing = (f: Fx) => ({ kind: 'item_missing', orderId: f.orderId, orderAccessoryLineId: f.lineId, shipmentAccessoryLineId: f.slId, accessoryQty: 1, missingReason: 'not_found' });
  const accDelivered = (f: Fx) => ({ kind: 'item_delivered', orderId: f.orderId, orderAccessoryLineId: f.lineId, accessoryQty: 1, deliveredReason: 'not_arrived', reason: 'nota' });

  /** La fila entra. */
  async function enters(...rows: ((f: Fx) => Record<string, unknown>)[]): Promise<void> {
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      for (const r of rows) await refund(tx, r(f));
    });
  }
  /** La fila revienta con 23514 y un CHECK de `names`. */
  async function rejectsWith(names: string[], row: (f: Fx) => Record<string, unknown>): Promise<void> {
    let caught: unknown = null;
    await rolledBack(async (tx) => {
      const f = await fixture(tx);
      try {
        await refund(tx, row(f));
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).not.toBeNull();
    const v = violated(caught);
    expect(v.code).toBe('23514');
    expect(names).toContain(v.name);
  }

  describe('AC-B47 — item_missing', () => {
    it('(1) CONTROL: la fila de CARTA entra (forma de M-61 sin cambio)', () => enters(cardMissing));
    it('(2) la fila de ACCESORIO {renglón, línea de envío, accessoryQty 1, missingReason} entra', () => enters(accMissing));
    it('(3) accesorio sin missingReason ⇒ PaymentRefund_item_missing_chk', () =>
      rejectsWith(['PaymentRefund_item_missing_chk'], (f) => ({ ...accMissing(f), missingReason: undefined })));
    it('(4) accesorio sin shipmentAccessoryLineId ⇒ PaymentRefund_item_missing_chk', () =>
      rejectsWith(['PaymentRefund_item_missing_chk'], (f) => ({ ...accMissing(f), shipmentAccessoryLineId: undefined })));
    it('(5) accesorio sin accessoryQty ⇒ payment_refund_accessory_qty_pair', () =>
      rejectsWith(['payment_refund_accessory_qty_pair'], (f) => ({ ...accMissing(f), accessoryQty: undefined })));
    it('(6) carta completa + renglón + accessoryQty ⇒ rechazo', () =>
      rejectsWith(['payment_refund_card_xor_accessory', 'PaymentRefund_item_missing_chk', 'payment_refund_accessory_shape'], (f) => ({
        ...cardMissing(f),
        orderAccessoryLineId: f.lineId,
        accessoryQty: 1,
      })));
    it('(7) accesorio + shipmentItemId ⇒ rechazo', () =>
      rejectsWith(['PaymentRefund_item_missing_chk', 'payment_refund_accessory_shape'], (f) => ({ ...accMissing(f), shipmentItemId: f.shipmentItemId })));
    it('(8) order_remaining con missingReason + renglón + línea ⇒ rechazo', () =>
      rejectsWith(['PaymentRefund_item_missing_chk', 'payment_refund_accessory_shape'], (f) => ({ ...accMissing(f), kind: 'order_remaining' })));
  });

  describe('AC-B48 — item_delivered', () => {
    it('(1) CONTROL: la fila de CARTA entra (forma de M-70 sin cambio)', () => enters(cardDelivered));
    it('(2) la fila de ACCESORIO {renglón, accessoryQty 1, deliveredReason, nota} entra', () => enters(accDelivered));
    it('(3) DOS filas de accesorio del mismo renglón con llaves distintas ⇒ ambas entran', () => enters(accDelivered, accDelivered));
    it('(4) accesorio con shipmentAccessoryLineId ⇒ PaymentRefund_item_delivered_shape_chk', () =>
      rejectsWith(['PaymentRefund_item_delivered_shape_chk'], (f) => ({ ...accDelivered(f), shipmentAccessoryLineId: f.slId })));
    it('(5) accesorio con missingReason ⇒ PaymentRefund_item_delivered_shape_chk', () =>
      rejectsWith(['PaymentRefund_item_delivered_shape_chk'], (f) => ({ ...accDelivered(f), missingReason: 'damaged' })));
    it('(6) accesorio con reason NULL ⇒ PaymentRefund_item_delivered_shape_chk', () =>
      rejectsWith(['PaymentRefund_item_delivered_shape_chk'], (f) => ({ ...accDelivered(f), reason: undefined })));
    it('(7) accesorio sin deliveredReason ⇒ PaymentRefund_item_delivered_chk', () =>
      rejectsWith(['PaymentRefund_item_delivered_chk'], (f) => ({ ...accDelivered(f), deliveredReason: undefined })));
  });

  describe('AC-B49 — ningún otro kind lleva renglón', () => {
    it.each(['order_remaining', 'order_full'])('%s con renglón + accessoryQty ⇒ payment_refund_accessory_shape', (kind) =>
      rejectsWith(['payment_refund_accessory_shape'], (f) => ({ kind, orderId: f.orderId, orderAccessoryLineId: f.lineId, accessoryQty: 1 })));
  });

  describe('AC-B50 — la migración', () => {
    it('el TEXTO de M-73 hace DROP y ADD de los tres nombres', () => {
      const forward = splitSql(M73); // la reversa va en comentarios: no está aquí
      for (const n of ['PaymentRefund_item_missing_chk', 'PaymentRefund_item_delivered_shape_chk', 'payment_refund_accessory_shape']) {
        expect(forward.some((s) => s === `ALTER TABLE "PaymentRefund" DROP CONSTRAINT IF EXISTS "${n}"`)).toBe(true);
        expect(forward.some((s) => s.startsWith(`ALTER TABLE "PaymentRefund" ADD CONSTRAINT "${n}"`))).toBe(true);
      }
    });

    it('la definición VIVA de los dos CHECK de M-61/M-70 nombra orderAccessoryLineId', async () => {
      const rows = await prisma.$queryRawUnsafe<{ n: string; def: string }[]>(
        `SELECT conname AS n, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = '"PaymentRefund"'::regclass AND conname IN ('PaymentRefund_item_missing_chk', 'PaymentRefund_item_delivered_shape_chk')`,
      );
      expect(rows.map((r) => r.n).sort()).toEqual(['PaymentRefund_item_delivered_shape_chk', 'PaymentRefund_item_missing_chk']);
      for (const r of rows) expect(r.def).toMatch(/"orderAccessoryLineId"/);
    });

    it('segunda aplicación ENTERA de M-73 sin error (idempotente)', async () => {
      const stmts = splitSql(M73);
      expect(stmts.length).toBeGreaterThan(50);
      await rolledBack(async (tx) => {
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const [{ n }] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "Accessory" WHERE "category"::text = 'energy' AND "name" LIKE 'Energía %'`);
        expect(n).toBe(8);
      });
    });

    it('sobre una tabla con forma M-72 y una fila de carta de CADA kind, la parte PaymentRefund de M-73 entra (y dos veces)', async () => {
      const forward = splitSql(M73).filter(touchesRefund);
      const back = splitSql(reversaSql(M73)).filter(touchesRefund);
      expect(forward.length).toBeGreaterThan(10);
      expect(back.length).toBeGreaterThan(3);
      const tmp = `acr_m72_${RUN}`;
      await rolledBack(async (tx) => {
        const [{ me }] = await tx.$queryRawUnsafe(`SELECT current_schema() AS me`);
        await tx.$executeRawUnsafe(`CREATE SCHEMA "${tmp}"`);
        // Copia SIN FK (ni índices) de la tabla viva; la reversa de M-73 la devuelve a la forma M-72 (columnas y CHECKs).
        await tx.$executeRawUnsafe(`CREATE TABLE "${tmp}"."PaymentRefund" (LIKE "${me}"."PaymentRefund" INCLUDING DEFAULTS INCLUDING CONSTRAINTS)`);
        await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${tmp}", "${me}"`);
        for (const s of back) await tx.$executeRawUnsafe(s);
        const cols = await tx.$queryRawUnsafe(
          `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'PaymentRefund'
             AND column_name IN ('orderAccessoryLineId', 'shipmentAccessoryLineId', 'accessoryQty')`,
          tmp,
        );
        expect(cols).toEqual([]);
        // Una fila de carta de CADA kind (sin FK en la copia: lo que se mide son los CHECK al validar el ADD CONSTRAINT).
        const o = randomUUID();
        const kinds: Record<string, Record<string, unknown>> = {
          item_missing: { orderId: o, orderItemId: randomUUID(), shipmentItemId: randomUUID(), missingReason: 'not_found' },
          item_delivered: { orderId: o, orderItemId: randomUUID(), shipmentItemId: randomUUID(), deliveredReason: 'not_arrived', reason: 'nota' },
          order_full: { orderId: o, reason: 'total' },
          order_remaining: { orderId: o },
          case_refund: { orderId: o, orderItemId: randomUUID(), replacementCaseId: randomUUID(), reason: 'caso' },
          shipment_fee: { shipmentRequestId: randomUUID() },
        };
        for (const [kind, row] of Object.entries(kinds)) await refund(tx, { kind, ...row });
        for (const s of forward) await tx.$executeRawUnsafe(s);
        for (const s of forward) await tx.$executeRawUnsafe(s);
        const [{ n }] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM "${tmp}"."PaymentRefund"`);
        expect(n).toBe(6);
        const defs = await tx.$queryRawUnsafe(
          `SELECT conname AS n FROM pg_constraint WHERE conrelid = '"${tmp}"."PaymentRefund"'::regclass AND conname = 'payment_refund_accessory_shape'`,
        );
        expect(defs).toHaveLength(1);
      });
    });
  });

  describe('AC-B51 — la reversa', () => {
    it('ejecutada ENTERA (con 0 renglones) deja los dos CHECK de la carta vivos, sin columnas de accesorio, y muerden', async () => {
      const back = splitSql(reversaSql(M73));
      expect(back.some((s) => /DROP COLUMN IF EXISTS "orderAccessoryLineId"/.test(s))).toBe(true);
      await rolledBack(async (tx) => {
        // Condición previa de la reversa (§AC.1): cero renglones. En la tx se vacían los que haya de otras pruebas.
        await tx.$executeRawUnsafe(`DELETE FROM "PaymentRefund" WHERE "orderAccessoryLineId" IS NOT NULL`);
        await tx.$executeRawUnsafe(`DELETE FROM "ShipmentAccessoryLine"`);
        await tx.$executeRawUnsafe(`DELETE FROM "OrderEnergyBundleComponent"`);
        await tx.$executeRawUnsafe(`DELETE FROM "OrderAccessoryLine"`);
        for (const s of back) await tx.$executeRawUnsafe(s);
        const rows = await tx.$queryRawUnsafe(
          `SELECT conname AS n, pg_get_constraintdef(oid) AS def FROM pg_constraint
            WHERE conrelid = '"PaymentRefund"'::regclass AND conname IN ('PaymentRefund_item_missing_chk', 'PaymentRefund_item_delivered_shape_chk')`,
        );
        expect(rows.map((r: { n: string }) => r.n).sort()).toEqual(['PaymentRefund_item_delivered_shape_chk', 'PaymentRefund_item_missing_chk']);
        for (const r of rows) expect(r.def).not.toMatch(/accessory|Accessory/);
        let caught: unknown = null;
        try {
          await refund(tx, { kind: 'item_missing', orderId: randomUUID(), orderItemId: randomUUID(), shipmentItemId: randomUUID() });
        } catch (e) {
          caught = e;
        }
        expect(violated(caught)).toEqual({ code: '23514', name: 'PaymentRefund_item_missing_chk' });
      });
    });
  });
});
