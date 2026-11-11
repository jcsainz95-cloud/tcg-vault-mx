import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { MerchantFeedService } from '../src/modules/catalog/merchant-feed.service';
import {
  MERCHANT_CATEGORY,
  buildMerchantFeed,
  clipText,
  merchantShippingCents,
  merchantPathOf,
  sealedMerchantId,
  plainText,
  type MerchantFeedRaw,
} from '../src/modules/catalog/merchant-feed';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SetValueService } from '../src/modules/catalog/set-value.service';
import { DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';
import { computeSealedSalePrice } from '../src/common/money';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * §GSHOP.B (docs/specs/GOOGLE_SHOPPING_E_INDEXACION.md) — `GET /catalog/merchant-feed`: feed para Google Merchant Center.
 * Candados: (1) PARIDAD k/N: el precio del feed = el `displayPriceCents` que la ficha exhibe (carta: publicación más barata;
 * sellado: `fromPriceCents` del grupo); (2) condición = la de `jsonLdItemCondition`; (3) exclusiones automáticas; (4) 503 sin ítems;
 * (5) envío con la regla viva (MX$100 cartas, gratis desde MX$4,000); (6) nada privado (folio, costo, dueño, `L`).
 */

const CARD = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  externalId: 'sv8-1',
  name: 'Pikachu',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Illustration Rare',
  rarityCanonical: 'illustration_rare',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's1',
  imageSmallUrl: 'https://images.pokemontcg.io/sv8/1.png',
  imageLargeUrl: 'https://images.pokemontcg.io/sv8/1_hires.png',
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' },
  ...over,
});

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  cardId: 'c1',
  productType: 'raw',
  rawCondition: 'NM',
  sealedSubtype: null,
  sealedCondition: null,
  sealedProductName: null,
  sealedImageUrl: null,
  sealedProductId: null,
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  status: 'listed',
  finish: 'normal',
  ownerType: 'platform',
  folio: 'INV-000001',
  listPriceCents: null,
  tcgplayerProductId: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  updatedAt: new Date('2026-10-10T00:00:00Z'),
  card: CARD(),
  ...over,
});

const SEALED = (over: Record<string, unknown> = {}) =>
  ITEM({
    id: 's1',
    productType: 'sealed',
    rawCondition: null,
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    sealedProductName: 'Surging Sparks Booster Box',
    sealedImageUrl: 'https://images.pokemontcg.io/sealed/surging-sparks-box.png',
    tcgplayerProductId: 555,
    listPriceCents: null,
    updatedAt: new Date('2026-10-12T00:00:00Z'),
    ...over,
  });

const MARKET = 100000;

function pricingMock() {
  return {
    loadSalePremiumFloorPolicy: jest.fn(async () => DEFAULT_SALE_PREMIUM_FLOOR_POLICY),
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadGradedEstimateConfig: jest.fn(async () => DISABLED_GRADED_ESTIMATE_CONFIG),
    getGradedEstimatesBatch: jest.fn(async () => new Map()),
    getPublishedSlabGradesBatch: jest.fn(async () => new Map()),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    // v1.114 (§DYN.5.9): sin caso de revisión vigente ⇒ la entrada del cuerpo de venta no cambia.
    saleRetentionFor: jest.fn(async () => new Map()),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn((i: { productType: string; rawCondition?: string }) =>
      i.productType === 'raw' ? `raw:${i.rawCondition ?? 'NM'}` : 'graded:PSA:10',
    ),
    tryGradeKeyFor: jest.fn((i: { productType: string; rawCondition?: string }) =>
      i.productType === 'raw' ? `raw:${i.rawCondition ?? 'NM'}` : 'graded:PSA:10',
    ),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: MARKET })),
    getReferencesBatch: jest.fn(async (items: Array<Record<string, unknown>>) => {
      const m = new Map<string, unknown>();
      for (const it of items) {
        m.set(`${it.cardId}|${it.productType}|${it.gradeKey}|${it.finish}`, {
          status: 'priced',
          referenceMxnCents: MARKET,
        });
      }
      return m;
    }),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    gateSealedMarketCents: (ref: { status?: string; referenceMxnCents?: number } | undefined, on: boolean) =>
      on && ref?.status === 'priced' ? (ref.referenceMxnCents ?? null) : null,
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: true })),
    sealedMarketGradeKeyForItem: jest.fn((i: { tcgplayerProductId: number | null }) =>
      i.tcgplayerProductId != null ? `sealed:tcg:${i.tcgplayerProductId}` : null,
    ),
    resolveSealedSalePrice: (
      item: { listPriceCents: number | null; sealedSubtype: string | null },
      ref: { status?: string; referenceMxnCents?: number } | undefined,
      ctx: { sourceOn: boolean; spreadPctBySubtype: Record<string, number>; fallbackPct: number },
    ) =>
      computeSealedSalePrice(
        item.listPriceCents,
        item.sealedSubtype as never,
        ctx.sourceOn && ref?.status === 'priced' ? (ref.referenceMxnCents ?? null) : null,
        ctx.spreadPctBySubtype,
        ctx.fallbackPct,
      ),
  } as unknown as PricingService;
}

