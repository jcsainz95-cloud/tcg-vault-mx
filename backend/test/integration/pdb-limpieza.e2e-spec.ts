/**
 * pdb-limpieza.e2e-spec.ts — 💰🔒 P-DB-LIMPIEZA contra Postgres REAL (docs/specs/LIMPIEZA_DB.md §9 y **§14 v2**, que manda
 * sobre v1). Propiedad: backend.
 *
 * Prueba los CUATRO guiones de `prisma/data-repair/20261006_pdblimpieza_*` tal como los corre el dueño (el texto del
 * fichero por psql), cada caso en un esquema propio recién migrado y sembrado con `limpieza-fixture.ts`:
 *
 *  §9.1 el ensayo (termina en ROLLBACK) deja la base IDÉNTICA — contenido de cada tabla y las tres secuencias;
 *  §9.2 (v2) la corrida vacía lo transaccional Y EL INVENTARIO ENTERO (plataforma, custodia, sellado, lotes, cola de
 *       precio `inventory`/`portfolio`) y conserva el CONTENIDO (no solo el conteo) de catálogo, precios, sellado,
 *       cajones, usuarios, diales, cola `catalog`/`buylist` y overrides (salvo las columnas de bounty);
 *  §9.3 idempotencia; §9.4 las guardas muerden (G-1, G-2, G-3, G-7 —también tras volver a subir inventario—, G-9 y
 *       respaldo vacío); A y D de solo lectura, D muerde (también «folio por delante de su contador»);
 *  §9.6 (v2) C reinicia `TCG-` e `INV-` con guardas INDEPENDIENTES y nunca `ENV-`;
 *  §9.7 con `ENV-` SIN reiniciar, la guía vieja `ENV-000003-01` no produce huérfana; con la secuencia reiniciada SÍ
 *       (la mutación, N = 3 esquemas);
 *  §9.8 sin M-72 el guion corre igual (y no nombra columnas de M-72).
 *  v2 retira el paso E (`limpieza:republicar`), P-1, P-2, G-4, G-6 y las pruebas que los cubrían (§14.7, §14.9).
 *  §14.13 (v2.2) las 9 tablas de M-73 (accesorios) y M-74 (lista de deseos): T-AC1…T-AC7 y T-W10a…e; con y sin ellas
 *       (T-AC3 compara contra la copia congelada del B de `a7232d7a` en dos esquemas gemelos).
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Fixture, d, seedFixture } from './helpers/limpieza-fixture';
import {
  FILES,
  Snapshot,
  assertConstraintsComplete,
  cleanupMigrations,
  dropSchema,
  header,
  limpiezaSql,
  migrateSchema,
  psql,
  PsqlResult,
  psqlAsync,
  psqlFile,
  readRepair,
  revertM72,
  revertM73,
  revertM74,
  cloneSchema,
  FROZEN_B_SHA256,
  readFrozenB,
  schemaUrl,
  snapshot,
} from './helpers/limpieza-db';
import { ShipmentOrphanService } from '../../src/modules/shipments/orphan-reconcile.service';
import { AdminAccessoriesService } from '../../src/modules/accessories/admin-accessories.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { deriveBountyState } from '../../src/modules/pricing/bounty-state';
import { PrismaService } from '../../src/prisma/prisma.service';

jest.setTimeout(180_000);

const RUN = `lz${Date.now().toString(36)}`;
let n = 0;

/** Tablas que la limpieza v2 VACÍA (§2.4–§2.7 + §14.2). `AuditLog` aparte: queda el rastro. */
const EMPTIED = [
  'Order', 'OrderItem', 'OrderAccessToken', 'PaymentRefund', 'ManualRefund', 'ReplacementCase', 'VaultPlacement', 'VaultPlacementItem',
  'ShipmentRequest', 'ShipmentItem', 'ShipmentQuote', 'ShipmentCarrierEvent', 'ShipmentAddressRevision', 'ShipmentCostAdjustment',
  'ShipmentLabelAttempt', 'ShipmentPaidLabel', 'Dispute', 'SellRequest', 'SellRequestItem', 'SpendAlert', 'PortfolioSnapshot',
  'InventoryItem', 'InventoryMovement', 'InventoryAdjustment', 'InventoryBatch',
  // v2.2 (§14.13): M-73 y M-74
  'OrderAccessoryLine', 'OrderEnergyBundleComponent', 'ShipmentAccessoryLine', 'AccessoryStockMovement', 'WishlistNotice',
];
/** Tablas que la limpieza toca EN PARTE (se comprueban por separado); todas las demás: contenido idéntico. */
const PARTIAL = ['VariantPriceOverride', 'PendingPriceEntry', 'AuditLog', 'Accessory'];
/** Las conservadas que el encargo nombra: deben tener filas en el fixture, o «idéntico» no probaría nada. */
const KEY_KEPT = [
  'User', 'Card', 'CardSet', 'SealedProduct', 'PriceReference', 'VaultLocation', 'ConfigSetting',
  // v2.2: `Accessory` se conserva (fila) pero se ajusta (existencias): está también en PARTIAL y se compara aparte.
  'Accessory', 'AccessoryPhoto', 'WishlistItem', 'WishlistMail',
];

interface Env {
  schema: string;
  db: PrismaClient;
  fx: Fixture;
}
const live: Env[] = [];
let admin: PrismaClient;

async function fresh(opts: { m72?: boolean; m73?: boolean; m74?: boolean } = {}): Promise<Env> {
  const m72 = opts.m72 ?? true;
  n += 1;
  const schema = `${RUN}_${n}`;
  migrateSchema(schema);
  await assertConstraintsComplete(admin, schema);
  const db = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
  const fx = await seedFixture(db, { m72 });
  if (!m72) await revertM72(admin, schema);
  // §14.13.5: la base de `production` sin #84 (sin M-74 y/o sin M-73). Primero M-74 (su orden inverso de despliegue).
  if (opts.m74 === false) revertM74(schema);
  if (opts.m73 === false) revertM73(schema);
  const env = { schema, db, fx };
  live.push(env);
  return env;
}

function ok(r: { status: number | null; stdout: string; stderr: string }) {
  if (r.status !== 0) throw new Error(`psql salió ${r.status}\n--- stderr ---\n${r.stderr}\n--- stdout (cola) ---\n${r.stdout.slice(-4000)}`);
  return r;
}

const RESPALDO = 'manual 2026-10-06 10:00 (prueba)';
/** Las dos cuentas con custodia del fixture (comprador y cliente 2), como las escribiría el dueño. */
const cuentasDe = (e: Env) => `${e.fx.email.buyer}, ${e.fx.email.client2}`;
const commitSql = (e: Env, cuentas?: string) => limpiezaSql({ respaldo: RESPALDO, cuentas: cuentas ?? cuentasDe(e), commit: true });
const drySql = (e: Env) => limpiezaSql({ respaldo: RESPALDO, cuentas: cuentasDe(e) });
const commit = (e: Env, cuentas?: string) => ok(psql(e.schema, commitSql(e, cuentas)));

function expectSame(a: Snapshot, b: Snapshot) {
  expect(b.sequences).toEqual(a.sequences);
  expect(b.tables).toEqual(a.tables);
}

/** Conteo + md5 del contenido de una consulta (una fila = un `jsonb` `j`), para las tablas que se tocan en parte. */
async function hashOf(schema: string, sql: string): Promise<{ n: number; h: string }> {
  const [r] = await admin.$queryRawUnsafe<{ n: number; h: string }[]>(
    `SELECT count(*)::int AS n, md5(coalesce(string_agg(j::text, '|' ORDER BY j::text), '')) AS h FROM (${sql.replace(/\$S/g, `"${schema}"`)}) z`,
  );
  return r;
}
async function partial(schema: string) {
  return {
    ppeKept: await hashOf(schema, `SELECT to_jsonb(p) AS j FROM $S."PendingPriceEntry" p WHERE p.context::text IN ('catalog', 'buylist')`),
    ppeGone: await hashOf(schema, `SELECT to_jsonb(p) AS j FROM $S."PendingPriceEntry" p WHERE p.context::text IN ('inventory', 'portfolio')`),
    // §14.9: los overrides del dueño se conservan salvo las dos columnas de bounty (y su `updatedAt`).
    vpo: await hashOf(schema, `SELECT to_jsonb(v) - 'bountyAcquiredQty' - 'bountyCompletedAt' - 'updatedAt' AS j FROM $S."VariantPriceOverride" v`),
  };
}

/** URL para psql (sin `?schema=`), como en el arnés. */
function libpqUrlForTest(): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.search = '';
  return u.toString();
}

/** El alta como la hace la APP: folio por `PrismaService.nextFolios` (no por SQL). */
async function altaPorApp(e: Env, k: number): Promise<string[]> {
  const prisma = new PrismaService({ datasources: { db: { url: schemaUrl(e.schema) } } } as any);
  try {
    const folios = await prisma.nextFolios(k);
    const card = await prisma.card.findFirstOrThrow();
    for (const folio of folios) {
      await prisma.inventoryItem.create({
        data: { folio, cardId: card.id, productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 300, status: 'in_stock' } as any,
      });
    }
    return folios;
  } finally {
    await prisma.$disconnect();
  }
}

/** El siguiente valor de una secuencia SIN consumirlo. */
async function nextOf(e: Env, seq: string): Promise<number> {
  const [r] = await admin.$queryRawUnsafe<{ v: string; c: boolean }[]>(`SELECT last_value::text AS v, is_called AS c FROM "${e.schema}".${seq}`);
  return Number(r.v) + (r.c ? 1 : 0);
}

