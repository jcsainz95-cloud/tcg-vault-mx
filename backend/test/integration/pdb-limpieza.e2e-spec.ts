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
import { PrismaClient } from '@prisma/client';
import { Fixture, T_KEYS, d, seedFixture } from './helpers/limpieza-fixture';
import {
  Snapshot,
  assertConstraintsComplete,
  cleanupMigrations,
  dropSchema,
  limpiezaSql,
  migrateSchema,
  psql,
  readRepair,
  revertM72,
  schemaUrl,
  snapshot,
} from './helpers/limpieza-db';
import { ShipmentOrphanService } from '../../src/modules/shipments/orphan-reconcile.service';
import { deriveBountyState } from '../../src/modules/pricing/bounty-state';

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
    expect(trace.conteosAntes.Order).toBe(3);
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
    expect(await e.db.inventoryAdjustment.count()).toBe(1); // el cierre NO es un levantamiento
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

  it('P-1 «borrar»: la pieza nacida del buylist de prueba se borra (con sus movimientos); el resto igual', async () => {
    const e = await fresh();
    const before = await snapshot(admin, e.schema);
    commit(e, { buylist: 'borrar' });
    expect(await e.db.inventoryItem.findUnique({ where: { id: e.fx.piece.P6.id } })).toBeNull();
    expect(await e.db.inventoryItem.count()).toBe(before.tables.InventoryItem.n - 1);
    expect(await e.db.inventoryMovement.count({ where: { itemId: e.fx.piece.P6.id } })).toBe(0);
    const trace = (await e.db.auditLog.findFirstOrThrow()).after as any;
    expect(trace.piezasBuylistBorradas).toEqual([e.fx.piece.P6.folio]);
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
    expect(r.stdout).toMatch(/order_number_seq\s*\|\s*3/);
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
