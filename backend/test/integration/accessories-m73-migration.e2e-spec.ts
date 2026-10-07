/**
 * accessories-m73-migration.e2e-spec.ts — 💰 **AC-B1** (v1.86⟨accesorios⟩, M-73, API_CONTRACT §AC.1 y §AC.14) contra
 * Postgres REAL. Propiedad: backend.
 *
 * Qué fija (la BD, no la aplicación, es la última línea de las invariantes de dinero y existencias):
 *  - **I-AC-2** `0 ≤ reservedQty ≤ stockQty` (CHECK `accessory_stock`): apartar de más ⇒ error de BD.
 *  - **«Activar» exige precio, foto y medidas** (`accessory_active_ready`); la energía, sin medidas.
 *  - **Criterio 732**: dos productos ACTIVOS del mismo tipo de energía ⇒ error (índice único PARCIAL).
 *  - **I-AC-4** sin bóveda: un renglón de accesorio en un pedido `vault` ⇒ error (CONSTRAINT TRIGGER).
 *  - Las CHECK de forma de `OrderAccessoryLine`, `AccessoryStockMovement`, `ShipmentAccessoryLine`, `Order`,
 *    `ShippingPackage` y `PaymentRefund` que §AC.1 marca «(CHECK)».
 *  - La semilla: 8 «Energía <tipo>» inactivas, MX$5, existencias 0, sin foto.
 *  - Mitad estática: el TEXTO de la migración declara cada restricción con su nombre (mutación «quitar un CHECK de la
 *    migración» ⇒ rojo aquí aunque la BD de pruebas ya estuviera migrada con la versión vieja).
 *
 * Las tablas nuevas se tocan por SQL crudo a propósito: la prueba mide la BD, no el cliente de Prisma.
 * Todo corre en transacciones que SIEMPRE se deshacen: la BD compartida queda como estaba.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

jest.setTimeout(60_000);

const RUN = `m73${Date.now().toString(36)}`;
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M73_DIR = readdirSync(MIGRATIONS).find((d) => /_m73_accessories$/.test(d));
const M73 = M73_DIR ? readFileSync(join(MIGRATIONS, M73_DIR, 'migration.sql'), 'utf8') : '';
const code = (s: string) => s.replace(/--.*$/gm, '');
const ROLLBACK = Symbol('rollback');

/** Las restricciones CHECK con nombre que §AC.1 exige (tabla ⇒ nombres). */
const NAMED_CHECKS: Record<string, string[]> = {
  Accessory: [
    'accessory_energy_type',
    'accessory_energy_not_suggested',
    'accessory_stock',
    'accessory_active_ready',
    'accessory_price_range',
    'accessory_cost_range',
    'accessory_dims_range',
    'accessory_weight_range',
    'accessory_name_length',
    'accessory_description_length',
  ],
  AccessoryStockMovement: ['accessory_movement_identity', 'accessory_movement_delta', 'accessory_movement_adjust_reason'],
  OrderAccessoryLine: [
    'order_accessory_line_kind_accessory',
    'order_accessory_line_quantity',
    'order_accessory_line_bundle_shape',
    'order_accessory_line_money',
    'order_accessory_line_sold_at',
    'order_accessory_line_restocked_at',
    'order_accessory_line_refunded_qty',
  ],
  OrderEnergyBundleComponent: ['order_energy_bundle_component_quantity'],
  ShipmentAccessoryLine: ['shipment_accessory_line_missing', 'shipment_accessory_line_quantity'],
  Order: ['order_shipping_box_review'],
  ShippingPackage: ['shipping_package_customer_fee'],
  PaymentRefund: [
    'payment_refund_accessory_qty_pair',
    'payment_refund_accessory_qty_min',
    'payment_refund_card_xor_accessory',
    'payment_refund_accessory_shipment_line',
  ],
};