beforeAll(() => {
  admin = new PrismaClient();
});
// Cada esquema abre su propio PrismaClient (con su pool). Sin soltarlo al terminar cada caso, ~50 clientes vivos a la vez
// agotan max_connections del Postgres compartido y el caso que toque falla con «remaining connection slots are
// reserved» (medido, be-lz22). `$disconnect` es reversible: si un caso vuelve a usar el cliente, Prisma reconecta.
afterEach(async () => {
  for (const e of live) await e.db.$disconnect();
});
afterAll(async () => {
  for (const e of live) {
    await e.db.$disconnect();
    await dropSchema(admin, e.schema);
  }
  await admin.$disconnect();
  cleanupMigrations();
});

describe('💰 P-DB-LIMPIEZA · guion B (limpieza, v2: también el inventario)', () => {
  it('§9.1 el ENSAYO (ROLLBACK) deja la base IDÉNTICA — tablas y las tres secuencias — y enseña pedidos, envíos, custodia por dueño y el RESUMEN del inventario (sin lista por pieza)', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, drySql(e)));
    expect(r.stdout).toMatch(/PUNTO PITR/);
    expect(r.stdout).toContain('TCG-000001');
    expect(r.stdout).toContain(e.fx.directShipFolio);
    expect(r.stdout).toContain(e.fx.email.buyer);
    expect(r.stdout).toContain(e.fx.email.client2);
    expect(r.stdout).toMatch(/RESUMEN DEL INVENTARIO QUE SE BORRA/);
    expect(r.stdout).toMatch(/sellado/);
    // ⛔ sin lista por pieza (§14.3: miles de filas): ni el folio de una pieza que no toca nada sale
    expect(r.stdout).not.toContain(e.fx.piece.P9.folio);
    expect(r.stdout).toMatch(/ROLLBACK/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.1 el ensayo SIN variables (tal cual, paso 5 del dueño) enseña la custodia y aborta AL FINAL pidiendo respaldo y cuentas — base IDÉNTICA', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, readRepair('limpieza'));
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain(e.fx.email.client2); // la lista de custodia sale ANTES de pedir la respuesta
    expect(r.stderr).toMatch(/respaldo_manual/);
    expect(r.stderr).toMatch(/cuentas_prueba/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.1 B no lleva ningún setval/nextval (las secuencias no se deshacen con ROLLBACK: van en C)', () => {
    const code = readRepair('limpieza').replace(/--.*$/gm, '');
    expect(code).not.toMatch(/\bsetval\b|\bnextval\b/i);
  });

  it('§9.2 la CORRIDA vacía lo transaccional y el inventario ENTERO (plataforma, custodia, sellado, lotes, cola inventory/portfolio) y conserva el CONTENIDO de lo demás', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const pBefore = await partial(e.schema);
    // Lo que se va a borrar EXISTE (si fuera 0, «queda en 0» no probaría nada): los tres tipos y los dos dueños.
    for (const t of ['InventoryItem', 'InventoryMovement', 'InventoryAdjustment', 'InventoryBatch']) expect({ t, n: before.tables[t].n > 0 }).toEqual({ t, n: true });
    expect(await e.db.inventoryItem.count({ where: { productType: 'sealed' } })).toBe(1);
    expect(await e.db.inventoryItem.count({ where: { ownerType: 'customer' } })).toBe(5);
    expect(await e.db.inventoryItem.count({ where: { ownerType: 'platform' } })).toBeGreaterThan(0);
    expect(pBefore.ppeGone.n).toBe(4);
    expect(pBefore.ppeKept.n).toBe(2);

    commit(e);
    const after = await snapshot(admin, e.schema);
    // Medición DIRECTA (no la guarda G-5 del guion): cada tabla vaciada tiene 0 filas.
    for (const t of EMPTIED) expect({ t, n: after.tables[t].n }).toEqual({ t, n: 0 });
    expect(await e.db.inventoryItem.count()).toBe(0);

    // Todo lo que no se vacía ni se toca en parte: CONTENIDO idéntico (md5 de cada fila), no solo el conteo.
    const kept = Object.keys(before.tables).filter((t) => !EMPTIED.includes(t) && !PARTIAL.includes(t));
    for (const t of KEY_KEPT) {
      const conservada = kept.includes(t) || (PARTIAL.includes(t) && after.tables[t].n === before.tables[t].n);
      expect({ t, conservada, conFilas: before.tables[t].n > 0 }).toEqual({ t, conservada: true, conFilas: true });
    }
    for (const t of kept) expect({ t, s: after.tables[t] }).toEqual({ t, s: before.tables[t] });
    expect(after.sequences).toEqual(before.sequences); // ⛔ B no toca secuencias (R-3)

    const pAfter = await partial(e.schema);
    expect(pAfter.ppeKept).toEqual(pBefore.ppeKept); // cola de catálogo y cotizador: idéntica
    expect(pAfter.ppeGone.n).toBe(0);
    expect(pAfter.vpo).toEqual(pBefore.vpo); // overrides del dueño intactos salvo bounty
    expect(await e.db.sealedProduct.findUniqueOrThrow({ where: { id: e.fx.sealedProduct } })).toMatchObject({
      imageUrl: 'https://tcgplayer-cdn.tcgplayer.com/product/lz_200w.jpg',
      ownerDisplayPriceCents: 159900,
    });
    expect(await e.db.vaultLocation.count()).toBe(4);

    const audit = await e.db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: null, actorRole: null, action: 'maintenance.test_data_purge', entityType: 'Database', entityId: 'P-DB-LIMPIEZA' });
    const trace = audit[0].after as any;
    expect(trace.respaldoManual).toBe(RESPALDO);
    expect(trace.conteosAntes.Order).toBe(5);
    expect(trace.conteosDespues.Order).toBe(0);
    expect(trace.conteosDespues.InventoryItem).toBe(0);
    expect(typeof trace.puntoPitr).toBe('string');
    expect(trace.inventarioBorrado).toEqual({
      total: before.tables.InventoryItem.n,
      porTipo: { raw: before.tables.InventoryItem.n - 1, graded: 0, sealed: 1 },
      custodiaPorUsuario: { [e.fx.buyer]: 4, [e.fx.client2]: 1 },
    });
    expect(trace.cuentasPrueba).toBe(2);
    expect(Object.keys(trace.secuencias).sort()).toEqual(['inventory_folio_seq', 'order_number_seq', 'shipment_folio_seq']);
    for (const k of ['piezasRestauradas', 'piezasExcluidas', 'piezasBuylistBorradas', 'piezasBuylistConservadas']) expect(trace).not.toHaveProperty(k);
    expect(JSON.stringify(trace)).not.toMatch(/INV-\d|@/); // ids, sin folios ni correos (§14.3)
  });

  it('§2.2 bounty: adquirido ⇒ 0, sello de completado ⇒ NULL, `bountyEnabled` intacto ⇒ el estado derivado es `apagada`', async () => {
    const e = await fresh();
    commit(e);
    const c = await e.db.variantPriceOverride.findUniqueOrThrow({ where: { id: e.fx.bounty.completed } });
    expect(c).toMatchObject({ bountyEnabled: false, bountyAcquiredQty: 0, bountyCompletedAt: null, bountyPriceCents: 900, bountyTargetQty: 1 });
    expect(deriveBountyState({ enabled: c.bountyEnabled, completedAt: c.bountyCompletedAt, priceCents: c.bountyPriceCents, effective: false } as any, c.bountyUnpublishedAt)).toBe('apagada');
    const o = await e.db.variantPriceOverride.findUniqueOrThrow({ where: { id: e.fx.bounty.open } });
    expect(o).toMatchObject({ bountyEnabled: true, bountyAcquiredQty: 0, bountyPriceCents: 800 });
    const s = await e.db.variantPriceOverride.findUniqueOrThrow({ where: { id: e.fx.bounty.sellOnly } });
    expect(s).toMatchObject({ sellOverrideCents: 1500, bountyAcquiredQty: 0, bountyEnabled: false });
  });

  it('§9.3 IDEMPOTENCIA: la segunda corrida no cambia NADA (ni el rastro)', async () => {
    const e = await fresh();
    commit(e);
    const once = await snapshot(admin, e.schema);
    commit(e);
    expectSame(once, await snapshot(admin, e.schema));
  });

  describe('§9.4 las guardas MUERDEN (abortan y la base queda IDÉNTICA)', () => {
    async function aborts(e: Env, sql: string, msg: RegExp) {
      const before = await snapshot(admin, e.schema);
      const r = psql(e.schema, sql);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(msg);
      expectSame(before, await snapshot(admin, e.schema));
      return r;
    }
    it('G-1: una pieza de cliente que no vino de ningún pedido', async () => {
      const e = await fresh();
      await e.db.inventoryItem.update({ where: { id: e.fx.piece.P10.id }, data: { ownerType: 'customer', ownerUserId: e.fx.buyer, ownershipStatus: 'settled' } });
      await aborts(e, commitSql(e), /G-1/);
    });
    it('G-2: una pieza `in_custody` fuera de T', async () => {
      const e = await fresh();
      await e.db.inventoryItem.update({ where: { id: e.fx.piece.P10.id }, data: { status: 'in_custody' } });
      await aborts(e, commitSql(e), /G-2/);
    });
    it('G-3: un movimiento `settle` sobre una pieza fuera de T', async () => {
      const e = await fresh();
      await e.db.inventoryMovement.create({ data: { itemId: e.fx.piece.P9.id, reason: 'settle', createdAt: d(4) } });
      await aborts(e, commitSql(e), /G-3/);
    });
    it('respaldo_manual vacío', async () => {
      const e = await fresh();
      await aborts(e, limpiezaSql({ cuentas: cuentasDe(e), commit: true }), /respaldo_manual/);
    });
    it('G-7: la limpieza YA se hizo y después hubo un pedido ⇒ no se vuelve a correr', async () => {
      const e = await fresh();
      commit(e);
      await e.db.order.create({
        data: { userId: e.fx.buyer, orderNumber: 'TCG-000001', fulfillmentMode: 'vault', status: 'settled', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' },
      });
      await aborts(e, commitSql(e), /G-7/);
    });
    it('G-7 (v2): B (COMMIT) + C + el dueño vuelve a subir UNA pieza ⇒ una 2.ª corrida de B se niega y NO borra la pieza nueva', async () => {
      const e = await fresh();
      commit(e);
      ok(psql(e.schema, readRepair('folio')));
      const [folio] = await altaPorApp(e, 1);
      expect(folio).toBe('INV-000001');
      await aborts(e, commitSql(e), /G-7[^\n]*InventoryItem/);
      expect(await e.db.inventoryItem.findUnique({ where: { folio } })).not.toBeNull();
    });

    it('G-9: pieza en custodia de un cliente NO declarado en `cuentas_prueba` ⇒ aborta y el mensaje NOMBRA al cliente', async () => {
      const e = await fresh();
      const r = await aborts(e, commitSql(e, e.fx.email.buyer), /G-9/);
      expect(r.stderr).toContain(e.fx.email.client2);
      expect(r.stderr).not.toContain(e.fx.email.buyer);
    });
    it('G-9: errata — un correo de la lista que NO existe ⇒ aborta (un error tipográfico no decide borrar nada)', async () => {
      const e = await fresh();
      const r = await aborts(e, commitSql(e, `${cuentasDe(e)}, nadie.${e.schema}@lz.local`), /G-9/);
      expect(r.stderr).toContain(`nadie.${e.schema}@lz.local`);
    });
    // (Una pieza de cliente SIN dueño no se puede fabricar: la base la rechaza con el CHECK
    // `InventoryItem_customer_has_owner_chk` — medido 2026-10-07. El guion la trata igual como «no declarada».)
    it('G-9: errata por id — un id que no es ninguna cuenta ⇒ aborta', async () => {
      const e = await fresh();
      await aborts(e, commitSql(e, `${e.fx.email.buyer}, ${e.fx.client2}, id-que-no-existe`), /G-9[^\n]*id-que-no-existe/);
    });
    it('G-9: con AMBOS clientes declarados (uno por correo en MAYÚSCULAS, otro por id) ⇒ pasa y su custodia se borra', async () => {
      const e = await fresh();
      commit(e, `${e.fx.email.buyer.toUpperCase()} , ${e.fx.client2}`);
      expect(await e.db.inventoryItem.count()).toBe(0);
      expect(((await e.db.auditLog.findFirstOrThrow()).after as any).cuentasPrueba).toBe(2);
    });
    it('G-9: sin piezas de cliente y la lista vacía ⇒ pasa', async () => {
      const e = await fresh();
      await e.db.inventoryItem.updateMany({ where: { ownerType: 'customer' }, data: { ownerType: 'platform', ownerUserId: null, ownershipStatus: null } });
      commit(e, '');
      expect(await e.db.inventoryItem.count()).toBe(0);
    });
  });
});

