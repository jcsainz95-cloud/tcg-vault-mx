/**
 * inventory-move-mark-guards.e2e-spec.ts — guardas de `POST /admin/inventory/items/:id/move` y
 * `…/mark` por HTTP contra Postgres real.
 *
 * *El defecto (techlead + QA sobre `16a3170`):* el API aceptaba mover la carta DE UN CLIENTE, en un
 * retiro cobrado, al estante de tienda, y marcar perdida una pieza en `picking` de un pedido cobrado.
 * Aquí además se mide lo que el unitario no puede: que el `update` condicionado de Prisma (filtros no
 * únicos en `where`) funciona contra el motor, y que un rechazo **no escribe nada** (ni pieza, ni
 * `InventoryMovement`).
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultPlacementDb } from './helpers/vault-placement-db';

const RUN = `mg${Date.now().toString(36)}`;

describe('M1 move/mark — guardas de estado y zona (Postgres real)', () => {
  let h: E2EHarness;
  let db: VaultPlacementDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new VaultPlacementDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.auditLog.deleteMany({ where: { entityType: 'InventoryItem', entityId: { in: db.items } } });
      await db.limpiar();
      await h.close();
    }
  });

  const move = (id: string, toLocationId: string) =>
    h.api('POST', `/admin/inventory/items/${id}/move`, { token: db.opToken, json: { toLocationId } });
  const mark = (id: string, m: 'lost' | 'damaged') =>
    h.api('POST', `/admin/inventory/items/${id}/mark`, { token: db.opToken, json: { mark: m, note: 'e2e' } });
  const state = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, select: { status: true, locationId: true } });
  const movementCount = (id: string) => h.prisma.inventoryMovement.count({ where: { itemId: id } });

  it('⛔ (QA) carta del cliente en un retiro cobrado → estante de tienda: 409 y nada escrito', async () => {
    const u = await db.mkUser('Retiro Cobrado');
    const drawer = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(u.id, drawer.id, 1);
    await db.mkWithdrawal(u.id, piece.id, 'picking');
    const res = await move(piece.id, db.shopLocationId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ITEM_IN_ANOTHER_SHIPMENT');
    expect(await state(piece.id)).toEqual({ status: 'in_custody', locationId: drawer.id });
    expect(await movementCount(piece.id)).toBe(0);
  });

  it('⛔ carta del cliente (sin retiro) → estante de tienda ⇒ 422 not_customer_custody', async () => {
    const u = await db.mkUser('Sin Retiro');
    const drawer = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(u.id, drawer.id, 1);
    const res = await move(piece.id, db.shopLocationId);
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'LOCATION_NOT_AVAILABLE', details: { reason: 'not_customer_custody' } });
    expect(await movementCount(piece.id)).toBe(0);
  });

  it('⛔ carta del cliente → cajón de OTRO cliente ⇒ 422 not_customer_drawer (con los suyos)', async () => {
    const a = await db.mkUser('Dueña');
    const b = await db.mkUser('Otro');
    const da = await db.mkDrawer();
    const dbb = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(a.id, da.id, 1);
    await db.seedInDrawer(b.id, dbb.id, 1);
    const res = await move(piece.id, dbb.id);
    expect(res.status).toBe(422);
    expect(res.body.error.details.reason).toBe('not_customer_drawer');
    expect(res.body.error.details.customerDrawers.map((d: any) => d.id)).toEqual([da.id]);
    expect((await state(piece.id)).locationId).toBe(da.id);
  });

  it('✅ consolidar: a otro cajón del MISMO cliente ⇒ 200, con `location` y un movimiento', async () => {
    const u = await db.mkUser('Dos Cajones');
    const d1 = await db.mkDrawer();
    const d2 = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(u.id, d1.id, 1);
    await db.seedInDrawer(u.id, d2.id, 1);
    const res = await move(piece.id, d2.id);
    expect(res.status).toBe(201);
    expect(res.body.location).toEqual({ id: d2.id, label: d2.label, zone: 'customer_custody' });
    expect(await state(piece.id)).toEqual({ status: 'in_custody', locationId: d2.id });
    expect(await movementCount(piece.id)).toBe(1);
  });

  it('pieza de plataforma: estante ⇒ 200; cajón de cliente ⇒ 422 not_platform_stock; terminal ⇒ 422', async () => {
    const shelf = await db.mkDrawer({ zone: 'platform_stock' });
    const drawer = await db.mkDrawer();
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'picking' });
    const ok = await move(p.id, shelf.id);
    expect(ok.status).toBe(201);
    expect(ok.body.location).toMatchObject({ id: shelf.id, zone: 'platform_stock' });
    expect(await state(p.id)).toEqual({ status: 'picking', locationId: shelf.id });

    const bad = await move(p.id, drawer.id);
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.reason).toBe('not_platform_stock');

    const gone = await db.mkPiece(null, db.shopLocationId, { status: 'shipped' });
    const term = await move(gone.id, shelf.id);
    expect(term.status).toBe(422);
    expect(term.body.error.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect(await movementCount(gone.id)).toBe(0);
  });

  it('⛔ destino inactivo o inexistente ⇒ 422 (antes: FK/500 o aceptado)', async () => {
    const off = await db.mkDrawer({ zone: 'platform_stock', isActive: false });
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'in_stock' });
    expect((await move(p.id, off.id)).body.error.details.reason).toBe('inactive');
    const nf = await move(p.id, '00000000-0000-0000-0000-000000000000');
    expect(nf.status).toBe(422);
    expect(nf.body.error.details.reason).toBe('not_found');
  });

  it('⛔ (QA) marcar perdida una pieza en `picking` de un pedido cobrado ⇒ 422 y nada escrito', async () => {
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'picking' });
    const res = await mark(p.id, 'lost');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('ITEM_NOT_ADJUSTABLE');
    expect((await state(p.id)).status).toBe('picking');
    expect(await movementCount(p.id)).toBe(0);
  });

  // 🔒 v1.80.3 §M4-SHIP.17.1 (1) (D-SHIP-5): `mark` es SOLO plataforma `in_stock|listed`. Toda pieza
  // de cliente ⇒ 422 ITEM_NOT_ADJUSTABLE, esté o no en un retiro (antes: fuera de retiro se marcaba;
  // en retiro cobrado ⇒ 409). La incidencia de custodia se registra en el palomeo, que abre su caso.
  it('marcar: plataforma `listed` ⇒ 201 lost; (D-SHIP-5) cliente en retiro cobrado ⇒ 422, nada escrito', async () => {
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'listed' });
    const ok = await mark(p.id, 'damaged');
    expect(ok.status).toBe(201);
    expect((await state(p.id)).status).toBe('damaged');
    expect(await movementCount(p.id)).toBe(1);

    const u = await db.mkUser('Marca Retiro');
    const drawer = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(u.id, drawer.id, 1);
    await db.mkWithdrawal(u.id, piece.id, 'guia');
    const r = await mark(piece.id, 'lost');
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', details: { ownerType: 'customer' } });
    expect((await state(piece.id)).status).toBe('in_custody');
    expect(await movementCount(piece.id)).toBe(0);
  });

  it('⛔ (D-SHIP-5) marcar la carta de un cliente en custodia liquidada, FUERA de retiro ⇒ 422, nada escrito', async () => {
    const u = await db.mkUser('Marca Custodia');
    const drawer = await db.mkDrawer();
    const [piece] = await db.seedInDrawer(u.id, drawer.id, 1);
    const r = await mark(piece.id, 'lost');
    expect(r.status).toBe(422);
    expect(r.body.error).toMatchObject({
      code: 'ITEM_NOT_ADJUSTABLE',
      details: { status: 'in_custody', ownerType: 'customer' },
    });
    expect((await state(piece.id)).status).toBe('in_custody');
    expect(await movementCount(piece.id)).toBe(0);
  });
});

// =============================================================================================
// 🔒 v1.80.3 §M4-SHIP.17.1 (2) (D-SHIP-6): el `status` del `PATCH` gana la misma guarda. Antes
// `{status:'in_stock'}` era un `update` plano ⇒ existía `lost → in_stock` (borrar la merma firmada),
// `picking → in_stock` (pieza vendida vuelve al estante) e `in_custody → in_stock` (carta de cliente
// pasa a ser de la tienda). Aquí se mide contra el motor que el rechazo no escribe NADA (ni `status`
// ni los demás campos del mismo PATCH) y que el `update` condicionado funciona.
describe('M1 PATCH status — guarda de estado y de dueño (Postgres real, D-SHIP-6)', () => {
  let h: E2EHarness;
  let db: VaultPlacementDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new VaultPlacementDb(h, `${RUN}p`);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.auditLog.deleteMany({ where: { entityType: 'InventoryItem', entityId: { in: db.items } } });
      await db.limpiar();
      await h.close();
    }
  });

  const patch = (id: string, json: Record<string, unknown>) =>
    h.api('PATCH', `/admin/inventory/items/${id}`, { token: db.opToken, json });
  const state = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({
      where: { id },
      select: { status: true, certNumber: true, ownerType: true },
    });
  const movementCount = (id: string) => h.prisma.inventoryMovement.count({ where: { itemId: id } });

  it('listed → in_stock (despublicar) ⇒ 200, sin InventoryMovement', async () => {
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'listed' });
    const r = await patch(p.id, { status: 'in_stock' });
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('in_stock');
    expect((await state(p.id)).status).toBe('in_stock');
    expect(await movementCount(p.id)).toBe(0);
  });

  it.each(['picking', 'reserved', 'lost', 'damaged', 'shipped'])(
    '⛔ plataforma %s → in_stock ⇒ 422 ITEM_NOT_ADJUSTABLE; ni `status` ni `certNumber` se escriben',
    async (status) => {
      const p = await db.mkPiece(null, db.shopLocationId, { status });
      const r = await patch(p.id, { status: 'in_stock', certNumber: 'E2E-NO' });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', details: { status, ownerType: 'platform' } });
      expect(await state(p.id)).toMatchObject({ status, certNumber: null });
    },
  );

  it('⛔ carta de un cliente (custodia liquidada, en retiro cobrado o no) → in_stock ⇒ 422, sigue siendo suya', async () => {
    const u = await db.mkUser('Patch Cliente');
    const drawer = await db.mkDrawer();
    const [libre, enRetiro] = await db.seedInDrawer(u.id, drawer.id, 2);
    await db.mkWithdrawal(u.id, enRetiro.id, 'picking');
    for (const piece of [libre, enRetiro]) {
      const r = await patch(piece.id, { status: 'in_stock' });
      expect(r.status).toBe(422);
      expect(r.body.error).toMatchObject({
        code: 'ITEM_NOT_ADJUSTABLE',
        details: { status: 'in_custody', ownerType: 'customer' },
      });
      expect(await state(piece.id)).toMatchObject({ status: 'in_custody', ownerType: 'customer' });
    }
  });

  it('sin `status` en el body, la edición de campos sigue igual (la guarda es del cambio de estado)', async () => {
    const p = await db.mkPiece(null, db.shopLocationId, { status: 'lost' });
    const r = await patch(p.id, { certNumber: 'E2E-OK' });
    expect(r.status).toBe(200);
    expect(await state(p.id)).toMatchObject({ status: 'lost', certNumber: 'E2E-OK' });
  });
});
