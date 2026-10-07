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
 */
import { spawnSync } from 'node:child_process';
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
  psqlAsync,
  psqlFile,
  readRepair,
  revertM72,
  schemaUrl,
  snapshot,
} from './helpers/limpieza-db';
import { ShipmentOrphanService } from '../../src/modules/shipments/orphan-reconcile.service';
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
];
/** Tablas que la limpieza toca EN PARTE (se comprueban por separado); todas las demás: contenido idéntico. */
const PARTIAL = ['VariantPriceOverride', 'PendingPriceEntry', 'AuditLog'];
/** Las conservadas que el encargo nombra: deben tener filas en el fixture, o «idéntico» no probaría nada. */
const KEY_KEPT = ['User', 'Card', 'CardSet', 'SealedProduct', 'PriceReference', 'VaultLocation', 'ConfigSetting'];

interface Env {
  schema: string;
  db: PrismaClient;
  fx: Fixture;
}
const live: Env[] = [];
let admin: PrismaClient;

async function fresh(opts: { m72?: boolean } = {}): Promise<Env> {
  const m72 = opts.m72 ?? true;
  n += 1;
  const schema = `${RUN}_${n}`;
  migrateSchema(schema);
  await assertConstraintsComplete(admin, schema);
  const db = new PrismaClient({ datasources: { db: { url: schemaUrl(schema) } } });
  const fx = await seedFixture(db, { m72 });
  if (!m72) await revertM72(admin, schema);
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
    for (const t of KEY_KEPT) expect({ t, conservada: kept.includes(t), conFilas: before.tables[t].n > 0 }).toEqual({ t, conservada: true, conFilas: true });
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
    // Un tercero sostiene ~3 s el candado de una fila de bounty que B actualiza (< lock_timeout de 5 s).
    const holder = psqlAsync(e.schema, `BEGIN; SELECT 1 FROM "VariantPriceOverride" WHERE id = '${e.fx.bounty.completed}' FOR UPDATE; SELECT pg_sleep(3); ROLLBACK;`);
    await new Promise((res) => setTimeout(res, 700));
    const run = psqlAsync(e.schema, commitSql(e));
    let waited = false;
    for (let i = 0; i < 40 && !waited; i++) {
      await new Promise((res) => setTimeout(res, 100));
      const w = await admin.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND query LIKE '%VariantPriceOverride%bountyAcquiredQty%'`,
      );
      waited = w[0].n > 0;
    }
    expect(waited).toBe(true); // B está a mitad de camino (ya contó «antes»)
    await e.db.user.create({ data: { email: `concurrente.${e.schema}@lz.local`, name: 'Alta durante B', role: 'customer', emailVerified: true } });
    await holder;
    const r = await run;
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