describe('💰 P-DB-LIMPIEZA · A (censo) y D (verificación) son de SOLO LECTURA; D muerde', () => {
  it('A informa conteos, FK, guardas, custodia por dueño, secuencias y M-72 sin cambiar nada', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('censo')));
    expect(r.stdout).toMatch(/order_number_seq\s*\|\s*5/);
    expect(r.stdout).toMatch(/shipment_folio_seq\s*\|\s*3/);
    expect(r.stdout).toContain('ManualRefund_reissuedFromId_fkey');
    expect(r.stdout).toMatch(/G-9/);
    expect(r.stdout).not.toMatch(/G-4|P-1/);
    expect(r.stdout).toContain(e.fx.email.client2);
    expect(r.stdout).toMatch(/m72_aplicada\s*\|?\s*\n[-+]+\n\s*t/);
    expect(r.stdout).toContain('ENV-000003-01');
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('D sobre la base SIN limpiar ⇒ HAY FALLAS (cada línea muerde); tras B + C ⇒ TODO OK; y no escribe', async () => {
    const e = await fresh();
    const dirty = psql(e.schema, readRepair('verificacion'));
    expect(dirty.stdout).toMatch(/HAY FALLAS/);
    for (const line of [
      '0 filas en Order', '0 filas en ShipmentRequest', '0 filas en SellRequest', 'AuditLog: exactamente 1 rastro', '0 piezas de cliente',
      '0 movimientos de venta', '0 piezas ligadas', 'contador de pedidos', 'contador de inventario', 'bounties: comprado = 0',
      '0 filas anteriores a la limpieza en InventoryItem', '0 filas anteriores a la limpieza en InventoryMovement',
      '0 filas anteriores a la limpieza en InventoryAdjustment', '0 filas anteriores a la limpieza en InventoryBatch',
      '0 filas anteriores a la limpieza en PendingPriceEntry',
    ]) {
      expect({ line, falla: new RegExp(`FALLA\\s*\\|\\s*${line}`).test(dirty.stdout) }).toEqual({ line, falla: true });
    }
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
    expect(r.stdout).not.toMatch(/\bFALLA\b/);
    expect(r.stdout).toMatch(/OK\s*\|\s*ningún folio por delante de su contador: INV-/);
    expect(r.stdout).toMatch(/OK\s*\|\s*ningún folio por delante de su contador: TCG-/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('D (v2): tras B + C + alta de 3 piezas por la APP (`PrismaService.nextFolios`) ⇒ las piezas son INV-000001…3 y D sigue en TODO OK', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    expect(await altaPorApp(e, 3)).toEqual(['INV-000001', 'INV-000002', 'INV-000003']);
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
  });

  it('D (v2): una pieza con folio POR DELANTE de su contador (INV-000050 con el contador en 1) ⇒ FALLA en esa línea', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    const card = await e.db.card.findFirstOrThrow();
    await e.db.inventoryItem.create({ data: { folio: 'INV-000050', cardId: card.id, productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1 } as any });
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/FALLA\s*\|\s*ningún folio por delante de su contador: INV-/);
    expect(r.stdout).toMatch(/OK\s*\|\s*ningún folio por delante de su contador: TCG-/);
    expect(r.stdout).toMatch(/HAY FALLAS/);
  });
});

describe('💰 P-DB-LIMPIEZA · C v2 (folios TCG- e INV-, guardas independientes; ENV- nunca)', () => {
  it('§9.6 con pedidos Y piezas (sin limpiar) ⇒ ABORTA y ninguna secuencia se mueve', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, readRepair('folio'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Order/);
    expect(r.stderr).toMatch(/[Cc]orre primero la limpieza/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.6 sin pedidos ni piezas ⇒ TCG-000001 e INV-000001; ENV- sigue donde estaba', async () => {
    const e = await fresh();
    commit(e);
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('folio')));
    const after = await snapshot(admin, e.schema);
    expect(after.sequences.shipment_folio_seq).toEqual(before.sequences.shipment_folio_seq);
    expect(await nextOf(e, 'order_number_seq')).toBe(1);
    expect(await nextOf(e, 'inventory_folio_seq')).toBe(1);
    expect(r.stdout).toContain('TCG-000001');
    expect(r.stdout).toContain('INV-000001');
  });

  it('§9.6 con piezas nuevas y sin pedidos ⇒ TCG- se reinicia, INV- NO se mueve y lo dice; ENV- igual', async () => {
    const e = await fresh();
    commit(e);
    const card = await e.db.card.findFirstOrThrow();
    const [{ v }] = await e.db.$queryRawUnsafe<{ v: bigint }[]>(`SELECT nextval('inventory_folio_seq') AS v`);
    await e.db.inventoryItem.create({ data: { folio: `INV-${String(Number(v)).padStart(6, '0')}`, cardId: card.id, productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1 } as any });
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('folio')));
    const after = await snapshot(admin, e.schema);
    expect(after.sequences.inventory_folio_seq).toEqual(before.sequences.inventory_folio_seq);
    expect(after.sequences.shipment_folio_seq).toEqual(before.sequences.shipment_folio_seq);
    expect(await nextOf(e, 'order_number_seq')).toBe(1);
    // §14.12: la frase común con C y D (ya no «no pasa nada»), con el mínimo y el máximo NUMÉRICOS.
    const f = `INV-${String(Number(v)).padStart(6, '0')}`;
    expect(r.stdout).toContain(`${FRASE_INV} (1 pieza(s), de ${f} a ${f})`);
    expect(r.stdout).not.toMatch(/no pasa nada/);
  });

  it('§9.6 con pedidos y sin piezas ⇒ INV- se reinicia, TCG- NO se mueve y lo dice; ENV- igual', async () => {
    const e = await fresh();
    commit(e);
    await e.db.order.create({
      data: { userId: e.fx.buyer, orderNumber: 'TCG-000099', fulfillmentMode: 'vault', status: 'settled', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' },
    });
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('folio')));
    const after = await snapshot(admin, e.schema);
    expect(after.sequences.order_number_seq).toEqual(before.sequences.order_number_seq);
    expect(after.sequences.shipment_folio_seq).toEqual(before.sequences.shipment_folio_seq);
    expect(await nextOf(e, 'inventory_folio_seq')).toBe(1);
    expect(r.stdout).toMatch(/ya hay 1 pedido/);
  });

  it('QA-8 · C tras la limpieza con un pedido REAL y una pieza REAL ⇒ se niega SIN decir «corre primero la limpieza»', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await e.db.order.create({
      data: { userId: e.fx.buyer, orderNumber: 'TCG-000001', fulfillmentMode: 'vault', status: 'settled', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' },
    });
    await altaPorApp(e, 1);
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, readRepair('folio'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/[Cc]orre primero la limpieza/);
    expect(r.stderr).toMatch(/limpieza YA se hizo[^\n]*TCG-000001/);
    expectSame(before, await snapshot(admin, e.schema));
  });
});