describe('💰 AC-B1 — M-73 (accesorios) contra Postgres real', () => {
  const prisma = new PrismaClient();

  afterAll(async () => {
    await prisma.$disconnect();
  });

  /** Corre `body` en una tx que SIEMPRE se deshace. */
  async function rolledBack(body: (tx: any) => Promise<void>): Promise<void> {
    try {
      await prisma.$transaction(async (tx) => {
        await body(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }

  let seq = 0;
  /** Un `Order` mínimo válido. `direct_ship` ⇒ de invitado; `vault` ⇒ con cuenta. */
  async function order(tx: any, mode: 'direct_ship' | 'vault'): Promise<string> {
    seq += 1;
    const base = { subtotalCents: 8900, processingFeeCents: 300, ivaCents: 1228, totalCents: 9200, priceConvention: 'IVA_INCLUSIVE' };
    if (mode === 'direct_ship') {
      const o = await tx.order.create({
        data: { ...base, guestEmail: `m73.${RUN}.${seq}@e2e.local`, fulfillmentMode: 'direct_ship', shippingAddressSnapshot: { line1: 'Calle 1' } },
      });
      return o.id;
    }
    const u = await tx.user.create({ data: { email: `m73.${RUN}.${seq}@e2e.local`, name: 'Cliente M73', role: 'customer', emailVerified: true } });
    const o = await tx.order.create({ data: { ...base, userId: u.id, fulfillmentMode: 'vault' } });
    return o.id;
  }

  /** Inserta un `Accessory` con `over` encima de una fila válida (inactiva, sin foto). Devuelve el id. */
  async function accessory(tx: any, over: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      name: `Funda ${RUN}`,
      category: 'sleeves',
      energyType: null,
      lengthMm: 90,
      widthMm: 65,
      heightMm: 20,
      weightG: 50,
      priceCents: 8900,
      unitCostCents: 4000,
      stockQty: 20,
      reservedQty: 0,
      active: false,
      suggested: false,
      photoVersion: null,
      ...over,
    };
    const cols = Object.keys(row);
    const casts: Record<string, string> = { category: '::"AccessoryCategory"', energyType: '::"EnergyType"' };
    const vals = cols.map((c, i) => `$${i + 1}${casts[c] ?? ''}`);
    await tx.$executeRawUnsafe(
      `INSERT INTO "Accessory" (${cols.map((c) => `"${c}"`).join(', ')}, "updatedAt") VALUES (${vals.join(', ')}, now())`,
      ...cols.map((c) => row[c]),
    );
    return row.id as string;
  }

  /** Inserta un `OrderAccessoryLine` (por defecto: 1 accesorio, apartado). Devuelve el id. */
  async function line(tx: any, orderId: string, accessoryId: string | null, over: Record<string, unknown> = {}): Promise<string> {
    const row: Record<string, unknown> = {
      id: randomUUID(),
      orderId,
      kind: 'accessory',
      accessoryId,
      quantity: 1,
      unitPriceCents: 8900,
      unitCostCents: 4000,
      snapshot: JSON.stringify({ name: 'Funda', category: 'sleeves', energyType: null, photoVersion: null }),
      reservedUntil: new Date(Date.now() + 15 * 60_000),
      ...over,
    };
    const cols = Object.keys(row);
    const casts: Record<string, string> = {
      kind: '::"AccessoryLineKind"',
      status: '::"AccessoryLineStatus"',
      snapshot: '::jsonb',
      deckOrderItemIds: '::text[]',
    };
    const vals = cols.map((c, i) => `$${i + 1}${casts[c] ?? ''}`);
    await tx.$executeRawUnsafe(
      `INSERT INTO "OrderAccessoryLine" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')})`,
      ...cols.map((c) => row[c]),
    );
    return row.id as string;
  }

  /** Espera que `body` reviente con un error de BD cuyo texto contenga `what`. */
  async function rejects(what: RegExp, body: (tx: any) => Promise<unknown>): Promise<void> {
    let caught: unknown = null;
    await rolledBack(async (tx) => {
      try {
        await body(tx);
      } catch (e) {
        caught = e;
      }
    });
    expect(caught).not.toBeNull();
    expect(String((caught as Error)?.message ?? caught)).toMatch(what);
  }

  describe('el texto de la migración (mitad estática: «quitar un CHECK de la migración» ⇒ rojo)', () => {
    it('existe la carpeta reservada `20261026120000_m73_accessories`', () => {
      expect(M73_DIR).toBe('20261026120000_m73_accessories');
    });

    it.each(Object.entries(NAMED_CHECKS).flatMap(([t, names]) => names.map((n) => [t, n] as const)))(
      '"%s" ADD CONSTRAINT "%s" … CHECK está en el SQL',
      (table, name) => {
        expect(code(M73)).toMatch(new RegExp(`ALTER TABLE "${table}" ADD CONSTRAINT "${name}"\\s+CHECK`));
      },
    );

    it('el índice único PARCIAL y el CONSTRAINT TRIGGER están en el SQL', () => {
      expect(code(M73)).toMatch(
        /CREATE UNIQUE INDEX (IF NOT EXISTS )?"accessory_energy_type_active_key" ON "Accessory"\("energyType"\) WHERE "active" AND "energyType" IS NOT NULL/,
      );
      expect(code(M73)).toMatch(/CREATE CONSTRAINT TRIGGER "order_accessory_line_direct_ship"\s+AFTER INSERT/);
    });
  });

  describe('el catálogo de la BD migrada', () => {
    it('cada CHECK con nombre existe en su tabla', async () => {
      const rows = await prisma.$queryRawUnsafe<{ t: string; c: string }[]>(
        `SELECT cl.relname AS t, co.conname AS c FROM pg_constraint co JOIN pg_class cl ON cl.oid = co.conrelid
          WHERE co.contype = 'c' AND cl.relnamespace = 'public'::regnamespace`,
      );
      for (const [t, names] of Object.entries(NAMED_CHECKS)) {
        const have = rows.filter((r) => r.t === t).map((r) => r.c);
        expect({ t, have: names.filter((n) => have.includes(n)) }).toEqual({ t, have: names });
      }
    });

    it('el índice parcial es ÚNICO y PARCIAL; el disparador es de restricción', async () => {
      const [idx] = await prisma.$queryRawUnsafe<{ def: string }[]>(
        `SELECT indexdef AS def FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'accessory_energy_type_active_key'`,
      );
      expect(idx?.def).toMatch(/CREATE UNIQUE INDEX .* WHERE \(active AND \("energyType" IS NOT NULL\)\)/);
      const trg = await prisma.$queryRawUnsafe<{ n: string; isconstraint: boolean }[]>(
        `SELECT tgname AS n, tgconstraint <> 0 AS isconstraint FROM pg_trigger
          WHERE tgrelid = '"OrderAccessoryLine"'::regclass AND NOT tgisinternal`,
      );
      expect(trg).toEqual([{ n: 'order_accessory_line_direct_ship', isconstraint: true }]);
    });

    it('semilla: 8 «Energía <tipo>», una por tipo, inactivas, MX$5, existencias 0, sin foto ni medidas', async () => {
      const rows = await prisma.$queryRawUnsafe<any[]>(
        `SELECT "name", "energyType"::text AS e, "priceCents" AS p, "stockQty" AS s, "reservedQty" AS r, "active" AS a,
                "suggested" AS sg, "photoVersion" AS pv, "lengthMm" AS l
           FROM "Accessory" WHERE "category"::text = 'energy' AND "name" LIKE 'Energía %' ORDER BY "energyType"`,
      );
      const names: Record<string, string> = {
        grass: 'Energía Planta',
        fire: 'Energía Fuego',
        water: 'Energía Agua',
        lightning: 'Energía Rayo',
        psychic: 'Energía Psíquica',
        fighting: 'Energía Lucha',
        darkness: 'Energía Oscura',
        metal: 'Energía Metálica',
      };
      expect(rows.map((r) => r.e).sort()).toEqual(Object.keys(names).sort());
      for (const r of rows) {
        expect(r).toMatchObject({ name: names[r.e], p: 500, s: 0, r: 0, a: false, sg: false, pv: null, l: null });
      }
    });

    it('columnas nuevas en tablas existentes: anulables o con DEFAULT, sin tocar filas', async () => {
      const cols = await prisma.$queryRawUnsafe<{ t: string; c: string; nullable: string; def: string | null }[]>(
        `SELECT table_name AS t, column_name AS c, is_nullable AS nullable, column_default AS def
           FROM information_schema.columns WHERE table_schema = 'public' AND (
             (table_name = 'Order' AND column_name IN ('shippingBoxSnapshot','shippingBoxReview')) OR
             (table_name = 'ShippingPackage' AND column_name = 'customerFeeCents') OR
             (table_name = 'PaymentRefund' AND column_name IN ('orderAccessoryLineId','shipmentAccessoryLineId','accessoryQty')))
          ORDER BY 1, 2`,
      );
      expect(cols.map((c) => `${c.t}.${c.c}:${c.nullable}:${c.def ?? ''}`)).toEqual([
        'Order.shippingBoxReview:NO:false',
        'Order.shippingBoxSnapshot:YES:',
        'PaymentRefund.accessoryQty:YES:',
        'PaymentRefund.orderAccessoryLineId:YES:',
        'PaymentRefund.shipmentAccessoryLineId:YES:',
        'ShippingPackage.customerFeeCents:YES:',
      ]);
    });
  });

  describe('Accessory — I-AC-2, activar, energía', () => {
    it('CONTROL: una fila válida entra; apartar todo (reservedQty = stockQty) entra', async () => {
      await rolledBack(async (tx) => {
        const id = await accessory(tx, { stockQty: 3, reservedQty: 3 });
        const [r] = await tx.$queryRawUnsafe(`SELECT "stockQty" AS s, "reservedQty" AS r FROM "Accessory" WHERE id = $1`, id);
        expect(r).toEqual({ s: 3, r: 3 });
      });
    });

    it('I-AC-2: reservedQty > stockQty ⇒ error (al insertar y al apartar de más con UPDATE)', async () => {
      await rejects(/accessory_stock/, (tx) => accessory(tx, { stockQty: 1, reservedQty: 2 }));
      await rejects(/accessory_stock/, async (tx) => {
        const id = await accessory(tx, { stockQty: 1 });
        await tx.$executeRawUnsafe(`UPDATE "Accessory" SET "reservedQty" = "reservedQty" + 2 WHERE id = $1`, id);
      });
    });

    it('I-AC-2: existencias o apartado negativos ⇒ error', async () => {
      await rejects(/accessory_stock/, (tx) => accessory(tx, { stockQty: -1 }));
      await rejects(/accessory_stock/, (tx) => accessory(tx, { reservedQty: -1 }));
    });

    it('activar sin foto ⇒ error; sin precio ⇒ error; sin medidas (no energía) ⇒ error', async () => {
      await rejects(/accessory_active_ready/, (tx) => accessory(tx, { active: true, photoVersion: null }));
      await rejects(/accessory_active_ready/, (tx) => accessory(tx, { active: true, photoVersion: 'a1b2c3d4e5f60718', priceCents: null }));
      for (const k of ['lengthMm', 'widthMm', 'heightMm', 'weightG']) {
        await rejects(/accessory_active_ready/, (tx) => accessory(tx, { active: true, photoVersion: 'a1b2c3d4e5f60718', [k]: null }));
      }
    });

    it('activar con precio, foto y medidas entra; la ENERGÍA activa sin medidas entra (criterio 729)', async () => {
      await rolledBack(async (tx) => {
        await accessory(tx, { active: true, photoVersion: 'a1b2c3d4e5f60718' });
        // Tipo `metal` en una tx propia: la semilla es inactiva, así que no choca con el índice parcial.
        await accessory(tx, {
          category: 'energy',
          energyType: 'metal',
          active: true,
          photoVersion: 'a1b2c3d4e5f60718',
          lengthMm: null,
          widthMm: null,
          heightMm: null,
          weightG: null,
        });
      });
    });

    it('energía ⇔ tipo: energía sin tipo ⇒ error; no-energía con tipo ⇒ error', async () => {
      await rejects(/accessory_energy_type/, (tx) => accessory(tx, { category: 'energy', energyType: null }));
      await rejects(/accessory_energy_type/, (tx) => accessory(tx, { category: 'sleeves', energyType: 'fire' }));
    });

    it('una energía no puede ser «Sugerido» (P-EN-2, F3)', async () => {
      await rejects(/accessory_energy_not_suggested/, (tx) => accessory(tx, { category: 'energy', energyType: 'grass', suggested: true }));
    });

    it('criterio 732: dos productos ACTIVOS de tipo `fire` ⇒ error; uno activo y otro inactivo ⇒ entra', async () => {
      const ready = { category: 'energy', energyType: 'fire', active: true, photoVersion: 'a1b2c3d4e5f60718' };
      // 23505 sobre `energyType`: el único índice único de esa columna es el PARCIAL (el caso de abajo prueba que es parcial).
      await rejects(/23505[\s\S]*energyType[\s\S]*=\(fire\) already exists/, async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "Accessory" SET "active" = false WHERE "energyType"::text = 'fire'`);
        await accessory(tx, { ...ready, name: 'Energía Fuego A' });
        await accessory(tx, { ...ready, name: 'Energía Fuego B' });
      });
      await rolledBack(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "Accessory" SET "active" = false WHERE "energyType"::text = 'fire'`);
        await accessory(tx, { ...ready, name: 'Energía Fuego A' });
        await accessory(tx, { ...ready, name: 'Energía Fuego B', active: false });
      });
    });

    it.each([
      ['priceCents 0', { priceCents: 0 }, /accessory_price_range/],
      ['priceCents 100_000_001', { priceCents: 100_000_001 }, /accessory_price_range/],
      ['unitCostCents -1', { unitCostCents: -1 }, /accessory_cost_range/],
      ['unitCostCents 100_000_001', { unitCostCents: 100_000_001 }, /accessory_cost_range/],
      ['lengthMm 0', { lengthMm: 0 }, /accessory_dims_range/],
      ['heightMm 2001', { heightMm: 2001 }, /accessory_dims_range/],
      ['weightG 0', { weightG: 0 }, /accessory_weight_range/],
      ['weightG 50001', { weightG: 50001 }, /accessory_weight_range/],
      ['nombre vacío', { name: '' }, /accessory_name_length/],
      ['nombre de solo espacios', { name: '   ' }, /accessory_name_length/],
      ['nombre de 121', { name: 'x'.repeat(121) }, /accessory_name_length/],
      ['descripción de 501', { description: 'x'.repeat(501) }, /accessory_description_length/],
    ])('rango: %s ⇒ error', async (_n, over, what) => {
      await rejects(what as RegExp, (tx) => accessory(tx, over as Record<string, unknown>));
    });

    it('rangos en el borde entran (1, 100_000_000, 0 de costo, 2000 mm, 50000 g, 120 y 500 caracteres)', async () => {
      await rolledBack(async (tx) => {
        await accessory(tx, { priceCents: 1, unitCostCents: 0, lengthMm: 2000, weightG: 50000, name: 'x'.repeat(120), description: 'y'.repeat(500) });
        await accessory(tx, { priceCents: 100_000_000, unitCostCents: 100_000_000, lengthMm: 1, weightG: 1 });
      });
    });
  });

  describe('OrderAccessoryLine — I-AC-4 (sin bóveda) y forma', () => {
    it('CONTROL: un renglón en un pedido `direct_ship` entra', async () => {
      await rolledBack(async (tx) => {
        const o = await order(tx, 'direct_ship');
        const a = await accessory(tx);
        const id = await line(tx, o, a, { quantity: 3 });
        const [r] = await tx.$queryRawUnsafe(`SELECT "status"::text AS s, "refundedQty" AS q, "deckOrderItemIds" AS d FROM "OrderAccessoryLine" WHERE id = $1`, id);
        expect(r).toEqual({ s: 'reserved', q: 0, d: [] });
      });
    });

    it('I-AC-4: un renglón en un pedido `vault` ⇒ error del disparador', async () => {
      await rejects(/order_accessory_line_direct_ship|direct_ship/, async (tx) => {
        const o = await order(tx, 'vault');
        const a = await accessory(tx);
        await line(tx, o, a);
      });
    });

    it('I-AC-4: mover un renglón a un pedido `vault` (UPDATE de orderId) ⇒ error del disparador', async () => {
      await rejects(/order_accessory_line_direct_ship|direct_ship/, async (tx) => {
        const ds = await order(tx, 'direct_ship');
        const v = await order(tx, 'vault');
        const a = await accessory(tx);
        const id = await line(tx, ds, a);
        await tx.$executeRawUnsafe(`UPDATE "OrderAccessoryLine" SET "orderId" = $1 WHERE id = $2`, v, id);
      });
    });

    it.each([
      ['accessory sin accessoryId', { accessoryId: null }, /order_accessory_line_kind_accessory/],
      ['quantity 0', { quantity: 0 }, /order_accessory_line_quantity/],
      ['quantity 100', { quantity: 100 }, /order_accessory_line_quantity/],
      ['unitPriceCents 0', { unitPriceCents: 0 }, /order_accessory_line_money/],
      ['unitCostCents -1', { unitCostCents: -1 }, /order_accessory_line_money/],
      ['refundedQty > quantity', { quantity: 2, refundedQty: 3 }, /order_accessory_line_refunded_qty/],
      ['refundedQty negativo', { refundedQty: -1 }, /order_accessory_line_refunded_qty/],
      ['sold sin soldAt', { status: 'sold' }, /order_accessory_line_sold_at/],
      ['reserved con soldAt', { soldAt: new Date() }, /order_accessory_line_sold_at/],
      ['restocked sin restockedAt', { status: 'restocked', soldAt: new Date() }, /order_accessory_line_restocked_at/],
      ['sold con restockedAt', { status: 'sold', soldAt: new Date(), restockedAt: new Date() }, /order_accessory_line_restocked_at/],
      ['accessory con campos de paquete', { metaDeckId: 'md' }, /order_accessory_line_bundle_shape/],
      ['accessory con deckOrderItemIds', { deckOrderItemIds: ['x'] }, /order_accessory_line_bundle_shape/],
    ])('forma: %s ⇒ error', async (_n, over, what) => {
      await rejects(what as RegExp, async (tx) => {
        const o = await order(tx, 'direct_ship');
        const a = await accessory(tx);
        await line(tx, o, (over as any).accessoryId === null ? null : a, over as Record<string, unknown>);
      });
    });

    const BUNDLE = {
      kind: 'energy_bundle',
      unitPriceCents: 2000,
      unitCostCents: null,
      metaDeckId: 'md-1',
      metaDeckListId: 'mdl-1',
      deckSlug: 'charizard-ex',
      deckName: 'Charizard ex',
      deckOrderItemIds: ['oi-1', 'oi-2'],
    };

    it('CONTROL: un paquete bien formado entra, con sus componentes', async () => {
      await rolledBack(async (tx) => {
        const o = await order(tx, 'direct_ship');
        const id = await line(tx, o, null, BUNDLE);
        const fire = await accessory(tx, { category: 'energy', energyType: 'fire', lengthMm: null, widthMm: null, heightMm: null, weightG: null });
        await tx.$executeRawUnsafe(
          `INSERT INTO "OrderEnergyBundleComponent" (id, "lineId", "accessoryId", "energyType", quantity, "unitCostCents")
           VALUES ($1, $2, $3, 'fire', 12, 100)`,
          randomUUID(),
          id,
          fire,
        );
      });
    });

    it.each([
      ['paquete con quantity 2', { quantity: 2 }, /order_accessory_line_quantity/],
      ['paquete con accessoryId', { accessoryId: '__A__' }, /order_accessory_line_kind_accessory/],
      ['paquete sin metaDeckListId', { metaDeckListId: null }, /order_accessory_line_bundle_shape/],
      ['paquete sin deckName', { deckName: null }, /order_accessory_line_bundle_shape/],
      ['paquete con deckOrderItemIds vacío', { deckOrderItemIds: [] }, /order_accessory_line_bundle_shape/],
      ['paquete con costo propio (el costo va en los componentes)', { unitCostCents: 100 }, /order_accessory_line_money/],
    ])('forma del paquete: %s ⇒ error', async (_n, over, what) => {
      await rejects(what as RegExp, async (tx) => {
        const o = await order(tx, 'direct_ship');
        const a = await accessory(tx);
        const o2: Record<string, unknown> = { ...BUNDLE, ...(over as Record<string, unknown>) };
        if (o2.accessoryId === '__A__') o2.accessoryId = a;
        await line(tx, o, (o2.accessoryId as string) ?? null, o2);
      });
    });

    it('componente con quantity 0 ⇒ error; dos componentes del mismo tipo ⇒ error', async () => {
      const comp = (tx: any, lineId: string, acc: string, q: number) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "OrderEnergyBundleComponent" (id, "lineId", "accessoryId", "energyType", quantity) VALUES ($1, $2, $3, 'fire', $4)`,
          randomUUID(),
          lineId,
          acc,
          q,
        );
      await rejects(/order_energy_bundle_component_quantity/, async (tx) => {
        const o = await order(tx, 'direct_ship');
        const id = await line(tx, o, null, BUNDLE);
        await comp(tx, id, await accessory(tx), 0);
      });
      await rejects(/23505[\s\S]*lineId[\s\S]*energyType/, async (tx) => {
        const o = await order(tx, 'direct_ship');
        const id = await line(tx, o, null, BUNDLE);
        const a = await accessory(tx);
        await comp(tx, id, a, 1);
        await comp(tx, id, a, 2);
      });
    });
  });

  describe('AccessoryStockMovement — identidad de existencias', () => {
    const mv = (tx: any, acc: string, over: Record<string, unknown>) => {
      const row: Record<string, unknown> = { id: randomUUID(), accessoryId: acc, kind: 'receive', delta: 5, stockBefore: 0, stockAfter: 5, ...over };
      const cols = Object.keys(row);
      const vals = cols.map((c, i) => `$${i + 1}${c === 'kind' ? '::"AccessoryStockMovementKind"' : ''}`);
      return tx.$executeRawUnsafe(
        `INSERT INTO "AccessoryStockMovement" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${vals.join(', ')})`,
        ...cols.map((c) => row[c]),
      );
    };

    it('CONTROL: receive 0→5 y adjust con motivo entran', async () => {
      await rolledBack(async (tx) => {
        const a = await accessory(tx);
        await mv(tx, a, {});
        await mv(tx, a, { kind: 'adjust', delta: -2, stockBefore: 5, stockAfter: 3, reason: 'conteo físico', actorUserId: 'u1' });
      });
    });

    it.each([
      ['stockAfter ≠ stockBefore + delta', { stockAfter: 6 }, /accessory_movement_identity/],
      ['stockAfter negativo', { delta: -1, stockBefore: 0, stockAfter: -1 }, /accessory_movement_identity/],
      ['delta 0', { delta: 0, stockBefore: 5, stockAfter: 5 }, /accessory_movement_delta/],
      ['adjust sin motivo', { kind: 'adjust', delta: -1, stockBefore: 5, stockAfter: 4 }, /accessory_movement_adjust_reason/],
      ['adjust con motivo de 2', { kind: 'adjust', delta: -1, stockBefore: 5, stockAfter: 4, reason: 'ab' }, /accessory_movement_adjust_reason/],
      ['adjust con motivo de 201', { kind: 'adjust', delta: -1, stockBefore: 5, stockAfter: 4, reason: 'x'.repeat(201) }, /accessory_movement_adjust_reason/],
    ])('%s ⇒ error', async (_n, over, what) => {
      await rejects(what as RegExp, async (tx) => mv(tx, await accessory(tx), over as Record<string, unknown>));
    });

    it('FK RESTRICT: no se borra un accesorio con movimientos', async () => {
      await rejects(/AccessoryStockMovement_accessoryId_fkey|foreign key/, async (tx) => {
        const a = await accessory(tx);
        await mv(tx, a, {});
        await tx.$executeRawUnsafe(`DELETE FROM "Accessory" WHERE id = $1`, a);
      });
    });
  });

  describe('ShipmentAccessoryLine, Order, ShippingPackage, PaymentRefund', () => {
    async function shipment(tx: any, orderId: string): Promise<string> {
      const s = await tx.shipmentRequest.create({
        data: { orderId, addressSnapshot: { line1: 'Calle 1' }, shippingFeeCents: 17500, priceConvention: 'IVA_INCLUSIVE' },
      });
      return s.id;
    }
    async function shipLine(tx: any, over: Record<string, unknown> = {}): Promise<{ orderId: string; lineId: string; slId: string }> {
      const o = await order(tx, 'direct_ship');
      const lineId = await line(tx, o, await accessory(tx), { quantity: 3 });
      const row: Record<string, unknown> = { id: randomUUID(), shipmentRequestId: await shipment(tx, o), orderAccessoryLineId: lineId, quantity: 3, ...over };
      const cols = Object.keys(row);
      const casts: Record<string, string> = { prepStatus: '::"PreparationItemStatus"', missingReason: '::"MissingReason"' };
      await tx.$executeRawUnsafe(
        `INSERT INTO "ShipmentAccessoryLine" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c, i) => `$${i + 1}${casts[c] ?? ''}`).join(', ')})`,
        ...cols.map((c) => row[c]),
      );
      return { orderId: o, lineId, slId: row.id as string };
    }

    it('CONTROL: línea de envío pendiente y «faltó 1 de 3» entran', async () => {
      await rolledBack(async (tx) => {
        await shipLine(tx);
        await shipLine(tx, { prepStatus: 'missing', missingQty: 1, missingReason: 'not_found' });
      });
    });

    it.each([
      ['missing sin cantidad', { prepStatus: 'missing', missingReason: 'not_found' }],
      ['missing sin motivo', { prepStatus: 'missing', missingQty: 1 }],
      ['picked con cantidad faltante', { prepStatus: 'picked', missingQty: 1 }],
      ['pending con motivo', { missingReason: 'damaged' }],
      ['missingQty > quantity', { prepStatus: 'missing', missingQty: 4, missingReason: 'not_found' }],
    ])('ShipmentAccessoryLine: %s ⇒ error', async (_n, over) => {
      await rejects(/shipment_accessory_line_missing/, (tx) => shipLine(tx, over));
    });

    it('ShipmentAccessoryLine: un renglón ⇒ a lo más UNA línea de envío (@unique)', async () => {
      await rejects(/23505[\s\S]*orderAccessoryLineId/, async (tx) => {
        const { lineId } = await shipLine(tx);
        const [{ s }] = await tx.$queryRawUnsafe(`SELECT "shipmentRequestId" AS s FROM "ShipmentAccessoryLine" WHERE "orderAccessoryLineId" = $1`, lineId);
        await tx.$executeRawUnsafe(
          `INSERT INTO "ShipmentAccessoryLine" (id, "shipmentRequestId", "orderAccessoryLineId", quantity) VALUES ($1, $2, $3, 3)`,
          randomUUID(),
          s,
          lineId,
        );
      });
    });

    it('Order: «revisar caja» sin caja congelada ⇒ error; con caja ⇒ entra; las filas nacen sin caja', async () => {
      await rejects(/order_shipping_box_review/, async (tx) => {
        const o = await order(tx, 'direct_ship');
        await tx.$executeRawUnsafe(`UPDATE "Order" SET "shippingBoxReview" = true WHERE id = $1`, o);
      });
      await rolledBack(async (tx) => {
        const o = await order(tx, 'direct_ship');
        const [r0] = await tx.$queryRawUnsafe(`SELECT "shippingBoxReview" AS r, "shippingBoxSnapshot" AS s FROM "Order" WHERE id = $1`, o);
        expect(r0).toEqual({ r: false, s: null });
        await tx.$executeRawUnsafe(
          `UPDATE "Order" SET "shippingBoxReview" = true, "shippingBoxSnapshot" = '{"code":"box-l"}'::jsonb WHERE id = $1`,
          o,
        );
      });
    });

    it('ShippingPackage.customerFeeCents: 0 y 10_000_001 ⇒ error; NULL, 1 y 10_000_000 entran', async () => {
      const pkg = (tx: any, fee: number | null) =>
        tx.$executeRawUnsafe(
          `INSERT INTO "ShippingPackage" (id, code, label, "lengthCm", "widthCm", "heightCm", "weightKg", "providerPackageType", "customerFeeCents", "updatedAt")
           VALUES ($1, $2, 'Caja', 30, 20, 10, 1, '4G', $3, now())`,
          randomUUID(),
          `m73-${randomUUID()}`,
          fee,
        );
      await rejects(/shipping_package_customer_fee/, (tx) => pkg(tx, 0));
      await rejects(/shipping_package_customer_fee/, (tx) => pkg(tx, 10_000_001));
      await rolledBack(async (tx) => {
        await pkg(tx, null);
        await pkg(tx, 1);
        await pkg(tx, 10_000_000);
      });
    });

    /** Una fila `order_remaining` (forma ya admitida por los CHECK de M-61) con `over` encima. */
    async function refund(tx: any, orderId: string, over: Record<string, unknown>): Promise<void> {
      const row: Record<string, unknown> = {
        id: randomUUID(),
        idempotencyKey: `m73:${randomUUID()}`,
        kind: 'order_remaining',
        orderId,
        amountCents: 100,
        merchandiseCents: 100,
        merchandiseIvaCents: 14,
        shippingCents: 0,
        shippingIvaCents: 0,
        processingFeeCents: 0,
        requestedByUserId: 'u-m73',
        requestedByRole: 'vault_operator',
        ...over,
      };
      const cols = Object.keys(row);
      const casts: Record<string, string> = { kind: '::"PaymentRefundKind"', requestedByRole: '::"Role"' };
      await tx.$executeRawUnsafe(
        `INSERT INTO "PaymentRefund" (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${cols.map((c, i) => `$${i + 1}${casts[c] ?? ''}`).join(', ')})`,
        ...cols.map((c) => row[c]),
      );
    }

    it('PaymentRefund: CONTROL — una fila con renglón y cantidad entra; varias filas por renglón entran (sin @unique)', async () => {
      await rolledBack(async (tx) => {
        const { orderId, lineId, slId } = await shipLine(tx);
        await refund(tx, orderId, { orderAccessoryLineId: lineId, accessoryQty: 1 });
        await refund(tx, orderId, { orderAccessoryLineId: lineId, accessoryQty: 1, shipmentAccessoryLineId: slId });
      });
    });

    it.each([
      ['renglón sin cantidad', (l: string) => ({ orderAccessoryLineId: l }), /payment_refund_accessory_qty_pair/],
      ['cantidad sin renglón', () => ({ accessoryQty: 1 }), /payment_refund_accessory_qty_pair/],
      ['cantidad 0', (l: string) => ({ orderAccessoryLineId: l, accessoryQty: 0 }), /payment_refund_accessory_qty_min/],
      ['línea de envío sin renglón', (_l: string, s: string) => ({ shipmentAccessoryLineId: s }), /payment_refund_accessory_shipment_line/],
    ])('PaymentRefund: %s ⇒ error', async (_n, build, what) => {
      await rejects(what as RegExp, async (tx) => {
        const { orderId, lineId, slId } = await shipLine(tx);
        await refund(tx, orderId, (build as (l: string, s: string) => Record<string, unknown>)(lineId, slId));
      });
    });

    it('PaymentRefund: carta Y renglón en la misma fila ⇒ error (definición del CHECK)', async () => {
      // Una fila con `orderItemId` necesita forma de carta (M-61/M-70); se fija la DEFINICIÓN, que es lo que muerde.
      const [r] = await prisma.$queryRawUnsafe<{ def: string }[]>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = 'payment_refund_card_xor_accessory'`,
      );
      expect(r?.def).toMatch(/NOT \(\("orderItemId" IS NOT NULL\) AND \("orderAccessoryLineId" IS NOT NULL\)\)/);
    });

    it('PaymentRefund.shipmentAccessoryLineId es @unique: un faltante por línea', async () => {
      await rejects(/23505[\s\S]*shipmentAccessoryLineId/, async (tx) => {
        const { orderId, lineId, slId } = await shipLine(tx);
        await refund(tx, orderId, { orderAccessoryLineId: lineId, accessoryQty: 1, shipmentAccessoryLineId: slId });
        await refund(tx, orderId, { orderAccessoryLineId: lineId, accessoryQty: 1, shipmentAccessoryLineId: slId });
      });
    });
  });
});
