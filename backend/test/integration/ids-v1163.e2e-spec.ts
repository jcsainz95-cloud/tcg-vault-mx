/**
 * ids-v1163.e2e-spec.ts — v1.116.3⟨ids⟩ (API_CONTRACT §IDS.9: IDS-B22, IDS-B23 y la ampliación de IDS-B17) contra Postgres REAL
 * y la app por HTTP. Propiedad: backend. Sin cambio de código de precio: fija lo ya construido. Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { DecksMetaService } from '../../src/modules/decks-meta/decks-meta.service';
import { InventoryService } from '../../src/modules/inventory/inventory.service';
import { PriceIngestService } from '../../src/modules/pricing/price-ingest.service';

jest.setTimeout(120_000);

describe('E2E — §IDS v1.116.3: IDS-B22, IDS-B23 e IDS-B17 ampliada', () => {
  let h: E2EHarness;
  let admin: string;
  let customer: string;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const pid = 300_000_000 + Math.floor(Math.random() * 90_000_000);
  const cardIds: string[] = [];
  let setId: string;
  let shelf: string | null;
  let seq = 0;
  const today = () => new Date(new Date().toISOString().slice(0, 10));
  const err = (r: { body: unknown }) => (r.body as { error: { code: string; details?: Record<string, unknown> } }).error;

  async function card(n: number) {
    const c = await h.prisma.card.create({
      data: { externalId: `idv-${run}-${n}`, setId, name: `Carta V1163 ${run} N${n}`, number: String(n), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'] },
    });
    cardIds.push(c.id);
    await h.prisma.priceReference.create({
      data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 50_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    return c;
  }
  async function piece(cardId: string, data: Record<string, unknown> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `IDV-${run}-${seq}`,
        cardId,
        productType: 'raw',
        rawCondition: 'NM',
        finish: 'normal',
        ownerType: 'platform',
        status: 'listed',
        acquisitionType: 'compra',
        firstListedAt: new Date(),
        locationId: shelf,
        ...data,
      },
    });
  }
  const alta = (json: Record<string, unknown>) =>
    h.api<{ id: string; status: string }>('POST', '/admin/inventory/items', {
      token: admin,
      json: { productType: 'raw', rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1000, ...json },
    });

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    admin = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customer = await h.login(E2E_USERS.customer.email, E2E_USERS.customer.password);
    lp = h.app.get(ListingPriceService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idv-${run}`, name: `Set V1163 ${run}` } })).id;
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      const orderIds = (await h.prisma.orderItem.findMany({ where: { inventoryItemId: { in: ids } }, select: { orderId: true } })).map((o) => o.orderId);
      await h.prisma.inventoryItem.updateMany({ where: { id: { in: ids } }, data: { reservedByOrderId: null } });
      await h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }).catch(() => undefined);
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

  it('IDS-B22: errores del alta (single y lote); PATCH {cardProductId} no toca la pieza; la línea de pedido lee tipo/rótulo del OrderItem', async () => {
    const c = await card(1);
    const other = await card(2);
    await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: pid, kind: 'stamped', name: `L ${run}`, finishes: ['normal'], stampType: 'prize_pack', stampLabel: 'Cosmos Holo', sourceGroupId: 22880 } });
    await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: pid + 1, kind: 'promo', name: `P ${run}`, finishes: ['normal'] } });
    await h.prisma.cardProduct.create({ data: { cardId: other.id, tcgplayerProductId: pid + 2, kind: 'stamped', name: `O ${run}`, finishes: ['normal'], stampType: 'league', sourceGroupId: 1539 } });
    await h.prisma.priceReference.create({
      data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 80_000, capturedDate: today(), isManualOverride: true, refKind: 'market', cardProductId: (await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: pid } })).id },
    });
    const ok = await alta({ cardId: c.id, cardProductId: pid, locationId: shelf ?? undefined });
    expect(ok.status).toBe(201);
    const nf = await alta({ cardId: c.id, cardProductId: pid + 999_999 });
    expect([nf.status, err(nf).code]).toEqual([422, 'PRODUCT_NOT_FOUND']);
    const mm = await alta({ cardId: c.id, cardProductId: pid + 2 });
    expect([mm.status, err(mm).code]).toEqual([422, 'PRODUCT_CARD_MISMATCH']);
    const pr = await alta({ cardId: c.id, cardProductId: pid + 1 });
    expect([pr.status, err(pr).code, err(pr).details?.field]).toEqual([422, 'VALIDATION_ERROR', 'cardProductId']);
    const batch = await h.api<{ results: { index: number; ok: boolean; error?: { code: string } }[] }>('POST', '/admin/inventory/items/batch', {
      token: admin,
      json: {
        batchKey: `idv-${run}`,
        items: [
          { productType: 'raw', cardId: c.id, rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1, cardProductId: pid + 999_999 },
          { productType: 'raw', cardId: c.id, rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1, cardProductId: pid + 2 },
          { productType: 'raw', cardId: c.id, rawCondition: 'NM', acquisitionType: 'compra', acquisitionCostCents: 1, cardProductId: pid + 1 },
        ],
      },
    });
    expect(batch.body.results.map((r) => r.error?.code)).toEqual(['PRODUCT_NOT_FOUND', 'PRODUCT_CARD_MISMATCH', 'VALIDATION_ERROR']);
    // PATCH {cardProductId}: no es campo del PATCH ⇒ la pieza queda intacta.
    const before = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ok.body.id } });
    const patch = await h.api('PATCH', `/admin/inventory/items/${ok.body.id}`, { token: admin, json: { cardProductId: pid + 1 } });
    expect(patch.status).toBeLessThan(500);
    const after = await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: ok.body.id } });
    expect(after.cardProductId).toBe(before.cardProductId);
    expect(after.cardProductId).toBe(pid);
    // Línea de pedido de liga + una inglesa sin liga.
    const plain = await piece(c.id);
    await lp.run('manual_price', [ok.body.id, plain.id]);
    const s = await h.api<{ orderId: string }>('POST', '/checkout/session', {
      token: customer,
      json: { inventoryItemIds: [ok.body.id, plain.id] },
      headers: { 'idempotency-key': `idv-${run}-1` },
    });
    expect(s.status).toBe(201);
    await h.prisma.cardProduct.update({ where: { tcgplayerProductId: pid }, data: { stampLabel: 'Cambiado', stampType: 'league' } });
    const o = await h.api<{ items: { inventoryItemId: string; version: { key: string; stamp: { type: string; label: string | null; productId: number } | null } }[] }>(
      'GET',
      `/orders/${s.body.orderId}`,
      { token: customer },
    );
    const liga = o.body.items.find((l) => l.inventoryItemId === ok.body.id)!;
    expect(liga.version.stamp).toEqual({ type: 'prize_pack', label: 'Cosmos Holo', productId: pid });
    expect(o.body.items.find((l) => l.inventoryItemId === plain.id)!.version.stamp).toBeNull();
  });

  it('IDS-B23: Destacadas solo (en, null); ficha con solo gradeadas ⇒ versions []; línea de deck sin carta ⇒ units []', async () => {
    const c = await card(3);
    await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: pid + 3, kind: 'stamped', name: `L3 ${run}`, finishes: ['normal'], stampType: 'prize_pack', sourceGroupId: 22880 } });
    await h.prisma.priceReference.create({
      data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: 70_000, capturedDate: today(), isManualOverride: true, refKind: 'market', cardProductId: (await h.prisma.cardProduct.findUniqueOrThrow({ where: { tcgplayerProductId: pid + 3 } })).id },
    });
    const en = await piece(c.id);
    const es = await piece(c.id, { language: 'es' });
    const lg = await piece(c.id, { cardProductId: pid + 3 });
    await lp.run('manual_price', [en.id, es.id, lg.id]);
    const cands = (await h.app.get(CatalogService).featuredCandidates()).filter((f) => f.cardId === c.id);
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' });
    // Ficha con solo gradeadas.
    const g = await card(4);
    await h.prisma.priceReference.create({
      data: { cardId: g.id, productType: 'graded', gradeKey: 'graded:PSA:10', finish: 'normal', source: 'manual', priceMxnCents: 400_000, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    const slab = await piece(g.id, { productType: 'graded', rawCondition: null, gradingCompany: 'PSA', gradeValue: '10', certNumber: `IDV-${run}` });
    await lp.run('manual_price', [slab.id]);
    const d = await h.api<{ listings: unknown[]; versions: unknown[] }>('GET', `/catalog/cards/${g.id}`);
    expect(d.body.listings.length).toBeGreaterThan(0);
    expect(d.body.versions).toEqual([]);
    // Línea de deck sin carta casada.
    const svc = h.app.get(DecksMetaService) as unknown as { buildLine: (l: unknown, u: Map<string, unknown[]>) => { units: unknown[]; availableQty: number } };
    const line = svc.buildLine(
      { rawName: 'Basic Fire Energy', rawSetCode: '', rawNumber: '', quantity: 4, group: MetaCardGroup.energy, matchStatus: MetaMatchStatus.unmatched_basic_energy, matchedCard: null },
      new Map(),
    );
    expect([line.availableQty, line.units]).toEqual([0, []]);
  });

  it('IDS-B17 ampliada: promo sin escalar tras publicar ni tras el barrido; con listPriceCents se publica a ese precio', async () => {
    const c = await card(5);
    await h.prisma.cardProduct.create({ data: { cardId: c.id, tcgplayerProductId: pid + 5, kind: 'promo', name: `Pr ${run}`, finishes: ['normal'] } });
    const p = await piece(c.id, { cardProductId: pid + 5, status: 'in_stock', firstListedAt: null });
    const listed = await piece(c.id, { cardProductId: pid + 5 });
    await h.app.get(InventoryService).reevaluateVariantsForPublication([{ cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' }]);
    expect((await h.prisma.inventoryItem.findUniqueOrThrow({ where: { id: p.id } })).status).toBe('in_stock');
    const set = await h.prisma.cardSet.findUniqueOrThrow({ where: { id: setId } });
    await (h.app.get(PriceIngestService) as unknown as { reconcilePublishedPrices: (s: unknown) => Promise<void> }).reconcilePublishedPrices(set);
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: c.id } })).toBe(0);
    // Respaldo manual: precio por pieza ⇒ se publica a ese precio.
    const r = await h.api('PATCH', `/admin/inventory/items/${p.id}`, { token: admin, json: { listPriceCents: 12_345, status: 'listed' } });
    expect(r.status).toBe(200);
    await lp.idle();
    await lp.run('manual_price', [p.id, listed.id]);
    const row = await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: p.id } });
    expect([row.status, row.listPriceCents]).toEqual(['priced', 12_345]);
    expect((await h.prisma.listingPrice.findUniqueOrThrow({ where: { inventoryItemId: listed.id } })).status).toBe('pending');
    expect(await h.prisma.pendingPriceEntry.count({ where: { cardId: c.id } })).toBe(0);
  });
});