const settingsStub = () =>
  ({
    getBool: jest.fn(async () => false),
    getNumber: jest.fn(async () => 0),
    getString: jest.fn(async () => 'off'),
    ...ivaDialsStub(),
  }) as unknown as SettingsService;


const SHIP = { cardsOnlyFeeCents: 10000, sealedFeeCents: 17500, freeFromCents: 400000 };

function stack(items: Array<Record<string, unknown>>, settings: Record<string, number> = {}) {
  const prisma = {
    inventoryItem: {
      findMany: jest.fn(async (args: { where?: { productType?: unknown; cardId?: unknown } }) => {
        const sealedQ = args?.where?.productType === 'sealed';
        const byCard = typeof args?.where?.cardId === 'string' ? args.where.cardId : null;
        return items.filter((i) => (sealedQ ? i.productType === 'sealed' : i.productType !== 'sealed') && (byCard == null || i.cardId === byCard));
      }),
      count: jest.fn(async () => items.length),
      findFirst: jest.fn(async (a: { where?: { id?: string } }) => items.find((i) => i.productType === 'sealed' && (a?.where?.id == null || i.id === a.where.id))),
    },
    card: { findUnique: jest.fn(async (a: { where: { id: string } }) => (items.find((i) => (i.card as { id: string }).id === a.where.id) as { card: unknown } | undefined)?.card ?? null) },
    sealedProduct: { findMany: jest.fn(async () => []) },
  } as unknown as PrismaService;
  const catalog = new CatalogService(prisma, pricingMock(), ivaDialsStub() as never);
  const sealed = new SealedCatalogService(prisma, pricingMock(), settingsStub(), catalog);
  const settingsSvc = {
    getNumber: jest.fn(async (k: string) =>
      k === SettingKey.DIRECT_SHIP_CARDS_FEE_CENTS ? (settings.cards ?? SHIP.cardsOnlyFeeCents)
      : k === SettingKey.DIRECT_SHIP_SEALED_FEE_CENTS ? (settings.sealed ?? SHIP.sealedFeeCents)
      : (settings.free ?? SHIP.freeFromCents)),
  } as unknown as SettingsService;
  const feed = new MerchantFeedService(catalog, sealed, settingsSvc);
  const controller = new CatalogController(catalog, {} as unknown as SetValueService, sealed, undefined, feed);
  return { catalog, sealed, feed, controller };
}

const res = () => {
  const headers: Record<string, string> = {};
  let status = 200;
  return { headers, get status() { return status; }, status_: (s: number) => { status = s; }, r: { status: (s: number) => { status = s; }, setHeader: (k: string, v: string) => { headers[k] = v; } } };
};

