/**
 * pdb-limpieza.e2e-spec.ts — 💰🔒 P-DB-LIMPIEZA contra Postgres REAL (docs/specs/LIMPIEZA_DB.md §9). Propiedad: backend.
 *
 * Prueba los CUATRO guiones de `prisma/data-repair/20261006_pdblimpieza_*` tal como los corre el dueño (el texto del
 * fichero por psql), cada caso en un esquema propio recién migrado y sembrado con `limpieza-fixture.ts`:
 *
 *  §9.1 el ensayo (termina en ROLLBACK) deja la base IDÉNTICA — contenido de cada tabla y las tres secuencias;
 *  §9.2 la corrida (COMMIT) aplica: §8.3 entero, conteos esperados, piezas restauradas, rastro;
 *  §9.3 idempotencia: la segunda corrida no cambia NADA;
 *  §9.4 las guardas muerden (G-1, G-3, G-4, respaldo vacío, folio de exclusión desconocido; y G-7, añadida aquí);
 *  §9.5 ninguna pieza queda `listed` por SQL;
 *  §9.6 el reinicio de `TCG-` aborta con pedidos y deja `TCG-000001` sin ellos;
 *  §9.7 con `ENV-` SIN reiniciar, la guía vieja `ENV-000003-01` no produce huérfana; con la secuencia reiniciada SÍ
 *       (la mutación, N = 3 esquemas);
 *  §9.8 sin M-72 el guion corre igual (y no nombra columnas de M-72).
 *  P-1 «borrar» y «conservar», P-2 (exclusión), bounty ⇒ `apagada`, cajón de vuelta.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import { Test, TestingModule } from '@nestjs/testing';
import { Fixture, T_KEYS, d, seedFixture } from './helpers/limpieza-fixture';
import {
  BACKEND_DIR,
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
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { LimpiezaRepublicarModule } from '../../src/cli/limpieza-republicar';
import { republicarPiezasRestauradas } from '../../src/modules/inventory/limpieza-republicar';

jest.setTimeout(180_000);

const RUN = `lz${Date.now().toString(36)}`;
let n = 0;

/** Tablas que la limpieza vacía (§8.3). */
const EMPTIED = [
  'Order', 'OrderItem', 'OrderAccessToken', 'PaymentRefund', 'ManualRefund', 'ReplacementCase', 'VaultPlacement', 'VaultPlacementItem',
  'ShipmentRequest', 'ShipmentItem', 'ShipmentQuote', 'ShipmentCarrierEvent', 'ShipmentAddressRevision', 'ShipmentCostAdjustment',
  'ShipmentLabelAttempt', 'ShipmentPaidLabel', 'Dispute', 'SellRequest', 'SellRequestItem', 'SpendAlert', 'PortfolioSnapshot',
];
/** Tablas que la limpieza NO toca (contenido idéntico, no solo el conteo). */
const KEPT = [
  'User', 'KycProfile', 'KycUploadGrant', 'BillingProfile', 'Address', 'AuthToken', 'Card', 'CardSet', 'SealedProduct', 'PriceReference',
  'PendingPriceEntry', 'FxRate', 'ConfigSetting', 'VaultLocation', 'InventoryBatch', 'InventoryAdjustment', 'ProcessedStripeEvent',
  'SpendDigestRun', 'SpendOwnerWatch', 'SealedRestockSubscription', 'SetValueSnapshot', '_prisma_migrations',
];

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
const commit = (e: Env, extra: { buylist?: string; fueraDeVenta?: string } = {}) =>
  ok(psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: extra.buylist ?? 'conservar', fueraDeVenta: extra.fueraDeVenta, commit: true })));

function expectSame(a: Snapshot, b: Snapshot) {
  expect(b.sequences).toEqual(a.sequences);
  expect(b.tables).toEqual(a.tables);
}

/** URL para psql (sin `?schema=`), como en el arnés. */
function libpqUrlForTest(): string {
  const u = new URL(process.env.DATABASE_URL!);
  u.search = '';
  return u.toString();
}