/** §14.12 · la frase LITERAL que C y D comparten cuando `INV-` no se pudo reiniciar (las pruebas la buscan como subcadena). */
const FRASE_INV = 'NO se reinició INV-: ya había piezas cuando corriste C';
/** La línea de la salida de D (formato alineado de psql: `resultado | comprobación | detalle`) cuya comprobación empieza por `comprobacion`. */
function lineaD(stdout: string, comprobacion: string): string {
  const l = stdout.split('\n').find((x) => new RegExp(`^\\s*\\S+\\s*\\|\\s*${comprobacion}`).test(x));
  if (!l) throw new Error(`D no trae la línea «${comprobacion}»:\n${stdout.slice(-3000)}`);
  return l;
}
const resultadoDe = (linea: string) => linea.split('|')[0].trim();
/** `R` de §14.12: el `last_value` de `inventory_folio_seq` que B guardó en el rastro. */
async function rastroInv(e: Env): Promise<number> {
  const a = await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } });
  return Number((a.after as any).secuencias.inventory_folio_seq);
}
const inv = (k: number) => `INV-${String(k).padStart(6, '0')}`;

describe('💰 §14.12 v2.1 · C y D dicen lo mismo del folio INV- (QA N-1, MENOR-1, MENOR-3)', () => {
  it('T-N1 · B COMMIT → 2 piezas por la APP → C → D: C reinicia TCG-, NO INV- y lo dice con la frase común; D da AVISO (no FALLA) con la MISMA frase y el MISMO primer folio, y TODO OK', async () => {
    const e = await fresh();
    commit(e);
    const R = await rastroInv(e);
    const folios = await altaPorApp(e, 2);
    expect(folios).toEqual([inv(R + 1), inv(R + 2)]);

    const c = ok(psql(e.schema, readRepair('folio')));
    expect(await nextOf(e, 'order_number_seq')).toBe(1);
    expect(await nextOf(e, 'inventory_folio_seq')).toBe(R + 3); // INV- no se movió
    const lc = c.stdout.split('\n').find((x) => x.includes('inventario (INV-)') && x.includes(FRASE_INV));
    expect({ lineaC: lc ?? c.stdout.slice(-2000) }).toEqual({ lineaC: expect.stringContaining(FRASE_INV) });
    expect(lc).toContain(`(2 pieza(s), de ${inv(R + 1)} a ${inv(R + 2)})`);
    expect(c.stdout).not.toMatch(/no pasa nada/);

    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect(resultadoDe(l51)).toBe('AVISO');
    expect(l51).toContain(FRASE_INV);
    expect(l51).toContain(`primera ${inv(R + 1)}`); // el mismo primer folio que nombró C
    expect(l51).toContain(`siguiente ${inv(R + 3)}`);
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK \(con 1 aviso\(s\)\)/);
    expect(d.stdout).not.toMatch(/\bFALLA\b/);
  });

  it('T-N1-ctl · B COMMIT → 2 piezas por la APP → SIN C → D: la línea de inventario es FALLA (no AVISO), la de pedidos FALLA y HAY FALLAS', async () => {
    const e = await fresh();
    commit(e);
    await altaPorApp(e, 2);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect(resultadoDe(l51)).toBe('FALLA');
    expect(l51).not.toContain(FRASE_INV);
    expect(resultadoDe(lineaD(d.stdout, 'contador de pedidos'))).toBe('FALLA');
    expect(d.stdout).toMatch(/HAY FALLAS/);
    expect(d.stdout).not.toMatch(/\bAVISO\b/);
  });

  it('T-N1-sinPiezas (QA v2.1, QM1) · B COMMIT → SIN C → SIN altas, con el contador de pedidos ya usado → D: «sin piezas» NO basta, la línea de inventario es FALLA porque el siguiente no es INV-000001', async () => {
    const e = await fresh();
    commit(e);
    // Precondiciones: sin piezas, el siguiente INV- NO es 1 y el contador de pedidos ya se usó (C no corrió).
    expect(await e.db.inventoryItem.count()).toBe(0);
    const R = await rastroInv(e);
    expect(await nextOf(e, 'inventory_folio_seq')).toBe(R + 1);
    expect(R + 1).toBeGreaterThan(1);
    expect(await nextOf(e, 'order_number_seq')).toBeGreaterThan(1);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect({ l51, r: resultadoDe(l51) }).toEqual({ l51, r: 'FALLA' });
    expect(l51).toContain('C no corrió');
    expect(l51).toContain(`siguiente ${inv(R + 1)}`);
    expect(l51).not.toContain('sin cartas');
    expect(resultadoDe(lineaD(d.stdout, 'contador de pedidos'))).toBe('FALLA');
    expect(d.stdout).toMatch(/HAY FALLAS/);
    expect(d.stdout).not.toMatch(/\bAVISO\b|TODO OK/);
  });

  // §14.12 · el límite de R (QM3: R leído de otra clave del rastro). Cada caso fuerza ANTES de B que el contador de
  // pedidos del rastro quede del lado contrario del límite, para que leer la clave equivocada cambie el resultado.
  it('T-R-borde · m = R ⇒ OK (B → C → R piezas → se borran por SQL INV-000001…R-1); el rastro de pedidos queda POR DEBAJO de R', async () => {
    const e = await fresh();
    const ord = await nextOf(e, 'order_number_seq');
    if ((await nextOf(e, 'inventory_folio_seq')) < ord + 3) await e.db.$queryRawUnsafe(`SELECT setval('inventory_folio_seq', ${ord + 3}, true)`);
    commit(e);
    const R = await rastroInv(e);
    const a = await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } });
    expect(Number((a.after as any).secuencias.order_number_seq)).toBeLessThan(R); // precondición de la mutación
    ok(psql(e.schema, readRepair('folio')));
    const folios = await altaPorApp(e, R);
    expect(folios[0]).toBe(inv(1));
    expect(folios[R - 1]).toBe(inv(R));
    expect(await e.db.$executeRawUnsafe(`DELETE FROM "InventoryItem" WHERE substring(folio FROM 5)::bigint < ${R}`)).toBe(R - 1);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect({ l51, r: resultadoDe(l51) }).toEqual({ l51, r: 'OK' });
    expect(l51).toContain(`primera carta ${inv(R)}`);
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK\s*\|/);
    expect(d.stdout).not.toMatch(/\bFALLA\b|\bAVISO\b/);
  });

  it('T-R-borde · m = R + 1 ⇒ AVISO (B → 1 pieza por la APP → C → D); el rastro de pedidos queda POR ENCIMA de R + 1', async () => {
    const e = await fresh();
    const R0 = await nextOf(e, 'inventory_folio_seq');
    if ((await nextOf(e, 'order_number_seq')) < R0 + 3) await e.db.$queryRawUnsafe(`SELECT setval('order_number_seq', ${R0 + 3}, true)`);
    commit(e);
    const R = await rastroInv(e);
    const a = await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } });
    expect(Number((a.after as any).secuencias.order_number_seq)).toBeGreaterThan(R + 1); // precondición de la mutación
    expect(await altaPorApp(e, 1)).toEqual([inv(R + 1)]);
    ok(psql(e.schema, readRepair('folio')));
    expect(await nextOf(e, 'order_number_seq')).toBe(1);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect({ l51, r: resultadoDe(l51) }).toEqual({ l51, r: 'AVISO' });
    expect(l51).toContain(FRASE_INV);
    expect(l51).toContain(`primera ${inv(R + 1)}`);
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK \(con 1 aviso\(s\)\)/);
    expect(d.stdout).not.toMatch(/\bFALLA\b/);
  });

  it('T-M3 · B → C → 3 piezas por la APP → se borra por SQL la fila INV-000001 → D: la línea de inventario es OK (mínimo NUMÉRICO ≤ rastro) y TODO OK', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    expect(await altaPorApp(e, 3)).toEqual([inv(1), inv(2), inv(3)]);
    // Precondición construida por SQL (que la app pueda borrar la FILA de una pieza: NO MEDIDO, §14.12 MENOR-3).
    expect(await e.db.$executeRawUnsafe(`DELETE FROM "InventoryItem" WHERE folio = 'INV-000001'`)).toBe(1);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l51 = lineaD(d.stdout, 'contador de inventario');
    expect({ l51, r: resultadoDe(l51) }).toEqual({ l51, r: 'OK' });
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK/);
    expect(d.stdout).not.toMatch(/\bFALLA\b|\bAVISO\b/);
  });

  it('T-M1 · shipment_folio_seq NUNCA usada (is_called = f) antes de B → B → C → D: la línea «contador shipment_folio_seq» es OK con «ahora 1 · rastro 1»', async () => {
    const e = await fresh();
    await e.db.$queryRawUnsafe(`SELECT setval('shipment_folio_seq', 1, false)`);
    const [s] = await admin.$queryRawUnsafe<{ v: string; c: boolean }[]>(`SELECT last_value::text AS v, is_called AS c FROM "${e.schema}".shipment_folio_seq`);
    expect(s).toEqual({ v: '1', c: false }); // la prueba ejerce el caso «nunca leída»
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    const d = ok(psql(e.schema, readRepair('verificacion')));
    const l53 = lineaD(d.stdout, 'contador shipment_folio_seq');
    expect({ l53, r: resultadoDe(l53) }).toEqual({ l53, r: 'OK' });
    expect(l53).toMatch(/ahora 1 · rastro 1\s*$/);
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK/);
  });
});

