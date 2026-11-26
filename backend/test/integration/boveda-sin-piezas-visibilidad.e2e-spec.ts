/**
 * boveda-sin-piezas-visibilidad.e2e-spec.ts — §BOVEDA-COBRADA-SIN-PIEZAS punto 4 + criterio 6 (sin SQL): el contador del panel, los
 * filtros de Pedidos, el estado por línea del detalle, el renglón de «Bóvedas de clientes», el detalle de la bitácora (solo
 * súper-admin) y `GET /admin/vault-orphans`. El caso reproducido: cuenta sin nombre, pedido cobrado y piezas a la venta.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { VaultOrphanRepairService } from '../../src/jobs/vault-orphan-repair.service';
import { distinctOrders, findUnassignedLines } from '../../src/modules/payments/vault-orphans';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);

describe('§BOVEDA-COBRADA-SIN-PIEZAS — visibilidad (panel, Pedidos, bóvedas, bitácora)', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;
  let admin: string;
  let operator: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, RUN);
    await fx.init();
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
  });
  afterAll(async () => {
    if (h) {
      await fx.cleanup();
      await h.close();
    }
  });

  it('el caso reproducido de punta a punta: contador, filtros, ficha, bóveda del cliente, bitácora, lista del dueño y reparación', async () => {
    const ghost = await fx.user('ghost'); // «cuenta sin nombre»
    await h.prisma.user.update({ where: { id: ghost.id }, data: { name: (ghost.email as string).split('@')[0], nameSource: 'derived' } });
    const other = await fx.user('other');
    const card = await fx.card('vis');
    const cardNone = await fx.card('vis-none');
    const free = await fx.piece(card.id); // libre ⇒ «asignada» tras reparar
    const gone = await fx.piece(card.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled' });
    const copy = await fx.piece(card.id); // la copia que repone a `gone`
    const lost = await fx.piece(cardNone.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled' });
    const { order } = await fx.settledVaultOrder(ghost.id, [free, gone, lost]);
    const direct = await fx.order({ userId: null, pieces: [await fx.piece(card.id)], status: 'settled', mode: 'direct_ship', pi: null });

    // --- contador del panel = N de la consulta de la invariante (el mismo número de la reparación)
    const dash = await h.api('GET', '/admin/dashboard', { token: admin });
    expect(dash.status).toBe(200);
    const total = [{ n: distinctOrders(await findUnassignedLines(h.prisma)).length }];
    expect(dash.body.workQueue.vaultOrdersWithUnassignedItems).toBe(Number(total[0].n));
    expect(dash.body.vaultOrdersWithUnassignedItems).toBe(Number(total[0].n));
    expect(dash.body.workQueue.vaultOrdersWithUnassignedItems).toBeGreaterThanOrEqual(2);
    const dashOp = await h.api('GET', '/admin/dashboard', { token: operator });
    expect(dashOp.body.workQueue.vaultOrdersWithUnassignedItems).toBe(Number(total[0].n)); // sin dinero ⇒ también el operador

    // --- Pedidos: `mismatch` y `fulfillmentMode`
    const mm = await h.api('GET', '/admin/orders?mismatch=true&pageSize=100', { token: admin });
    expect(mm.status).toBe(200);
    const ids = mm.body.data.map((o: { id: string }) => o.id);
    expect(ids).toEqual(expect.arrayContaining([order.id, direct.order.id]));
    const row = mm.body.data.find((o: { id: string }) => o.id === order.id);
    expect(row.unassignedItemCount).toBe(3);
    const vaultOnly = await h.api('GET', '/admin/orders?fulfillmentMode=vault&mismatch=true&pageSize=100', { token: admin });
    expect(vaultOnly.body.data.every((o: { fulfillmentMode: string }) => o.fulfillmentMode === 'vault')).toBe(true);
    expect(vaultOnly.body.data.map((o: { id: string }) => o.id)).toContain(order.id);
    expect(vaultOnly.body.data.map((o: { id: string }) => o.id)).not.toContain(direct.order.id);
    const directOnly = await h.api('GET', '/admin/orders?fulfillmentMode=direct_ship&pageSize=100', { token: admin });
    expect(directOnly.body.data.every((o: { fulfillmentMode: string }) => o.fulfillmentMode === 'direct_ship')).toBe(true);
    expect((await h.api('GET', '/admin/orders?fulfillmentMode=banana', { token: admin })).status).toBe(400);
    expect((await h.api('GET', '/admin/orders?mismatch=maybe', { token: admin })).status).toBe(400);

    // --- «Bóvedas de clientes»: el renglón aparece aunque el cliente NO tenga ninguna pieza
    const vaults = await h.api('GET', `/admin/vaults?q=${encodeURIComponent(ghost.email as string)}`, { token: admin });
    expect(vaults.status).toBe(200);
    const mine = vaults.body.data.find((v: { userId: string }) => v.userId === ghost.id);
    expect(mine).toMatchObject({ pieceCount: 0, unassignedPaidOrders: [{ orderId: order.id, missingCount: 3 }] });

    // --- GET /admin/vault-orphans: lista del dueño; el monto solo al súper-admin; sin datos personales
    const orphansAdmin = await h.api('GET', '/admin/vault-orphans', { token: admin });
    expect(orphansAdmin.status).toBe(200);
    const o1 = orphansAdmin.body.data.find((o: { orderId: string }) => o.orderId === order.id);
    expect(o1.lines).toHaveLength(3);
    expect(o1.lines[0].amountCents).toEqual(expect.any(Number));
    const orphansOp = await h.api('GET', '/admin/vault-orphans', { token: operator });
    expect(orphansOp.body.data.find((o: { orderId: string }) => o.orderId === order.id).lines[0].amountCents).toBeNull();
    expect(JSON.stringify(orphansAdmin.body)).not.toContain(ghost.email);
    expect(JSON.stringify(orphansAdmin.body)).not.toContain(other.email);
    expect((await h.api('GET', '/admin/vault-orphans', { token: await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password) })).status).toBe(403);

    // --- reparación (la del despliegue): asigna, repone y lista lo que no tiene copia
    const report = await h.app.get(VaultOrphanRepairService).run('deploy', new Date(), { onlyOrderIds: [order.id, direct.order.id] });
    expect(report).toMatchObject({ orders: 2, repaired: 3, replaced: 1, forDecision: 1 });
    const afterDash = await h.api('GET', '/admin/dashboard', { token: admin });
    // El de envío directo (pieza libre) quedó arreglado ⇒ el contador baja en 1; el de bóveda sigue contando su línea «requiere atención».
    expect(afterDash.body.workQueue.vaultOrdersWithUnassignedItems).toBe(dash.body.workQueue.vaultOrdersWithUnassignedItems - 1);

    // --- ficha del pedido: estado por línea
    const detail = await h.api('GET', `/admin/orders/${order.id}`, { token: admin });
    expect(detail.status).toBe(200);
    const byItem = new Map(detail.body.items.map((i: { inventoryItemId: string }) => [i.inventoryItemId, i]));
    expect(byItem.get(free.id)).toMatchObject({ fulfillmentState: 'assigned', folio: free.folio, replacedInventoryItemId: null });
    expect(byItem.get(copy.id)).toMatchObject({ fulfillmentState: 'replaced', folio: copy.folio, replacedInventoryItemId: gone.id, replacedFolio: gone.folio });
    expect(byItem.get(lost.id)).toMatchObject({ fulfillmentState: 'needs_attention', fulfillmentFailedReason: 'no_equivalent_copy' });

    // --- D: identificar la carta a reponer (campos aditivos del detalle) y «Qué debe haber» con las líneas pagadas sin asignar
    expect(byItem.get(lost.id)).toMatchObject({ setKey: 'EEB', imageUrl: null, card: expect.objectContaining({ imageSmallUrl: null }), version: expect.objectContaining({ language: expect.any(String) }) });
    expect(byItem.get(lost.id)).toHaveProperty('finish');
    for (const tok of [admin, operator]) {
      const phys = await h.api('GET', `/admin/vaults/${ghost.id}/physical-inventory`, { token: tok });
      expect(phys.status).toBe(200);
      expect(phys.body.counts.needsAttention).toBe(1);
      expect(phys.body.unassignedLines).toHaveLength(1);
      expect(phys.body.unassignedLines[0]).toMatchObject({
        orderId: order.id,
        orderItemId: expect.any(String),
        folio: lost.folio,
        state: 'needs_attention',
        fulfillmentFailedReason: 'no_equivalent_copy',
        fulfillmentFailedAt: expect.any(String),
        card: { name: expect.any(String), number: expect.any(String), productType: expect.anything(), setKey: 'EEB' },
        language: expect.any(String),
      });
      expect(phys.body.unassignedLines[0]).toHaveProperty('finish');
      expect(JSON.stringify(phys.body.unassignedLines)).not.toContain('amountCents');
    }
    // otro cliente no ve líneas ajenas
    expect((await h.api('GET', `/admin/vaults/${other.id}/physical-inventory`, { token: admin })).body.unassignedLines).toEqual([]);

    // --- D: localizar una pieza por FOLIO (exacto, sin distinguir mayúsculas) y buscar la carta por folio
    const fp = await fx.piece(cardNone.id, { status: 'in_custody', ownerType: 'customer', ownerUserId: other.id, ownershipStatus: 'settled', folio: `INV-${String(7000000 + (Date.now() % 1000000))}` });
    const byF = await h.api('GET', `/admin/inventory/by-folio/${String(fp.folio).toLowerCase()}`, { token: admin });
    expect(byF.status).toBe(200);
    expect(byF.body).toMatchObject({ id: fp.id, folio: fp.folio, status: expect.any(String), owner: { type: 'customer', userId: other.id }, card: { id: cardNone.id, setKey: 'EEB', name: expect.any(String), number: expect.any(String), setName: expect.any(String) } });
    expect(byF.body).toHaveProperty('location');
    const byFOp = await h.api('GET', `/admin/inventory/by-folio/${fp.folio}`, { token: operator });
    expect(byFOp.status).toBe(200);
    expect(byFOp.body.owner).toEqual({ type: 'customer' });
    expect(JSON.stringify(byFOp.body)).not.toContain(other.id);
    expect((await h.api('GET', '/admin/inventory/by-folio/INV-999999999', { token: admin })).status).toBe(404);
    expect((await h.api('GET', '/admin/inventory/by-folio/banana', { token: admin })).status).toBe(400);
    const cat = await h.api('GET', `/buylist/cards?q=${encodeURIComponent(String(fp.folio).toLowerCase())}`);
    expect(cat.status).toBe(200);
    expect(cat.body.data.map((c: { id: string }) => c.id)).toEqual([cardNone.id]);
    expect((await h.api('GET', '/buylist/cards?q=INV-999999999')).body.total).toBe(0);

    // --- D: editar el NOMBRE (solo súper-admin, auditado antes/después, sin HTML)
    const patch = (tok: string, body: unknown) => h.api('PATCH', `/admin/users/${ghost.id}/name`, { token: tok, json: body });
    expect((await patch(operator, { name: 'Nuevo Nombre' })).status).toBe(403);
    expect((await patch(admin, { name: '<b>x</b>' })).status).toBe(400);
    expect((await patch(admin, { name: '   ' })).status).toBe(400);
    expect((await patch(admin, { name: 'x'.repeat(121) })).status).toBe(400);
    expect((await patch(admin, { name: 123 })).status).toBe(400);
    const okName = await patch(admin, { name: '  Nuevo Nombre  ' });
    expect(okName.status).toBe(200);
    expect(okName.body).toEqual({ id: ghost.id, name: 'Nuevo Nombre' });
    const nl = await h.prisma.auditLog.findFirst({ where: { action: 'user.name.update', entityId: ghost.id }, orderBy: { createdAt: 'desc' } });
    expect(nl?.after).toEqual({ name: 'Nuevo Nombre' });
    expect(nl?.before).toEqual({ name: (ghost.email as string).split('@')[0] });
    expect((await h.api('PATCH', `/admin/users/00000000-0000-0000-0000-000000000000/name`, { token: admin, json: { name: 'Zed' } })).status).toBe(404);
    // GET /admin/users/:id: cada pedido trae `id` (orderId) para enlazar
    const u = await h.api('GET', `/admin/users/${ghost.id}`, { token: admin });
    expect(u.body.orders[0]).toMatchObject({ id: order.id, orderNumber: expect.anything() });

    // --- la bóveda del cliente muestra la copia Y (no la X)
    const mineAfter = await h.api('GET', `/admin/vaults?q=${encodeURIComponent(ghost.email as string)}`, { token: admin });
    expect(mineAfter.body.data.find((v: { userId: string }) => v.userId === ghost.id)).toMatchObject({ pieceCount: 2 });

    // --- bitácora: el DETALLE solo al súper-admin; el operador no lo ve; lectura de `after.anomalies[].was`
    const logAdmin = await h.api('GET', `/admin/audit-log?action=order.settle_item_not_reserved&pageSize=100`, { token: admin });
    expect(logAdmin.status).toBe(200);
    const mineLog = logAdmin.body.data.find((r: { entityId: string }) => r.entityId === order.id);
    expect(mineLog.after.anomalies.map((a: { was: string }) => a.was).sort()).toEqual(['in_custody', 'in_custody', 'listed']);
    // El operador ni siquiera llega a la bitácora global (`@MoneyOut` de clase ⇒ 403): el detalle es del súper-admin.
    expect((await h.api('GET', `/admin/audit-log?action=order.settle_item_not_reserved`, { token: operator })).status).toBe(403);
    // Una acción fuera de la lista blanca NO viaja con detalle ni siquiera al súper-admin.
    const other2 = await h.api('GET', '/admin/audit-log?action=user.create&pageSize=5', { token: admin });
    for (const r of other2.body.data) expect(r.after).toBeUndefined();
    // Sin PII en el detalle de lo que escribe esta función.
    expect(JSON.stringify(mineLog.after)).not.toContain('@');

    // --- segunda corrida: 0 cambios y el contador ya no cuenta el pedido salvo la línea que espera decisión
    const again = await h.app.get(VaultOrphanRepairService).run('daily', new Date(), { onlyOrderIds: [order.id] });
    expect(again.repaired).toBe(0);
  });
});
