import { CatalogController } from '../src/modules/catalog/catalog.controller';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SetValueService } from '../src/modules/catalog/set-value.service';
import { DEFAULT_PRICING_CURVE, DEFAULT_SALE_PREMIUM_FLOOR_POLICY } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';
import { computeSealedSalePrice } from '../src/common/money';
import { toMexicoCityDateKey } from '../src/common/business-days';
import { ivaDialsStub } from './helpers/iva-dials';

/**
 * v1.96⟨mkt-tienda⟩ OLA 1 (§MKT.A ficha/og, §MKT.B sitemap · ARCHITECTURE §13.2/§13.3) — los deltas de
 * backend de la tienda-marketing:
 *   A3/A4 — `pricedAsOf` (fecha CDMX honesta bajo ISR) y `ogImageUrl` (URL ABSOLUTA) en la ficha de carta
 *           y en `SealedGroupDTO` (⛔ no en las rejillas).
 *   E/SEO — `GET /catalog/sitemap`: una entrada por ficha a la venta (cartas + sellado), `{type,id,lastmod}`.
 *
 * ⚠️ El TAMAÑO ≥1200×630 de `ogImageUrl` NO se afirma aquí (backend no descarga la imagen; BACKEND_NOTES Q1).
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/; // YYYY-MM-DD
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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

describe('§MKT.A — ficha de CARTA: pricedAsOf + ogImageUrl (A3/A4)', () => {
  function build(items: Array<Record<string, unknown>>, card = CARD()) {
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
      card: { findUnique: jest.fn(async () => card) },
    } as unknown as PrismaService;
    return new CatalogService(prisma, pricingMock(), ivaDialsStub() as never);
  }

  it('emite `pricedAsOf` = la fecha CDMX de HOY (YYYY-MM-DD), no now() del cliente', async () => {
    const detail = await build([ITEM()]).getCard('c1');
    expect(detail.pricedAsOf).toMatch(ISO_DATE);
    expect(detail.pricedAsOf).toBe(toMexicoCityDateKey(new Date()));
  });

  it('`ogImageUrl` es ABSOLUTA y PREFIERE la imagen grande sobre la pequeña', async () => {
    const detail = await build([ITEM()]).getCard('c1');
    expect(detail.ogImageUrl).toBe('https://images.pokemontcg.io/sv8/1_hires.png');
  });

  it('sin imagen grande, cae a la pequeña absoluta', async () => {
    const detail = await build([ITEM()], CARD({ imageLargeUrl: null })).getCard('c1');
    expect(detail.ogImageUrl).toBe('https://images.pokemontcg.io/sv8/1.png');
  });

  it('con imagen RELATIVA o ausente, `ogImageUrl` es null (⇒ frontend omite og:image)', async () => {
    const detail = await build([ITEM()], CARD({ imageLargeUrl: '/rel.png', imageSmallUrl: null })).getCard('c1');
    expect(detail.ogImageUrl).toBeNull();
  });
});

describe('§MKT.A — ficha de SELLADO: pricedAsOf + ogImageUrl', () => {
  function buildSealed(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async () => items),
        count: jest.fn(async () => items.length),
        findFirst: jest.fn(async () => items[0]),
      },
      sealedProduct: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    return new SealedCatalogService(
      prisma,
      pricingMock(),
      settingsStub(),
      new CatalogService(prisma, pricingMock(), ivaDialsStub() as never),
    );
  }

  it('`group.pricedAsOf` es la fecha CDMX de hoy y `group.ogImageUrl` es la imagen absoluta del sellado', async () => {
    const { group } = await buildSealed([SEALED()]).sealedDetail('s1');
    expect(group.pricedAsOf).toBe(toMexicoCityDateKey(new Date()));
    expect(group.ogImageUrl).toBe('https://images.pokemontcg.io/sealed/surging-sparks-box.png');
  });

  it('⛔ los dos campos NO viajan en la REJILLA de sellado (`listSealed`)', async () => {
    const res = await buildSealed([SEALED()]).listSealed({ page: 1, pageSize: 20 } as never);
    expect(res.data[0]).not.toHaveProperty('pricedAsOf');
    expect(res.data[0]).not.toHaveProperty('ogImageUrl');
  });
});

describe('§MKT.B — GET /catalog/sitemap (E/SEO)', () => {
  function buildController() {
    const rawItem = ITEM({ id: 'i-raw', cardId: 'c1', updatedAt: new Date('2026-10-10T00:00:00Z') });
    const sealedItem = SEALED({ id: 's1', updatedAt: new Date('2026-10-12T00:00:00Z') });
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async (args: { where?: { productType?: unknown } }) =>
          args?.where?.productType === 'sealed' ? [sealedItem] : [rawItem],
        ),
        count: jest.fn(async () => 1),
        findFirst: jest.fn(async () => sealedItem),
      },
      card: { findUnique: jest.fn(async () => CARD()) },
      sealedProduct: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    const catalog = new CatalogService(prisma, pricingMock(), ivaDialsStub() as never);
    const sealed = new SealedCatalogService(prisma, pricingMock(), settingsStub(), catalog);
    return new CatalogController(catalog, {} as unknown as SetValueService, sealed);
  }

  it('devuelve { items, generatedAt } con al menos UNA carta y UN sellado a la venta', async () => {
    const res = await buildController().sitemap();
    expect(res.generatedAt).toMatch(ISO_DATETIME);
    expect(Array.isArray(res.items)).toBe(true);
    const cards = res.items.filter((i) => i.type === 'card');
    const sealed = res.items.filter((i) => i.type === 'sealed');
    expect(cards.length).toBeGreaterThanOrEqual(1);
    expect(sealed.length).toBeGreaterThanOrEqual(1);
  });

  it('cada entrada tiene {type, id, lastmod ISO} y el id/lastmod correctos', async () => {
    const res = await buildController().sitemap();
    for (const it of res.items) {
      expect(it.type === 'card' || it.type === 'sealed').toBe(true);
      expect(typeof it.id).toBe('string');
      expect(it.id.length).toBeGreaterThan(0);
      expect(it.lastmod).toMatch(ISO_DATETIME);
    }
    const card = res.items.find((i) => i.type === 'card')!;
    expect(card.id).toBe('c1'); // la carta se indexa por cardId, no por inventoryItemId
    expect(card.lastmod).toBe(new Date('2026-10-10T00:00:00Z').toISOString());
    const sealed = res.items.find((i) => i.type === 'sealed')!;
    expect(sealed.id).toBe('s1'); // representativeItemId = la pieza representante del grupo
    expect(sealed.lastmod).toBe(new Date('2026-10-12T00:00:00Z').toISOString());
  });
});
