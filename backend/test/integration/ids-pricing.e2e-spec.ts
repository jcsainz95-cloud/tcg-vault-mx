/**
 * ids-pricing.e2e-spec.ts — 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.2/.7) contra Postgres REAL y la app por HTTP. Propiedad: backend.
 *
 *  - IDS-B2 (515): `P(es)` = `P` de una inglesa con mercado `R ×75`, en tres tramos (piso, medio, cara).
 *  - IDS-B3 (514, 516): inglés sin mercado ⇒ española `PRICE_PENDING`: fuera de rejilla y ficha, quote ⇒ 422, cero
 *    `PendingPriceEntry`; el mercado llega ⇒ se publica sola (`reevaluateVariantsForPublication`).
 *  - IDS-B4 (517): sin fila ⇒ 75; `PUT` 74 ⇒ `dial_change` y las españolas (con y sin liga) recalculadas; rechaza "", 0, −1,
 *    201, 7.5 y "a"; bitácora antes → después; operador ⇒ 403.
 *  - IDS-B5 (524, 525): `(en, P)` = precio de SU producto; mover la base no lo mueve; producto sin precio ⇒ pending.
 *  - IDS-B6 (958): `(es, P)` = producto ×X; mover la base no lo mueve, mover X sí; pierde mercado ⇒ pending y vuelve sola.
 *  - IDS-B10 (517): el dial tiene los MISMOS roles efectivos que `PUT /admin/pricing/curve`.
 *  - IDS-B15 (959): exhibido — español ⇒ sin valor de mercado; `(en, P)` ⇒ el de su producto.
 * Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { SaleDecisionService, SaleItem, isPricePending } from '../../src/modules/pricing/sale-decision.service';
import { SettingsService } from '../../src/modules/settings/settings.service';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { SEALED_SALE_PRICE_INCLUDE } from '../../src/common/money';

jest.setTimeout(120_000);

describe('E2E — §IDS.2/.7 precio por versión (español y liga)', () => {
  let h: E2EHarness;
  let admin: string;
  let operator: string;
  let customer: string;
  let lp: ListingPriceService;
  let decider: SaleDecisionService;
  const run = randomUUID().slice(0, 8);
  const pidBase = 800_000_000 + Math.floor(Math.random() * 90_000_000);
  let setId: string;
  let shelf: string | null;
  const cardIds: string[] = [];
  let seq = 0;
  let savedDial: Prisma.JsonValue | undefined;
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function card(n: number): Promise<string> {
    const c = await h.prisma.card.create({
      data: {
        externalId: `ids-${run}-${n}`,
        setId,
        name: `Carta IDS ${run} ${n}`,
        number: String(n),
        rarity: 'Common',
        rarityCanonical: 'Common',
        imageSmallUrl: `https://images.pokemontcg.io/ids/${n}.png`,
        availableFinishes: ['normal', 'holofoil'],
      },
    });
    cardIds.push(c.id);
    return c.id;
  }
  async function baseRef(cardId: string, cents: number, finish: 'normal' | 'holofoil' = 'normal') {
    await h.prisma.priceReference.deleteMany({ where: { cardId, finish, cardProductId: null } });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source: 'manual', priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
  }
  async function stamped(cardId: string, n: number, cents: number | null, finish: 'normal' | 'holofoil' = 'holofoil') {
    const cp = await h.prisma.cardProduct.create({
      data: { cardId, tcgplayerProductId: pidBase + n, kind: 'stamped', name: `Liga ${run} ${n}`, finishes: [finish], stampType: 'prize_pack', sourceGroupId: 22880 },
    });
    if (cents != null) await stampedRef(cardId, cp.id, cents, finish);
    return cp;
  }
  async function stampedRef(cardId: string, cpId: string, cents: number, finish: 'normal' | 'holofoil' = 'holofoil') {
    await h.prisma.priceReference.deleteMany({ where: { cardProductId: cpId } });
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source: 'manual', cardProductId: cpId, priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
  }
  async function item(cardId: string, data: Partial<Prisma.InventoryItemUncheckedCreateInput> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `IDS-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        acquisitionCostCents: 1000,
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }
  const full = (id: string) =>
    h.prisma.inventoryItem.findUniqueOrThrow({ where: { id }, include: { card: { include: { set: true } }, ...SEALED_SALE_PRICE_INCLUDE } }) as Promise<SaleItem>;
  async function live(id: string): Promise<number | string> {
    try {
      return (await decider.decide(await full(id), await h.app.get(SettingsService).getIvaDials())).unitPriceCents;
    } catch (e) {
      if (isPricePending(e)) return `pending:${(e.details as { reason?: string } | undefined)?.reason ?? '-'}`;
      throw e;
    }
  }
  const setDial = async (v: number | null) => {
    if (v == null) await h.prisma.configSetting.deleteMany({ where: { key: 'spanish_market_pct' } });
    else await h.prisma.configSetting.upsert({ where: { key: 'spanish_market_pct' }, create: { key: 'spanish_market_pct', valueJson: v }, update: { valueJson: v } });
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    operator = await h.login(E2E_USERS.operator.email, E2E_USERS.operator.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    lp = h.app.get(ListingPriceService);
    decider = h.app.get(SaleDecisionService);
    savedDial = (await h.prisma.configSetting.findUnique({ where: { key: 'spanish_market_pct' } }))?.valueJson;
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `ids-${run}`, name: `Set IDS ${run}` } })).id;
    await setDial(75);
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      if (savedDial === undefined) await setDial(null);
      else await h.prisma.configSetting.update({ where: { key: 'spanish_market_pct' }, data: { valueJson: savedDial as Prisma.InputJsonValue } });
      const ids = (await h.prisma.inventoryItem.findMany({ where: { folio: { startsWith: `IDS-${run}-` } }, select: { id: true } })).map((i) => i.id);
      await h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: ids } } });
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('IDS-B2 (515): P(es) = P de una inglesa con mercado R ×75, en el piso, el tramo medio y una cara', async () => {
    for (const [i, R] of [400, 48_000, 1_200_000].entries()) {
      const a = await card(10 + i);
      const b = await card(20 + i);
      await baseRef(a, R);
      await baseRef(b, (R * 75) / 100);
      const es = await item(a, { language: 'es' });
      const en = await item(b);
      expect(await live(es.id)).toBe(await live(en.id));
      expect(typeof (await live(es.id))).toBe('number');
    }
  });

  it('IDS-B3 (514, 516): inglés sin mercado ⇒ española pending fuera de tienda y quote; cero PendingPriceEntry; el mercado la publica sola', async () => {
    const c = await card(30);
    const es = await item(c, { language: 'es', status: 'in_stock', firstListedAt: null });
    const esListed = await item(c, { language: 'es' });
    expect(await live(es.id)).toBe('pending:no_english_market');
    await lp.run('manual_price', [es.id, esListed.id]);
    expect((await h.prisma.listingPrice.findUnique({ where: { inventoryItemId: esListed.id } }))?.status).toBe('pending');
    const detail = await h.api('GET', `/catalog/cards/${c}`);
    expect(JSON.stringify(detail.body ?? {})).not.toContain(esListed.id);
    const q = await h.api('POST', '/checkout/quote', { token: customer, json: { inventoryItemIds: [esListed.id] } });
    expect(q.status).toBe(422);
    expect((q.body as { error: { code: string } }).error.code).toBe('PRICE_PENDING');
    // Publicar a mano tampoco escala.
    await h.app.get(InventoryService).reevaluateVariantsForPublication([{ cardId: c, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }]);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: c } })).toBe(0);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: es.id } })).status).toBe('in_stock');
    // Llega el mercado del inglés ⇒ el disparo del barrido la publica sin acción de nadie.
    await baseRef(c, 20_000);
    await h.app.get(InventoryService).reevaluateVariantsForPublication([{ cardId: c, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }]);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: es.id } })).status).toBe('listed');
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: c } })).toBe(0);
  });

  it('IDS-B5 (524, 525): (en, P) = su producto; mover la base no lo mueve; producto sin precio ⇒ pending (nunca la base)', async () => {
    const base = await card(40);
    const twin = await card(41);
    await baseRef(base, 10_000, 'holofoil');
    await baseRef(twin, 60_000, 'holofoil');
    const cp = await stamped(base, 40, 60_000);
    const enP = await item(base, { cardProductId: cp.tcgplayerProductId, finish: 'holofoil' });
    const enTwin = await item(twin, { finish: 'holofoil' });
    const enBase = await item(base, { finish: 'holofoil' });
    const p0 = await live(enP.id);
    expect(p0).toBe(await live(enTwin.id));
    expect(p0).not.toBe(await live(enBase.id));
    await baseRef(base, 33_000, 'holofoil');
    expect(await live(enP.id)).toBe(p0);
    // IDS-B15: exhibido de (en, P) = el de su producto.
    const batch = await decider.loadBatch([await full(enP.id)]);
    expect(decider.exhibitedReferenceOf(await full(enP.id), batch).referenceMxnCents).toBe(60_000);
    const noPrice = await stamped(base, 41, null);
    const enQ = await item(base, { cardProductId: noPrice.tcgplayerProductId, finish: 'holofoil' });
    expect(await live(enQ.id)).toBe('pending:no_stamped_market');
  });

  it('IDS-B6 (958): (es, P) = producto ×X; la base no lo mueve, X sí; pierde mercado ⇒ pending y vuelve sola', async () => {
    const base = await card(50);
    const twin = await card(51);
    await baseRef(base, 5_000, 'holofoil');
    await baseRef(twin, 30_000, 'holofoil'); // 40 000 × 75 %
    const cp = await stamped(base, 50, 40_000);
    const esP = await item(base, { language: 'es', cardProductId: cp.tcgplayerProductId, finish: 'holofoil' });
    const enTwin = await item(twin, { finish: 'holofoil' });
    const p0 = await live(esP.id);
    expect(p0).toBe(await live(enTwin.id));
    await baseRef(base, 90_000, 'holofoil');
    expect(await live(esP.id)).toBe(p0);
    await setDial(50);
    expect(await live(esP.id)).not.toBe(p0);
    await setDial(75);
    // IDS-B15: español ⇒ sin valor de mercado exhibido.
    const batch = await decider.loadBatch([await full(esP.id)]);
    expect(decider.exhibitedReferenceOf(await full(esP.id), batch)).toEqual({ referenceMxnCents: null, capturedDate: null });
    // Pierde el mercado del producto ⇒ pending en la fila; vuelve ⇒ priced sin acción.
    await h.prisma.priceReference.deleteMany({ where: { cardProductId: cp.id } });
    await lp.run('manual_price', [esP.id]);
    expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: esP.id } })).status).toBe('pending');
    await stampedRef(base, cp.id, 40_000);
    await lp.run('daily', [esP.id]);
    const row = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: esP.id } });
    expect(row.status).toBe('priced');
    expect(row.unitPriceCents).toBe(p0);
    expect(row.variantKey).toBe(`${base}|raw|raw:NM|holofoil|v:es.${cp.tcgplayerProductId}`);
    expect(row.referenceMxnCents).toBeNull();
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: base } })).toBe(0);
  });

  it('IDS-B4 (517): sin fila ⇒ 75; PUT 74 ⇒ dial_change y españolas recalculadas; validación; bitácora; operador 403', async () => {
    await setDial(null);
    const got = await h.api<{ spanishMarketPct: number }>('GET', '/admin/settings', { token: admin });
    expect(got.status).toBe(200);
    expect(got.body.spanishMarketPct).toBe(75);
    const c = await card(60);
    await baseRef(c, 40_000);
    const cp = await stamped(c, 60, 40_000, 'normal');
    const es = await item(c, { language: 'es' });
    const esP = await item(c, { language: 'es', cardProductId: cp.tcgplayerProductId });
    await lp.run('manual_price', [es.id, esP.id]);
    const before = await h.prisma.listingPrice.findMany({ where: { inventoryItemId: { in: [es.id, esP.id] } }, orderBy: { inventoryItemId: 'asc' } });
    for (const bad of ['', 0, -1, 201, 7.5, 'a']) {
      const r = await h.api('PUT', '/admin/settings', { token: admin, json: { spanishMarketPct: bad } });
      expect([bad, r.status]).toEqual([bad, 422]);
    }
    const denied = await h.api('PUT', '/admin/settings', { token: operator, json: { spanishMarketPct: 74 } });
    expect(denied.status).toBe(403);
    const ok = await h.api('PUT', '/admin/settings', { token: admin, json: { spanishMarketPct: 50 } });
    expect(ok.status).toBe(200);
    await lp.idle();
    const runRow = await h.prisma.listingPriceRun.findFirst({ where: { trigger: 'dial_change' }, orderBy: { startedAt: 'desc' } });
    expect(runRow?.status).toBe('ok');
    const after = await h.prisma.listingPrice.findMany({ where: { inventoryItemId: { in: [es.id, esP.id] } }, orderBy: { inventoryItemId: 'asc' } });
    expect(after.map((r) => r.unitPriceCents)).not.toEqual(before.map((r) => r.unitPriceCents));
    for (const [i, r] of after.entries()) expect(r.unitPriceCents).toBeLessThan(before[i].unitPriceCents!);
    const audit = await h.prisma.auditLog.findFirst({ where: { action: 'settings.update' }, orderBy: { createdAt: 'desc' } });
    expect((audit?.before as Record<string, unknown>).spanishMarketPct).toBe(75);
    expect((audit?.after as Record<string, unknown>).spanishMarketPct).toBe(50);
    await setDial(75);
  });

  it('IDS-B10 (517): el dial y `PUT /admin/pricing/curve` tienen los mismos roles efectivos', async () => {
    const curve = await h.api('GET', '/admin/pricing/curve', { token: admin });
    const outcome = async (token: string) => [
      (await h.api('PUT', '/admin/settings', { token, json: { spanishMarketPct: 75 } })).status,
      (await h.api('PUT', '/admin/pricing/curve', { token, json: curve.body })).status,
    ];
    const [opDial, opCurve] = await outcome(operator);
    const [adDial, adCurve] = await outcome(admin);
    const [cuDial, cuCurve] = await outcome(customer);
    expect([opDial < 300, adDial < 300, cuDial < 300]).toEqual([opCurve < 300, adCurve < 300, cuCurve < 300]);
    expect([opDial, adDial < 300, cuDial]).toEqual([403, true, 403]);
  });
});