async function pieces(e: Env) {
  return e.db.inventoryItem.findMany({ orderBy: { folio: 'asc' } });
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

describe('💰 P-DB-LIMPIEZA · guion B (limpieza)', () => {
  it('§9.1 el ENSAYO (ROLLBACK) deja la base IDÉNTICA — tablas y las tres secuencias — y lista lo que haría', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar' })));
    expect(r.stdout).toMatch(/PUNTO PITR/);
    expect(r.stdout).toContain('TCG-000001');
    expect(r.stdout).toContain(e.fx.directShipFolio);
    expect(r.stdout).toContain(e.fx.piece.P7.folio);
    expect(r.stdout).toContain('M1 · ajuste de cajón'); // el `move` real posterior al corte se ENSEÑA antes de borrarse
    expect(r.stdout).toMatch(/ROLLBACK/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.1 el ensayo SIN variables (tal cual, paso 4 del dueño) enseña todo y aborta al final pidiendo lo que falta — base IDÉNTICA', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, readRepair('limpieza'));
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain(e.fx.piece.P6.folio); // la pieza del buylist sale en la lista (P-1 se contesta con esto)
    expect(r.stderr).toMatch(/respaldo_manual/);
    expect(r.stderr).toMatch(/P-1/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.2 la CORRIDA aplica: vacía lo transaccional, conserva usuarios/catálogo/precios, restaura T y deja UN rastro', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    commit(e);
    const after = await snapshot(admin, e.schema);
    for (const t of EMPTIED) expect({ t, n: after.tables[t].n }).toEqual({ t, n: 0 });
    for (const t of KEPT) expect({ t, s: after.tables[t] }).toEqual({ t, s: before.tables[t] });
    expect(after.sequences).toEqual(before.sequences); // ⛔ B no toca secuencias (R-3)
    expect(after.tables.InventoryItem.n).toBe(before.tables.InventoryItem.n);

    const audit = await e.db.auditLog.findMany();
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ actorUserId: null, actorRole: null, action: 'maintenance.test_data_purge', entityType: 'Database', entityId: 'P-DB-LIMPIEZA' });
    const trace = audit[0].after as any;
    expect(trace.respaldoManual).toBe(RESPALDO);
    expect(trace.conteosAntes.Order).toBe(4);
    expect(trace.conteosDespues.Order).toBe(0);
    expect(typeof trace.puntoPitr).toBe('string');
    expect(trace.piezasRestauradas.map((p: any) => p.id).sort()).toEqual(T_KEYS.map((k) => e.fx.piece[k].id).sort());

    const byId = new Map((await pieces(e)).map((p) => [p.id, p]));
    for (const k of T_KEYS) {
      const p = byId.get(e.fx.piece[k].id)!;
      expect({ k, ownerType: p.ownerType, ownerUserId: p.ownerUserId, ownershipStatus: p.ownershipStatus, reservedByOrderId: p.reservedByOrderId, reservedUntil: p.reservedUntil, status: p.status })
        .toEqual({ k, ownerType: 'platform', ownerUserId: null, ownershipStatus: null, reservedByOrderId: null, reservedUntil: null, status: 'in_stock' });
    }
    // §4.3 cajón: P1 vuelve al de plataforma del que salió su colocación MÁS ANTIGUA; custodia sin origen ⇒ NULL; plataforma se queda.
    expect(byId.get(e.fx.piece.P1.id)!.locationId).toBe(e.fx.loc.A1);
    expect(byId.get(e.fx.piece.P4.id)!.locationId).toBeNull();
    expect(byId.get(e.fx.piece.P5.id)!.locationId).toBeNull();
    expect(byId.get(e.fx.piece.P11.id)!.locationId).toBeNull();
    expect(byId.get(e.fx.piece.P3.id)!.locationId).toBe(e.fx.loc.A2);
    expect(byId.get(e.fx.piece.P7.id)!.locationId).toBe(e.fx.loc.A2);
    // Fuera de T: idénticas (P8 perdida en M1 sigue perdida).
    expect(byId.get(e.fx.piece.P8.id)!.status).toBe('lost');
    expect(byId.get(e.fx.piece.P9.id)!.status).toBe('listed');
    // P-1 «conservar»: la pieza del buylist se queda, sin vínculo.
    expect(byId.get(e.fx.piece.P6.id)!).toMatchObject({ sourceSellRequestItemId: null, acquisitionType: 'buylist', acquisitionCostCents: 500, status: 'listed' });
    // C-5: la de buylist que TAMBIÉN está en T (pedido fallido O4) se desliga y se restaura como el resto; su cajón de plataforma se queda.
    expect(byId.get(e.fx.piece.P12.id)!).toMatchObject({ sourceSellRequestItemId: null, acquisitionType: 'buylist', status: 'in_stock', locationId: e.fx.loc.A2 });
  });

  it('§4.4 movimientos: se borran los de prueba (y los lost/damaged/move desde el corte), se conservan los anteriores y los de fuera de T, y entra UNO de cierre por pieza', async () => {
    const e = await fresh();
    commit(e);
    const mv = await e.db.inventoryMovement.findMany({ orderBy: { createdAt: 'asc' } });
    const of = (k: keyof Fixture['piece']) => mv.filter((m) => m.itemId === e.fx.piece[k].id);
    expect(mv.filter((m) => ['sale', 'settle', 'chargeback_return', 'withdrawal', 'refund_return', 'refund_release', 'replacement'].includes(m.reason))).toEqual([]);
    expect(of('P1').map((m) => [m.reason, m.note])).toEqual([
      ['alta', null],
      ['move', 'M1 · reacomodo'],
      ['adjustment', expect.stringMatching(/^P-DB-LIMPIEZA \d{4}-\d{2}-\d{2}: pruebas borradas; vuelve a inventario$/)],
    ]);
    const close = of('P1')[2];
    expect(close).toMatchObject({ fromStatus: 'in_custody', toStatus: 'in_stock', fromLocationId: e.fx.loc.C1, toLocationId: e.fx.loc.A1, actorUserId: null });
    for (const k of ['P2', 'P3', 'P4', 'P5', 'P7', 'P11'] as const) expect({ k, r: of(k).map((m) => m.reason) }).toEqual({ k, r: ['alta', 'adjustment'] });
    expect(of('P7')[1]).toMatchObject({ fromStatus: 'damaged', toStatus: 'in_stock', fromLocationId: null, toLocationId: null });
    expect(of('P8').map((m) => m.reason)).toEqual(['alta', 'lost']);
    expect(of('P10').map((m) => m.reason)).toEqual(['alta', 'adjustment']);
    expect(of('P6').map((m) => m.reason)).toEqual(['buylist_convert']);
    expect(of('P12').map((m) => m.reason)).toEqual(['buylist_convert', 'adjustment']); // el `sale` del pedido fallido se va
    expect(of('P12')[1]).toMatchObject({ fromStatus: 'listed', toStatus: 'in_stock', fromLocationId: null, toLocationId: null });
    expect(await e.db.inventoryAdjustment.count()).toBe(2); // el cierre NO es un levantamiento (P10 y P12 ya los tenían)
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

  it('§9.5 fail-closed de precio: ninguna pieza de T queda `listed`; las publicadas son exactamente las que ya lo estaban fuera de T', async () => {
    const e = await fresh();
    commit(e);
    const listed = (await pieces(e)).filter((p) => p.status === 'listed').map((p) => p.id).sort();
    expect(listed).toEqual([e.fx.piece.P6.id, e.fx.piece.P9.id].sort());
  });

  it('P-1 «borrar» (C-5): las piezas nacidas del buylist de prueba se borran — también la que está en T (P12, pedido fallido), con movimientos, levantamiento y cierre ≠ 0 — y G-5 cuadra', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    // C-5: los conteos que entran en la cuenta de G-5 para la pieza de buylist en T NO son 0 (si lo fueran, la fórmula no se prueba).
    expect(await e.db.inventoryMovement.count({ where: { itemId: e.fx.piece.P12.id } })).toBe(2); // buylist_convert + sale
    expect(await e.db.inventoryAdjustment.count({ where: { inventoryItemId: e.fx.piece.P12.id } })).toBe(1);
    const movBefore = await e.db.inventoryMovement.count();
    const r = commit(e, { buylist: 'borrar' });
    expect(r.stdout).toMatch(/InventoryMovement\s*\|\s*ajustar\s*\|\s*\d+\s*\|\s*\d+\s*\|\s*\d+/);
    for (const k of ['P6', 'P12'] as const) {
      expect(await e.db.inventoryItem.findUnique({ where: { id: e.fx.piece[k].id } })).toBeNull();
      expect(await e.db.inventoryMovement.count({ where: { itemId: e.fx.piece[k].id } })).toBe(0);
    }
    expect(await e.db.inventoryItem.count()).toBe(before.tables.InventoryItem.n - 2);
    expect(await e.db.inventoryAdjustment.count()).toBe(before.tables.InventoryAdjustment.n - 1);
    // Movimientos: los de prueba de T se van, entra uno de cierre por pieza de T que SIGUE existiendo; los de P6/P12 caen enteros.
    expect(await e.db.inventoryMovement.count()).toBeLessThan(movBefore);
    const trace = (await e.db.auditLog.findFirstOrThrow()).after as any;
    expect(trace.piezasBuylistBorradas).toEqual([e.fx.piece.P6.folio, e.fx.piece.P12.folio].sort());
    expect(trace.piezasRestauradas.map((p: any) => p.id)).not.toContain(e.fx.piece.P12.id);
  });

  it('P-2 exclusión: `fuera_de_venta` deja esas piezas de plataforma, sin reserva, `withdrawn` (o `damaged` si se dice)', async () => {
    const e = await fresh();
    commit(e, { fueraDeVenta: ` ${e.fx.piece.P7.folio} , ${e.fx.piece.P4.folio}:damaged` });
    const p7 = await e.db.inventoryItem.findUniqueOrThrow({ where: { id: e.fx.piece.P7.id } });
    const p4 = await e.db.inventoryItem.findUniqueOrThrow({ where: { id: e.fx.piece.P4.id } });
    expect(p7).toMatchObject({ status: 'withdrawn', ownerType: 'platform', reservedByOrderId: null });
    expect(p4).toMatchObject({ status: 'damaged', ownerType: 'platform', ownerUserId: null });
    const trace = (await e.db.auditLog.findFirstOrThrow()).after as any;
    expect(trace.piezasExcluidas.sort()).toEqual([e.fx.piece.P4.folio, e.fx.piece.P7.folio].sort());
  });

  describe('§9.4 las guardas MUERDEN (abortan y la base queda IDÉNTICA)', () => {
    async function aborts(e: Env, sql: string, msg: RegExp) {
      const before = await snapshot(admin, e.schema);
      const r = psql(e.schema, sql);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toMatch(msg);
      expectSame(before, await snapshot(admin, e.schema));
    }
    it('G-1: una pieza de cliente que no vino de ningún pedido', async () => {
      const e = await fresh();
      await e.db.inventoryItem.update({ where: { id: e.fx.piece.P10.id }, data: { ownerType: 'customer', ownerUserId: e.fx.buyer, ownershipStatus: 'settled' } });
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }), /G-1/);
    });
    it('G-2: una pieza `in_custody` fuera de T', async () => {
      const e = await fresh();
      await e.db.inventoryItem.update({ where: { id: e.fx.piece.P10.id }, data: { status: 'in_custody' } });
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }), /G-2/);
    });
    it('G-3: un movimiento `settle` sobre una pieza fuera de T', async () => {
      const e = await fresh();
      await e.db.inventoryMovement.create({ data: { itemId: e.fx.piece.P9.id, reason: 'settle', createdAt: d(4) } });
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }), /G-3/);
    });
    it('G-4: pieza nacida del buylist y P-1 sin contestar', async () => {
      const e = await fresh();
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, commit: true }), /G-4.*P-1/s);
    });
    it('G-4: respuesta de P-1 que no es «borrar» ni «conservar»', async () => {
      const e = await fresh();
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'si', commit: true }), /buylist_piezas/);
    });
    it('respaldo_manual vacío', async () => {
      const e = await fresh();
      await aborts(e, limpiezaSql({ buylist: 'conservar', commit: true }), /respaldo_manual/);
    });
    it('P-2: un folio de exclusión que no es una pieza tocada por pruebas (errata)', async () => {
      const e = await fresh();
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', fueraDeVenta: e.fx.piece.P9.folio, commit: true }), /fuera_de_venta/);
    });
    it('G-7: la limpieza YA se hizo y después hubo un pedido ⇒ no se vuelve a correr', async () => {
      const e = await fresh();
      commit(e);
      await e.db.order.create({
        data: { userId: e.fx.buyer, orderNumber: 'TCG-000001', fulfillmentMode: 'vault', status: 'settled', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' },
      });
      await aborts(e, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }), /G-7/);
    });
  });
});

