/**
 * ids-catalog.e2e-spec.ts — 💰 v1.116⟨ids⟩ (API_CONTRACT §IDS.5 tienda y §IDS.6 Meta decks) contra Postgres REAL y la app por
 * HTTP. Propiedad: backend.
 *  - IDS-B8 (520): cuatro versiones (una liga, un acabado) ⇒ `versions[]` de 4 en el orden de §IDS.5 y 4 tejas con
 *    `versionOptionKey` == el `optionKey` de su entrada; vender una española baja solo su `stockCount`; agotarla ⇒ 3 entradas.
 *  - IDS-B18 (D-IDS-5): Buddy-Buddy Poffin — base Normal + Reverse, Prize Pack Normal y «(Cosmos Holo)» Holofoil ⇒ `en`, `es`
 *    con `finishLabel null` + filas `non_holo` y `cosmos_holo` por PRECIO de fila (no por productId); liga con dos acabados ⇒
 *    dos entradas; cuerpo idéntico con `Accept-Language` es y en.
 *  - IDS-B15 (959): grupo español sin número de mercado ni `referenceDisplayCents`; `(en, P)` con la referencia de su producto.
 *  - Filtros `language`/`stamped` (521) y facetas.
 *  - IDS-B12 (963, 965, 966, 968): surtido de Meta deck — sin liga primero; liga solo si no alcanza; tramos por versión.
 * Deterministas (N=1).
 */
import { randomUUID } from 'crypto';
import { MetaCardGroup, MetaMatchStatus } from '@prisma/client';
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ListingPriceService } from '../../src/modules/pricing/listing-price.service';
import { CatalogService } from '../../src/modules/catalog/catalog.service';
import { DecksMetaService } from '../../src/modules/decks-meta/decks-meta.service';

jest.setTimeout(120_000);

type Opt = { optionKey: string; version: { key: string }; finish: string | null; finishLabel: string | null; fromPriceCents: number; stockCount: number };