describe('💰🔒 §9.7 · ENV- no se reinicia: la guía vieja ENV-000003-01 no se vuelve huérfana falsa', () => {
  const cfg = { purchaseMaxLifeMs: 60 * 60 * 1000 } as any;
  /**
   * Tras B + C, la tienda arranca en real y saca sus TRES primeros envíos con guía (intento -01 cada uno); el job lee el
   * listado de Skydropx, que todavía trae la guía VIEJA `ENV-000003-01` (real, cancelada). `resetEnv` reinicia la
   * secuencia como lo haría un C que también reiniciara `ENV-`.
   */
  async function scenario(e: Env, opts: { resetEnv: boolean }) {
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    if (opts.resetEnv) await e.db.$queryRawUnsafe(`SELECT setval('shipment_folio_seq', 1, false)`);
    const addr = { line1: 'x', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX' };
    const folios: string[] = [];
    for (let i = 1; i <= 3; i++) {
      const since = new Date(Date.now() - (4 - i) * 1000);
      const sr = await e.db.shipmentRequest.create({
        data: {
          userId: e.fx.buyer, addressSnapshot: addr, status: 'guia', shippingFeeCents: 0, priceConvention: 'IVA_INCLUSIVE', labelSource: 'skydropx',
          providerShipmentId: `sdx-nueva-${i}`, providerRateId: 'r', chosenRateJson: {}, rateChosenByUserId: e.fx.staff, rateChosenAt: since,
          labelPurchasedAt: since, packageCode: 'box', declaredValueCents: 1, insuredValueCents: 1, trackingNumber: `NUEVA-${i}`,
        },
      });
      await e.db.shipmentLabelAttempt.create({
        data: {
          shipmentRequestId: sr.id, since, actorUserId: e.fx.staff, capExempt: true, rateId: 'r', carrierName: 'fedex', expectedChargeCents: 9999,
          marginCents: 0, attemptNo: 1, providerReference: `${sr.folio}-01`, sentAt: since, outcome: 'labeled', outcomeAt: since,
        },
      });
      folios.push(sr.folio);
    }
    const svc = new ShipmentOrphanService(e.db as any, {} as any, {} as any, cfg);
    (svc as any).logger = { warn: () => undefined, error: () => undefined, log: () => undefined };
    const listing = [{ readable: true, coversFrom: true, shipments: [{
      providerShipmentId: 'sdx-old-skydropx', createdAt: d(2).toISOString(), carrierName: 'fedex', totalCents: 12000, postalCodeTo: '01000', source: 'api',
      hasError: false, providerReference: 'ENV-000003-01',
    }] }];
    const wrote = await svc.detectLate(listing, new Date());
    const orphans = await e.db.shipmentPaidLabel.count({ where: { origin: 'orphan' } });
    return { wrote, orphans, folios };
  }

  it('sin reiniciar ENV- (lo que hacen B y C): 0 huérfanas — N = 3 esquemas', async () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await fresh();
      const r = await scenario(e, { resetEnv: false });
      results.push(`${r.wrote}/${r.orphans}`);
    }
    expect(results).toEqual(['0/0', '0/0', '0/0']);
  });

  it('CONTROL — reiniciando ENV- aparece la huérfana falsa con el cobro del intento NUEVO — N = 3 esquemas (3/3 esperado)', async () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await fresh();
      const r = await scenario(e, { resetEnv: true });
      expect(r.folios).toEqual(['ENV-000001', 'ENV-000002', 'ENV-000003']);
      const pl = await e.db.shipmentPaidLabel.findFirstOrThrow({ where: { origin: 'orphan' } });
      expect(pl.chargedCents).toBe(9999);
      results.push(`${r.wrote}/${r.orphans}`);
    }
    expect(results).toEqual(['1/1', '1/1', '1/1']);
  });
});

describe('💰 §9.8 / §11 · sin M-72', () => {
  it('el guion B no nombra columnas de M-72 (fuera de comentarios)', () => {
    // `SellRequestItem."sellRequestId"` es de siempre (no de M-72): se admite SOLO en esa forma exacta.
    const code = readRepair('limpieza').replace(/--.*$/gm, '').replace(/"SellRequestItem" x WHERE x\."sellRequestId"/g, '');
    expect(code).not.toMatch(/\bkind\b|sellRequestId|inboundGuideClockStartedAt|buylist_inbound|buylist_guide_due/);
  });

  it('esquema SIN M-72: A, B (COMMIT), C y D corren y dan lo mismo', async () => {
    const e = await fresh({ m72: false });
    const cols = await admin.$queryRawUnsafe<{ c: string }[]>(
      `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = $1 AND table_name = 'ShipmentRequest' AND column_name = 'kind'`,
      e.schema,
    );
    expect(cols).toEqual([]);
    const census = ok(psql(e.schema, readRepair('censo')));
    expect(census.stdout).toMatch(/m72_aplicada\s*\|?\s*\n[-+]+\n\s*f/);
    const before = await snapshot(admin, e.schema);
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
    const after = await snapshot(admin, e.schema);
    for (const t of ['Order', 'ShipmentRequest', 'SellRequest', 'ManualRefund', 'InventoryItem']) expect(after.tables[t].n).toBe(0);
    expect(after.tables.User).toEqual(before.tables.User);
  });
});