describe('§GSHOP.B — piezas puras', () => {
  const raw = (over: Partial<MerchantFeedRaw> = {}): MerchantFeedRaw => ({ kind: 'card', refId: 'c1', title: 'Pikachu · 1 · Set · Carta Pokémon', description: 'd', imageUrl: 'https://img.example/x.png', priceCents: 12345, ...over });

  it('envío: cartas MX$100, sellado MX$175, gratis desde MX$4,000 (igual que shippingDetailsJsonLd)', () => {
    expect(merchantShippingCents('card', 399999, SHIP)).toBe(10000);
    expect(merchantShippingCents('card', 400000, SHIP)).toBe(0);
    expect(merchantShippingCents('sealed', 100, SHIP)).toBe(17500);
    expect(merchantShippingCents('sealed', 400000, SHIP)).toBe(0);
  });

  it('exclusiones automáticas: precio ≤ 0 / no entero / nulo, sin título, sin imagen https; se cuentan', () => {
    const r = buildMerchantFeed(
      [raw(), raw({ refId: 'a', priceCents: 0 }), raw({ refId: 'b', priceCents: -5 }), raw({ refId: 'c', priceCents: 10.5 }), raw({ refId: 'd', priceCents: null }),
       raw({ refId: 'e', title: '   ' }), raw({ refId: 'f', imageUrl: null }), raw({ refId: 'g', imageUrl: '/rel.png' }), raw({ refId: 'h', imageUrl: 'http://x/y.png' }), raw({ refId: 'c1' })],
      SHIP,
    );
    expect(r.items.map((i) => i.id)).toEqual(['card:c1']);
    expect(r.skipped).toBe(9);
  });

  it('campos: condición new/used, marca, sin GTIN ⇒ identifierExists:false, categoría, devoluciones, ruta sin locale', () => {
    const r = buildMerchantFeed([raw({ kind: 'sealed', refId: 'x y' }), raw()], SHIP).items;
    const s = r.find((i) => i.kind === 'sealed')!;
    const c = r.find((i) => i.kind === 'card')!;
    expect(s.condition).toBe('new');
    expect(c.condition).toBe('used');
    expect(s.path).toBe('/sellado/x%20y');
    expect(c.path).toBe('/catalog/c1');
    for (const i of r) {
      expect(i).toMatchObject({ brand: 'Pokémon', gtin: null, identifierExists: false, availability: 'in_stock', returns: 'not_permitted', googleProductCategory: MERCHANT_CATEGORY });
    }
  });

  it('texto: sin HTML ni controles XML, título ≤ 150 y descripción ≤ 5000 por puntos de código', () => {
    expect(plainText('Hola\u0000 \u0008mundo\n\n  x')).toBe('Hola mundo x');
    // GS-5: el nombre se conserva íntegro (lo escapa el front al armar el XML)
    expect(plainText(`Farfetch'd & <Mr. "Mime">`)).toBe(`Farfetch'd & <Mr. "Mime">`);
    expect(Array.from(clipText('😀'.repeat(200), 150))).toHaveLength(150);
    const i = buildMerchantFeed([raw({ title: 'T'.repeat(400), description: 'D'.repeat(9000) })], SHIP).items[0];
    expect(i.title.length).toBeLessThanOrEqual(150);
    expect(i.description.length).toBeLessThanOrEqual(5000);
  });
});