describe('E2E — §IDS.5/.6 tienda y Meta decks por versión', () => {
  let h: E2EHarness;
  let lp: ListingPriceService;
  const run = randomUUID().slice(0, 8);
  const base = 400_000_000 + Math.floor(Math.random() * 90_000_000);
  const cardIds: string[] = [];
  let setId: string;
  let shelf: string | null;
  let seq = 0;
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function card(n: number, finishes: ('normal' | 'reverse_holo' | 'holofoil')[]) {
    const c = await h.prisma.card.create({
      data: { externalId: `idk-${run}-${n}`, setId, name: `Carta Tienda ${run} N${n}`, number: String(n), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: finishes },
    });
    cardIds.push(c.id);
    return c;
  }
  async function ref(cardId: string, finish: 'normal' | 'reverse_holo' | 'holofoil', cents: number, cpId: string | null = null) {
    await h.prisma.priceReference.create({
      data: { cardId, productType: 'raw', gradeKey: 'raw:NM', finish, source: 'manual', priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market', cardProductId: cpId },
    });
  }
  async function stamped(cardId: string, n: number, finishes: ('normal' | 'holofoil')[], label: string | null) {
    return h.prisma.cardProduct.create({
      data: { cardId, tcgplayerProductId: base + n, kind: 'stamped', name: `Liga ${run} ${n}`, finishes, stampType: 'prize_pack', stampLabel: label, sourceGroupId: 22880 },
    });
  }
  async function piece(cardId: string, data: Record<string, unknown> = {}) {
    seq += 1;
    return h.prisma.inventoryItem.create({
      data: {
        folio: `IDK-${run}-${String(seq).padStart(3, '0')}`,
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
  const priceAll = async (cardId: string) => {
    const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId }, select: { id: true } })).map((i) => i.id);
    await lp.run('manual_price', ids);
  };
  const detail = (cardId: string, lang = 'es') =>
    h.api<{ versions: Opt[]; listings: { version: { key: string; language: string }; referenceValue: { referenceMxnCents?: number }; referenceDisplayCents?: number; priceBasis: string }[] }>(
      'GET',
      `/catalog/cards/${cardId}`,
      { headers: { 'accept-language': lang } },
    );

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    lp = h.app.get(ListingPriceService);
    shelf = (await h.prisma.vaultLocation.findFirst({ where: { zone: 'platform_stock', isActive: true } }))?.id ?? null;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `idk-${run}`, name: `Set Tienda ${run}` } })).id;
  });

  afterAll(async () => {
    if (h) {
      await lp?.idle();
      const ids = (await h.prisma.inventoryItem.findMany({ where: { cardId: { in: cardIds } }, select: { id: true } })).map((i) => i.id);
      await h.prisma.inventoryItem.deleteMany({ where: { id: { in: ids } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.cardProduct.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('IDS-B8 (520): 4 versiones ⇒ versions[] de 4 en orden y 4 tejas con su versionOptionKey; vender/agotar la española', async () => {
    const c = await card(1, ['normal']);
    await ref(c.id, 'normal', 30_000);
    const cp = await stamped(c.id, 1, ['holofoil'], null);
    await ref(c.id, 'holofoil', 80_000, cp.id);
    await piece(c.id);
    const es1 = await piece(c.id, { language: 'es' });
    const es2 = await piece(c.id, { language: 'es' });
    await piece(c.id, { cardProductId: base + 1, finish: 'holofoil' });
    await piece(c.id, { language: 'es', cardProductId: base + 1, finish: 'holofoil' });
    await priceAll(c.id);
    const d = await detail(c.id);
    expect(d.status).toBe(200);
    expect(d.body.versions.map((v) => v.optionKey)).toEqual(['en', 'es', `en.${base + 1}.holofoil`, `es.${base + 1}.holofoil`]);
    const es = d.body.versions.find((v) => v.optionKey === 'es')!;
    expect(es.stockCount).toBe(2);
    const grid = await h.api<{ data: { versionOptionKey: string; version: { key: string }; finishLabel: string }[] }>('GET', `/catalog/cards?q=${encodeURIComponent(`Tienda ${run} N1`)}&pageSize=50`);
    expect(grid.body.data.map((t) => t.versionOptionKey).sort()).toEqual(d.body.versions.map((v) => v.optionKey).sort());
    await h.prisma.inventoryItem.update({ where: { id: es1.id }, data: { status: 'in_custody' } });
    const d2 = await detail(c.id);
    expect(d2.body.versions.find((v) => v.optionKey === 'es')!.stockCount).toBe(1);
    expect(d2.body.versions.find((v) => v.optionKey === 'en')!.stockCount).toBe(1);
    await h.prisma.inventoryItem.update({ where: { id: es2.id }, data: { status: 'in_custody' } });
    const d3 = await detail(c.id);
    expect(d3.body.versions.map((v) => v.optionKey)).toEqual(['en', `en.${base + 1}.holofoil`, `es.${base + 1}.holofoil`]);
    // Filtros (521): language y stamped.
    const onlyEs = await h.api<{ data: { version: { key: string } }[] }>('GET', `/catalog/cards?q=${encodeURIComponent(`Tienda ${run} N1`)}&language=es`);
    expect(onlyEs.body.data.map((t) => t.version.key)).toEqual([`es.${base + 1}`]);
    const onlyLiga = await h.api<{ data: { version: { key: string } }[] }>('GET', `/catalog/cards?q=${encodeURIComponent(`Tienda ${run} N1`)}&stamped=true`);
    expect(onlyLiga.body.data.map((t) => t.version.key).sort()).toEqual([`en.${base + 1}`, `es.${base + 1}`]);
    const bad = await h.api('GET', `/catalog/cards?language=ja`);
    expect(bad.status).toBe(400);
  });

  it('IDS-B18: Poffin — en/es sin acabado + filas non_holo y cosmos_holo por precio de fila; dos acabados ⇒ dos entradas; idéntico en es/en', async () => {
    const c = await card(144, ['normal', 'reverse_holo']);
    await ref(c.id, 'normal', 600);
    await ref(c.id, 'reverse_holo', 1_800);
    // 565451-equivalente (productId MENOR, más CARO) y 703819-equivalente Cosmos (productId MAYOR, más BARATO).
    const pp = await stamped(c.id, 10, ['normal'], null);
    const cosmos = await stamped(c.id, 20, ['holofoil'], 'Cosmos Holo');
    const two = await stamped(c.id, 30, ['normal', 'holofoil'], 'Left Stamp');
    await ref(c.id, 'normal', 90_000, pp.id);
    await ref(c.id, 'holofoil', 20_000, cosmos.id);
    await ref(c.id, 'normal', 150_000, two.id);
    await ref(c.id, 'holofoil', 160_000, two.id);
    for (const f of ['normal', 'reverse_holo'] as const) {
      await piece(c.id, { finish: f });
      await piece(c.id, { finish: f, language: 'es' });
    }
    await piece(c.id, { cardProductId: base + 10 });
    await piece(c.id, { cardProductId: base + 20, finish: 'holofoil' });
    await piece(c.id, { cardProductId: base + 30, finish: 'normal' });
    await piece(c.id, { cardProductId: base + 30, finish: 'holofoil' });
    await priceAll(c.id);
    const es = await detail(c.id, 'es');
    const en = await detail(c.id, 'en');
    expect(JSON.stringify(es.body.versions)).toBe(JSON.stringify(en.body.versions));
    const v = es.body.versions;
    expect(v.map((o) => [o.optionKey, o.finishLabel])).toEqual([
      ['en', null],
      ['es', null],
      [`en.${base + 20}.holofoil`, 'cosmos_holo'],
      [`en.${base + 10}.normal`, 'non_holo'],
      [`en.${base + 30}.normal`, 'non_holo'],
      [`en.${base + 30}.holofoil`, 'holo'],
    ]);
  });

  it('IDS-B15 (959): grupo español sin número de mercado ni referenceDisplayCents; (en, P) con la referencia de su producto', async () => {
    const c = await card(7, ['normal']);
    await ref(c.id, 'normal', 30_000);
    const cp = await stamped(c.id, 7, ['normal'], null);
    await ref(c.id, 'normal', 77_000, cp.id);
    await piece(c.id, { language: 'es' });
    await piece(c.id, { cardProductId: base + 7 });
    await priceAll(c.id);
    const d = await detail(c.id);
    const esGroup = d.body.listings.find((l) => l.version.key === 'es')!;
    expect(esGroup.referenceValue.referenceMxnCents).toBeUndefined();
    expect(esGroup.referenceDisplayCents).toBeUndefined();
    const enP = d.body.listings.find((l) => l.version.key === `en.${base + 7}`)!;
    expect(enP.priceBasis).toBe('market');
    expect(enP.referenceValue.referenceMxnCents).toBe(77_000);
    // IDS-B21: con piezas `en`, `es` y de liga publicadas ⇒ ['en','es'] y `true` (sin conteos).
    const facets = await h.api<{ languages: string[]; stamped: boolean }>('GET', '/catalog/facets');
    expect(facets.body.languages).toEqual(['en', 'es']);
    expect(facets.body.stamped).toBe(true);
  });

  it('IDS-B12 (963, 965, 966, 968): surtido sin liga primero; liga solo si no alcanza; tramos por versión; sin precio no cuenta', async () => {
    const c = await card(99, ['normal']);
    await ref(c.id, 'normal', 40_000);
    const cp = await stamped(c.id, 99, ['normal'], null);
    await ref(c.id, 'normal', 1_000, cp.id); // la de liga es la MÁS BARATA: ordenar solo por precio la pondría primero
    const en = await piece(c.id);
    const es = await piece(c.id, { language: 'es' });
    const liga = await piece(c.id, { cardProductId: base + 99 });
    const sinPrecio = await piece(c.id, { language: 'es', finish: 'normal', cardProductId: null, rawCondition: 'NM', status: 'listed' });
    await priceAll(c.id);
    await h.prisma.listingPrice.update({
      where: { inventoryItemId: sinPrecio.id },
      data: { status: 'pending', unitPriceCents: null, listPriceCents: null, priceBasis: null, marketMxnCents: null, fixedDisplayCents: null },
    });
    const units = await h.app.get(CatalogService).getSellableRawUnitsByCardIds([c.id]);
    const svc = h.app.get(DecksMetaService) as unknown as { buildLine: (l: unknown, u: typeof units) => { availableQty: number; unitInventoryItemIds: string[]; unitPriceMxnCents: number | null; units: { version: { key: string }; qty: number; unitPriceMxnCents: number | null; inventoryItemIds: string[] }[] } };
    const line = (quantity: number) =>
      svc.buildLine(
        { rawName: 'X', rawSetCode: '', rawNumber: '', quantity, group: MetaCardGroup.pokemon, matchStatus: MetaMatchStatus.matched, matchedCard: { ...c, set: { name: 'S' } } },
        units,
      );
    const four = line(4);
    expect(four.availableQty).toBe(3);
    // Español (40 000 × 75 %) más barato que el inglés; la de liga, aunque es la más barata, al final.
    expect(four.unitInventoryItemIds).toEqual([es.id, en.id, liga.id]);
    expect(four.unitInventoryItemIds).not.toContain(sinPrecio.id);
    expect(four.units.map((u) => u.version.key)).toEqual([...new Set(four.units.map((u) => u.version.key))]);
    expect(four.units.map((u) => u.qty).reduce((a, b) => a + b, 0)).toBe(3);
    expect(four.units[four.units.length - 1].version.key).toBe(`en.${base + 99}`);
    const two = line(2);
    expect(two.unitInventoryItemIds).not.toContain(liga.id);
    expect(two.unitInventoryItemIds.sort()).toEqual([en.id, es.id].sort());
    expect(two.unitPriceMxnCents).toBe(two.units[0].unitPriceMxnCents);
  });
});
