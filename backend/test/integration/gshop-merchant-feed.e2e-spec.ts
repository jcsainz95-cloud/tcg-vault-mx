/**
 * §GSHOP.B (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md) — `GET /catalog/merchant-feed` por HTTP contra Postgres REAL: público (sin sesión), solo lectura,
 * misma regla de «vendible» que el sitemap, precio = el que exhibe la ficha (k/N sobre TODO el feed), cabeceras `X-Feed-Items`/`X-Feed-Skipped`,
 * nada privado. Mutaciones que deben ponerlo rojo: precio del feed ≠ `displayPriceCents` de la ficha; incluir piezas no `listed`/de cliente;
 * filtrar `folio`/costo; 200 vacío sin ítems.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

jest.setTimeout(180_000);

type FeedItem = { id: string; kind: 'card' | 'sealed'; path: string; priceCents: number; condition: string; imageUrl: string; title: string; shippingCents: number };

describe('E2E — §GSHOP.B feed de Merchant', () => {
  let h: E2EHarness;
  const run = randomUUID().slice(0, 8);
  let setId: string;
  const cardIds: string[] = [];
  let ownerId: string;
  const today = () => new Date(new Date().toISOString().slice(0, 10));

  async function card(n: number, cents: number, listedCents: number[], status: 'listed' | 'in_stock' = 'listed', ownerType: 'platform' | 'customer' = 'platform') {
    const c = await h.prisma.card.create({
      data: { externalId: `gs-${run}-${n}`, setId, name: `Carta GS ${run} ${n}`, number: String(n), rarity: 'Common', rarityCanonical: 'Common', availableFinishes: ['normal'], imageLargeUrl: `https://images.example/gs-${run}-${n}.png` },
    });
    cardIds.push(c.id);
    await h.prisma.priceReference.create({
      data: { cardId: c.id, productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', source: 'manual', priceMxnCents: cents, capturedDate: today(), isManualOverride: true, refKind: 'market' },
    });
    let k = 0;
    for (const lp of listedCents) {
      k += 1;
      await h.prisma.inventoryItem.create({
        data: { folio: `GS-${run}-${n}-${k}`, cardId: c.id, productType: 'raw', rawCondition: 'NM', finish: 'normal', ownerType, ...(ownerType === 'customer' ? { ownerUserId: ownerId } : {}), status, acquisitionType: 'compra', acquisitionCostCents: 1111, firstListedAt: new Date(), listPriceCents: lp },
      });
    }
    return c.id;
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    ownerId = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).id;
    setId = (await h.prisma.cardSet.create({ data: { externalId: `gs-${run}`, name: `Set GS ${run}` } })).id;
  });
  afterAll(async () => {
    if (h) {
      await h.prisma.inventoryItem.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.priceReference.deleteMany({ where: { cardId: { in: cardIds } } });
      await h.prisma.card.deleteMany({ where: { id: { in: cardIds } } });
      await h.prisma.cardSet.deleteMany({ where: { id: setId } });
      await h.close();
    }
  });

  it('público, sin sesión: 200, cabeceras, caché; solo cartas vendibles; precio = ficha en k/N; nada privado', async () => {
    const a = await card(1, 30_000, [30_000, 45_000]); // dos piezas: la ficha exhibe la más barata
    const b = await card(2, 80_000, [80_000]);
    const unlisted = await card(3, 30_000, [30_000], 'in_stock'); // sin publicar ⇒ no
    const own = await card(4, 30_000, [30_000], 'listed', 'customer'); // de cliente ⇒ no
    const r = await h.api<{ items: FeedItem[]; generatedAt: string }>('GET', '/catalog/merchant-feed');
    expect(r.status).toBe(200);
    expect(r.headers['x-feed-items']).toBe(String(r.body.items.length));
    expect(r.headers['x-feed-skipped']).toMatch(/^\d+$/);
    expect(String(r.headers['cache-control'])).toMatch(/^public/);
    const ids = new Set(r.body.items.map((i) => i.id));
    expect(ids.has(`card:${a}`) && ids.has(`card:${b}`)).toBe(true);
    expect(ids.has(`card:${unlisted}`) || ids.has(`card:${own}`)).toBe(false);

    // k/N: cada ítem del feed contra la ficha pública que Google verá
    let ok = 0;
    let n = 0;
    for (const it of r.body.items) {
      n += 1;
      if (it.kind === 'card') {
        const d = await h.api<{ listings: { displayPriceCents: number }[] }>('GET', `/catalog/cards/${it.id.slice('card:'.length)}`);
        if (d.status === 200 && it.priceCents === Math.min(...d.body.listings.map((l) => l.displayPriceCents)) && it.condition === 'used') ok += 1;
      } else {
        const d = await h.api<{ group: { fromPriceCents: number } }>('GET', `/catalog/sealed/${decodeURIComponent(it.path.slice('/sellado/'.length))}`);
        if (d.status === 200 && it.priceCents === d.body.group.fromPriceCents && it.condition === 'new') ok += 1;
      }
    }
    // eslint-disable-next-line no-console
    console.log(`PARIDAD feed↔ficha (HTTP): ${ok}/${n}`);
    expect(n).toBeGreaterThanOrEqual(2);
    expect(ok).toBe(n);

    // misma regla que el sitemap: todo ítem del feed está en el sitemap
    const sm = await h.api<{ items: { type: string; id: string }[] }>('GET', '/catalog/sitemap');
    const smPaths = new Set(sm.body.items.map((i) => `${i.type === 'card' ? '/catalog/' : '/sellado/'}${encodeURIComponent(i.id)}`));
    expect(r.body.items.every((i) => smPaths.has(i.path))).toBe(true);

    // nada privado
    expect(r.text).not.toMatch(/GS-[a-z0-9]+-\d/); // folios de mis piezas (mayúsculas; la imagen usa minúsculas)
    expect(r.text).not.toMatch(/folio|acquisition|ownerUser|ownerType|listPriceCents|certNumber|inventoryItemId/i);
    for (const it of r.body.items) {
      expect(it.imageUrl).toMatch(/^https:\/\//);
      expect(it.shippingCents).toBeGreaterThanOrEqual(0);
    }
  });
});