describe('💰 P-DB-LIMPIEZA · A (censo) y D (verificación) son de SOLO LECTURA; D muerde', () => {
  it('A informa conteos, FK, guardas, secuencias y M-72 sin cambiar nada', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('censo')));
    expect(r.stdout).toMatch(/order_number_seq\s*\|\s*4/);
    expect(r.stdout).toMatch(/shipment_folio_seq\s*\|\s*3/);
    expect(r.stdout).toContain('ManualRefund_reissuedFromId_fkey');
    expect(r.stdout).toMatch(/G-4/);
    expect(r.stdout).toMatch(/m72_aplicada\s*\|?\s*\n[-+]+\n\s*t/);
    expect(r.stdout).toContain('ENV-000003-01');
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('D sobre la base SIN limpiar ⇒ HAY FALLAS (la verificación muerde); tras B + C ⇒ TODO OK; y no escribe', async () => {
    const e = await fresh();
    const dirty = psql(e.schema, readRepair('verificacion'));
    expect(dirty.stdout).toMatch(/HAY FALLAS/);
    // y cada comprobación muerde por sí sola, no solo el total
    for (const line of ['0 filas en Order', '0 filas en ShipmentRequest', '0 filas en SellRequest', 'AuditLog: exactamente 1 rastro', '0 piezas de cliente', '0 movimientos de venta', '0 piezas ligadas', 'contador de pedidos', 'bounties: comprado = 0']) {
      expect({ line, falla: new RegExp(`FALLA\\s*\\|\\s*${line}`).test(dirty.stdout) }).toEqual({ line, falla: true });
    }
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    const before = await snapshot(admin, e.schema);
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
    expect(r.stdout).not.toMatch(/\bFALLA\b/);
    expectSame(before, await snapshot(admin, e.schema));
  });
});