describe('🔒 C-1 / C-2 / QA-9 · cómo se corre cada guion (y cómo NO), y qué se ve', () => {
  const ALL = ['censo', 'limpieza', 'folio', 'verificacion'] as const;

  it.each(ALL)('%s: el encabezado manda `\\i <fichero>` tras `railway connect` o `psql <URL SIN contraseña> -v ON_ERROR_STOP=1 -f <fichero>`, nunca «pegar»; pide el cliente psql y marca `railway connect` como NO MEDIDO', (f) => {
    const h = header(readRepair(f));
    expect(h).toContain(`psql "postgresql://USUARIO@HOST:PUERTO/BASE" -v ON_ERROR_STOP=1 -f ${FILES[f]}`);
    // CS-1 / LZ-S1 (seguridad): primero `railway connect` (sin teclear URL), nada de URL con contraseña en la línea de órdenes.
    expect(h.indexOf('1.º (recomendado) · `railway connect`')).toBeGreaterThan(-1);
    expect(h.indexOf('1.º (recomendado) · `railway connect`')).toBeLessThan(h.indexOf('psql "postgresql://USUARIO@'));
    expect(h).not.toMatch(/psql "\$URL"|^--\s+URL=|^--\s+DATABASE_URL='/m);
    expect(h).toMatch(/CAMBIA la contraseña de Postgres/);
    expect(h).toContain(`\\i ${FILES[f]}`);
    expect(h).not.toMatch(/\b(pega|pégalo|pegalo|pegarlo)\b/i);
    expect(h).toMatch(/NUNCA lo pegues/);
    expect(h).toMatch(/cliente `?psql`?/);
    expect(h).toMatch(/\\set.*\\if.*\\gset/);
    expect(h).toMatch(/railway connect[^\n]*\n?[^\n]*NO MEDIDO/);
    // v2 (§14.7): el paso E se retiró — ningún guion manda al dueño a correr `limpieza:republicar`.
    expect(h).not.toMatch(/republicar|PASO E/);
  });

  it.each(['censo', 'limpieza'] as const)('LZ2-S1 (seguridad) · %s imprime correos y nombres de clientes: su encabezado lo dice en llano y pide no pegarla en chats, correos ni en el repositorio', (f) => {
    expect(header(readRepair(f))).toContain('Esta salida trae correos y nombres de tus clientes: no la pegues en chats, correos ni en el repositorio.');
  });

  it('B (v2): el encabezado dice «si al final ves ROLLBACK, NO se aplicó», que se BORRA el inventario, que descargue el Excel antes y que C va ANTES de re-subir', () => {
    const h = header(readRepair('limpieza'));
    expect(h).toMatch(/si al final ves ROLLBACK, NO se aplicó/i);
    expect(h).toMatch(/BORRA[^\n]*inventario/);
    expect(h).toMatch(/Excel/);
    expect(h).toMatch(/cuentas_prueba/);
    expect(h).toMatch(/fichero 3[^\n]*ANTES de (volver a subir|dar de alta)/);
    expect(h).not.toMatch(/fuera_de_venta|buylist_piezas|P-1|P-2/);
  });

  it('CS-1 · B dice cómo conservar la bitácora antes de borrarla, y esa línea `\\copy` funciona tal cual (CSV con cabecera y todas las filas)', async () => {
    const h = header(readRepair('limpieza'));
    const line = h.split('\n').map((l) => l.replace(/^--\s*/, '')).find((l) => l.startsWith('\\copy (SELECT * FROM "AuditLog"'));
    expect(line).toBeDefined();
    expect(h).toMatch(/ANTES del COMMIT/);
    const e = await fresh();
    const dir = mkdtempSync(join(tmpdir(), 'lz-bit-'));
    try {
      const r = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', libpqUrlForTest(), '-c', line!], {
        cwd: dir, encoding: 'utf8', env: { ...process.env, PGOPTIONS: `-c search_path=${e.schema}` },
      });
      expect({ s: r.status, err: r.stderr }).toEqual({ s: 0, err: '' });
      const csv = readFileSync(join(dir, 'bitacora-antes-de-limpieza.csv'), 'utf8').trim().split('\n');
      expect(csv[0]).toMatch(/^id,/);
      expect(csv.length - 1).toBe(await e.db.auditLog.count());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it.each(['censo', 'verificacion'] as const)('C-2 · %s: se corre con el ADMINISTRADOR en READ ONLY; ninguna receta GRANT; sin la frase falsa «el resto del censo sale igual»', (f) => {
    const sql = readRepair(f);
    expect(sql).not.toMatch(/GRANT/i);
    expect(sql).not.toMatch(/el resto del censo sale igual/);
    expect(header(sql)).toMatch(/ADMINISTRADOR/);
    expect(sql).toMatch(/^BEGIN TRANSACTION READ ONLY;$/m);
  });

  it('C-1 · con G-1 forzada y `psql -f`, lo ÚLTIMO que se ve es el error G-1 (uno solo, sin 40 errores detrás que lo entierren)', async () => {
    const e = await fresh();
    await e.db.inventoryItem.update({ where: { id: e.fx.piece.P10.id }, data: { ownerType: 'customer', ownerUserId: e.fx.buyer, ownershipStatus: 'settled' } });
    const before = await snapshot(admin, e.schema);
    const r = psqlFile(e.schema, commitSql(e));
    expect(r.status).not.toBe(0);
    const lines = r.out.split('\n').map((x) => x.trim()).filter(Boolean);
    expect(lines[lines.length - 1]).toMatch(/ERROR:\s+G-1 ·/);
    expect(r.out.match(/ERROR/g)).toHaveLength(1);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('C-1 · el ensayo con `psql -f` termina con la palabra ROLLBACK a la vista (y la corrida con COMMIT)', async () => {
    const e = await fresh();
    const dry = psqlFile(e.schema, drySql(e));
    expect(dry.status).toBe(0);
    expect(dry.out.trim().split('\n').pop()!.trim()).toBe('ROLLBACK');
    const wet = psqlFile(e.schema, commitSql(e));
    expect(wet.status).toBe(0);
    expect(wet.out.trim().split('\n').pop()!.trim()).toBe('COMMIT');
  });

  it('QA-9 · salida limpia: sin etiquetas de comando sueltas (INSERT 0 3, DELETE 2, DO…) y los estados en español', async () => {
    const e = await fresh();
    const r = commit(e);
    const tags = r.stdout.split('\n').filter((l) => /^(INSERT \d|DELETE \d|UPDATE \d|SELECT \d|DO$|CREATE |ALTER |LOCK |SET$|BEGIN$)/.test(l.trim()));
    expect(tags).toEqual([]);
    expect(r.stdout).toMatch(/en custodia/);
    expect(r.stdout).toMatch(/a la venta/);
    expect(r.stdout).not.toMatch(/\bin_custody\b|\blisted\b/);
  });
});

describe('🔒 C-3 · B aborta si el esquema tiene una tabla que el diseño no clasificó', () => {
  it('una tabla nueva ⇒ G-8 la nombra y no se escribe nada', async () => {
    const e = await fresh();
    await admin.$executeRawUnsafe(`CREATE TABLE "${e.schema}"."TablaNueva" (id text PRIMARY KEY)`);
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, commitSql(e));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/G-8[^\n]*TablaNueva/);
    expectSame(before, await snapshot(admin, e.schema));
  });
});

describe('🔒 C-4 / QA-6 · escrituras ajenas concurrentes no dan aborto ni FALLA falsos', () => {
  it('un alta de usuario y de precio ENTRE B y D ⇒ D sigue en TODO OK (esas tablas son informativas)', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await e.db.user.create({ data: { email: `nuevo.${e.schema}@lz.local`, name: 'Cliente real', role: 'customer', emailVerified: true } });
    const someCard = await e.db.card.findFirstOrThrow();
    await e.db.priceReference.create({ data: { cardId: someCard.id, productType: 'raw', gradeKey: 'raw:LP', source: 'manual', priceMxnCents: 999, capturedDate: d(20) } as any });
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
    expect(r.stdout).toMatch(/INFO\s*\|[^\n]*User/);
  });

  it('un alta de usuario MIENTRAS B corre (B esperando un candado de fila) ⇒ B termina con COMMIT (foto REPEATABLE READ), sin G-5 falso', async () => {
    const e = await fresh();
    const usersBefore = await e.db.user.count();
    // QA v2.1 (C-4 inestable con carga): nada de ventanas fijas. Un tercero toma el candado de una fila de bounty que B
    // actualiza y lo SOSTIENE hasta que la prueba lo suelta (pg_cancel_backend); la prueba espera por ESTADO, no por
    // tiempo: (1) el tercero ya tiene el candado (está en su pg_sleep), (2) B está bloqueado POR ese tercero
    // (pg_blocking_pids). Solo entonces da el alta y suelta el candado (B espera ≤ lock_timeout de 5 s).
    const app = `lzhold_${e.schema}`.slice(0, 63);
    const holder = psqlAsync(e.schema, `SET application_name = '${app}';\nBEGIN;\nSELECT 1 FROM "VariantPriceOverride" WHERE id = '${e.fx.bounty.completed}' FOR UPDATE;\nSELECT pg_sleep(170);\nROLLBACK;\n`);
    const until = async <T>(what: string, probe: () => Promise<T | undefined>, ms = 120_000): Promise<T> => {
      const t0 = Date.now();
      for (;;) {
        const v = await probe();
        if (v !== undefined) return v;
        if (Date.now() - t0 > ms) throw new Error(`C-4: no se alcanzó «${what}» en ${ms} ms`);
        await new Promise((res) => setTimeout(res, 50));
      }
    };
    let run: Promise<PsqlResult> | undefined;
    try {
      const holderPid = await until('el tercero sostiene el candado', async () => {
        const [r] = await admin.$queryRawUnsafe<{ pid: number }[]>(
          `SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event = 'PgSleep'`, app);
        return r?.pid;
      });
      run = psqlAsync(e.schema, commitSql(e));
      const bPid = await until('B bloqueado por el tercero', async () => {
        const [r] = await admin.$queryRawUnsafe<{ pid: number }[]>(
          `SELECT pid FROM pg_stat_activity WHERE $1::int = ANY(pg_blocking_pids(pid)) AND query LIKE '%VariantPriceOverride%bountyAcquiredQty%'`, holderPid);
        return r?.pid;
      });
      expect(bPid).toBeGreaterThan(0); // B está a mitad de camino (ya contó «antes») y esperando el candado
      await e.db.user.create({ data: { email: `concurrente.${e.schema}@lz.local`, name: 'Alta durante B', role: 'customer', emailVerified: true } });
      await admin.$queryRawUnsafe(`SELECT pg_cancel_backend($1::int)`, holderPid);
    } finally {
      // Si algo falló antes de soltarlo, el tercero no se queda colgado: se cancela por su application_name (solo el nuestro).
      await admin.$queryRawUnsafe(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, app);
      await holder;
    }
    const r = await run!;
    expect({ status: r.status, err: r.stderr.slice(0, 400) }).toEqual({ status: 0, err: '' });
    expect(await e.db.user.count()).toBe(usersBefore + 1);
    const trace = (await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } })).after as any;
    expect(trace.conteosAntes.User).toBe(usersBefore);
  });
});

describe('🔒 QA-7 · después de la limpieza, lo nuevo es real', () => {
  it('QA-7 · B otra vez tras un job diario (portafolio y aviso de gasto nuevos) ⇒ G-7 se niega: no borra nada ni escribe un 2.º rastro; D sigue en TODO OK', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await e.db.portfolioSnapshot.create({ data: { userId: e.fx.buyer, asOfDate: d(40), totalValueMxnCents: 1 } });
    await e.db.spendAlert.create({ data: { kind: 'label_charged_unexplained', severity: 'immediate', dedupKey: `real:${e.schema}`, facts: {}, mailStatus: 'sent' } as any });
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, commitSql(e));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/G-7[^\n]*PortfolioSnapshot/);
    expectSame(before, await snapshot(admin, e.schema));
    expect(await e.db.auditLog.count({ where: { action: 'maintenance.test_data_purge' } })).toBe(1);
    const v = ok(psql(e.schema, readRepair('verificacion')));
    expect(v.stdout).toMatch(/VERIFICACION: TODO OK/);
  });
});

// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
// §14.13 v2.2 — la limpieza conoce las 9 tablas de M-73 (accesorios) y M-74 (lista de deseos). Norma: LIMPIEZA_DB.md
// §14.13 (errata v1.88.1⟨release-s7⟩). Antes de esto, con M-73/M-74 en la base, B se paraba en G-8 (39 rojas en CI).
// ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════

/** La fila de cada accesorio SIN las dos columnas de existencias ni su `updatedAt` (lo que la limpieza puede tocar). */
const accCatalog = (schema: string) =>
  hashOf(schema, `SELECT to_jsonb(a) - 'stockQty' - 'reservedQty' - 'updatedAt' AS j FROM $S."Accessory" a`);
/** Las energías de la semilla que NO recibieron piezas: idénticas, `updatedAt` incluido (LZ-A4: el WHERE no las toca). */
const idleEnergies = (e: Env) =>
  hashOf(e.schema, `SELECT to_jsonb(a) AS j FROM $S."Accessory" a WHERE a.category::text = 'energy' AND a.id <> '${e.fx.accessory.energy}'`);
const stockOf = async (e: Env, id: string) =>
  (await admin.$queryRawUnsafe<{ s: number; r: number }[]>(`SELECT "stockQty" AS s, "reservedQty" AS r FROM "${e.schema}"."Accessory" WHERE id = $1`, id))[0];

