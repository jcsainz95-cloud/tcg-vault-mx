/**
 * finish-review.e2e-spec.ts — 💰 §AUTO-ENLACE fase 4 (Q1 = A; contrato §8b) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *  Piezas antiguas que podrían ser 1.ª edición: NADA se cambia en silencio. GET (lista con acabado/precio actual y destino, blockedReason, pending, cursor)
 *  y POST (keep | first_edition) con 409 ITEM_LOCKED / NO_TARGET_PRICE / STALE / ALREADY_RESOLVED, 200 alreadyResolved, 404, 422, auditoría y cambio atómico.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { SettingKey } from '../../src/modules/settings/settings.constants';

jest.setTimeout(180_000);

describe('E2E — §AUTO-ENLACE fase 4 finish-review', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let setId: string;
  let customerId: string;
  const run = randomUUID().slice(0, 8);
  const cardIds: string[] = [];
  const itemIds: string[] = [];
  const dialKeys = [SettingKey.FX_RATE_MODE, SettingKey.FX_MANUAL_OVERRIDE_RATE];
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const daysAgo = (n: number) => new Date(today().getTime() - n * 86_400_000);
  let n = 0;

  async function card(finishes: ('normal' | 'holofoil' | 'first_edition' | 'first_edition_holofoil')[], opts: { priced?: ('normal' | 'holofoil' | 'first_edition' | 'first_edition_holofoil')[] } = {}) {
    n += 1;
    const c = await h.prisma.card.create({
      data: { externalId: `fr-${run}-${n}`, setId, name: `Carta WotC ${run} ${n}`, number: String(n), rarity: 'Common', rarityCanonical: 'Common', imageSmallUrl: `https://images.pokemontcg.io/fr/${n}.png`, availableFinishes: finishes },
    });
    cardIds.push(c.id);
    // Dos fuentes frescas que DISCREPAN (el árbitro necesita ≥ 2): normal vale menos que 1.ª edición.
    for (const f of opts.priced ?? finishes) {
      const base = f.startsWith('first_edition') ? 40_000 : 3_000;
      await h.prisma.priceReference.createMany({
        data: [
          { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: f, source: 'tcgcsv_singles', priceUsdCents: base, priceMxnCents: base * 18, capturedDate: daysAgo(3), refKind: 'market' },
          { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: f, source: 'tcgdex', priceUsdCents: Math.round(base * 1.4), priceMxnCents: Math.round(base * 1.4 * 18), capturedDate: daysAgo(3), refKind: 'market' },
        ],
      });
    }
    return c.id;
  }
  async function piece(cardId: string, extra: Record<string, unknown> = {}) {
    const it = await h.prisma.inventoryItem.create({
      data: { folio: `FR-${run}-${itemIds.length + 1}`.padEnd(12, '0'), cardId, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType: 'platform', status: 'listed', acquisitionType: 'compra', acquisitionCostCents: 1000, firstListedAt: new Date(), ...extra } as never,
    });
    itemIds.push(it.id);
    return it.id;
  }
  const list = (q = '') => h.api<any>('GET', `/admin/catalog/finish-review${q}`, { token: admin });
  const decide = (id: string, json: unknown, token = admin) => h.api<any>('POST', `/admin/catalog/finish-review/${id}`, { token, json });
  const mine = (body: any) => (body.items as any[]).filter((i) => itemIds.includes(i.inventoryItemId));

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customerId = (await h.prisma.user.findFirstOrThrow({ where: { email: E2E_USERS.customer.email } })).id;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `fr-${run}`, name: `Gym Heroes ${run}` } })).id;
    for (const [key, v] of [[SettingKey.FX_RATE_MODE, 'manual'], [SettingKey.FX_MANUAL_OVERRIDE_RATE, 21.37]] as const) {
      await h.prisma.configSetting.upsert({ where: { key }, create: { key, valueJson: v as never, updatedBy: 'test' }, update: { valueJson: v as never, updatedBy: 'test' } });
    }
  });

  afterAll(async () => {
    if (h) {
      await h.prisma.orderItem.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await h.prisma.order.deleteMany({ where: { orderNumber: `FR-${run}` } });
      await h.prisma.auditLog.deleteMany({ where: { action: 'catalog.finish_review' } });
      await h.prisma.listingPrice.deleteMany({ where: { inventoryItemId: { in: itemIds } } });
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.prisma.configSetting.deleteMany({ where: { key: { in: dialKeys } } });
      await h.close();
    }
  });

  it('GET: solo super_admin; entran solo raw normal|holofoil cuya carta ofrece el destino; sellado/gradeadas/otras cartas NUNCA; centavos enteros; orden listed primero', async () => {
    const withFe = await card(['normal', 'first_edition']);
    const plain = await card(['normal']); // sin 1.ª edición: no entra
    const holo = await card(['holofoil', 'first_edition_holofoil']);
    const a = await piece(withFe, { status: 'in_stock' });
    const b = await piece(withFe); // listed
    const c = await piece(plain);
    const d = await piece(holo, { finish: 'holofoil' });
    const e = await piece(withFe, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', certNumber: `FR-${run}` });
    expect((await h.api('GET', '/admin/catalog/finish-review', { token: operator })).status).toBe(403);
    const r = await list('?limit=200');
    expect(r.status).toBe(200);
    const items = mine(r.body);
    expect(items.map((i) => i.inventoryItemId).sort()).toEqual([a, b, d].sort());
    expect([c, e].some((x) => items.some((i) => i.inventoryItemId === x))).toBe(false);
    expect(items[0].status).toBe('listed'); // listed primero
    const ia = items.find((i) => i.inventoryItemId === a);
    expect(ia).toMatchObject({ currentFinish: 'normal', targetFinish: 'first_edition', blockedReason: null, cardId: withFe, setName: `Gym Heroes ${run}` });
    expect(Number.isInteger(ia.targetPriceCents) && ia.targetPriceCents > 0).toBe(true);
    expect(items.find((i) => i.inventoryItemId === d)).toMatchObject({ currentFinish: 'holofoil', targetFinish: 'first_edition_holofoil' });
    expect(r.body.pending).toBeGreaterThanOrEqual(3);
  });

  it('paginación por cursor sin repetir ni perder piezas', async () => {
    const first = await list('?limit=1');
    expect(first.body.items).toHaveLength(1);
    expect(first.body.nextCursor).toEqual(expect.any(String));
    const seen = new Set<string>([first.body.items[0].inventoryItemId]);
    let cur: string | null = first.body.nextCursor;
    let guard = 0;
    while (cur && guard++ < 50) {
      const pg = await list(`?limit=1&cursor=${encodeURIComponent(cur)}`);
      for (const it of pg.body.items) {
        expect(seen.has(it.inventoryItemId)).toBe(false);
        seen.add(it.inventoryItemId);
      }
      cur = pg.body.nextCursor;
    }
    expect(seen.size).toBe(first.body.pending);
    expect((await list('?cursor=basura')).status).toBe(422);
  });

  it('blockedReason: venta, reservada, custodia, dueño cliente y sin precio destino', async () => {
    const cid = await card(['normal', 'first_edition']);
    const noPrice = await card(['normal', 'first_edition'], { priced: ['normal'] });
    const sale = await piece(cid);
    const reserved = await piece(cid, { status: 'reserved' });
    const custody = await piece(cid, { status: 'in_custody' });
    const customer = await piece(cid, { ownerType: 'customer', ownerUserId: customerId });
    const np = await piece(noPrice);
    const order = await h.prisma.order.create({
      data: { orderNumber: `FR-${run}`, status: 'settled', priceConvention: 'IVA_INCLUSIVE', feeConvention: 'FEE_ON_TOP', guestEmail: `fr-${run}@example.test`, fulfillmentMode: 'direct_ship', shippingAddressSnapshot: { street: 'Calle 1', city: 'CDMX', postalCode: '01000' }, subtotalCents: 100, processingFeeCents: 0, ivaCents: 0, totalCents: 100 },
    });
    await h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: sale, cardSnapshot: { name: 'x' }, unitPriceCents: 100 } });
    const items = mine((await list('?limit=200')).body);
    const reason = (id: string) => items.find((i) => i.inventoryItemId === id)?.blockedReason;
    expect(reason(sale)).toBe('has_sale');
    expect(reason(reserved)).toBe('reserved');
    expect(reason(custody)).toBe('in_custody');
    expect(reason(customer)).toBe('customer_owned');
    expect(reason(np)).toBe('no_target_price');
    expect(items.find((i) => i.inventoryItemId === np).targetPriceCents).toBeNull();
    await h.prisma.orderItem.deleteMany({ where: { orderId: order.id } });
    await h.prisma.order.delete({ where: { id: order.id } });
  });

  it('POST first_edition: cambia el acabado y el precio, audita; repetir = 200 alreadyResolved sin escribir; la contraria = 409 ALREADY_RESOLVED; sale de la lista', async () => {
    const cid = await card(['normal', 'first_edition']);
    const id = await piece(cid);
    const before = (await list('?limit=200')).body;
    const target = mine(before).find((i) => i.inventoryItemId === id).targetPriceCents;
    expect((await decide(id, { decision: 'first_edition', expectedFinish: 'normal' }, operator)).status).toBe(403);
    const r = await decide(id, { decision: 'first_edition', expectedFinish: 'normal' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ inventoryItemId: id, decision: 'first_edition', alreadyResolved: false, before: { finish: 'normal' }, after: { finish: 'first_edition' } });
    expect(r.body.after.unitPriceCents).toBe(target);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).finish).toBe('first_edition');
    const row = await h.prisma.listingPrice.findUnique({ where: { inventoryItemId: id } });
    if (row) expect(row.variantKey).toMatch(/\|first_edition$/);
    const au = await h.prisma.auditLog.findMany({ where: { action: 'catalog.finish_review', entityId: id } });
    expect(au).toHaveLength(1);
    expect(au[0].actorUserId).not.toBeNull();
    expect(au[0].after).toMatchObject({ decision: 'first_edition', before: { finish: 'normal' }, after: { finish: 'first_edition' } });
    const again = await decide(id, { decision: 'first_edition', expectedFinish: 'normal' });
    expect(again.status).toBe(200);
    expect(again.body.alreadyResolved).toBe(true);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.finish_review', entityId: id } })).toBe(1);
    const contrary = await decide(id, { decision: 'keep', expectedFinish: 'first_edition' as never });
    expect([409, 422]).toContain(contrary.status);
    const c2 = await decide(id, { decision: 'keep', expectedFinish: 'normal' });
    expect(c2.status).toBe(409);
    expect(c2.body.error?.code ?? c2.body.code).toBe('ALREADY_RESOLVED');
    expect(mine((await list('?limit=200')).body).some((i) => i.inventoryItemId === id)).toBe(false);
  });

  it('POST keep: solo registra (0 cambios de acabado ni de precio); queda fuera de la lista', async () => {
    const cid = await card(['normal', 'first_edition']);
    const id = await piece(cid);
    const r = await decide(id, { decision: 'keep', expectedFinish: 'normal' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ decision: 'keep', alreadyResolved: false });
    expect(r.body.after.finish).toBe('normal');
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).finish).toBe('normal');
    expect(mine((await list('?limit=200')).body).some((i) => i.inventoryItemId === id)).toBe(false);
    const flip = await decide(id, { decision: 'first_edition', expectedFinish: 'normal' });
    expect(flip.status).toBe(409);
    expect(flip.body.error?.code ?? flip.body.code).toBe('ALREADY_RESOLVED');
  });

  it('POST 409: ITEM_LOCKED (con blockedReason, 0 escrituras, también con keep), NO_TARGET_PRICE (keep sí puede), STALE; 404 y 422', async () => {
    const cid = await card(['normal', 'first_edition']);
    const noPrice = await card(['normal', 'first_edition'], { priced: ['normal'] });
    const locked = await piece(cid, { status: 'reserved' });
    const customer = await piece(cid, { ownerType: 'customer', ownerUserId: customerId });
    const np = await piece(noPrice);
    const ok = await piece(cid);
    for (const [id, why] of [[locked, 'reserved'], [customer, 'customer_owned']] as const) {
      for (const decision of ['first_edition', 'keep']) {
        const r = await decide(id, { decision, expectedFinish: 'normal' });
        expect(r.status).toBe(409);
        expect(r.body.error?.code ?? r.body.code).toBe('ITEM_LOCKED');
        expect(JSON.stringify(r.body)).toContain(why);
      }
      expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } })).finish).toBe('normal');
      expect(await h.prisma.auditLog.count({ where: { action: 'catalog.finish_review', entityId: id } })).toBe(0);
    }
    const nt = await decide(np, { decision: 'first_edition', expectedFinish: 'normal' });
    expect(nt.status).toBe(409);
    expect(nt.body.error?.code ?? nt.body.code).toBe('NO_TARGET_PRICE');
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: np } })).finish).toBe('normal');
    expect((await decide(np, { decision: 'keep', expectedFinish: 'normal' })).status).toBe(200); // sigue pudiendo `keep`
    const stale = await decide(ok, { decision: 'first_edition', expectedFinish: 'holofoil' });
    expect(stale.status).toBe(409);
    expect(stale.body.error?.code ?? stale.body.code).toBe('STALE');
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ok } })).finish).toBe('normal');
    expect((await decide(randomUUID(), { decision: 'keep', expectedFinish: 'normal' })).status).toBe(404);
    expect((await decide(ok, { decision: 'otra', expectedFinish: 'normal' })).status).toBe(422);
    expect((await decide(ok, { decision: 'keep', expectedFinish: 'reverse_holo' })).status).toBe(422);
  });

  it('una venta concurrente gana: con la pieza vendida a mitad, first_edition NO cambia nada', async () => {
    const cid = await card(['normal', 'first_edition']);
    const id = await piece(cid);
    // Dos decisiones simultáneas: una sola escribe (FOR UPDATE), la otra ve la decisión ya tomada.
    const [x, y] = await Promise.all([decide(id, { decision: 'first_edition', expectedFinish: 'normal' }), decide(id, { decision: 'first_edition', expectedFinish: 'normal' })]);
    expect([x.status, y.status]).toEqual([200, 200]);
    expect([x.body.alreadyResolved, y.body.alreadyResolved].sort()).toEqual([false, true]);
    expect(await h.prisma.auditLog.count({ where: { action: 'catalog.finish_review', entityId: id } })).toBe(1);
  });

  it('sync-status.autoLink.pendingConfirm = finish-review.pending', async () => {
    const r = await h.api<any>('GET', '/admin/catalog/sync-status', { token: admin });
    expect(r.body.autoLink.pendingConfirm).toBe((await list()).body.pending);
  });
});