describe('💰 P-DB-LIMPIEZA · C (folio de pedidos)', () => {
  it('§9.6 con pedidos ⇒ ABORTA y la secuencia no se mueve', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, readRepair('folio'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Order/);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('§9.6 sin pedidos ⇒ el siguiente número es TCG-000001; ENV- e INV- siguen donde estaban', async () => {
    const e = await fresh();
    commit(e);
    const before = await snapshot(admin, e.schema);
    ok(psql(e.schema, readRepair('folio')));
    const after = await snapshot(admin, e.schema);
    expect(after.sequences.shipment_folio_seq).toEqual(before.sequences.shipment_folio_seq);
    expect(after.sequences.inventory_folio_seq).toEqual(before.sequences.inventory_folio_seq);
    const [r] = await e.db.$queryRawUnsafe<{ n: bigint }[]>(`SELECT nextval('order_number_seq') AS n`);
    expect(`TCG-${String(Number(r.n)).padStart(6, '0')}`).toBe('TCG-000001');
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
    ok(psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true })));
    ok(psql(e.schema, readRepair('folio')));
    const r = ok(psql(e.schema, readRepair('verificacion')));
    expect(r.stdout).toMatch(/VERIFICACION: TODO OK/);
    const after = await snapshot(admin, e.schema);
    for (const t of ['Order', 'ShipmentRequest', 'SellRequest', 'ManualRefund']) expect(after.tables[t].n).toBe(0);
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
  });

  it('B: el encabezado dice «si al final ves ROLLBACK, NO se aplicó» y ya no manda a publicar a mano en M1', () => {
    const h = header(readRepair('limpieza'));
    expect(h).toMatch(/si al final ves ROLLBACK, NO se aplicó/i);
    expect(h).toContain('limpieza:republicar');
    expect(h).not.toMatch(/eso lo haces tú desde M1/);
  });

  it('E1 · B dice la orden EXACTA del paso E y dónde: `node dist/cli/limpieza-republicar.js` (sin npm en el contenedor) y, fuera de Railway, con la URL PÚBLICA', () => {
    const h = header(readRepair('limpieza'));
    expect(h.split('\n').filter((l) => l.includes('node dist/cli/limpieza-republicar.js')).length).toBeGreaterThanOrEqual(2);
    expect(h).toMatch(/node dist\/cli\/limpieza-republicar\.js --apply/);
    expect(h).toMatch(/cd backend && npm ci && npm run build/);
    expect(h).toMatch(/railway run --service <servicio-de-la-API> node dist\/cli\/limpieza-republicar\.js/);
    // CS-1: la URL a mano, solo con `read -rs` + `export` (fuera del historial y de `ps`), y el aviso de rotar la contraseña.
    expect(h).toMatch(/read -rs DATABASE_URL[^\n]*\n--\s+export DATABASE_URL\n--\s+node dist\/cli\/limpieza-republicar\.js/);
    expect(h).toMatch(/DATABASE_PUBLIC_URL/);
    expect(h).toMatch(/CAMBIA la contraseña de Postgres/);
    expect(h).not.toMatch(/npm run limpieza:republicar/);
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

  it('M3 · la lista 2.4 marca en «ojo» las perdidas/dañadas que vuelven a inventario (candidatas a P-2), y no las demás', async () => {
    const e = await fresh();
    const r = ok(psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar' })));
    const row = (k: keyof Fixture['piece']) => r.stdout.split('\n').find((l) => l.trimStart().startsWith(e.fx.piece[k].folio + ' ')) ?? '';
    expect(row('P5')).toMatch(/¿EXISTE Y ESTÁ BIEN\? era perdida/);
    expect(row('P4')).toMatch(/era dañada/);
    expect(row('P7')).toMatch(/era dañada/);
    for (const k of ['P1', 'P2', 'P3', 'P11', 'P12'] as const) expect({ k, ojo: /EXISTE Y ESTÁ BIEN/.test(row(k)) }).toEqual({ k, ojo: false });
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
    const r = psqlFile(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }));
    expect(r.status).not.toBe(0);
    const lines = r.out.split('\n').map((x) => x.trim()).filter(Boolean);
    expect(lines[lines.length - 1]).toMatch(/ERROR:\s+G-1 ·/);
    expect(r.out.match(/ERROR/g)).toHaveLength(1);
    expectSame(before, await snapshot(admin, e.schema));
  });

  it('C-1 · el ensayo con `psql -f` termina con la palabra ROLLBACK a la vista (y la corrida con COMMIT)', async () => {
    const e = await fresh();
    const dry = psqlFile(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar' }));
    expect(dry.status).toBe(0);
    expect(dry.out.trim().split('\n').pop()!.trim()).toBe('ROLLBACK');
    const wet = psqlFile(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }));
    expect(wet.status).toBe(0);
    expect(wet.out.trim().split('\n').pop()!.trim()).toBe('COMMIT');
  });

  it('QA-9 · salida limpia: sin etiquetas de comando sueltas (INSERT 0 3, DELETE 2, DO…) y los estados en español', async () => {
    const e = await fresh();
    const r = commit(e);
    const tags = r.stdout.split('\n').filter((l) => /^(INSERT \d|DELETE \d|UPDATE \d|SELECT \d|DO$|CREATE |ALTER |LOCK |SET$|BEGIN$)/.test(l.trim()));
    expect(tags).toEqual([]);
    expect(r.stdout).toMatch(/en custodia → en inventario/);
    expect(r.stdout).toMatch(/a la venta → en inventario/); // P12 (pedido fallido)
    expect(r.stdout).not.toMatch(/in_custody → in_stock/);
  });
});

