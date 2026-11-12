/**
 * alta-liga-2.e2e-spec.ts — §ALTA-LIGA-2 (docs/API_CONTRACT_ALTA_LIGA.md) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  - POST /admin/inventory/cards/:cardId/versions: 201/200, idempotencia (acentos/mayúsculas/espacios), acabado nuevo se AÑADE,
 *    doble alta en paralelo ⇒ UN producto, USE_EXISTING, 404/400/422/403, 429 a las 20 altas/hora.
 *  - Precio heredado de la normal SOLO para el producto manual sin mercado, resuelto en `sale-decision`; ningún precio existente cambia.
 *  - GET …/versions: canAddManual, stampTypes, stamp.manual, priceSource.
 *  - Fusión con el producto real: reapunta piezas (costo intacto), une acabados, borra el manual, audita; no fusiona ante la duda;
 *    idempotente; la dispara `attach`.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ManualVersionMergeService } from '../../src/modules/pricing/manual-version-merge.service';

jest.setTimeout(120_000);

type Combo = { finish: string; language: string; stamp: { productId: number; manual?: boolean; type: string } | null; previewPriceCents: number | null; unavailableReason: string | null; priceSource: string | null; buySuggestedCents: number | null };

describe('E2E — §ALTA-LIGA-2 versión de liga manual', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let customer: string;
  let operatorId: string;
  let merge: ManualVersionMergeService;
  const run = randomUUID().slice(0, 8);
  const cardIds: string[] = [];
  let setId: string;
  let shelf: string | null;
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string; details?: Record<string, any> } }).error;
  const post = (cardId: string, json: Record<string, unknown>, token = operator) => h.api<any>('POST', `/admin/inventory/cards/${cardId}/versions`, { token, json });
  const versions = async (cardId: string) => (await h.api<{ combos: Combo[]; canAddManual: boolean; stampTypes: string[] }>('GET', `/admin/inventory/cards/${cardId}/versions`, { token: admin })).body;
  const alta = (json: Record<string, unknown>) =>
    h.api<{ id: string }>('POST', '/admin/inventory/items', { token: admin, json: { productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1234, locationId: shelf ?? undefined, ...json } });

  async function card(n: string, finishes: ('normal' | 'reverse_holo' | 'holofoil')[], market: Partial<Record<string, number>> = {}) {
    const c = await h.prisma.card.create({
      data: { externalId: `al2-${run}-${n}`, setId, name: `Carta Liga ${run} ${n}`, number: n, rarity: 'Common', rarityCanonical: 'Common', availableFinishes: finishes },
    });
    cardIds.push(c.id);
    for (const [finish, cents] of Object.entries(market)) {
      await h.prisma.priceReference.create({
        data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: finish as 'normal', source: 'manual', priceMxnCents: cents!, capturedDate: today(), isManualOverride: true, refKind: 'market' },
      });
    }
    return c.id;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    operatorId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.operator.email } })).id;
    merge = h.app.get(ManualVersionMergeService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `al2-${run}`, name: `Set Liga ${run}` } })).id;
  });

  afterAll(async () => {
    if (h) {
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.auditLog.deleteMany({ where: { OR: [{ actorUserId: operatorId, action: { startsWith: 'inventory.manual_version' } }, { action: { startsWith: 'inventory.manual_version' } }] } });
      await h.prisma.stampedProductCandidate.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  let A = '';
  it('permisos y validación: customer 403; carta inexistente 404; etiqueta con HTML 400 field; acabado ajeno 422', async () => {
    A = await card('A', ['normal', 'reverse_holo'], { normal: 40_000, reverse_holo: 50_000 });
    expect((await post(A, { stampType: 'league', finish: 'normal' }, customer)).status).toBe(403);
    const nf = await post(randomUUID(), { stampType: 'league', finish: 'normal' });
    expect([nf.status, err(nf).code]).toEqual([404, 'CARD_NOT_FOUND']);
    const html = await post(A, { stampType: 'league', stampLabel: '<b>x</b>', finish: 'normal' });
    expect([html.status, err(html).code, err(html).details?.field]).toEqual([400, 'VALIDATION_ERROR', 'stampLabel']);
    const long = await post(A, { stampType: 'league', stampLabel: 'x'.repeat(41), finish: 'normal' });
    expect([long.status, err(long).details?.field]).toEqual([400, 'stampLabel']);
    const badType = await post(A, { stampType: 'nope', finish: 'normal' });
    expect(badType.status).toBe(400);
    const fin = await post(A, { stampType: 'league', finish: 'holofoil' });
    expect([fin.status, err(fin).code]).toEqual([422, 'FINISH_NOT_AVAILABLE']);
    expect(await h.prisma.cardProduct.count({ where: { cardId: A } })).toBe(0);
  });

  it('crea la versión manual: 201, productId negativo, hereda el precio de la normal (en y es), GET con canAddManual/stampTypes/manual/priceSource', async () => {
    const before = await versions(A);
    const r = await post(A, { stampType: 'league', stampLabel: 'Liga Mayo', finish: 'normal' });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: true, finishAdded: false, finishes: ['normal'], stamp: { type: 'league', label: 'Liga Mayo', manual: true } });
    const pid = r.body.stamp.productId as number;
    expect(pid).toBeLessThan(0);
    expect(r.body.combos.every((c: Combo) => c.stamp?.productId === pid)).toBe(true);
    const after = await versions(A);
    expect(after.canAddManual).toBe(true);
    expect(after.stampTypes).toEqual(expect.arrayContaining(['prize_pack', 'league', 'championship', 'prerelease', 'staff', 'event_promo']));
    const norm = (l: string) => after.combos.find((c) => c.stamp == null && c.finish === 'normal' && c.language === l)!;
    const man = (l: string) => after.combos.find((c) => c.stamp?.productId === pid && c.finish === 'normal' && c.language === l)!;
    for (const l of ['en', 'es']) {
      expect(man(l).previewPriceCents).not.toBeNull();
      expect(man(l).previewPriceCents).toBe(norm(l).previewPriceCents); // VENTA = la de la normal del mismo idioma y acabado
      expect(man(l).buySuggestedCents).toBe(norm(l).buySuggestedCents); // COMPRA sugerida = la de la normal
      expect(man(l)).toMatchObject({ priceSource: 'inherited_base', stamp: { manual: true } });
      expect(norm(l).priceSource).toBe('own_market');
    }
    // NINGÚN precio existente cambia: todas las combinaciones previas salen idénticas.
    const key = (c: Combo) => `${c.stamp?.productId ?? 'base'}|${c.finish}|${c.language}`;
    const prev = new Map(before.combos.map((c) => [key(c), c]));
    for (const c of after.combos.filter((x) => x.stamp?.productId !== pid)) expect(c).toEqual(prev.get(key(c)));
    expect(await h.prisma.priceReference.count({ where: { cardId: A } })).toBe(2); // ni una referencia escrita
  });

  it('idempotente por (carta, tipo, etiqueta normalizada): acentos, mayúsculas y espacios ⇒ el mismo producto; acabado nuevo se AÑADE', async () => {
    const again = await post(A, { stampType: 'league', stampLabel: '  líga   MAYO ', finish: 'normal' });
    expect([again.status, again.body.created, again.body.finishAdded]).toEqual([200, false, false]);
    const add = await post(A, { stampType: 'league', stampLabel: 'liga mayo', finish: 'reverse_holo' });
    expect([add.status, add.body.created, add.body.finishAdded, add.body.finishes]).toEqual([200, false, true, ['normal', 'reverse_holo']]);
    expect(await h.prisma.cardProduct.count({ where: { cardId: A, tcgplayerProductId: { lt: 0 } } })).toBe(1);
    const other = await post(A, { stampType: 'league', finish: 'normal' }); // sin etiqueta = otra versión
    expect([other.status, other.body.created]).toEqual([201, true]);
    expect(await h.prisma.cardProduct.count({ where: { cardId: A, tcgplayerProductId: { lt: 0 } } })).toBe(2);
    const audits = await h.prisma.auditLog.findMany({ where: { action: { startsWith: 'inventory.manual_version' }, entityType: 'CardProduct' } });
    expect(audits.map((a) => a.action).sort()).toEqual(['inventory.manual_version_created', 'inventory.manual_version_created', 'inventory.manual_version_finish_added']);
    expect(audits[0].actorUserId).toBe(operatorId);
  });

  it('dos operadores a la vez con la misma llave ⇒ UN producto (un 201 y un 200)', async () => {
    const C = await card('C', ['normal'], { normal: 10_000 });
    const rs = await Promise.all([post(C, { stampType: 'prerelease', stampLabel: 'Pre ASC', finish: 'normal' }, admin), post(C, { stampType: 'prerelease', stampLabel: 'pre asc', finish: 'normal' }, operator)]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 201]);
    expect(await h.prisma.cardProduct.count({ where: { cardId: C } })).toBe(1);
    expect(new Set(rs.map((r) => r.body.stamp.productId)).size).toBe(1);
  });

  it('el alta con el productId negativo funciona y la pieza se precia como la normal; sin mercado en la normal ⇒ no_market / PRICE_PENDING', async () => {
    const ok = await alta({ cardId: A, cardProductId: (await h.prisma.cardProduct.findFirstOrThrow({ where: { cardId: A, stampLabelNorm: 'liga mayo' } })).tcgplayerProductId, finish: 'normal' });
    expect(ok.status).toBe(201);
    const item = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(item.cardProductId).toBeLessThan(0);
    const B = await card('B', ['normal']); // sin mercado en ninguna parte
    const mb = await post(B, { stampType: 'staff', finish: 'normal' });
    expect(mb.status).toBe(201);
    const vb = await versions(B);
    const c = vb.combos.find((x) => x.stamp?.productId === mb.body.stamp.productId && x.language === 'en')!;
    expect([c.previewPriceCents, c.unavailableReason, c.priceSource]).toEqual([null, 'no_market', null]);
  });

  it('un producto REAL nunca hereda: sin mercado propio sigue en no_stamped_market aunque la normal tenga mercado', async () => {
    const R = await card('R', ['normal'], { normal: 20_000 });
    const real = 710_000_000 + Math.floor(Math.random() * 1_000_000);
    await h.prisma.cardProduct.create({ data: { cardId: R, tcgplayerProductId: real, kind: 'stamped', name: `Real ${run}`, finishes: ['normal'], stampType: 'league', sourceGroupId: 1539 } });
    const v = await versions(R);
    const c = v.combos.find((x) => x.stamp?.productId === real && x.language === 'en')!;
    expect([c.previewPriceCents, c.unavailableReason, c.priceSource]).toEqual([null, 'no_stamped_market', null]);
  });

  it('USE_EXISTING: producto real o candidata del mismo tipo ⇒ 409 con details; otro tipo sí se crea', async () => {
    const U = await card('U', ['normal'], { normal: 10_000 });
    await h.prisma.cardProduct.create({ data: { cardId: U, tcgplayerProductId: 720_000_001 + Math.floor(Math.random() * 1000), kind: 'stamped', name: `Real U ${run}`, finishes: ['normal'], stampType: 'prize_pack', sourceGroupId: 22880 } });
    await h.prisma.stampedProductCandidate.create({ data: { tcgplayerProductId: 730_000_001 + Math.floor(Math.random() * 1000), cardId: U, groupId: 1539, name: `Cand ${run}`, stampType: 'championship', finishes: ['normal'], refreshedAt: new Date() } });
    const a = await post(U, { stampType: 'prize_pack', finish: 'normal' });
    expect([a.status, err(a).code]).toEqual([409, 'USE_EXISTING']);
    expect(err(a).details?.stamps).toHaveLength(1);
    const b = await post(U, { stampType: 'championship', finish: 'normal' });
    expect([b.status, err(b).code]).toEqual([409, 'USE_EXISTING']);
    expect(err(b).details?.candidates).toHaveLength(1);
    expect((await post(U, { stampType: 'staff', finish: 'normal' })).status).toBe(201);
    expect(await h.prisma.cardProduct.count({ where: { cardId: U, tcgplayerProductId: { lt: 0 } } })).toBe(1);
  });

  it('límite: 20 altas por usuario y hora ⇒ 429 RATE_LIMITED; un reintento que no escribe no gasta cupo', async () => {
    const L = await card('L', ['normal']);
    const first = await post(L, { stampType: 'event_promo', stampLabel: 'primera', finish: 'normal' }, admin);
    expect(first.status).toBe(201);
    const used = await h.prisma.auditLog.count({ where: { actorUserId: (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id, action: { in: ['inventory.manual_version_created', 'inventory.manual_version_finish_added'] } } });
    const adminId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.admin.email } })).id;
    await h.prisma.auditLog.createMany({ data: Array.from({ length: 20 - used }, () => ({ actorUserId: adminId, actorRole: 'super_admin' as const, action: 'inventory.manual_version_created', entityType: 'CardProduct', entityId: 'seed' })) });
    const blocked = await post(L, { stampType: 'event_promo', stampLabel: 'segunda', finish: 'normal' }, admin);
    expect([blocked.status, err(blocked).code]).toEqual([429, 'RATE_LIMITED']);
    const replay = await post(L, { stampType: 'event_promo', stampLabel: 'primera', finish: 'normal' }, admin);
    expect([replay.status, replay.body.created]).toEqual([200, false]);
    await h.prisma.auditLog.deleteMany({ where: { entityId: 'seed', action: 'inventory.manual_version_created' } });
  });

  describe('fusión con el producto real', () => {
    const mk = async (n: string, label: string | null, finishes: string[] = ['normal']) => {
      const id = await card(n, ['normal', 'reverse_holo']);
      const r = await post(id, { stampType: 'prize_pack', ...(label ? { stampLabel: label } : {}), finish: finishes[0] });
      for (const f of finishes.slice(1)) await post(id, { stampType: 'prize_pack', ...(label ? { stampLabel: label } : {}), finish: f });
      return { id, pid: r.body.stamp.productId as number };
    };
    const real = (cardId: string, label: string | null, finishes = ['reverse_holo']) =>
      h.prisma.cardProduct.create({ data: { cardId, tcgplayerProductId: 740_000_000 + Math.floor(Math.random() * 9_000_000), kind: 'stamped', name: `Real ${run}`, finishes: finishes as ('normal')[], stampType: 'prize_pack', stampLabel: label, sourceGroupId: 22880 } });

    it('reapunta piezas (costo y estado intactos), une acabados, borra el manual, audita y es idempotente', async () => {
      const m = await mk('M1', 'Cosmos');
      const a1 = await alta({ cardId: m.id, cardProductId: m.pid, finish: 'normal', acquisitionCostCents: 777 });
      const a2 = await alta({ cardId: m.id, cardProductId: m.pid, finish: 'normal', acquisitionCostCents: 888 });
      await h.prisma.inventoryItem.update({ where: { id: a2.body.id }, data: { status: 'shipped' } }); // una ya vendida/enviada
      const r = await real(m.id, 'COSMOS');
      await h.prisma.priceReference.create({ data: { cardId: m.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo', cardProductId: r.id, source: 'manual', priceMxnCents: 99_000, capturedDate: today(), isManualOverride: true, refKind: 'market' } });
      const pend = await h.prisma.pendingPriceEntry.create({ data: { cardId: m.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', cardProductId: m.pid, context: 'inventory', status: 'open' } });
      const res = await merge.mergeForCard(m.id);
      expect(res).toMatchObject({ merged: 1, items: 2 });
      expect((await h.prisma.pendingPriceEntry.findUniqueOrThrow({ where: { id: pend.id } })).status).toBe('resolved'); // la cola del id manual se cierra
      expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: m.pid } })).toBe(0);
      const items = await h.prisma.inventoryItem.findMany({ where: { id: { in: [a1.body.id, a2.body.id] } }, orderBy: { acquisitionCostCents: 'asc' } });
      expect(items.map((i) => [i.cardProductId, i.acquisitionCostCents, i.status])).toEqual([[r.tcgplayerProductId, 777, 'in_stock'], [r.tcgplayerProductId, 888, 'shipped']]);
      expect((await h.prisma.cardProduct.findUniqueOrThrow({ where: { id: r.id } })).finishes.sort()).toEqual(['normal', 'reverse_holo']);
      const aud = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'inventory.manual_version_merged', entityId: r.id } });
      expect(aud.after).toMatchObject({ from: m.pid, to: r.tcgplayerProductId, items: 2 });
      expect(await merge.mergeForCard(m.id)).toEqual({ merged: 0, skipped: 0, items: 0 });
    });

    it('la duda NO fusiona: ≥2 manuales del tipo, etiquetas distintas o real ambiguo; el skip se audita UNA vez', async () => {
      const two = await mk('M2', 'uno');
      await post(two.id, { stampType: 'prize_pack', stampLabel: 'dos', finish: 'normal' });
      await real(two.id, null);
      expect(await merge.mergeForCard(two.id)).toMatchObject({ merged: 0, skipped: 2 });
      expect(await h.prisma.cardProduct.count({ where: { cardId: two.id, tcgplayerProductId: { lt: 0 } } })).toBe(2);
      await merge.mergeForCard(two.id);
      expect(await h.prisma.auditLog.count({ where: { action: 'inventory.manual_version_merge_skipped', entityId: two.pid.toString() ? (await h.prisma.cardProduct.findFirstOrThrow({ where: { tcgplayerProductId: two.pid } })).id : '' } })).toBe(1);

      const mis = await mk('M3', 'Alfa');
      await real(mis.id, 'Beta');
      expect(await merge.mergeForCard(mis.id)).toMatchObject({ merged: 0, skipped: 1 });
      expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: mis.pid } })).toBe(1);
      const sk = await h.prisma.auditLog.findFirstOrThrow({ where: { action: 'inventory.manual_version_merge_skipped', entityId: (await h.prisma.cardProduct.findFirstOrThrow({ where: { tcgplayerProductId: mis.pid } })).id } });
      expect(sk.after).toMatchObject({ reason: 'label_mismatch' });

      const amb = await mk('M4', null);
      await real(amb.id, null);
      await real(amb.id, null);
      expect(await merge.mergeForCard(amb.id)).toMatchObject({ merged: 0, skipped: 1 });
    });

    it('attach de una candidata fusiona la versión manual de esa carta (disparador)', async () => {
      const m = await mk('M5', null);
      const cand = 750_000_000 + Math.floor(Math.random() * 9_000_000);
      await h.prisma.stampedProductCandidate.create({ data: { tcgplayerProductId: cand, cardId: m.id, groupId: 22880, name: `Cand ${run}`, stampType: 'prize_pack', finishes: ['reverse_holo'], refreshedAt: new Date() } });
      const it = await alta({ cardId: m.id, cardProductId: m.pid, finish: 'normal' });
      const r = await h.api('POST', `/admin/inventory/stamped-candidates/${cand}/attach`, { token: operator, json: { cardId: m.id } });
      expect(r.status).toBe(200);
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: it.body.id } })).cardProductId).toBe(cand);
      expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: m.pid } })).toBe(0);
    });

    it('el job diario recorre solo las cartas con manual', async () => {
      const m = await mk('M6', null);
      await real(m.id, null);
      const all = await merge.runAll();
      expect(all.merged).toBeGreaterThanOrEqual(1);
      expect(await h.prisma.cardProduct.count({ where: { tcgplayerProductId: m.pid } })).toBe(0);
    });
  });
});