/** Pone un dial (`ConfigSetting.valueJson` = cadena JSON), exista o no la fila. */
async function setDial(e: Env, key: string, value: 'on' | 'off') {
  await admin.$executeRawUnsafe(
    `INSERT INTO "${e.schema}"."ConfigSetting" (key, "valueJson", "updatedAt") VALUES ($1, to_jsonb($2::text), now())
     ON CONFLICT (key) DO UPDATE SET "valueJson" = EXCLUDED."valueJson"`,
    key,
    value,
  );
}
/** Una suscripción «Avísame cuando vuelva» por SQL (sin M-74 la tabla no tiene `armedAt`/`matchedAt`: Prisma no sirve). */
async function subscribe(e: Env, extra: { armedAt?: Date; notifiedAt?: Date } = {}) {
  const card = await admin.$queryRawUnsafe<{ id: string }[]>(`SELECT id FROM "${e.schema}"."Card" ORDER BY id LIMIT 1`);
  const cols = ['id', 'email', '"cardId"', '"sealedCondition"'];
  const vals = [`gen_random_uuid()::text`, `'sub.${Math.random().toString(36).slice(2, 8)}@lz.local'`, `'${card[0].id}'`, `'mint'`];
  if (extra.armedAt) (cols.push('"armedAt"'), vals.push(`'${extra.armedAt.toISOString()}'`));
  if (extra.notifiedAt) (cols.push('"notifiedAt"'), vals.push(`'${extra.notifiedAt.toISOString()}'`));
  await admin.$executeRawUnsafe(`INSERT INTO "${e.schema}"."SealedRestockSubscription" (${cols.join(', ')}) VALUES (${vals.join(', ')})`);
}

/** La recepción de piezas como la hace la APP (`POST /admin/accessories/:id/stock`, `admin-accessories.service.ts`). */
async function recibirPorApp(e: Env, accessoryId: string, quantity: number) {
  const prisma = new PrismaService({ datasources: { db: { url: schemaUrl(e.schema) } } } as any);
  try {
    const svc = new AdminAccessoriesService(prisma, new AuditService(prisma));
    await svc.stock(accessoryId, { kind: 'receive', quantity }, { id: e.fx.staff, role: 'super_admin' });
  } finally {
    await prisma.$disconnect();
  }
}

/** La sección de la salida de B entre su cabecera `=== <id>…` y la siguiente `===`. */
function seccion(stdout: string, id: string): string {
  const i = stdout.indexOf(`=== ${id}`);
  if (i < 0) return '';
  const j = stdout.indexOf('===', stdout.indexOf('\n', i));
  return stdout.slice(i, j < 0 ? undefined : j);
}