describe('🔒 C-3 · B aborta si el esquema tiene una tabla que el diseño no clasificó', () => {
  it('una tabla nueva ⇒ G-8 la nombra y no se escribe nada', async () => {
    const e = await fresh();
    await admin.$executeRawUnsafe(`CREATE TABLE "${e.schema}"."TablaNueva" (id text PRIMARY KEY)`);
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }));
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
    // Un tercero sostiene ~3 s el candado de una fila de bounty que B actualiza en el paso 14 (< lock_timeout de 5 s).
    const holder = psqlAsync(e.schema, `BEGIN; SELECT 1 FROM "VariantPriceOverride" WHERE id = '${e.fx.bounty.completed}' FOR UPDATE; SELECT pg_sleep(3); ROLLBACK;`);
    await new Promise((res) => setTimeout(res, 700));
    const run = psqlAsync(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }));
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

describe('🔒 QA-7 / QA-8 · después de la limpieza, lo nuevo es real', () => {
  it('QA-7 · B otra vez tras un job diario (portafolio y aviso de gasto nuevos) ⇒ G-7 se niega: no borra nada ni escribe un 2.º rastro; D sigue en TODO OK', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await e.db.portfolioSnapshot.create({ data: { userId: e.fx.buyer, asOfDate: d(40), totalValueMxnCents: 1 } });
    await e.db.spendAlert.create({ data: { kind: 'label_charged_unexplained', severity: 'immediate', dedupKey: `real:${e.schema}`, facts: {}, mailStatus: 'sent' } as any });
    const before = await snapshot(admin, e.schema);
    const r = psql(e.schema, limpiezaSql({ respaldo: RESPALDO, buylist: 'conservar', commit: true }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/G-7[^\n]*PortfolioSnapshot/);
    expectSame(before, await snapshot(admin, e.schema));
    expect(await e.db.auditLog.count({ where: { action: 'maintenance.test_data_purge' } })).toBe(1);
    const v = ok(psql(e.schema, readRepair('verificacion')));
    expect(v.stdout).toMatch(/VERIFICACION: TODO OK/);
  });

  it('QA-8 · C tras la limpieza con un pedido REAL ya hecho ⇒ se niega SIN decir «corre primero la limpieza»', async () => {
    const e = await fresh();
    commit(e);
    ok(psql(e.schema, readRepair('folio')));
    await e.db.order.create({
      data: { userId: e.fx.buyer, orderNumber: 'TCG-000001', fulfillmentMode: 'vault', status: 'settled', subtotalCents: 1, processingFeeCents: 0, ivaCents: 0, totalCents: 1, priceConvention: 'IVA_INCLUSIVE' },
    });
    const r = psql(e.schema, readRepair('folio'));
    expect(r.status).not.toBe(0);
    expect(r.stderr).not.toMatch(/[Cc]orre primero la limpieza/);
    expect(r.stderr).toMatch(/limpieza YA se hizo[^\n]*TCG-000001/);
  });
});

