/**
 * vault-placement-verbs.e2e-spec.ts — ⭐⭐ la COLOCACIÓN en bóveda por HTTP contra Postgres real.
 *
 * API_CONTRACT §M4-VAULT (v1.79.3). Pruebas de §M4-VAULT.8 que NO son carreras (las carreras con
 * entrelazado forzado viven en `vault-placement-races.e2e-spec.ts`): 4, 5, 7, 8, 9, 11, 12, 14, 15,
 * 16, 17, 19, 20, 21, 22, 23, 26, 27, 28, 30, 31, 33 (verbos sobre `placed`) y 34. Cada `it` nombra
 * su número.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultPlacementDb } from './helpers/vault-placement-db';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);

describe('§M4-VAULT — verbos, cola y vista física (Postgres real)', () => {
  let h: E2EHarness;
  let db: VaultPlacementDb;

  beforeAll(async () => {
    h = await E2EHarness.create();
    db = new VaultPlacementDb(h, RUN);
    await db.init();
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vpv_fail_trg ON "AuditLog"`);
      await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vpv_fail_fn()`);
      await db.limpiar();
      await h.close();
    }
  });

  const vaultRow = async (placementId: string) => {
    const res = await db.queue('?destination=vault');
    expect(res.status).toBe(200);
    return res.body.data.find((r: any) => r.placementId === placementId);
  };

  // ============================================================== cola

  describe('la cola (§M4-VAULT.3)', () => {
    it('4 — la fila aparece en ?destination=vault y NO en ship; tras confirm ya no aparece (CA #17/#23)', async () => {
      const u = await db.mkUser('Cola Cuatro');
      const drawer = await db.mkDrawer();
      const { placement } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const row = await vaultRow(placement.id);
      expect(row).toMatchObject({ destination: 'vault', placementId: placement.id, suggestedLocation: { source: 'none' } });
      expect(row).not.toHaveProperty('shipTo');
      const ship = await db.queue('?destination=ship');
      expect(ship.body.data.some((r: any) => r.placementId === placement.id)).toBe(false);
      const all = await db.queue();
      expect(all.body.data.some((r: any) => r.placementId === placement.id)).toBe(true);

      expect((await db.confirm(placement.id, { locationId: drawer.id })).status).toBe(200);
      expect(await vaultRow(placement.id)).toBeUndefined();
    });

    it('5 — propuesta: solo en platform_stock ⇒ none; mismo apellido, cajones distintos ⇒ el suyo; 2 cajones ⇒ multiple; inactivo cuenta', async () => {
      // (a) piezas in_custody SOLO en el estante de tienda ⇒ none (muerde a quien quite el filtro de zona)
      const a = await db.mkUser('Ana Pérez');
      await db.seedInDrawer(a.id, db.shopLocationId, 2);
      const pa = await db.mkPlacement(a.id, 1);
      expect((await vaultRow(pa.placement.id)).suggestedLocation).toEqual({ source: 'none' });

      // (b) dos clientes con el MISMO apellido, cada uno su cajón (CA #20)
      const b = await db.mkUser('Beto Pérez');
      const c = await db.mkUser('Carla Pérez');
      const xb = await db.mkDrawer();
      const xc = await db.mkDrawer();
      await db.seedInDrawer(b.id, xb.id, 2);
      await db.seedInDrawer(c.id, xc.id, 1);
      const pb = await db.mkPlacement(b.id, 1);
      const pc = await db.mkPlacement(c.id, 1);
      expect((await vaultRow(pb.placement.id)).suggestedLocation).toEqual({
        source: 'existing_customer_vault',
        location: { id: xb.id, label: xb.label, zone: 'customer_custody', customerPieceCount: 2 },
      });
      expect((await vaultRow(pc.placement.id)).suggestedLocation.location.id).toBe(xc.id);

      // (c) dos cajones ⇒ multiple_drawers con LOS DOS y sin propuesta; (d) inactivo sigue contando
      const d = await db.mkUser('Dora Dos');
      const x1 = await db.mkDrawer();
      const x2 = await db.mkDrawer({ isActive: false });
      await db.seedInDrawer(d.id, x1.id, 1);
      await db.seedInDrawer(d.id, x2.id, 3);
      const pd = await db.mkPlacement(d.id, 1);
      const s = (await vaultRow(pd.placement.id)).suggestedLocation;
      expect(s.source).toBe('multiple_drawers');
      expect(s.locations.map((l: any) => l.id)).toEqual([x1.id, x2.id].sort((p, q) => {
        const lp = p === x1.id ? x1.label : x2.label;
        const lq = q === x1.id ? x1.label : x2.label;
        return lp < lq ? -1 : lp > lq ? 1 : 0;
      }));
      expect(s).not.toHaveProperty('location');
    });

    it('26 — nombre: derived ⇒ fullName/lastName null + email; nombre compuesto íntegro; la tarjeta `ship` de un derived SIGUE con User.name', async () => {
      const der = await db.mkUser('juan.perez95', 'derived', 'juan.perez95');
      const full = await db.mkUser('María de la Luz Pérez Gómez');
      const pd = await db.mkPlacement(der.id, 1);
      const pf = await db.mkPlacement(full.id, 1);
      const rd = await vaultRow(pd.placement.id);
      expect(rd.customer).toEqual({ userId: der.id, email: der.email, fullName: null, lastName: null });
      expect((await vaultRow(pf.placement.id)).customer.fullName).toBe('María de la Luz Pérez Gómez');
      const phys = await db.physical(der.id);
      expect(phys.body.owner).toEqual({ userId: der.id, name: null, email: der.email });
      // ⭐ v1.80 (§M4-SHIP.3 «Fuente del cliente», PS-16): la asimetría de v1.79.2 queda superada — la tarjeta `ship`
      // también titula con `customerDisplayName(User)` ⇒ un `derived` es `null` (y el correo de segunda línea).
      const piece = await db.mkPiece(der.id, db.shopLocationId);
      const sh = await db.mkWithdrawal(der.id, piece.id, 'picking');
      const ship = (await db.queue('?destination=ship')).body.data.find((r: any) => r.shipmentId === sh.id);
      expect(ship.customer).toMatchObject({ userId: der.id, email: der.email, fullName: null, lastName: null });
    });

    it('invariante — una colocación pendiente con orden `direct_ship` ⇒ 409 CONFLICT de la cola ENTERA', async () => {
      const u = await db.mkUser('Rota');
      const { placement, order } = await db.mkPlacement(u.id, 1, { fulfillmentMode: 'direct_ship' });
      try {
        for (const qs of ['', '?destination=vault', '?destination=ship']) {
          const res = await db.queue(qs);
          expect(res.status).toBe(409);
          expect(res.body.error.code).toBe('CONFLICT');
          expect(res.body.error.message).toContain(placement.id);
        }
      } finally {
        // se retira para no romper la cola del resto del fichero
        await h.prisma.vaultPlacement.update({
          where: { id: placement.id },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: 'chargeback' },
        });
        void order;
      }
    });
  });

  // ============================================================== palomear / preparado

  describe('palomear y preparado (§M4-VAULT.10)', () => {
    it('16 — blocked ⇒ 409 PREP_ITEM_BLOCKED (volver a pending ⇒ 200); doble toque ⇒ changed:false sin escritura; tras prepared ⇒ 409 PREPARATION_CLOSED', async () => {
      const u = await db.mkUser('Palomea Dieciséis');
      const { placement, pieces, items } = await db.mkPlacement(u.id, 2);
      // la primera carta queda bloqueada: está en un retiro COBRADO
      await db.mkWithdrawal(u.id, pieces[0].id, 'picking');
      const blocked = items.find((i) => i.inventoryItemId === pieces[0].id)!;
      const ok = items.find((i) => i.inventoryItemId === pieces[1].id)!;

      for (const st of ['picked', 'missing']) {
        const r = await db.mark(placement.id, blocked.id, st);
        expect(r.status).toBe(409);
        expect(r.body.error).toMatchObject({ code: 'PREP_ITEM_BLOCKED', details: { reason: 'in_withdrawal' } });
      }
      const back = await db.mark(placement.id, blocked.id, 'pending');
      expect(back.status).toBe(200);
      expect(back.body.changed).toBe(false);

      const r1 = await db.mark(placement.id, ok.id, 'picked');
      expect(r1.status).toBe(200);
      expect(r1.body).toMatchObject({
        changed: true,
        item: { placementItemId: ok.id, prepStatus: 'picked', placeability: { kind: 'placeable' } },
        preparation: { status: 'in_progress', total: 2, pending: 0, picked: 1, missing: 0, blocked: 1 },
      });
      const marked = await h.prisma.vaultPlacementItem.findUniqueOrThrow({ where: { id: ok.id } });
      expect(marked.prepMarkedByUserId).toBe(db.operatorId);
      const r2 = await db.mark(placement.id, ok.id, 'picked');
      expect(r2.body.changed).toBe(false);
      const again = await h.prisma.vaultPlacementItem.findUniqueOrThrow({ where: { id: ok.id } });
      expect(again.prepMarkedAt!.getTime()).toBe(marked.prepMarkedAt!.getTime()); // sin escritura

      expect((await db.prepare(placement.id)).status).toBe(200);
      const closed = await db.mark(placement.id, ok.id, 'missing');
      expect(closed.status).toBe(409);
      expect(closed.body.error.code).toBe('PREPARATION_CLOSED');
      expect(closed.body.error.details.preparedAt).toEqual(expect.any(String));
    });

    it('16 — cuerpo: status fuera del dominio ⇒ 400 {field, allowed}; carta de OTRA colocación ⇒ 404', async () => {
      const u = await db.mkUser('Cuerpo Mal');
      const a = await db.mkPlacement(u.id, 1);
      const b = await db.mkPlacement(u.id, 1);
      const bad = await db.mark(a.placement.id, a.items[0].id, 'lost');
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        details: { field: 'status', allowed: ['pending', 'picked', 'missing'] },
      });
      const other = await db.mark(a.placement.id, b.items[0].id, 'picked');
      expect(other.status).toBe(404);
      expect((await db.mark('no-existe', a.items[0].id, 'picked')).status).toBe(404);
    });

    it('16 — bitácora SOLO al entrar o salir de `missing` (picked↔pending no la deja)', async () => {
      const u = await db.mkUser('Bitácora Faltante');
      const { placement, items } = await db.mkPlacement(u.id, 1);
      await db.mark(placement.id, items[0].id, 'picked');
      await db.mark(placement.id, items[0].id, 'pending');
      expect(await db.audits(placement.id)).toHaveLength(0);
      await db.mark(placement.id, items[0].id, 'missing');
      await db.mark(placement.id, items[0].id, 'picked');
      const logs = await db.audits(placement.id);
      expect(logs.map((l) => l.action)).toEqual(['vault_placement.item_missing', 'vault_placement.item_missing_cleared']);
      expect(logs[0].after).toMatchObject({
        placementItemId: items[0].id,
        inventoryItemId: items[0].inventoryItemId,
        orderId: expect.any(String),
      });
      expect(logs[0].actorUserId).toBe(db.operatorId);
    });

    it('17 — prepared: una colocable pending ⇒ 409 PREPARATION_INCOMPLETE; todas marcadas/bloqueadas ⇒ 200 + UNA bitácora; segundo ⇒ already_prepared sin bitácora', async () => {
      const u = await db.mkUser('Prepara Diecisiete');
      const { placement, pieces, items } = await db.mkPlacement(u.id, 3);
      await db.mark(placement.id, items[0].id, 'picked');
      const inc = await db.prepare(placement.id);
      expect(inc.status).toBe(409);
      expect(inc.body.error).toMatchObject({ code: 'PREPARATION_INCOMPLETE', details: { pendingCount: 2 } });
      await db.mark(placement.id, items[1].id, 'missing');
      await db.mkWithdrawal(u.id, pieces[2].id, 'guia'); // la tercera, bloqueada: no cuenta
      const ok = await db.prepare(placement.id);
      expect(ok.status).toBe(200);
      expect(ok.body.outcome).toBe('prepared');
      expect(ok.body.placement.preparedBy).toEqual({ userId: db.operatorId, name: E2E_USERS.operator.name });
      expect(ok.body.preparation).toMatchObject({ status: 'prepared', pending: 0, picked: 1, missing: 1, blocked: 1 });
      const logs = await db.audits(placement.id, 'vault_placement.prepared');
      expect(logs).toHaveLength(1);
      expect(logs[0].after).toEqual({
        orderId: placement.orderId,
        picked: [pieces[0].id],
        missing: [pieces[1].id],
        blocked: [{ id: pieces[2].id, reason: 'in_withdrawal' }],
      });
      const again = await db.prepare(placement.id);
      expect(again.status).toBe(200);
      expect(again.body.outcome).toBe('already_prepared');
      expect(await db.audits(placement.id, 'vault_placement.prepared')).toHaveLength(1);
    });
  });

  // ============================================================== deshacer preparado

  describe('deshacer preparado (§M4-VAULT.10, v1.79.2)', () => {
    it('21 — camino feliz: sello limpio, MARCAS INTACTAS, una bitácora con `before`; después el PATCH ya no da PREPARATION_CLOSED', async () => {
      const u = await db.mkUser('Deshace Veintiuno');
      const { placement, items } = await db.mkPlacement(u.id, 3, {
        marks: ['missing', 'picked', 'picked'],
        prepared: true,
      });
      const before = await db.placementRow(placement.id);
      const marksBefore = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: placement.id }, orderBy: { id: 'asc' } });
      const res = await db.unprepare(placement.id);
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('unprepared');
      expect(res.body.placement).toMatchObject({ preparedAt: null, preparedBy: null, status: 'pending' });
      expect(res.body.preparation).toMatchObject({ status: 'in_progress', missing: 1, picked: 2, pending: 0 });
      const after = await db.placementRow(placement.id);
      expect(after.preparedAt).toBeNull();
      expect(after.preparedByUserId).toBeNull();
      const marksAfter = await h.prisma.vaultPlacementItem.findMany({ where: { placementId: placement.id }, orderBy: { id: 'asc' } });
      expect(marksAfter).toEqual(marksBefore); // prepStatus, prepMarkedAt y prepMarkedByUserId intactos
      const logs = await db.audits(placement.id, 'vault_placement.unprepared');
      expect(logs).toHaveLength(1);
      expect(logs[0].before).toEqual({
        preparedAt: before.preparedAt!.toISOString(),
        preparedByUserId: before.preparedByUserId,
      });
      const missingItem = items.find((i) => i.prepStatus === 'missing')!;
      const fix = await db.mark(placement.id, missingItem.id, 'picked');
      expect(fix.status).toBe(200);
      expect(fix.body.changed).toBe(true);
    });

    it('21 — atomicidad: un fallo DESPUÉS del updateMany (al escribir la bitácora) ⇒ ni sello limpio ni bitácora', async () => {
      const u = await db.mkUser('Deshace Atómico');
      const { placement } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      await h.prisma.$executeRawUnsafe(`
        CREATE OR REPLACE FUNCTION vpv_fail_fn() RETURNS trigger AS $$
        BEGIN
          IF NEW."entityId" = '${placement.id}' AND NEW.action = 'vault_placement.unprepared' THEN
            RAISE EXCEPTION 'vpv: fallo forzado';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`);
      await h.prisma.$executeRawUnsafe(
        `CREATE TRIGGER vpv_fail_trg BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION vpv_fail_fn()`,
      );
      let res;
      try {
        res = await db.unprepare(placement.id);
      } finally {
        await h.prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS vpv_fail_trg ON "AuditLog"`);
        await h.prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS vpv_fail_fn()`);
      }
      expect(res.status).toBe(500);
      const row = await db.placementRow(placement.id);
      expect(row.preparedAt).not.toBeNull();
      expect(row.preparedByUserId).toBe(db.operatorId);
      expect(await db.audits(placement.id)).toHaveLength(0);
    });

    it('22 — idempotencia: segundo DELETE y nunca-preparada ⇒ 200 not_prepared, sin escritura ni bitácora', async () => {
      const u = await db.mkUser('Deshace Dos Veces');
      const a = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      expect((await db.unprepare(a.placement.id)).body.outcome).toBe('unprepared');
      const n = (await db.audits(a.placement.id)).length;
      const second = await db.unprepare(a.placement.id);
      expect(second.status).toBe(200);
      expect(second.body.outcome).toBe('not_prepared');
      expect(await db.audits(a.placement.id)).toHaveLength(n);
      const never = await db.mkPlacement(u.id, 1);
      const r = await db.unprepare(never.placement.id);
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe('not_prepared');
      expect(await db.audits(never.placement.id)).toHaveLength(0);
    });

    it('23 / 33 — terminal: placed ⇒ 409 {placed, location} en los CUATRO verbos (sin `locationId`); cancelled ⇒ 409 {cancelled, cancelReason}; preparedAt intacto', async () => {
      const u = await db.mkUser('Terminal Veintitrés');
      const x = await db.mkDrawer();
      const y = await db.mkDrawer();
      const p = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      expect((await db.confirm(p.placement.id, { locationId: x.id })).status).toBe(200);
      const prepAt = (await db.placementRow(p.placement.id)).preparedAt;
      const expected = { status: 'placed', location: { id: x.id, label: x.label, zone: 'customer_custody' } };
      const answers = [
        await db.unprepare(p.placement.id),
        await db.prepare(p.placement.id),
        await db.mark(p.placement.id, p.items[0].id, 'missing'),
        await db.confirm(p.placement.id, { locationId: y.id }),
        await db.confirm(p.placement.id, {}), // v1.79.3: placed y cuerpo SIN cajón ⇒ 409
      ];
      for (const r of answers) {
        expect(r.status).toBe(409);
        expect(r.body.error.code).toBe('PLACEMENT_NOT_PENDING');
        expect(r.body.error.details).toEqual(expected);
        expect(r.body.error.details).not.toHaveProperty('locationId');
      }
      expect((await db.placementRow(p.placement.id)).preparedAt).toEqual(prepAt);

      for (const reason of ['chargeback', 'nothing_to_place'] as const) {
        const c = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
        await h.prisma.vaultPlacement.update({
          where: { id: c.placement.id },
          data: { status: 'cancelled', cancelledAt: new Date(), cancelReason: reason },
        });
        for (const r of [await db.unprepare(c.placement.id), await db.prepare(c.placement.id), await db.confirm(c.placement.id, { locationId: x.id })]) {
          expect(r.status).toBe(409);
          expect(r.body.error.details).toEqual({ status: 'cancelled', cancelReason: reason });
        }
        expect((await db.placementRow(c.placement.id)).preparedAt).not.toBeNull();
      }
    });
  });

  // ============================================================== confirm

  describe('confirm (§M4-VAULT.5)', () => {
    it('camino feliz + 9 + 11 — mueve SOLO locationId, un movimiento por pieza, bitácora en la tx, actor de la SESIÓN', async () => {
      const u = await db.mkUser('Coloca Feliz');
      const x = await db.mkDrawer();
      const { placement, pieces } = await db.mkPlacement(u.id, 2, { marks: ['picked', 'picked'], prepared: true });
      const res = await db.confirm(placement.id, { locationId: x.id, placedByUserId: db.adminId, placedAt: '2000-01-01' });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('placed');
      expect(res.body.placement).toMatchObject({
        status: 'placed',
        placedBy: { userId: db.operatorId, name: E2E_USERS.operator.name },
        location: { id: x.id, label: x.label, zone: 'customer_custody' },
      });
      expect(new Date(res.body.placement.placedAt).getFullYear()).toBeGreaterThan(2020);
      expect(res.body.items.map((i: any) => i.result)).toEqual(['moved', 'moved']);
      const after = await h.prisma.inventoryItem.findMany({ where: { id: { in: pieces.map((p) => p.id) } } });
      for (const p of after) {
        expect(p).toMatchObject({ locationId: x.id, status: 'in_custody', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled' });
      }
      const mv = await db.movements(pieces.map((p) => p.id));
      expect(mv).toHaveLength(2);
      for (const m of mv) {
        expect(m).toMatchObject({ fromLocationId: db.shopLocationId, toLocationId: x.id, fromStatus: 'in_custody', toStatus: 'in_custody', reason: 'move', actorUserId: db.operatorId });
        expect(m.note).toBe(`colocación en bóveda · ${(await h.prisma.order.findUniqueOrThrow({ where: { id: placement.orderId } })).orderNumber}`);
      }
      const logs = await db.audits(placement.id, 'vault_placement.placed');
      expect(logs).toHaveLength(1);
      expect(logs[0].actorUserId).toBe(db.operatorId);
      expect(logs[0].after).toMatchObject({
        orderId: placement.orderId,
        locationId: x.id,
        suggestion: { source: 'none', locationIds: [] },
        moved: expect.arrayContaining(pieces.map((p) => p.id)),
        alreadyThere: [],
        missing: [],
        skipped: [],
      });
      // ?action= de la bitácora NO es dominio cerrado (medido: settings.controller.ts · auditLog)
      const byAction = await h.api('GET', `/admin/audit-log?action=vault_placement.placed&entityType=VaultPlacement`, { token: db.adminToken });
      expect(byAction.status).toBe(200);
      expect(byAction.body.data.some((r: any) => r.entityId === placement.id)).toBe(true);
    });

    it('7 — pieza con locationId NULL ⇒ se coloca (la trampa del NULL)', async () => {
      const u = await db.mkUser('Sin Ubicar');
      const x = await db.mkDrawer();
      const { placement, pieces } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true, pieceLocationId: null });
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.body.items).toEqual([{ inventoryItemId: pieces[0].id, folio: pieces[0].folio, result: 'moved' }]);
      const mv = await db.movements([pieces[0].id]);
      expect(mv[0]).toMatchObject({ fromLocationId: null, toLocationId: x.id });
    });

    it('8 — retiro `picking` ⇒ skipped/in_withdrawal; retiro `solicitado` ⇒ moved', async () => {
      const u = await db.mkUser('Retiro Ocho');
      const x = await db.mkDrawer();
      const { placement, pieces } = await db.mkPlacement(u.id, 2, { marks: ['picked', 'picked'], prepared: true });
      await db.mkWithdrawal(u.id, pieces[0].id, 'picking');
      await db.mkWithdrawal(u.id, pieces[1].id, 'solicitado');
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.body.outcome).toBe('placed');
      const byId = Object.fromEntries(res.body.items.map((i: any) => [i.inventoryItemId, i]));
      expect(byId[pieces[0].id]).toMatchObject({ result: 'skipped', reason: 'in_withdrawal' });
      expect(byId[pieces[1].id]).toMatchObject({ result: 'moved' });
      const p0 = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: pieces[0].id } });
      expect(p0.locationId).toBe(db.shopLocationId);
    });

    it('already_there — una pieza tomada que YA está en el cajón ⇒ already_there sin movimiento', async () => {
      const u = await db.mkUser('Ya Está');
      const x = await db.mkDrawer();
      const { placement, pieces } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true, pieceLocationId: x.id });
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.body.outcome).toBe('placed');
      expect(res.body.items[0].result).toBe('already_there');
      expect(await db.movements([pieces[0].id])).toHaveLength(0);
    });

    it('doble clic al MISMO cajón ⇒ 200 already_placed, sin movimiento ni bitácora', async () => {
      const u = await db.mkUser('Doble Clic');
      const x = await db.mkDrawer();
      const { placement, pieces } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      expect((await db.confirm(placement.id, { locationId: x.id })).body.outcome).toBe('placed');
      const second = await db.confirm(placement.id, { locationId: x.id });
      expect(second.status).toBe(200);
      expect(second.body.outcome).toBe('already_placed');
      expect(second.body).not.toHaveProperty('items');
      expect(await db.movements([pieces[0].id])).toHaveLength(1);
      expect(await db.audits(placement.id)).toHaveLength(1);
    });

    it('12 / 34 — cliente con cajón X, confirm a Y ⇒ 422 not_customer_drawer con customerDrawers (⛔ customerDrawerIds) y CERO escritura', async () => {
      const u = await db.mkUser('Un Cajón');
      const x = await db.mkDrawer();
      const y = await db.mkDrawer();
      await db.seedInDrawer(u.id, x.id, 2);
      const { placement, pieces } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const res = await db.confirm(placement.id, { locationId: y.id });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('LOCATION_NOT_AVAILABLE');
      expect(res.body.error.details).toEqual({
        reason: 'not_customer_drawer',
        customerDrawers: [{ id: x.id, label: x.label, zone: 'customer_custody', customerPieceCount: 2 }],
      });
      expect((await db.placementRow(placement.id)).status).toBe('pending');
      expect(await db.movements([pieces[0].id])).toHaveLength(0);
      expect(await db.audits(placement.id)).toHaveLength(0);
    });

    it('7 del algoritmo — cajón inexistente / inactivo / de tienda ⇒ 422 con su razón', async () => {
      const u = await db.mkUser('Cajón Malo');
      const inactive = await db.mkDrawer({ isActive: false });
      const shop = await db.mkDrawer({ zone: 'platform_stock' });
      const { placement } = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      for (const [id, reason] of [['no-existe', 'not_found'], [inactive.id, 'inactive'], [shop.id, 'not_customer_custody']]) {
        const r = await db.confirm(placement.id, { locationId: id });
        expect(r.status).toBe(422);
        expect(r.body.error.details).toEqual({ reason });
      }
      expect((await db.placementRow(placement.id)).status).toBe('pending');
    });

    it('14 / 34 — anomalía X y Z: W ⇒ 422 con LOS DOS por label; X ⇒ 200; la fila siguiente SIGUE multiple_drawers', async () => {
      const u = await db.mkUser('Anomalía Catorce');
      const x = await db.mkDrawer();
      const z = await db.mkDrawer();
      const w = await db.mkDrawer();
      await db.seedInDrawer(u.id, x.id, 1);
      await db.seedInDrawer(u.id, z.id, 2);
      const a = await db.mkPlacement(u.id, 1, { marks: ['picked'], prepared: true });
      const b = await db.mkPlacement(u.id, 1);
      const bad = await db.confirm(a.placement.id, { locationId: w.id });
      expect(bad.status).toBe(422);
      const both = [
        { id: x.id, label: x.label, zone: 'customer_custody', customerPieceCount: 1 },
        { id: z.id, label: z.label, zone: 'customer_custody', customerPieceCount: 2 },
      ].sort((p, q) => (p.label < q.label ? -1 : 1));
      expect(bad.body.error.details).toEqual({ reason: 'not_customer_drawer', customerDrawers: both });
      expect((await db.confirm(a.placement.id, { locationId: x.id })).status).toBe(200);
      const next = await vaultRow(b.placement.id);
      expect(next.suggestedLocation.source).toBe('multiple_drawers');
      expect(next.suggestedLocation.locations.map((l: any) => l.id).sort()).toEqual([x.id, z.id].sort());
    });

    it('15 — sin preparar ⇒ 409 PLACEMENT_NOT_PREPARED {preparation}; y un UPDATE SQL a placed sin preparedAt FALLA por CHECK', async () => {
      const u = await db.mkUser('Sin Preparar');
      const x = await db.mkDrawer();
      const { placement } = await db.mkPlacement(u.id, 1, { marks: ['picked'] });
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('PLACEMENT_NOT_PREPARED');
      expect(res.body.error.details.preparation).toMatchObject({ status: 'in_progress', picked: 1, total: 1 });
      await expect(
        h.prisma.$executeRawUnsafe(
          `UPDATE "VaultPlacement" SET status='placed', "placedAt"=now(), "placedByUserId"='x', "locationId"=$1 WHERE id=$2`,
          x.id,
          placement.id,
        ),
      ).rejects.toThrow(/placed_requires_prepared/);
    });

    it('19 / PS-20 — carta missing ⇒ resultado missing CON caso «Por reponer» (v1.80.1): pieza `lost` a nombre del cliente, movimiento con el actor, locationId intacto; la vista física la dice to_replace', async () => {
      const u = await db.mkUser('Falta Una');
      const x = await db.mkDrawer();
      const { placement, pieces, items } = await db.mkPlacement(u.id, 2, { marks: ['picked', 'missing'], prepared: true });
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.body.outcome).toBe('placed');
      const r = Object.fromEntries(res.body.items.map((i: any) => [i.inventoryItemId, i.result]));
      expect(r).toEqual({ [pieces[0].id]: 'moved', [pieces[1].id]: 'missing' });
      const missingRes = res.body.items.find((i: any) => i.inventoryItemId === pieces[1].id);
      expect(missingRes).toMatchObject({ result: 'missing', missingReason: 'not_found', caseId: expect.any(String) });
      // ⭐ v1.80.1: la merma con firma (movimiento `lost` del operador) — pero la carta SIGUE siendo del cliente.
      const mv = await db.movements([pieces[1].id]);
      expect(mv).toHaveLength(1);
      expect(mv[0]).toMatchObject({ reason: 'lost', fromStatus: 'in_custody', toStatus: 'lost', actorUserId: db.operatorId });
      const piece = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: pieces[1].id } });
      expect(piece).toMatchObject({ status: 'lost', ownerType: 'customer', ownerUserId: u.id, ownershipStatus: 'settled', locationId: db.shopLocationId });
      const kase = await h.prisma.replacementCase.findUniqueOrThrow({ where: { id: missingRes.caseId } });
      expect(kase).toMatchObject({
        source: 'vault_purchase',
        status: 'open',
        placementItemId: items.find((i) => i.inventoryItemId === pieces[1].id)!.id,
        customerUserId: u.id,
        originalInventoryItemId: pieces[1].id,
        missingReason: 'not_found',
        openedByUserId: db.operatorId,
      });
      expect(kase.originOrderItemId).not.toBeNull();
      const phys = await db.physical(u.id);
      const st = phys.body.items.find((i: any) => i.inventoryItemId === pieces[1].id).physical;
      expect(st).toMatchObject({ state: 'to_replace', caseId: kase.id, reason: 'not_found', source: 'vault_purchase' });
      expect(phys.body.counts).toMatchObject({ total: 1, toReplace: 1 });
    });

    it('PS-20 — marcar `missing` sin `missingReason` ⇒ 400 {field:\'missingReason\'}; con `damaged` ⇒ 200 y la pieza sale `damaged` al colocar; deshacer preparado ANTES de colocar ⇒ cero casos', async () => {
      const u = await db.mkUser('Dañada Veinte');
      const x = await db.mkDrawer();
      const { placement, pieces, items } = await db.mkPlacement(u.id, 2);
      const bad = await db.mark(placement.id, items[1].id, { status: 'missing' });
      expect(bad.status).toBe(400);
      expect(bad.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'missingReason' } });
      const bad2 = await db.mark(placement.id, items[1].id, { status: 'picked', missingReason: 'damaged' });
      expect(bad2.status).toBe(400);
      expect(bad2.body.error.details.field).toBe('missingReason');
      const ok = await db.mark(placement.id, items[1].id, { status: 'missing', missingReason: 'damaged' });
      expect(ok.status).toBe(200);
      expect(ok.body.item).toMatchObject({ prepStatus: 'missing', missingReason: 'damaged' });
      // cambiar de motivo ES un cambio (deja bitácora con el motivo nuevo)
      const chg = await db.mark(placement.id, items[1].id, { status: 'missing', missingReason: 'not_found' });
      expect(chg.body.changed).toBe(true);
      expect((await db.mark(placement.id, items[1].id, { status: 'missing', missingReason: 'damaged' })).body.changed).toBe(true);
      const marks = await db.audits(placement.id, 'vault_placement.item_missing');
      expect(marks.map((l) => (l.after as any).missingReason)).toEqual(['damaged', 'not_found', 'damaged']);
      await db.mark(placement.id, items[0].id, 'picked');
      expect((await db.prepare(placement.id)).status).toBe(200);
      // deshacer preparado antes de colocar: la marca sigue corregible y NO hay caso
      expect((await db.unprepare(placement.id)).status).toBe(200);
      expect(await h.prisma.replacementCase.count({ where: { customerUserId: u.id } })).toBe(0);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: pieces[1].id } })).status).toBe('in_custody');
      expect((await db.prepare(placement.id)).status).toBe(200);
      const res = await db.confirm(placement.id, { locationId: x.id });
      expect(res.status).toBe(200);
      const piece = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: pieces[1].id } });
      expect(piece).toMatchObject({ status: 'damaged', ownerType: 'customer', ownerUserId: u.id, locationId: db.shopLocationId });
      const kase = await h.prisma.replacementCase.findFirstOrThrow({ where: { originalInventoryItemId: pieces[1].id } });
      expect(kase).toMatchObject({ status: 'open', missingReason: 'damaged', source: 'vault_purchase' });
      // ⛔ cero dinero
      expect(await h.prisma.paymentRefund.count({ where: { orderId: placement.orderId } })).toBe(0);
      expect(await h.prisma.manualRefund.count({ where: { customerUserId: u.id } })).toBe(0);
    });

    it('19 / 30 — TODAS missing, cliente nuevo, confirm {} ⇒ 200 nothing_to_place sin cajón; sellos de colocación NULL; preparedAt intacto; 0 movimientos; sigue sin cajón; la vista física dice missing', async () => {
      const u = await db.mkUser('Nada Que Guardar');
      const { placement, pieces } = await db.mkPlacement(u.id, 2, { marks: ['missing', 'missing'], prepared: true });
      const prep = (await db.placementRow(placement.id)).preparedAt;
      const res = await db.confirm(placement.id, {});
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('nothing_to_place');
      expect(res.body.placement.location).toBeNull();
      expect(res.body.items.map((i: any) => i.result)).toEqual(['missing', 'missing']);
      const row = await db.placementRow(placement.id);
      expect(row).toMatchObject({
        status: 'cancelled',
        cancelReason: 'nothing_to_place',
        cancelledByUserId: db.operatorId,
        locationId: null,
        placedAt: null,
        placedByUserId: null,
      });
      expect(row.preparedAt).toEqual(prep);
      // ⭐ v1.80.1 (PS-20): el cierre directo 6-bis TAMBIÉN abre un caso por carta (movimiento `lost` cada una).
      expect(await db.movements(pieces.map((p) => p.id))).toHaveLength(2);
      expect(res.body.items.every((i: any) => typeof i.caseId === 'string' && i.missingReason === 'not_found')).toBe(true);
      expect(await h.prisma.replacementCase.count({ where: { customerUserId: u.id, status: 'open', source: 'vault_purchase' } })).toBe(2);
      const logs = await db.audits(placement.id);
      expect(logs.map((l) => l.action)).toEqual(['vault_placement.nothing_to_place']);
      expect(logs[0].after).toMatchObject({ locationId: null, requestedLocationId: null });
      const phys = await db.physical(u.id);
      expect(phys.body.drawer).toEqual({ kind: 'none' });
      expect(phys.body.items.map((i: any) => i.physical.state)).toEqual(['to_replace', 'to_replace']);
      expect(phys.body.counts).toMatchObject({ total: 0, toReplace: 2 });
      // doble clic en un cierre sin cajón ⇒ 409 {cancelled, nothing_to_place} (⛔ no 200)
      const again = await db.confirm(placement.id, {});
      expect(again.status).toBe(409);
      expect(again.body.error.details).toEqual({ status: 'cancelled', cancelReason: 'nothing_to_place' });
    });

    it('30 (variante) — mismo pedido vacío con un cajón que NO es del cliente ⇒ 200 nothing_to_place (⛔ 422) y requestedLocationId en la bitácora', async () => {
      const u = await db.mkUser('Vacío Con Cajón');
      const x = await db.mkDrawer();
      const y = await db.mkDrawer();
      await db.seedInDrawer(u.id, x.id, 1);
      const { placement } = await db.mkPlacement(u.id, 1, { marks: ['missing'], prepared: true });
      const res = await db.confirm(placement.id, { locationId: y.id });
      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe('nothing_to_place');
      const logs = await db.audits(placement.id);
      expect(logs[0].after).toMatchObject({ locationId: null, requestedLocationId: y.id });
    });

    it('31 — con ≥1 picked, confirm {} ⇒ 422 location_required {pickedCount} exacto, CERO escrituras; "" o 7 ⇒ 400 (con y sin tomadas)', async () => {
      const u = await db.mkUser('Cajón Obligatorio');
      const { placement, pieces } = await db.mkPlacement(u.id, 3, { marks: ['picked', 'picked', 'missing'], prepared: true });
      const res = await db.confirm(placement.id, {});
      expect(res.status).toBe(422);
      expect(res.body.error).toMatchObject({ code: 'LOCATION_NOT_AVAILABLE', details: { reason: 'location_required', pickedCount: 2 } });
      expect((await db.placementRow(placement.id)).status).toBe('pending');
      expect(await db.movements(pieces.map((p) => p.id))).toHaveLength(0);
      expect(await db.audits(placement.id)).toHaveLength(0);
      const empty = await db.mkPlacement(u.id, 1, { marks: ['missing'], prepared: true });
      for (const pid of [placement.id, empty.placement.id]) {
        for (const bad of ['', '   ', 7]) {
          const r = await db.confirm(pid, { locationId: bad });
          expect(r.status).toBe(400);
          expect(r.body.error).toMatchObject({ code: 'VALIDATION_ERROR', details: { field: 'locationId' } });
        }
      }
    });

    it('404 — colocación inexistente en los cuatro verbos', async () => {
      expect((await db.confirm('no-existe', {})).status).toBe(404);
      expect((await db.prepare('no-existe')).status).toBe(404);
      expect((await db.unprepare('no-existe')).status).toBe(404);
    });

    it('403 — un cliente no puede llamar a los verbos', async () => {
      const tok = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
      expect((await db.confirm('x', {}, tok)).status).toBe(403);
      expect((await db.prepare('x', tok)).status).toBe(403);
      expect((await db.unprepare('x', tok)).status).toBe(403);
      expect((await db.mark('x', 'y', 'picked', tok)).status).toBe(403);
      expect((await h.api('GET', `/admin/vaults/x/physical-inventory`, { token: tok })).status).toBe(403);
    });
  });

  // ============================================================== vista física

  describe('vista física (§M4-VAULT.11)', () => {
    it('20 — una pieza por cada uno de los cinco estados, con su precedencia, orden y conteos; anomalía de dos cajones', async () => {
      const u = await db.mkUser('Física Veinte');
      const x = await db.mkDrawer();
      const z = await db.mkDrawer();
      const [inDrawer] = await db.seedInDrawer(u.id, x.id, 1);
      await db.seedInDrawer(u.id, z.id, 1); // anomalía: 2 cajones
      const [sinUbicar] = await db.seedInDrawer(u.id, null, 1); // unlocated/no_location
      const [enTienda] = await db.seedInDrawer(u.id, db.shopLocationId, 1); // unlocated/not_in_customer_drawer
      const pend = await db.mkPlacement(u.id, 3, { marks: ['picked', 'missing', 'pending'] });
      // la 3.ª de la colocación: en un retiro cobrado (gana a pending_placement)
      await db.mkWithdrawal(u.id, pend.pieces[2].id, 'enviado');
      // una pieza missing QUE ADEMÁS está en retiro ⇒ missing gana (regla 1 antes que 2)
      await db.mkWithdrawal(u.id, pend.pieces[1].id, 'picking');
      // un retiro `solicitado` NO cuenta
      await db.mkWithdrawal(u.id, inDrawer.id, 'solicitado');
      // una pieza reservada (titularidad pending) NO entra al conjunto
      await db.mkPiece(u.id, db.shopLocationId, { status: 'reserved', ownershipStatus: 'pending' });

      const res = await db.physical(u.id);
      expect(res.status).toBe(200);
      const st = Object.fromEntries(res.body.items.map((i: any) => [i.inventoryItemId, i.physical]));
      expect(st[pend.pieces[1].id]).toMatchObject({ state: 'missing', placementId: pend.placement.id, markedBy: { userId: db.operatorId, name: E2E_USERS.operator.name } });
      expect(st[pend.pieces[2].id]).toMatchObject({ state: 'in_withdrawal', shipmentStatus: 'enviado' });
      expect(st[pend.pieces[0].id]).toEqual({ state: 'pending_placement', placementId: pend.placement.id, prepStatus: 'picked', prepared: false });
      expect(st[inDrawer.id]).toEqual({ state: 'in_drawer', drawer: { id: x.id, label: x.label, zone: 'customer_custody' } });
      expect(st[sinUbicar.id]).toEqual({ state: 'unlocated', reason: 'no_location' });
      expect(st[enTienda.id]).toEqual({ state: 'unlocated', reason: 'not_in_customer_drawer' });
      expect(res.body.counts).toEqual({ total: 7, inDrawer: 2, pendingPlacement: 1, missing: 1, inWithdrawal: 1, unlocated: 2, toReplace: 0 });
      // orden: missing, unlocated, in_drawer, pending_placement, in_withdrawal
      const states = res.body.items.map((i: any) => i.physical.state);
      expect(states).toEqual(['missing', 'unlocated', 'unlocated', 'in_drawer', 'in_drawer', 'pending_placement', 'in_withdrawal']);
      expect(res.body.drawer.kind).toBe('multiple');
      expect(res.body.drawer.locations.map((l: any) => l.id).sort()).toEqual([x.id, z.id].sort());
      expect(res.body.owner).toEqual({ userId: u.id, name: 'Física Veinte', email: u.email });
      // origin: su colocación más reciente; sembradas ⇒ null
      expect(res.body.items.find((i: any) => i.inventoryItemId === pend.pieces[0].id).origin).toEqual({
        placementId: pend.placement.id,
        orderId: pend.order.id,
        orderNumber: pend.order.orderNumber,
      });
      expect(res.body.items.find((i: any) => i.inventoryItemId === inDrawer.id).origin).toBeNull();
      // ⛔ sin precios
      expect(JSON.stringify(res.body)).not.toMatch(/Cents|price/i);
    });

    it('cliente sin cartas ⇒ 200 items [] drawer none; usuario inexistente ⇒ 404', async () => {
      const u = await db.mkUser('Vacío Total');
      const res = await db.physical(u.id);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ drawer: { kind: 'none' }, items: [], counts: { total: 0 } });
      expect((await db.physical('00000000-0000-0000-0000-000000000000')).status).toBe(404);
    });

    it('MEDIDO (no alineado, §M4-VAULT.11) — pieceCount de GET /admin/vaults cuenta piezas que la vista física no', async () => {
      const u = await db.mkUser('Cuenta Distinta', 'user', `cuenta${RUN}`);
      await db.seedInDrawer(u.id, db.shopLocationId, 1);
      await db.mkPiece(u.id, db.shopLocationId, { status: 'reserved', ownershipStatus: 'pending' });
      const list = await h.api('GET', `/admin/vaults?q=cuenta${RUN}`, { token: db.opToken });
      expect(list.body.data.find((r: any) => r.userId === u.id).pieceCount).toBe(2);
      expect((await db.physical(u.id)).body.counts.total).toBe(1);
    });
  });

  // ============================================================== H-1 por HTTP

  describe('H-1 — «Bóvedas de clientes» no presenta el correo como nombre', () => {
    it('27 — las cinco fuentes dan null para el derived e idéntico para el google; la vista (iii) del derived sigue con User.name', async () => {
      const der = await db.mkUser('juan.perez95', 'derived', `h1d${RUN}`);
      const goo = await db.mkUser('Gil Google', 'google', `h1g${RUN}`);
      for (const u of [der, goo]) {
        await db.seedInDrawer(u.id, db.shopLocationId, 1);
        await db.mkPlacement(u.id, 1);
      }
      const expectName = (u: typeof der) => (u.id === der.id ? null : 'Gil Google');
      for (const u of [der, goo]) {
        const list = await h.api('GET', `/admin/vaults?q=${encodeURIComponent(u.email!)}`, { token: db.opToken });
        const row = list.body.data.find((r: any) => r.userId === u.id);
        expect(row.name).toBe(expectName(u));
        expect(row.email).toBe(u.email);
        for (const path of [`/admin/vaults/${u.id}/master-sets`, `/admin/vaults/${u.id}/master-sets/${db.setId}`, `/admin/vaults/${u.id}/sealed`, `/admin/vaults/${u.id}/physical-inventory`]) {
          const r = await h.api('GET', path, { token: db.opToken });
          expect([path, r.status]).toEqual([path, 200]);
          expect([path, r.body.owner.name]).toEqual([path, expectName(u)]);
          expect(r.body.owner.email).toBe(u.email);
        }
        const q = (await db.queue('?destination=vault')).body.data.find((r: any) => r.customer.userId === u.id);
        expect(q.customer.fullName).toBe(expectName(u));
      }
      // candado de la frontera: vista (iii) del propio derived
      const tok = await h.login(der.email!, E2E_USERS.customer.password);
      const mine = await h.api('GET', '/vault/master-sets', { token: tok });
      expect(mine.status).toBe(200);
      expect(mine.body.owner.name).toBe('juan.perez95');
    });

    it('28 — ?sort=name_asc: Ana, Zoe, derived al final; dos derived por email; value_desc empatado desempata igual; ?q= por prefijo del correo encuentra al derived', async () => {
      const tag = `ord${RUN}`;
      const zoe = await db.mkUser('Zoe', 'user', `${tag}m`);
      const d2 = await db.mkUser('zz', 'derived', `${tag}z`);
      const ana = await db.mkUser('Ana', 'user', `${tag}n`);
      const d1 = await db.mkUser('aa', 'derived', `${tag}b`);
      for (const u of [zoe, d2, ana, d1]) await db.seedInDrawer(u.id, db.shopLocationId, 1);
      for (const sort of ['name_asc', 'value_desc', 'pieces_desc']) {
        const res = await h.api('GET', `/admin/vaults?q=${tag}&sort=${sort}`, { token: db.opToken });
        expect(res.status).toBe(200);
        expect([sort, res.body.data.map((r: any) => r.userId)]).toEqual([sort, [ana.id, zoe.id, d1.id, d2.id]]);
      }
      const byPrefix = await h.api('GET', `/admin/vaults?q=${tag}z`, { token: db.opToken });
      expect(byPrefix.body.data.map((r: any) => r.userId)).toEqual([d2.id]);
    });
  });
});
