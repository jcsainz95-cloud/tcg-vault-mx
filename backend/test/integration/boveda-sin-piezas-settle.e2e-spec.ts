/**
 * boveda-sin-piezas-settle.e2e-spec.ts — §BOVEDA-COBRADA-SIN-PIEZAS (DECISIONES). Postgres REAL, webhooks Stripe FIRMADOS, el doble de
 * Stripe del arnés. Criterios 2, 3, 5, 7 (la liquidación por línea y la reparación).
 *
 * Una orden COBRADA siempre entrega algo o queda «requiere atención»; ⛔ nunca «liquidada normal» sin pieza, ⛔ nunca una copia de otro
 * acabado/idioma/grado/sellado ni de un cliente, ⛔ nunca dinero. Todo lo que crea lo borra (`cleanup`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { VaultOrphanRepairService } from '../../src/jobs/vault-orphan-repair.service';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { distinctOrders, findUnassignedLines } from '../../src/modules/payments/vault-orphans';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);

describe('§BOVEDA-COBRADA-SIN-PIEZAS — liquidación por línea y reparación', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;
  let repair: VaultOrphanRepairService;
  let adminToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, RUN);
    await fx.init();
    repair = h.app.get(VaultOrphanRepairService);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  });
  afterAll(async () => {
    await fx.cleanup();
    await h.close();
  });
  beforeEach(() => {
    h.stripe.cancelOutcome = 'canceled';
    h.stripe.refundCreateCalls.length = 0;
  });

  const ledgerRows = (orderIds: string[]) => h.prisma.paymentRefund.count({ where: { orderId: { in: orderIds } } });
  const lineOf = (orderId: string) => h.prisma.orderItem.findMany({ where: { orderId }, orderBy: { unitPriceCents: 'asc' } });

  // ------------------------------------------------------------------------------------------------ criterio 7 / 5
  describe('regresión del estado de producción (pedido `settled` con piezas `listed`)', () => {
    it('la reparación las asigna al comprador y deja UN movimiento `settle` por pieza; la segunda corrida no cambia nada', async () => {
      const buyer = await fx.user('prod');
      const card = await fx.card('prod');
      const pieces = [await fx.piece(card.id), await fx.piece(card.id), await fx.piece(card.id)];
      const { order } = await fx.settledVaultOrder(buyer.id, pieces);
      // El estado de producción: pedido `settled` y las piezas a la venta.
      expect((await fx.item(pieces[0].id)).status).toBe('listed');

      const r1 = await repair.run('manual', new Date(), { onlyOrderIds: [order.id] });
      expect(r1).toMatchObject({ total: 3, orders: 1, repaired: 3, forDecision: 0 });
      for (const p of pieces) {
        const it = await fx.item(p.id);
        expect(it).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'settled', reservedByOrderId: null });
        expect(await fx.movements(p.id, 'settle')).toHaveLength(1);
      }
      expect(await ledgerRows([order.id])).toBe(0);
      expect(h.stripe.refundCreateCalls).toHaveLength(0);
      expect(await fx.violations([order.id])).toEqual([]);

      const audits = await h.prisma.auditLog.count({ where: { entityId: order.id } });
      const moves = await h.prisma.inventoryMovement.count({ where: { itemId: { in: pieces.map((p) => p.id) } } });
      const r2 = await repair.run('manual', new Date(), { onlyOrderIds: [order.id] });
      expect(r2).toMatchObject({ total: 0, repaired: 0 });
      expect(await h.prisma.auditLog.count({ where: { entityId: order.id } })).toBe(audits);
      expect(await h.prisma.inventoryMovement.count({ where: { itemId: { in: pieces.map((p) => p.id) } } })).toBe(moves);
    });

    it('a·libres + b·vendidas con copia + c·sin copia ⇒ reasigna a, repone b, lista SOLO c; 0 dinero; segunda corrida ⇒ 0 cambios', async () => {
      const buyer = await fx.user('mix');
      const other = await fx.user('mix-other');
      const cardLibre = await fx.card('mix-free');
      const cardCopia = await fx.card('mix-copy');
      const cardSola = await fx.card('mix-none');
      const free = [await fx.piece(cardLibre.id), await fx.piece(cardLibre.id)];
      // Vendidas a otro cliente (ya no son de plataforma) y con UNA copia equivalente libre cada una.
      const sold = [
        await fx.piece(cardCopia.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled', acquisitionCostCents: 5000 }),
        await fx.piece(cardCopia.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled', acquisitionCostCents: 6000 }),
      ];
      const newer = await fx.piece(cardCopia.id, { createdAt: new Date('2026-06-01T00:00:00Z'), acquisitionCostCents: 7000 });
      const older = await fx.piece(cardCopia.id, { createdAt: new Date('2026-01-01T00:00:00Z'), acquisitionCostCents: 8000 });
      const lost = await fx.piece(cardSola.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled' });
      const { order } = await fx.settledVaultOrder(buyer.id, [...free, ...sold, lost]);
      const before = await lineOf(order.id);

      const r1 = await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
      expect(r1).toMatchObject({ total: 5, repaired: 4, replaced: 2, forDecision: 1 });
      const after = await lineOf(order.id);
      // a — asignadas: la línea sigue apuntando a SU pieza.
      for (const p of free) expect(await fx.item(p.id)).toMatchObject({ status: 'in_custody', ownerUserId: buyer.id });
      // b — repuestas: la copia más ANTIGUA primero (determinista); la línea se reapunta; la original queda anotada.
      expect(after[2].inventoryItemId).toBe(older.id);
      expect(after[3].inventoryItemId).toBe(newer.id);
      expect(after[2].replacedInventoryItemId).toBe(sold[0].id);
      expect(after[3].replacedInventoryItemId).toBe(sold[1].id);
      for (const c of [older, newer]) expect(await fx.item(c.id)).toMatchObject({ status: 'in_custody', ownerType: 'customer', ownerUserId: buyer.id });
      // La original NO se toca (sigue siendo del otro cliente) y lleva su movimiento; precio cobrado y costo de cada pieza intactos.
      for (const s of sold) expect(await fx.item(s.id)).toMatchObject({ ownerUserId: other.id, status: 'in_custody' });
      expect((await fx.movements(sold[0].id, 'replacement')).length).toBe(1);
      expect((await fx.movements(older.id, 'settle')).length).toBe(1);
      expect(after.map((l) => l.unitPriceCents)).toEqual(before.map((l) => l.unitPriceCents));
      expect((await fx.item(older.id)).acquisitionCostCents).toBe(8000);
      expect((await fx.item(sold[0].id)).acquisitionCostCents).toBe(5000);
      // c — sin copia: «requiere atención», sin reembolso; sale de «Para bóveda».
      expect(after[4]).toMatchObject({ fulfillmentFailedReason: 'no_equivalent_copy' });
      expect(after[4].fulfillmentFailedAt).not.toBeNull();
      expect(await h.prisma.vaultPlacementItem.count({ where: { orderItemId: after[4].id } })).toBe(0);
      expect(await h.prisma.vaultPlacementItem.count({ where: { orderItemId: after[2].id, inventoryItemId: older.id } })).toBe(1);
      expect(await ledgerRows([order.id])).toBe(0);
      expect(h.stripe.refundCreateCalls).toHaveLength(0);
      // La bitácora trae el detalle (`after.anomalies[].was`) que el súper-admin lee.
      const anomalies = await h.prisma.auditLog.findFirst({ where: { entityId: order.id, action: 'order.settle_item_not_reserved' } });
      expect((anomalies!.after as { anomalies: { was: string }[] }).anomalies.length).toBe(5); // 2 asignadas + 2 repuestas + 1 requiere atención

      // Segunda corrida ⇒ 0 cambios.
      const audits = await h.prisma.auditLog.count({ where: { entityId: order.id } });
      const r2 = await repair.run('manual', new Date(), { onlyOrderIds: [order.id] });
      expect(r2.repaired).toBe(0);
      expect(await h.prisma.auditLog.count({ where: { entityId: order.id } })).toBe(audits);
      expect(await lineOf(order.id)).toEqual(after);

      // Al darla de alta (la carta que faltaba), la corrida diaria la asigna sola.
      const arrived = await fx.piece(cardSola.id);
      const r3 = await repair.run('daily', new Date(), { onlyOrderIds: [order.id] });
      expect(r3).toMatchObject({ repaired: 1, forDecision: 0 });
      const final = await lineOf(order.id);
      expect(final[4].fulfillmentFailedAt).toBeNull();
      expect(final[4].inventoryItemId).toBe(arrived.id);
      expect(await fx.violations([order.id])).toEqual([]);
    });
  });

  describe('política de la reparación diaria', () => {
    it('un pedido ANTERIOR al despliegue no se repone solo en la corrida diaria (lo decide el dueño); sí se asigna lo libre', async () => {
      const buyer = await fx.user('pol');
      const owner = await fx.user('pol-owner');
      const card = await fx.card('pol');
      const free = await fx.piece(card.id);
      const gone = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled' });
      const spare = await fx.piece(card.id);
      const { order } = await fx.settledVaultOrder(buyer.id, [free, gone]);
      await h.prisma.auditLog.deleteMany({ where: { action: 'vault.orphan_repair_run' } }); // solo hay marcas de ESTA suite (BD de pruebas)
      await h.prisma.auditLog.create({ data: { actorUserId: null, actorRole: null, action: 'vault.orphan_repair_run', entityType: 'Order', entityId: 'vault-orphan-repair', after: { trigger: 'deploy' }, createdAt: new Date(Date.now() + 60_000) } });
      const r = await repair.run('daily', new Date(), { onlyOrderIds: [order.id] });
      expect(r).toMatchObject({ total: 2, repaired: 1, forDecision: 0 });
      const lines = await lineOf(order.id);
      expect(lines[0].inventoryItemId).toBe(free.id);
      expect(lines[1].inventoryItemId).toBe(gone.id); // sin reposición automática
      expect((await fx.item(spare.id)).status).toBe('listed');
    });
  });

  // ------------------------------------------------------------------------------------------------ criterio 2: equivalencia
  describe('copia EQUIVALENTE: nunca otro acabado, idioma, grado, sellado ni una pieza de cliente (0/20 erróneas)', () => {
    it('raw: candidatas casi iguales (otro acabado/idioma/carta, de cliente, reservada, en envío) ⇒ 0/20 asignaciones erróneas', async () => {
      let wrong = 0;
      for (let i = 0; i < 20; i += 1) {
        const buyer = await fx.user('eq');
        const owner = await fx.user('eq-owner');
        const card = await fx.card('eq');
        const otherCard = await fx.card('eq-other');
        const orig = await fx.piece(card.id, { finish: 'holofoil', status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled' });
        const old = new Date('2025-01-01T00:00:00Z');
        const decoys = [
          await fx.piece(card.id, { finish: 'normal', createdAt: old }), // otro acabado
          await fx.piece(card.id, { finish: 'holofoil', language: 'es', createdAt: old }), // otro idioma
          await fx.piece(otherCard.id, { finish: 'holofoil', createdAt: old }), // otra carta
          await fx.piece(card.id, { finish: 'holofoil', status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled', createdAt: old }), // DE CLIENTE
          await fx.piece(card.id, { finish: 'holofoil', status: 'in_stock', ownerType: 'customer', ownerUserId: owner.id, createdAt: old }), // dueño cliente aunque «en stock»
          await fx.piece(card.id, { finish: 'holofoil', status: 'picking', createdAt: old }), // ya en preparación
        ];
        const withTrue = i % 2 === 0;
        const real = withTrue ? await fx.piece(card.id, { finish: 'holofoil', createdAt: new Date('2026-05-05T00:00:00Z') }) : null;
        const { order } = await fx.settledVaultOrder(buyer.id, [orig]);
        await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
        const [line] = await lineOf(order.id);
        const gotId = line.inventoryItemId;
        const ok = withTrue ? gotId === real!.id && line.replacedInventoryItemId === orig.id : gotId === orig.id && line.fulfillmentFailedAt !== null;
        if (!ok || decoys.some((d) => d.id === gotId)) wrong += 1;
        for (const d of decoys) expect((await fx.item(d.id)).ownerUserId).not.toBe(buyer.id);
      }
      expect(`${wrong}/20 asignaciones erróneas`).toBe('0/20 asignaciones erróneas');
    });

    it('graded: misma empresa y MISMO grado; sellado: mismo subtipo y condición', async () => {
      const buyer = await fx.user('gr');
      const owner = await fx.user('gr-owner');
      const card = await fx.card('gr');
      const sold = { status: 'in_custody', ownerType: 'customer' as const, ownerUserId: owner.id, ownershipStatus: 'settled' };
      const g = await fx.piece(card.id, { productType: 'graded', gradingCompany: 'PSA', gradeValue: '10', ...sold });
      const wrongGrade = await fx.piece(card.id, { productType: 'graded', gradingCompany: 'PSA', gradeValue: '9', createdAt: new Date('2025-01-01T00:00:00Z') });
      const wrongCo = await fx.piece(card.id, { productType: 'graded', gradingCompany: 'CGC', gradeValue: '10', createdAt: new Date('2025-01-02T00:00:00Z') });
      const okG = await fx.piece(card.id, { productType: 'graded', gradingCompany: 'PSA', gradeValue: '10', createdAt: new Date('2026-01-01T00:00:00Z') });
      const s = await fx.piece(card.id, { productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', ...sold });
      const wrongSub = await fx.piece(card.id, { productType: 'sealed', sealedSubtype: 'etb', sealedCondition: 'mint', createdAt: new Date('2025-01-01T00:00:00Z') });
      const wrongCond = await fx.piece(card.id, { productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'minor_box_damage', createdAt: new Date('2025-01-02T00:00:00Z') });
      const okS = await fx.piece(card.id, { productType: 'sealed', sealedSubtype: 'box', sealedCondition: 'mint', createdAt: new Date('2026-01-01T00:00:00Z') });
      const { order } = await fx.settledVaultOrder(buyer.id, [g, s]);
      await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
      const lines = await lineOf(order.id);
      expect(lines[0].inventoryItemId).toBe(okG.id);
      expect(lines[1].inventoryItemId).toBe(okS.id);
      for (const d of [wrongGrade, wrongCo, wrongSub, wrongCond]) expect((await fx.item(d.id)).status).toBe('listed');
    });
  });

  // ------------------------------------------------------------------------------------------------ liquidación por webhook
  describe('`payment_intent.succeeded` — cada línea por la función compartida', () => {
    it('reservada por el pedido ⇒ como siempre (un movimiento `settle`); libre ⇒ se asigna; ninguna sin pieza', async () => {
      const buyer = await fx.user('s1');
      const card = await fx.card('s1');
      const a = await fx.piece(card.id);
      const b = await fx.piece(card.id);
      const { order, pi } = await fx.order({ userId: buyer.id, pieces: [a, b] });
      // `b` quedó libre (el barrido la soltó) aunque el pedido siga colgado de ella.
      await h.prisma.inventoryItem.update({ where: { id: b.id }, data: { status: 'listed', ownerType: 'platform', ownerUserId: null, ownershipStatus: null, reservedByOrderId: null, reservedUntil: null } });
      const wh = await fx.paid(pi!);
      expect(wh.status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('settled');
      for (const p of [a, b]) {
        expect(await fx.item(p.id)).toMatchObject({ status: 'in_custody', ownerUserId: buyer.id, ownerType: 'customer', reservedByOrderId: null });
        expect(await fx.movements(p.id, 'settle')).toHaveLength(1);
      }
      expect(await h.prisma.vaultPlacementItem.count({ where: { placement: { orderId: order.id } } })).toBe(2);
      expect(await h.prisma.auditLog.count({ where: { entityId: order.id, action: 'order.settle_item_recovered' } })).toBe(1);
    });

    it('pieza vendida a OTRO / reservada por otro usuario ⇒ copia equivalente, visible «se repuso X por Y»; sin copia ⇒ requiere atención; 0 dinero', async () => {
      const buyer = await fx.user('s2');
      const rival = await fx.user('s2-rival');
      const card = await fx.card('s2');
      const cardNone = await fx.card('s2-none');
      const takenByRival = await fx.piece(card.id);
      const rivalOrder = await fx.order({ userId: rival.id, pieces: [takenByRival] });
      const soldTo = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: rival.id, ownershipStatus: 'settled' });
      const alone = await fx.piece(cardNone.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: rival.id, ownershipStatus: 'settled' });
      const spare1 = await fx.piece(card.id, { createdAt: new Date('2026-01-01T00:00:00Z') });
      const spare2 = await fx.piece(card.id, { createdAt: new Date('2026-02-01T00:00:00Z') });
      const { order, pi } = await fx.order({ userId: buyer.id, pieces: [takenByRival, soldTo, alone], status: 'failed' });
      expect((await fx.paid(pi!)).status).toBe(200);
      const lines = await lineOf(order.id);
      expect(lines[0].inventoryItemId).toBe(spare1.id);
      expect(lines[1].inventoryItemId).toBe(spare2.id);
      expect(lines[0].replacedInventoryItemId).toBe(takenByRival.id);
      expect(lines[2].fulfillmentFailedReason).toBe('no_equivalent_copy');
      // Al rival no se le quitó nada.
      expect(await fx.item(takenByRival.id)).toMatchObject({ status: 'reserved', reservedByOrderId: rivalOrder.order.id, ownerUserId: rival.id });
      expect(await fx.item(soldTo.id)).toMatchObject({ ownerUserId: rival.id });
      expect(await ledgerRows([order.id])).toBe(0);
      expect(h.stripe.refundCreateCalls).toHaveLength(0);
      // Pedido liquidado, colocación solo con las dos líneas que sí tienen pieza.
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('settled');
      const placed = await h.prisma.vaultPlacementItem.findMany({ where: { placement: { orderId: order.id } }, orderBy: { orderItem: { unitPriceCents: 'asc' } } });
      expect(placed.map((p) => p.inventoryItemId)).toEqual([spare1.id, spare2.id]);
      expect(await fx.violations([order.id])).toEqual([]);
      const audit = await h.prisma.auditLog.findFirst({ where: { entityId: order.id, action: 'order.settle_item_replaced' } });
      expect(audit!.after).toMatchObject({ originalFolio: takenByRival.folio, copyFolio: spare1.folio });
    });

    it('idempotencia: el MISMO evento, y dos `event.id` distintos ⇒ 1 settle, a lo más 1 reposición por línea, 1 colocación, 200 en todos', async () => {
      const buyer = await fx.user('s3');
      const owner = await fx.user('s3-owner');
      const card = await fx.card('s3');
      const gone = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled' });
      const copyA = await fx.piece(card.id, { createdAt: new Date('2026-01-01T00:00:00Z') });
      const copyB = await fx.piece(card.id, { createdAt: new Date('2026-02-01T00:00:00Z') });
      const { order, pi } = await fx.order({ userId: buyer.id, pieces: [gone], status: 'failed' });
      const eventA = 'evt_vo_' + RUN + '_a';
      const statuses = [(await fx.paid(pi!, 100, eventA)).status, (await fx.paid(pi!, 100, eventA)).status, (await fx.paid(pi!, 100, 'evt_vo_' + RUN + '_b')).status];
      expect(statuses).toEqual([200, 200, 200]);
      const [line] = await lineOf(order.id);
      expect(line.inventoryItemId).toBe(copyA.id);
      expect((await fx.item(copyB.id)).status).toBe('listed'); // NO se repuso una segunda copia
      expect(await fx.movements(copyA.id, 'settle')).toHaveLength(1);
      expect(await h.prisma.vaultPlacement.count({ where: { orderId: order.id } })).toBe(1);
      expect(await h.prisma.auditLog.count({ where: { entityId: order.id, action: 'order.settle_item_replaced' } })).toBe(1);
      expect(await ledgerRows([order.id])).toBe(0);
    });

    it('envío directo (`direct_ship`): MISMA función — pieza tomada por otro ⇒ copia, y el envío lleva la copia', async () => {
      const owner = await fx.user('ds-owner');
      const card = await fx.card('ds');
      const gone = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled' });
      const copy = await fx.piece(card.id);
      const { order, pi } = await fx.order({ userId: null, pieces: [gone], status: 'failed', mode: 'direct_ship' });
      expect((await fx.paid(pi!)).status).toBe(200);
      const [line] = await lineOf(order.id);
      expect(line.inventoryItemId).toBe(copy.id);
      expect(await fx.item(copy.id)).toMatchObject({ status: 'picking', ownerType: 'platform', ownerUserId: null });
      const ship = await h.prisma.shipmentRequest.findFirstOrThrow({ where: { orderId: order.id }, include: { items: true } });
      expect(ship.items.map((i) => i.inventoryItemId)).toEqual([copy.id]);
      expect(await fx.item(gone.id)).toMatchObject({ ownerUserId: owner.id });
    });
  });

  // ------------------------------------------------------------------------------------------------ R2
  describe('R2 — reservada por OTRA orden del MISMO usuario', () => {
    it('la otra está `pending` ⇒ se TRANSFIERE, la otra pasa a `failed`, su PI se cancela y solo se libera lo que sobra', async () => {
      const buyer = await fx.user('r2');
      const card = await fx.card('r2');
      const a = await fx.piece(card.id);
      const b = await fx.piece(card.id);
      const extra = await fx.piece(card.id);
      // O1 (cobrada tarde, `failed` por sustitución) y O2 (la vigente, retiene a, b y extra).
      const o1 = await fx.order({ userId: buyer.id, pieces: [a, b], status: 'failed' });
      const o2 = await fx.order({ userId: buyer.id, pieces: [a, b, extra] });
      expect((await fx.paid(o1.pi!)).status).toBe(200);
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o1.order.id } })).status).toBe('settled');
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o2.order.id } })).status).toBe('failed');
      for (const p of [a, b]) {
        expect(await fx.item(p.id)).toMatchObject({ status: 'in_custody', ownerUserId: buyer.id, reservedByOrderId: null });
        expect(await fx.movements(p.id, 'settle')).toHaveLength(1);
      }
      // `extra` solo la cubría O2 ⇒ se libera; nunca lo ya transferido.
      expect(await fx.item(extra.id)).toMatchObject({ status: 'listed', ownerUserId: null, ownerType: 'platform', reservedByOrderId: null });
      expect(h.stripe.canceledIntents).toContain(o2.pi);
      expect(await ledgerRows([o1.order.id, o2.order.id])).toBe(0);
      expect(await fx.violations([o1.order.id, o2.order.id])).toEqual([]);
      // El `succeeded` repetido de O1 no altera nada.
      expect((await fx.paid(o1.pi!)).status).toBe(200);
      expect(await fx.movements(a.id, 'settle')).toHaveLength(1);
    });

    it('doble cobro (la otra ya está `settled`) ⇒ AMBAS «requieren atención», 0 automatismos de dinero', async () => {
      const buyer = await fx.user('dc');
      const card = await fx.card('dc');
      const a = await fx.piece(card.id);
      const o1 = await fx.order({ userId: buyer.id, pieces: [a], status: 'failed' });
      const o2 = await fx.order({ userId: buyer.id, pieces: [a] });
      expect((await fx.paid(o2.pi!)).status).toBe(200); // O2 se paga primero y se queda con la pieza
      expect((await fx.paid(o1.pi!)).status).toBe(200); // O1 también se cobra
      const l1 = (await lineOf(o1.order.id))[0];
      const l2 = (await lineOf(o2.order.id))[0];
      expect(l1.fulfillmentFailedReason).toBe('double_charge');
      expect(l2.fulfillmentFailedReason).toBe('double_charge');
      expect(await fx.item(a.id)).toMatchObject({ status: 'in_custody', ownerUserId: buyer.id });
      expect(await fx.movements(a.id, 'settle')).toHaveLength(1);
      expect(await ledgerRows([o1.order.id, o2.order.id])).toBe(0);
      expect(h.stripe.refundCreateCalls).toHaveLength(0);

      // B-2: TODA línea «requiere atención» (aquí `double_charge`, con la pieza ya del comprador) cuenta y se ve.
      const found = await findUnassignedLines(h.prisma, { orderIds: [o1.order.id, o2.order.id] });
      expect(found.map((l) => l.orderItemId).sort()).toEqual([l1.id, l2.id].sort());
      expect(distinctOrders(found).sort()).toEqual([o1.order.id, o2.order.id].sort());
      const mm = await h.api('GET', '/admin/orders?mismatch=true&pageSize=100', { token: adminToken });
      expect(mm.body.data.map((o: { id: string }) => o.id)).toEqual(expect.arrayContaining([o1.order.id, o2.order.id]));
      const orph = await h.api('GET', '/admin/vault-orphans', { token: adminToken });
      expect(orph.body.data.find((o: { orderId: string }) => o.orderId === o1.order.id).lines[0].state).toBe('needs_attention');
      const vaults = await h.api('GET', `/admin/vaults?q=${encodeURIComponent(buyer.email as string)}`, { token: adminToken });
      expect(vaults.body.data.find((v: { userId: string }) => v.userId === buyer.id).unassignedPaidOrders.map((o: { orderId: string }) => o.orderId).sort()).toEqual([o1.order.id, o2.order.id].sort());
      // La reparación no vuelve a auditar ni a re-marcar lo que ya está marcado (flagOther).
      const attn = () => h.prisma.auditLog.count({ where: { entityId: { in: [o1.order.id, o2.order.id] }, action: 'order.settle_item_attention' } });
      const before = await attn();
      await repair.run('deploy', new Date(), { onlyOrderIds: [o1.order.id, o2.order.id] });
      expect(await attn()).toBe(before);
    });
  });

  // ------------------------------------------------------------------------------------------------ B-1 / I-4
  describe('B-1 — la invariante es por DUEÑO, no por lista de estados', () => {
    it('pieza en `picking`/`shipped`/`delivered`/`lost` de otro pedido o dueño ⇒ detectada, repuesta si hay copia o «requiere atención»; la del propio comprador y los casos de reposición NO', async () => {
      const buyer = await fx.user('b1');
      const other = await fx.user('b1-other');
      const cards = [await fx.card('b1a'), await fx.card('b1b'), await fx.card('b1c'), await fx.card('b1d'), await fx.card('b1e'), await fx.card('b1f')];
      const bad = [
        await fx.piece(cards[0].id, { status: 'picking' }), // plataforma en preparación de OTRO pedido
        await fx.piece(cards[1].id, { status: 'shipped' }),
        await fx.piece(cards[2].id, { status: 'delivered', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled' }),
        await fx.piece(cards[3].id, { status: 'lost' }),
      ];
      const legitOwn = await fx.piece(cards[4].id, { status: 'shipped', ownerType: 'customer', ownerUserId: buyer.id, ownershipStatus: 'settled' }); // retirada por SU pedido
      const withCase = await fx.piece(cards[5].id, { status: 'picking' }); // pieza ya tratada por un caso «Por reponer»
      const copy0 = await fx.piece(cards[0].id);
      const copy1 = await fx.piece(cards[1].id);
      const { order, lines } = await fx.settledVaultOrder(buyer.id, [...bad, legitOwn, withCase]);
      await h.prisma.replacementCase.create({
        data: { source: 'vault_purchase', customerUserId: buyer.id, originalInventoryItemId: withCase.id, originOrderItemId: lines[5].id, placementItemId: (await h.prisma.vaultPlacementItem.findFirstOrThrow({ where: { orderItemId: lines[5].id } })).id, missingReason: 'not_found', openedAt: new Date(), openedByUserId: other.id },
      });
      const found = await findUnassignedLines(h.prisma, { orderIds: [order.id] });
      expect(found.map((l) => l.orderItemId).sort()).toEqual(lines.slice(0, 4).map((l) => l.id).sort());
      const r = await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
      expect(r).toMatchObject({ total: 4, repaired: 2, replaced: 2, forDecision: 2 });
      const after = await lineOf(order.id);
      expect(after[0].inventoryItemId).toBe(copy0.id);
      expect(after[1].inventoryItemId).toBe(copy1.id);
      expect(after[2].fulfillmentFailedReason).toBe('no_equivalent_copy');
      expect(after[3].fulfillmentFailedReason).toBe('no_equivalent_copy');
      expect(after[4].inventoryItemId).toBe(legitOwn.id);
      expect(after[4].fulfillmentFailedAt).toBeNull();
      expect(after[5].fulfillmentFailedAt).toBeNull();
      // La pieza ajena no se tocó.
      expect(await fx.item(bad[2].id)).toMatchObject({ ownerUserId: other.id, status: 'delivered' });
      // La ficha no dice «en su bóveda» de una línea sin pieza: el estado por línea sale del servidor.
      const detail = await h.api('GET', `/admin/orders/${order.id}`, { token: adminToken });
      const st = new Map(detail.body.items.map((i: { inventoryItemId: string; fulfillmentState: string }) => [i.inventoryItemId, i.fulfillmentState]));
      expect(st.get(bad[2].id)).toBe('needs_attention');
      expect(st.get(copy0.id)).toBe('replaced');
      expect(st.get(legitOwn.id)).toBe('assigned');
    });

    it('una pieza de plataforma en `picking` (línea de bóveda sin marcar) cuenta como sin asignar ANTES de repararse', async () => {
      const buyer = await fx.user('b1x');
      const card = await fx.card('b1x');
      const p = await fx.piece(card.id, { status: 'picking' });
      const { order } = await fx.settledVaultOrder(buyer.id, [p]);
      expect(distinctOrders(await findUnassignedLines(h.prisma, { orderIds: [order.id] }))).toEqual([order.id]);
      const detail = await h.api('GET', `/admin/orders/${order.id}`, { token: adminToken });
      expect(detail.body.items[0].fulfillmentState).toBe('unassigned');
    });
  });

  describe('I-4 — exclusiones que no se pueden perder (mutaciones vivas)', () => {
    it('la copia NUNCA es una pieza en un envío vivo ni reclamada por la línea de otro pedido liquidado', async () => {
      const buyer = await fx.user('i4');
      const owner = await fx.user('i4-owner');
      const rival = await fx.user('i4-rival');
      const card = await fx.card('i4');
      const orig = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: owner.id, ownershipStatus: 'settled' });
      const inShipment = await fx.piece(card.id, { createdAt: new Date('2025-01-01T00:00:00Z') });
      await fx.shipmentWith([inShipment.id]);
      const claimed = await fx.piece(card.id, { createdAt: new Date('2025-01-02T00:00:00Z') });
      await fx.order({ userId: rival.id, pieces: [claimed], status: 'settled', pi: null }); // línea viva de otro pedido liquidado
      const real = await fx.piece(card.id, { createdAt: new Date('2026-05-05T00:00:00Z') });
      const { order } = await fx.settledVaultOrder(buyer.id, [orig]);
      await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
      expect((await lineOf(order.id))[0].inventoryItemId).toBe(real.id);
      expect((await fx.item(inShipment.id)).ownerUserId).toBeNull();
      expect((await fx.item(claimed.id)).ownerUserId).toBeNull();
    });

    it('una línea REEMBOLSADA no cuenta ni se repara, aunque su pieza esté a la venta', async () => {
      const buyer = await fx.user('i4r');
      const card = await fx.card('i4r');
      const p = await fx.piece(card.id);
      const { order, lines } = await fx.settledVaultOrder(buyer.id, [p]);
      const ship = await fx.shipmentWith([p.id], buyer.id);
      const shipItem = await h.prisma.shipmentItem.findFirstOrThrow({ where: { shipmentRequestId: ship.id } });
      await h.prisma.paymentRefund.create({
        data: { idempotencyKey: `vo-${RUN}-${order.id}`, kind: 'item_missing', missingReason: 'not_found', shipmentItemId: shipItem.id, status: 'requested', orderId: order.id, orderItemId: lines[0].id, amountCents: 1, merchandiseCents: 1, merchandiseIvaCents: 0, shippingCents: 0, shippingIvaCents: 0, processingFeeCents: 0, requestedByUserId: buyer.id, requestedByRole: 'super_admin' },
      });
      expect(await findUnassignedLines(h.prisma, { orderIds: [order.id] })).toEqual([]);
      const r = await repair.run('deploy', new Date(), { onlyOrderIds: [order.id] });
      expect(r.total).toBe(0);
      expect((await fx.item(p.id)).status).toBe('listed');
    });
  });

  // ------------------------------------------------------------------------------------------------ criterio 2: carreras N=20
  describe('carreras en Postgres real (N = 20 por escenario)', () => {
    const N = 20;

    it('(v) dos pedidos tardíos y un comprador normal compiten por la MISMA última copia ⇒ exactamente un dueño; la copia ni se duplica ni se pierde', async () => {
      let ok = 0;
      for (let i = 0; i < N; i += 1) {
        const u1 = await fx.user('v1');
        const u2 = await fx.user('v2');
        const normal = await fx.user('v3');
        const away = await fx.user('v-away');
        const card = await fx.card('v');
        const mk = () => fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: away.id, ownershipStatus: 'settled' });
        const last = await fx.piece(card.id);
        const l1 = await fx.order({ userId: u1.id, pieces: [await mk()], status: 'failed' });
        const l2 = await fx.order({ userId: u2.id, pieces: [await mk()], status: 'failed' });
        const normalOrder = await fx.order({ userId: normal.id, pieces: [] });
        const normalBuy = h.prisma.inventoryItem.updateMany({
          where: { id: last.id, status: { in: ['listed', 'in_stock'] }, ownerType: 'platform', ownerUserId: null, reservedByOrderId: null },
          data: { status: 'reserved', ownerType: 'customer', ownerUserId: normal.id, ownershipStatus: 'pending', reservedByOrderId: normalOrder.order.id, reservedUntil: new Date(Date.now() + 3600_000) },
        });
        const [, , nb] = await Promise.all([fx.paid(l1.pi!), fx.paid(l2.pi!), normalBuy]);
        const holders = [
          (await lineOf(l1.order.id))[0].inventoryItemId === last.id,
          (await lineOf(l2.order.id))[0].inventoryItemId === last.id,
          nb.count === 1 && (await fx.item(last.id)).status === 'reserved',
        ].filter(Boolean).length;
        const settledAll = (await h.prisma.order.count({ where: { id: { in: [l1.order.id, l2.order.id] }, status: 'settled' } })) === 2;
        const covered = await Promise.all(
          [l1, l2].map(async (o) => {
            const l = (await lineOf(o.order.id))[0];
            return l.inventoryItemId === last.id || l.fulfillmentFailedAt !== null; // cobrada ⇒ pieza propia, repuesta o «requiere atención»
          }),
        );
        const lastItem = await fx.item(last.id);
        const oneOwner = lastItem.ownerType === 'platform' ? lastItem.ownerUserId === null : lastItem.ownerUserId !== null;
        if (holders <= 1 && settledAll && covered.every(Boolean) && oneOwner && (await fx.ownerViolations()).length === 0) ok += 1;
      }
      expect(`${ok}/${N}`).toBe(`${N}/${N}`);
    });

    it('(i) barrido y `succeeded` simultáneos · (ii) tardío con pieza libre · (iii) con pieza ya reservada por otro · (iv) ya vendida a otro', async () => {
      const orders = h.app.get(OrdersService);
      const tally: Record<string, number> = { i: 0, ii: 0, iii: 0, iv: 0 };
      for (let i = 0; i < N; i += 1) {
        // (i) vencida y con PI: el barrido y el pago llegan a la vez.
        {
          const b = await fx.user('i');
          const card = await fx.card('i');
          const p = await fx.piece(card.id);
          const o = await fx.order({ userId: b.id, pieces: [p], reservedUntil: new Date(Date.now() - 1000) });
          await Promise.all([orders.sweepExpiredReservations(), fx.paid(o.pi!)]);
          const st = (await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status;
          const piece = await fx.item(p.id);
          // Ganó el pago (settled + pieza del comprador) o ganó el barrido (failed + pieza libre) — nunca «settled» sin pieza ni dos dueños.
          const consistent = st === 'settled' ? (await fx.violations([o.order.id])).length === 0 : st === 'failed' && piece.status === 'listed';
          if (consistent && (await ledgerRows([o.order.id])) === 0) tally.i += 1;
        }
        // (ii) tardío, pieza libre.
        {
          const b = await fx.user('ii');
          const card = await fx.card('ii');
          const p = await fx.piece(card.id);
          const o = await fx.order({ userId: b.id, pieces: [p], status: 'failed' });
          await fx.paid(o.pi!);
          if ((await fx.violations([o.order.id])).length === 0 && (await fx.item(p.id)).ownerUserId === b.id) tally.ii += 1;
        }
        // (iii) tardío, pieza reservada por OTRO usuario (con copia disponible).
        {
          const b = await fx.user('iii');
          const rival = await fx.user('iii-r');
          const card = await fx.card('iii');
          const p = await fx.piece(card.id);
          await fx.order({ userId: rival.id, pieces: [p] });
          const copy = await fx.piece(card.id);
          const o = await fx.order({ userId: b.id, pieces: [p], status: 'failed' });
          await fx.paid(o.pi!);
          const l = (await lineOf(o.order.id))[0];
          if (l.inventoryItemId === copy.id && (await fx.item(p.id)).ownerUserId === rival.id && (await fx.violations([o.order.id])).length === 0) tally.iii += 1;
        }
        // (iv) ya vendida a otro, sin copia ⇒ «requiere atención».
        {
          const b = await fx.user('iv');
          const rival = await fx.user('iv-r');
          const card = await fx.card('iv');
          const p = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: rival.id, ownershipStatus: 'settled' });
          const o = await fx.order({ userId: b.id, pieces: [p], status: 'failed' });
          await fx.paid(o.pi!);
          const l = (await lineOf(o.order.id))[0];
          if (l.fulfillmentFailedAt !== null && (await fx.item(p.id)).ownerUserId === rival.id && (await ledgerRows([o.order.id])) === 0) tally.iv += 1;
        }
      }
      expect(tally).toEqual({ i: N, ii: N, iii: N, iv: N });
      expect(await fx.ownerViolations()).toEqual([]);
    });
  });

  // ------------------------------------------------------------------------------------------------ criterio 4: barrido
  describe('barrido — nunca libera con el pago vivo; extiende si no puede cancelar; libera lo que no tiene cobro posible', () => {
    const expired = () => new Date(Date.now() - 5000);

    it('PI `succeeded`/`processing` (el cancel falla) ⇒ 0 piezas liberadas y `reservedUntil` EXTENDIDO', async () => {
      const orders = h.app.get(OrdersService);
      const b = await fx.user('sw1');
      const card = await fx.card('sw1');
      const p = await fx.piece(card.id);
      const o = await fx.order({ userId: b.id, pieces: [p], reservedUntil: expired() });
      h.stripe.cancelOutcome = 'throws-succeeded';
      const r = await orders.sweepExpiredReservations();
      expect(r.skipped).toBeGreaterThanOrEqual(1);
      const piece = await fx.item(p.id);
      expect(piece.status).toBe('reserved');
      expect(piece.reservedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('pending');
      // Y el cobro llega: se liquida normal (la pieza seguía reservada por el pedido).
      expect((await fx.paid(o.pi!)).status).toBe(200);
      expect(await fx.violations([o.order.id])).toEqual([]);
    });

    it('agotado el tope de 24 h ⇒ alerta `order.sweep_blocked` (una sola vez) y sigue sin liberar', async () => {
      const orders = h.app.get(OrdersService);
      const b = await fx.user('sw2');
      const card = await fx.card('sw2');
      const p = await fx.piece(card.id);
      const old = new Date(Date.now() - 26 * 3600_000);
      const o = await fx.order({ userId: b.id, pieces: [p], reservedUntil: expired(), createdAt: old });
      h.stripe.cancelOutcome = 'throws-succeeded';
      await orders.sweepExpiredReservations();
      await orders.sweepExpiredReservations();
      expect((await fx.item(p.id)).status).toBe('reserved');
      expect(await h.prisma.auditLog.count({ where: { action: 'order.sweep_blocked', entityId: o.order.id } })).toBe(1);
    });

    it('voucher / transferencia VIGENTE ⇒ no se cancela ni se libera; vencido ⇒ se libera', async () => {
      const orders = h.app.get(OrdersService);
      const b = await fx.user('sw3');
      const card = await fx.card('sw3');
      const p = await fx.piece(card.id);
      const o = await fx.order({ userId: b.id, pieces: [p], reservedUntil: expired() });
      const calls = h.stripe.callLog.length;
      h.stripe.voucherUntil = new Date(Date.now() + 3600_000);
      await orders.sweepExpiredReservations();
      expect((await fx.item(p.id)).status).toBe('reserved');
      expect(h.stripe.callLog.slice(calls).filter((c) => c === `cancel:${o.pi}`)).toHaveLength(0);
      h.stripe.voucherUntil = new Date(Date.now() - 1000);
      await h.prisma.inventoryItem.update({ where: { id: p.id }, data: { reservedUntil: expired() } });
      await orders.sweepExpiredReservations();
      expect((await fx.item(p.id)).status).toBe('listed');
      h.stripe.voucherUntil = null;
    });

    it('pedido `pending` SIN PI vencido ⇒ se libera y queda `order.sweep_no_pi`', async () => {
      const orders = h.app.get(OrdersService);
      const b = await fx.user('sw4');
      const card = await fx.card('sw4');
      const p = await fx.piece(card.id);
      const o = await fx.order({ userId: b.id, pieces: [p], pi: null, reservedUntil: expired() });
      await orders.sweepExpiredReservations();
      expect((await fx.item(p.id)).status).toBe('listed');
      expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe('failed');
      expect(await h.prisma.auditLog.count({ where: { action: 'order.sweep_no_pi', entityId: o.order.id } })).toBe(1);
    });
  });
});