describe('💰🔒 QA-1 · E · `limpieza:republicar` — ninguna pieza restaurada se queda fuera de venta SIN aviso', () => {
  const mods: TestingModule[] = [];
  afterAll(async () => {
    for (const m of mods) await m.close();
  });
  async function app(e: Env) {
    const prisma = new PrismaService({ datasources: { db: { url: schemaUrl(e.schema) } } } as any);
    const mod = await Test.createTestingModule({ imports: [LimpiezaRepublicarModule] }).overrideProvider(PrismaService).useValue(prisma).compile();
    await mod.init();
    mods.push(mod);
    return { prisma, inventory: mod.get(InventoryService) };
  }
  async function queue(inventory: InventoryService) {
    const r = await inventory.pendingPublish({ page: 1, pageSize: 500 });
    return new Map(r.data.map((x: any) => [x.inventoryItemId as string, x.missing as string[]]));
  }
  /** La comprobación del encargo: cada pieza de `piezasRestauradas` está `listed` o en «Listas para publicar» con motivo. */
  async function lost(e: Env, inventory: InventoryService) {
    const trace = (await e.db.auditLog.findFirstOrThrow({ where: { action: 'maintenance.test_data_purge' } })).after as any;
    const q = await queue(inventory);
    const out: string[] = [];
    for (const p of trace.piezasRestauradas as { id: string; folio: string }[]) {
      const it = await e.db.inventoryItem.findUniqueOrThrow({ where: { id: p.id } });
      if (it.status === 'listed') continue;
      if ((q.get(p.id) ?? []).length > 0) continue;
      out.push(`${p.folio} ${it.status}`);
    }
    return out;
  }

  it('el HUECO (medido por QA): tras B sola, P3 (publicada antes, con precio y cajón) y P12 (pedido fallido) quedan in_stock fuera de venta Y fuera de la cola', async () => {
    const e = await fresh();
    commit(e);
    const { inventory } = await app(e);
    expect((await lost(e, inventory)).sort()).toEqual(
      [`${e.fx.piece.P1.folio} in_stock`, `${e.fx.piece.P3.folio} in_stock`, `${e.fx.piece.P7.folio} in_stock`, `${e.fx.piece.P12.folio} in_stock`].sort(),
    );
  });

  it('tras B (COMMIT) + `limpieza:republicar --apply`: TODA pieza restaurada acaba `listed` o en «Listas para publicar» con su motivo', async () => {
    const e = await fresh();
    commit(e);
    const { prisma, inventory } = await app(e);
    const rep = await republicarPiezasRestauradas({ prisma, inventory }, { apply: true });
    expect(await lost(e, inventory)).toEqual([]);
    const st = new Map((await pieces(e)).map((p) => [p.id, p.status]));
    for (const k of ['P1', 'P3', 'P7', 'P12'] as const) expect({ k, s: st.get(e.fx.piece[k].id) }).toEqual({ k, s: 'listed' });
    const q = await queue(inventory);
    for (const k of ['P2', 'P4', 'P5', 'P11'] as const) expect({ k, m: q.get(e.fx.piece[k].id) }).toEqual({ k, m: ['location'] });
    expect(rep.resumen).toEqual({ aLaVenta: 4, enCola: 4, otroEstado: 0, sinResolver: 0 });
  });

  it('simulacro (sin --apply): NO escribe nada y predice exactamente lo que después hace --apply; una 2.ª corrida no cambia nada', async () => {
    const e = await fresh();
    commit(e);
    const { prisma, inventory } = await app(e);
    const before = await snapshot(admin, e.schema);
    const dry = await republicarPiezasRestauradas({ prisma, inventory }, { apply: false });
    expectSame(before, await snapshot(admin, e.schema));
    const wet = await republicarPiezasRestauradas({ prisma, inventory }, { apply: true });
    expect(dry.filas.map((f) => [f.folio, f.destino])).toEqual(wet.filas.map((f) => [f.folio, f.destino]));
    expect(dry.resumen).toEqual(wet.resumen);
    expect(dry.filas.filter((f) => f.destino === 'a_la_venta').map((f) => f.motivo)).toEqual(Array(4).fill('se publicaría'));
    const once = await snapshot(admin, e.schema);
    const again = await republicarPiezasRestauradas({ prisma, inventory }, { apply: true });
    expectSame(once, await snapshot(admin, e.schema));
    expect(again.resumen).toEqual(wet.resumen);
  });

  it('lo que el pipeline no puede publicar NI la cola enseña (gradeada sin certificado) sale «SIN RESOLVER» con su motivo; lo que cambió de estado después se informa y no se toca', async () => {
    const e = await fresh();
    commit(e);
    await e.db.inventoryItem.update({ where: { id: e.fx.piece.P7.id }, data: { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', certNumber: null } as any });
    await e.db.inventoryItem.update({ where: { id: e.fx.piece.P2.id }, data: { status: 'lost' } });
    const { prisma, inventory } = await app(e);
    const rep = await republicarPiezasRestauradas({ prisma, inventory }, { apply: true });
    const f7 = rep.filas.find((f) => f.inventoryItemId === e.fx.piece.P7.id)!;
    expect(f7).toMatchObject({ destino: 'sin_resolver' });
    expect(f7.motivo).toMatch(/certNumber/);
    expect(rep.filas.find((f) => f.inventoryItemId === e.fx.piece.P2.id)).toMatchObject({ destino: 'otro_estado' });
    expect(rep.resumen.sinResolver).toBe(1);
  });

  it('sin rastro de limpieza ⇒ se niega (no hay de dónde sacar las piezas)', async () => {
    const e = await fresh();
    const { prisma, inventory } = await app(e);
    await expect(republicarPiezasRestauradas({ prisma, inventory }, { apply: false })).rejects.toThrow(/rastro/);
  });

  /**
   * M2 (QA re-pase): el comando se prueba DOS veces — con ts-node y COMPILADO (`tsc -p tsconfig.build.json`, el mismo
   * árbol que `nest build` deja en `dist/`), que es lo que el dueño corre (`node dist/cli/limpieza-republicar.js`).
   * M1: la salida no lleva el ruido de arranque de Nest (`[Nest]`, `NO_OWNER_ACCOUNT`).
   */
  describe('el COMANDO como lo corre el dueño (proceso aparte, DATABASE_URL del entorno)', () => {
    const distDir = join(BACKEND_DIR, `.lz-dist-${RUN}`);
    beforeAll(() => {
      const r = spawnSync(
        process.execPath,
        [join(BACKEND_DIR, 'node_modules', 'typescript', 'bin', 'tsc'), '-p', 'tsconfig.build.json', '--outDir', distDir, '--incremental', 'false', '--declaration', 'false', '--sourceMap', 'false'],
        { cwd: BACKEND_DIR, encoding: 'utf8', timeout: 600_000 },
      );
      if (r.status !== 0) throw new Error(`no compila (tsc ${r.status}):\n${r.stdout}\n${r.stderr}`);
    }, 620_000);
    afterAll(() => rmSync(distDir, { recursive: true, force: true }));

    const runners: [string, (args: string[]) => string[]][] = [
      ['ts-node', (args) => ['-r', 'ts-node/register', join(BACKEND_DIR, 'src', 'cli', 'limpieza-republicar.ts'), ...args]],
      ['compilado (dist/cli/limpieza-republicar.js)', (args) => [join(distDir, 'cli', 'limpieza-republicar.js'), ...args]],
    ];
    it.each(runners)('%s: simulacro ⇒ sale 0 y no escribe; --apply ⇒ sale 0 y publica; sin ruido de Nest', async (name, argvOf) => {
      // Diagnóstico permanente (O-3, la intermitente 1/6 del 2026-10-06 sin reproducir en 19 corridas): cada paso y cada
      // proceso hijo deja en el mensaje de fallo su código, señal, error de spawn, duración, carga y las colas de su salida.
      const t0 = Date.now();
      const step = async <T>(label: string, f: () => T | Promise<T>): Promise<T> => {
        try {
          return await f();
        } catch (err) {
          throw new Error(`[${name}] paso «${label}» falló a los ${Date.now() - t0} ms (carga ${loadavg().map((x) => x.toFixed(2)).join(' ')}): ${(err as Error).message}`);
        }
      };
      const e = await step('fresh', () => fresh());
      await step('B COMMIT', () => commit(e));
      const cli = (args: string[]) => {
        const t = Date.now();
        const r = spawnSync(process.execPath, argvOf(args), {
          cwd: BACKEND_DIR,
          encoding: 'utf8',
          env: { ...process.env, DATABASE_URL: schemaUrl(e.schema), DATABASE_PUBLIC_URL: '', TS_NODE_TRANSPILE_ONLY: '1', REDIS_URL: '' },
          timeout: 120_000,
        });
        return {
          args: args.join(' ') || '(simulacro)',
          status: r.status,
          signal: r.signal,
          spawnError: r.error?.message ?? null,
          ms: Date.now() - t,
          load: loadavg().map((x) => x.toFixed(2)).join(' '),
          stdout: (r.stdout ?? '').slice(-1500),
          stderr: (r.stderr ?? '').slice(-1500),
        };
      };
      const before = await snapshot(admin, e.schema);
      const dry = cli([]);
      expect(dry).toMatchObject({ status: 0, spawnError: null });
      expect(dry.stdout).toMatch(/SIMULACRO/);
      expect(dry.stdout).toContain(e.fx.piece.P3.folio);
      expectSame(before, await snapshot(admin, e.schema));
      const wet = cli(['--apply']);
      expect(wet).toMatchObject({ status: 0, spawnError: null });
      expect(wet.stdout).toMatch(/a la venta: 4/);
      for (const out of [dry, wet]) {
        expect({ args: out.args, ruido: /\[Nest\]|NO_OWNER_ACCOUNT|ERROR/.test(out.stdout + out.stderr), out }).toMatchObject({ ruido: false });
      }
      expect((await e.db.inventoryItem.findUniqueOrThrow({ where: { id: e.fx.piece.P3.id } })).status).toBe('listed');
    });
  });
});