describe('💰 §14.13 v2.2 · accesorios (M-73) y lista de deseos (M-74)', () => {
  it('T-AC1 · con ambas: B COMMIT vacía renglones, componentes, líneas de envío, historial de existencias y avisos; Accessory conserva la fila con existencias y apartados en 0; las 7 energías sin piezas, la foto, los deseos y sus correos, IDÉNTICOS; B + C + D ⇒ TODO OK', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    // Lo que se va a borrar o ajustar EXISTE (si no, «queda en 0» no probaría nada).
    for (const t of ['OrderAccessoryLine', 'OrderEnergyBundleComponent', 'ShipmentAccessoryLine', 'AccessoryStockMovement', 'WishlistNotice', 'AccessoryPhoto', 'WishlistItem', 'WishlistMail']) {
      expect({ t, conFilas: before.tables[t].n > 0 }).toEqual({ t, conFilas: true });
    }
    expect(before.tables.Accessory.n).toBe(9); // 8 energías de la semilla + las fundas
    expect(await stockOf(e, e.fx.accessory.sleeves)).toEqual({ s: 18, r: 1 });
    expect(await stockOf(e, e.fx.accessory.energy)).toEqual({ s: 8, r: 0 });
    const catBefore = await accCatalog(e.schema);
    const idleBefore = await idleEnergies(e);
    expect(idleBefore.n).toBe(7);

    commit(e);
    const after = await snapshot(admin, e.schema);
    // Medición DIRECTA (no las guardas de B).
    for (const t of ['OrderAccessoryLine', 'OrderEnergyBundleComponent', 'ShipmentAccessoryLine', 'AccessoryStockMovement', 'WishlistNotice']) {
      expect({ t, n: after.tables[t].n }).toEqual({ t, n: 0 });
    }
    expect(after.tables.Accessory.n).toBe(9);
    expect(await accCatalog(e.schema)).toEqual(catBefore);
    const [{ k }] = await admin.$queryRawUnsafe<{ k: number }[]>(`SELECT count(*)::int AS k FROM "${e.schema}"."Accessory" WHERE "stockQty" <> 0 OR "reservedQty" <> 0`);
    expect(k).toBe(0);
    expect(await stockOf(e, e.fx.accessory.sleeves)).toEqual({ s: 0, r: 0 });
    expect(await idleEnergies(e)).toEqual(idleBefore);
    for (const t of ['AccessoryPhoto', 'WishlistItem', 'WishlistMail']) expect({ t, s: after.tables[t] }).toEqual({ t, s: before.tables[t] });
    const sleeves = await e.db.accessory.findUniqueOrThrow({ where: { id: e.fx.accessory.sleeves } });
    expect(sleeves).toMatchObject({ active: true, priceCents: 25000, unitCostCents: 12000, photoVersion: '0123456789abcdef' });

    const trace = (await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } })).after as any;
    expect(trace.accesorios).toEqual({ conExistencias: 2, existencias: 26, apartadas: 1 });
    expect(trace.conteosAntes.Accessory).toBe(9);
    expect(trace.conteosDespues.AccessoryStockMovement).toBe(0);
    expect(JSON.stringify(trace)).not.toContain('Fundas'); // sumas, sin nombres

    ok(psql(e.schema, readRepair('folio')));
    const d = ok(psql(e.schema, readRepair('verificacion')));
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK/);
    for (const t of ['OrderAccessoryLine', 'OrderEnergyBundleComponent', 'ShipmentAccessoryLine']) expect(d.stdout).toMatch(new RegExp(`OK\\s*\\|\\s*0 filas en ${t}\\s*\\|`));
    expect(d.stdout).toMatch(/OK\s*\|\s*0 filas anteriores a la limpieza en AccessoryStockMovement/);
    expect(d.stdout).toMatch(/OK\s*\|\s*0 filas anteriores a la limpieza en WishlistNotice/);
    for (const t of ['Accessory', 'AccessoryPhoto', 'WishlistItem', 'WishlistMail']) expect(d.stdout).toMatch(new RegExp(`INFO\\s*\\|[^\\n]*: ${t}\\s*\\|`));
  });

  it('T-AC2 · con ambas: el ENSAYO ×2 deja la base IDÉNTICA (las 9 tablas incluidas, y las tres secuencias) y enseña 2.7 (las fundas: 18 · 1) y 2.8', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    for (let i = 0; i < 2; i++) {
      const r = ok(psql(e.schema, drySql(e)));
      expectSame(before, await snapshot(admin, e.schema));
      const s27 = seccion(r.stdout, '2.7');
      const row = s27.split('\n').find((l) => l.includes(e.fx.accessory.sleevesName));
      expect({ row }).toEqual({ row: expect.stringMatching(/\|\s*sí\s*\|\s*18\s*\|\s*1\s*$/) });
      expect(s27).toMatch(/Energía Fuego[^\n]*\|\s*8\s*\|\s*0\s*$/m);
      expect(s27).not.toMatch(/Energía Planta/); // sin existencias: no sale
      expect(seccion(r.stdout, '2.8')).toMatch(/aviso_sellado/);
    }
  });

  it('T-AC3 · SIN ambas, dos esquemas GEMELOS: el B congelado de a7232d7a y el B nuevo dan el mismo código de salida y la MISMA base (salvo el rastro: id, fecha y puntoPitr; y la fecha de los bounties); el ensayo nuevo no trae 2.7, 2.8 ni G-10; A, C y D dicen lo mismo', async () => {
    // La copia congelada es el fichero de a7232d7a byte a byte.
    expect(createHash('sha256').update(readFrozenB()).digest('hex')).toBe(FROZEN_B_SHA256);
    const a = await fresh({ m73: false, m74: false });
    n += 1;
    const twin = `${RUN}_${n}`;
    migrateSchema(twin);
    revertM74(twin);
    revertM73(twin);
    const b: Env = { schema: twin, db: new PrismaClient({ datasources: { db: { url: schemaUrl(twin) } } }), fx: a.fx };
    live.push(b);
    await cloneSchema(admin, a.schema, twin);
    for (const t of ['Accessory', 'WishlistNotice', 'OrderAccessoryLine']) {
      const [{ r }] = await admin.$queryRawUnsafe<{ r: string | null }[]>(`SELECT to_regclass('"${a.schema}"."${t}"')::text AS r`);
      expect({ t, r }).toEqual({ t, r: null });
    }
    expectSame(await snapshot(admin, a.schema), await snapshot(admin, twin)); // precondición: gemelos de verdad

    const censoA = psql(a.schema, readRepair('censo'));
    const censoB = psql(twin, readRepair('censo'));
    expect(censoB.status).toBe(censoA.status);
    // La única diferencia admitida es la hora de la consulta (`now()` en «A.0 · DÓNDE ESTOY»).
    const sinHora = (x: string) => x.replace(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?\+00/g, '<ahora>');
    expect(sinHora(censoB.stdout)).toBe(sinHora(censoA.stdout));

    const dry = ok(psql(twin, drySql(b)));
    expect(dry.stdout).not.toMatch(/=== 2\.7|=== 2\.8|G-10/);
    expect(seccion(dry.stdout, '15 · CONTEOS')).not.toMatch(/Accessory|Wishlist/); // la tabla de conteos es la de siempre

    const old = psql(a.schema, limpiezaSql({ respaldo: RESPALDO, cuentas: cuentasDe(a), commit: true, frozen: true }));
    const neu = psql(twin, commitSql(b));
    expect({ status: neu.status, err: neu.stderr }).toEqual({ status: old.status, err: old.stderr });
    expect(neu.status).toBe(0);

    const sa = await snapshot(admin, a.schema);
    const sb = await snapshot(admin, twin);
    expect(sb.sequences).toEqual(sa.sequences);
    for (const t of Object.keys(sa.tables)) {
      if (t === 'AuditLog' || t === 'VariantPriceOverride') continue;
      expect({ t, s: sb.tables[t] }).toEqual({ t, s: sa.tables[t] });
    }
    expect(Object.keys(sb.tables).sort()).toEqual(Object.keys(sa.tables).sort());
    const vpo = (s: string) => hashOf(s, `SELECT to_jsonb(v) - 'updatedAt' AS j FROM $S."VariantPriceOverride" v`);
    expect(await vpo(twin)).toEqual(await vpo(a.schema));
    const audit = (s: string) =>
      hashOf(s, `SELECT to_jsonb(x) - 'id' - 'createdAt' || jsonb_build_object('after', x."after" - 'puntoPitr') AS j FROM $S."AuditLog" x`);
    expect(await audit(twin)).toEqual(await audit(a.schema));
    expect(((await b.db.auditLog.findFirstOrThrow()).after as any)).not.toHaveProperty('accesorios');

    const cA = psql(a.schema, readRepair('folio'));
    const cB = psql(twin, readRepair('folio'));
    expect({ s: cB.status, out: sinHora(cB.stdout) }).toEqual({ s: cA.status, out: sinHora(cA.stdout) });
    const dA = ok(psql(a.schema, readRepair('verificacion')));
    const dB = ok(psql(twin, readRepair('verificacion')));
    expect(sinHora(dB.stdout)).toBe(sinHora(dA.stdout));
    expect(dB.stdout).toMatch(/VERIFICACION: TODO OK/);
  });

  it('T-AC3b · solo M-73 (sin M-74): B COMMIT pasa, vacía lo de accesorios y pone existencias en 0; sin 2.8 ni G-10 (las dos banderas son independientes)', async () => {
    const e = await fresh({ m74: false });
    await setDial(e, 'sealed_restock_alerts', 'on');
    await subscribe(e);
    const r = commit(e);
    expect(r.stdout).toMatch(/=== 2\.7/);
    expect(r.stdout).not.toMatch(/=== 2\.8|G-10/);
    const after = await snapshot(admin, e.schema);
    for (const t of ['OrderAccessoryLine', 'OrderEnergyBundleComponent', 'ShipmentAccessoryLine', 'AccessoryStockMovement']) expect({ t, n: after.tables[t].n }).toEqual({ t, n: 0 });
    expect(after.tables).not.toHaveProperty('WishlistNotice');
    expect(await stockOf(e, e.fx.accessory.sleeves)).toEqual({ s: 0, r: 0 });
  });

  it('T-AC4 · con ambas: B COMMIT ×2 — la 2.ª no cambia NADA (todo «qué cambió» en 0, sin rastro nuevo)', async () => {
    const e = await fresh();
    commit(e);
    const once = await snapshot(admin, e.schema);
    const r = commit(e);
    expectSame(once, await snapshot(admin, e.schema));
    const cambio = seccion(r.stdout, '15 · QUÉ CAMBIÓ');
    for (const paso of ['8 ShipmentAccessoryLine', '9 OrderEnergyBundleComponent', '9 OrderAccessoryLine', '11 AccessoryStockMovement', '11 Accessory existencias']) {
      expect(cambio).toMatch(new RegExp(`${paso}\\s*\\|\\s*0\\s*$`, 'm'));
    }
    expect(cambio.split('\n').filter((l) => /\|\s*[1-9]\d*\s*$/.test(l))).toEqual([]);
  });

  it('T-AC5 · con ambas: B → C → recepción de 5 fundas POR LA APP → B se niega con G-7 nombrando AccessoryStockMovement; las fundas siguen con 5', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await recibirPorApp(e, e.fx.accessory.sleeves, 5);
    expect(await stockOf(e, e.fx.accessory.sleeves)).toEqual({ s: 5, r: 0 });
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, commitSql(e));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/G-7[^\n]*AccessoryStockMovement \(1\)/);
    expectSame(before, await snapshot(admin, e.schema));
    expect(await stockOf(e, e.fx.accessory.sleeves)).toEqual({ s: 5, r: 0 });
  });

  it('T-AC6 · con ambas: B → C → recepción por la app → D TODO OK; AccessoryStockMovement: 0 anteriores · 1 posteriores (reales)', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await recibirPorApp(e, e.fx.accessory.sleeves, 5);
    const d = ok(psql(e.schema, readRepair('verificacion')));
    expect(d.stdout).toMatch(/VERIFICACION: TODO OK/);
    expect(lineaD(d.stdout, '0 filas anteriores a la limpieza en AccessoryStockMovement')).toMatch(/^\s*OK\s*\|[^\n]*0 anteriores · 1 posteriores \(reales\)\s*$/);
  });

  it('T-AC7 · con ambas: otra conexión con un UPDATE sin confirmar sobre una energía con 0 piezas ⇒ B aborta por lock_timeout y la base queda IDÉNTICA — N = 3', async () => {
    const results: string[] = [];
    for (let i = 0; i < 3; i++) {
      const e = await fresh();
      const [idle] = await admin.$queryRawUnsafe<{ id: string }[]>(
        `SELECT id FROM "${e.schema}"."Accessory" WHERE category::text = 'energy' AND "stockQty" = 0 ORDER BY id LIMIT 1`,
      );
      const app = `lzacc_${e.schema}`.slice(0, 63);
      const holder = psqlAsync(e.schema, `SET application_name = '${app}';\nBEGIN;\nUPDATE "Accessory" SET "stockQty" = "stockQty" + 1 WHERE id = '${idle.id}';\nSELECT pg_sleep(170);\nCOMMIT;\n`);
      try {
        const t0 = Date.now();
        for (;;) {
          const [h] = await admin.$queryRawUnsafe<{ pid: number }[]>(`SELECT pid FROM pg_stat_activity WHERE application_name = $1 AND wait_event = 'PgSleep'`, app);
          if (h) break;
          if (Date.now() - t0 > 120_000) throw new Error('T-AC7: el tercero no llegó a sostener la fila');
          await new Promise((res) => setTimeout(res, 50));
        }
        const before = await snapshot(admin, e.schema);
        const s0 = Date.now();
        const r = psql(e.schema, commitSql(e));
        const ms = Date.now() - s0;
        const same = JSON.stringify(await snapshot(admin, e.schema)) === JSON.stringify(before);
        const timedOut = r.status !== 0 && /lock timeout/i.test(r.stderr);
        results.push(`${timedOut && same && ms < 60_000 ? 'aborta' : `NO (status ${r.status}, ${ms} ms, idéntica ${same}, ${r.stderr.slice(0, 200)})`}`);
      } finally {
        // El tercero se cancela (su COMMIT se vuelve ROLLBACK): solo el nuestro, por su application_name.
        await admin.$queryRawUnsafe(`SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, app);
        await holder;
      }
    }
    expect(results).toEqual(['aborta', 'aborta', 'aborta']);
  });

  describe('G-10 v2 (LZ-A8): solo con M-74, y solo si el aviso de sellado está ENCENDIDO y hay suscripciones pendientes SIN armar', () => {
    it('T-W10a · dial on + 1 suscripción pendiente sin armar ⇒ «Falta tu decisión» con G-10 y 1 suscripción(es); base IDÉNTICA', async () => {
      const e = await fresh();
      await setDial(e, 'sealed_restock_alerts', 'on');
      await subscribe(e);
      const before = await snapshot(admin, e.schema);
      const r = psql(e.schema, commitSql(e));
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(/Falta tu decisión/);
      expect(r.stderr).toMatch(/G-10 · [^\n]*ENCENDIDO y hay 1 suscripción\(es\)/);
      expectSame(before, await snapshot(admin, e.schema));
    });
    it('T-W10b · dial on y 0 suscripciones (el caso de producción de hoy) ⇒ pasa, y el dial sigue encendido', async () => {
      const e = await fresh();
      await setDial(e, 'sealed_restock_alerts', 'on');
      const r = commit(e);
      expect(r.stderr).not.toMatch(/G-10/);
      expect(seccion(r.stdout, '2.8')).toMatch(/\n\s*on\s*\|\s*0\s*\|\s*0\s*\|/);
      expect((await e.db.configSetting.findUniqueOrThrow({ where: { key: 'sealed_restock_alerts' } })).valueJson).toBe('on');
      expect(await e.db.inventoryItem.count()).toBe(0);
    });
    it('T-W10c · dial on con una suscripción ARMADA y otra YA AVISADA ⇒ pasa', async () => {
      const e = await fresh();
      await setDial(e, 'sealed_restock_alerts', 'on');
      await subscribe(e, { armedAt: d(3) });
      await subscribe(e, { notifiedAt: d(4) });
      const r = commit(e);
      expect(r.stderr).not.toMatch(/G-10/);
      expect(seccion(r.stdout, '2.8')).toMatch(/\n\s*on\s*\|\s*0\s*\|\s*1\s*\|/);
    });
    it('T-W10d · `wishlist_enabled = on` con deseos ⇒ pasa; 2.8 dice on y el número de deseos y de correos', async () => {
      const e = await fresh();
      await setDial(e, 'wishlist_enabled', 'on');
      const r = commit(e);
      expect(r.stderr).not.toMatch(/G-10/);
      expect(seccion(r.stdout, '2.8')).toMatch(/\n\s*off\s*\|\s*0\s*\|\s*0\s*\|\s*on\s*\|\s*1\s*\|\s*1\s*$/m);
      expect(await e.db.wishlistItem.count()).toBe(1);
    });
    it('T-W10e · SIN ambas: dial on + 1 suscripción pendiente ⇒ pasa (conducta de a7232d7a: `armedAt` no existe)', async () => {
      const e = await fresh({ m73: false, m74: false });
      await setDial(e, 'sealed_restock_alerts', 'on');
      await subscribe(e);
      const r = commit(e);
      expect(r.stdout).not.toMatch(/G-10|=== 2\.8/);
    });
  });
});