describe('§GSHOP.B — paridad con la ficha (k/N) y nada privado', () => {
  const cards = Array.from({ length: 6 }, (_, n) => n + 1);
  const mk = () => {
    const items: Array<Record<string, unknown>> = [];
    for (const n of cards) {
      const card = CARD({ id: `c${n}`, name: `Carta ${n}`, number: String(n) });
      // dos piezas por carta con precios distintos: la ficha exhibe la más barata
      items.push(ITEM({ id: `i${n}a`, cardId: `c${n}`, card, listPriceCents: 9000 + n * 1000, folio: `INV-A${n}` }));
      items.push(ITEM({ id: `i${n}b`, cardId: `c${n}`, card, listPriceCents: 20000 + n * 1000, rawCondition: 'NM', folio: `INV-B${n}` }));
    }
    items.push(SEALED({ id: 's1', listPriceCents: 150000 }));
    items.push(SEALED({ id: 's2', tcgplayerProductId: 777, sealedProductName: 'Otra caja', listPriceCents: 450000 }));
    return items;
  };

  it('PARIDAD k/N: price del feed = displayPriceCents más barato de la ficha (carta) y fromPriceCents (sellado)', async () => {
    const { catalog, sealed, feed } = stack(mk());
    const out = await feed.build();
    let ok = 0;
    let total = 0;
    for (const n of cards) {
      const detail = await catalog.getCard(`c${n}`);
      const cheapest = Math.min(...detail.listings.map((l) => l.displayPriceCents));
      total += 1;
      if (out.items.find((i) => i.id === `card:c${n}`)?.priceCents === cheapest) ok += 1;
    }
    for (const id of ['s1', 's2']) {
      const d = await sealed.sealedDetail(id);
      total += 1;
      if (out.items.find((i) => i.path === `/sellado/${id}`)?.priceCents === d.group.fromPriceCents) ok += 1;
    }
    // eslint-disable-next-line no-console
    console.log(`PARIDAD feed↔ficha: ${ok}/${total}`);
    expect(total).toBe(8);
    expect(ok).toBe(total);
  });

  it('una fila por ficha; condición carta=used, sellado=new; envío por regla; ítems ordenados por id', async () => {
    const { feed } = stack(mk());
    const out = await feed.build();
    expect(out.items).toHaveLength(8);
    expect(out.items.map((i) => i.id)).toEqual([...out.items.map((i) => i.id)].sort());
    expect(out.items.filter((i) => i.kind === 'card').every((i) => i.condition === 'used' && i.shippingCents === 10000)).toBe(true);
    const boxes = out.items.filter((i) => i.kind === 'sealed');
    expect(boxes.every((b) => b.condition === 'new')).toBe(true);
    expect(boxes.find((b) => b.path === '/sellado/s1')!.shippingCents).toBe(0 + (boxes.find((b) => b.path === '/sellado/s1')!.priceCents >= SHIP.freeFromCents ? 0 : 17500));
    expect(boxes.find((b) => b.path === '/sellado/s2')!.shippingCents).toBe(0); // 4,500 ≥ umbral ⇒ gratis
  });

  it('el umbral de envío gratis sigue al dial vivo (no un importe a mano)', async () => {
    const { feed } = stack(mk(), { free: 1 });
    const out = await feed.build();
    expect(out.items.every((i) => i.shippingCents === 0)).toBe(true);
  });

  it('⛔ nada privado: ni folio, ni costo, ni dueño, ni L, ni estado en la respuesta', async () => {
    const { feed } = stack(mk());
    const body = JSON.stringify((await feed.build()).items);
    expect(body).not.toMatch(/INV-|folio|acquisition|cost|ownerUser|ownerType|listPrice|status|margin|certNumber|inventoryItemId/i);
  });

  it('carta sin imagen absoluta ⇒ se omite y se cuenta', async () => {
    const items = mk();
    items.push(ITEM({ id: 'ix', cardId: 'cx', card: CARD({ id: 'cx', imageLargeUrl: null, imageSmallUrl: null }), listPriceCents: 5000 }));
    const { feed } = stack(items);
    const out = await feed.build();
    expect(out.items.find((i) => i.id === 'card:cx')).toBeUndefined();
    expect(out.skipped).toBeGreaterThanOrEqual(1);
  });
});

describe('§GSHOP.B — controlador: cabeceras, caché y 503', () => {
  it('con ítems: 200, X-Feed-Items = N, Cache-Control público, cuerpo { items, generatedAt }', async () => {
    const { controller } = stack([ITEM({ listPriceCents: 10000 })]);
    const r = res();
    const body = (await controller.merchantFeedGet(r.r as never)) as { items: unknown[]; generatedAt: string };
    expect(r.status).toBe(200);
    expect(body.items).toHaveLength(1);
    expect(r.headers['X-Feed-Items']).toBe('1');
    expect(r.headers['X-Feed-Skipped']).toBe('0');
    expect(r.headers['Cache-Control']).toMatch(/^public, /);
    expect(body.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('sin ítems vendibles: 503 (nunca un 200 vacío), no-store y X-Feed-Items: 0', async () => {
    const { controller } = stack([]);
    const r = res();
    const body = await controller.merchantFeedGet(r.r as never);
    expect(r.status).toBe(503);
    expect(r.headers['Cache-Control']).toBe('no-store');
    expect(r.headers['X-Feed-Items']).toBe('0');
    expect(body).toEqual({ ok: false });
  });

  it('todos los ítems excluidos (sin imagen) ⇒ también 503', async () => {
    const { controller } = stack([ITEM({ listPriceCents: 10000, card: CARD({ imageLargeUrl: null, imageSmallUrl: null }) })]);
    const r = res();
    await controller.merchantFeedGet(r.r as never);
    expect(r.status).toBe(503);
    expect(r.headers['X-Feed-Skipped']).toBe('1');
  });
});

describe('§GSHOP — g:id de sellado estable, caché de servidor, guarda de ruta', () => {
  it('g:id sellado = s:+base64url(16 B de SHA-256 del groupKey), ≤ 50; no depende del representante', () => {
    const id = sealedMerchantId('p:555:mint');
    expect(id).toMatch(/^s:[A-Za-z0-9_-]{22}$/);
    expect(id.length).toBeLessThanOrEqual(50);
    const a = buildMerchantFeed([{ kind: 'sealed', refId: 'rep-1', groupKey: 'p:555:mint', title: 'T', description: null, imageUrl: 'https://x/y.png', priceCents: 100 }], SHIP).items[0];
    const b = buildMerchantFeed([{ kind: 'sealed', refId: 'rep-2', groupKey: 'p:555:mint', title: 'T', description: null, imageUrl: 'https://x/y.png', priceCents: 50 }], SHIP).items[0];
    expect(a.id).toBe(id);
    expect(b.id).toBe(id); // se vendió/abarató la representante: mismo id
    expect(a.path).toBe('/sellado/rep-1');
    expect(b.path).toBe('/sellado/rep-2');
  });

  it('sellado: vender la representante (más barata) no cambia el g:id del grupo (servicio real)', async () => {
    const before = await stack([SEALED({ id: 's1', listPriceCents: 150000 }), SEALED({ id: 's1b', listPriceCents: 120000 })]).feed.build();
    const after = await stack([SEALED({ id: 's1', listPriceCents: 150000 })]).feed.build();
    expect(before.items).toHaveLength(1);
    expect(before.items[0].path).toBe('/sellado/s1b');
    expect(after.items[0].path).toBe('/sellado/s1');
    expect(after.items[0].id).toBe(before.items[0].id);
  });

  it('merchantPathOf: sustituto suelto (URIError) no revienta el feed; el ítem se omite', () => {
    expect(merchantPathOf('card', '\uD800')).toBe('');
    const r = buildMerchantFeed([{ kind: 'card', refId: '\uD800', title: 'T', description: null, imageUrl: 'https://x/y.png', priceCents: 100 }], SHIP);
    expect(r.items).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('caché de servidor 5 min: una sola consulta por ventana; 0 ítems no se cachea; cabecera 60/300/300', async () => {
    const items = [ITEM({ listPriceCents: 10000 })];
    const { feed, catalog, controller } = stack(items);
    const spy = jest.spyOn(catalog, 'merchantFeedCardRows');
    await feed.build();
    await feed.build();
    expect(spy).toHaveBeenCalledTimes(1);
    const r = res();
    await controller.merchantFeedGet(r.r as never);
    expect(r.headers['Cache-Control']).toBe('public, max-age=60, s-maxage=300, stale-while-revalidate=300');
    const empty = stack([]);
    const spy2 = jest.spyOn(empty.catalog, 'merchantFeedCardRows');
    await empty.feed.build();
    await empty.feed.build();
    expect(spy2).toHaveBeenCalledTimes(2);
  });

  it('caché del sitemap: segunda llamada no vuelve a consultar', async () => {
    const { controller, catalog } = stack([ITEM({ listPriceCents: 10000 })]);
    const spy = jest.spyOn(catalog, 'sitemapCardEntries');
    await controller.sitemap();
    await controller.sitemap();
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
