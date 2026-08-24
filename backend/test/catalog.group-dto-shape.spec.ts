import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { computeSealedSalePrice } from '../src/common/money';

/**
 * B-1 / B-2 (v2.1.7, hallazgo de QA contra el STACK VIVO) — **forma exacta de los DTOs de GRUPO**.
 *
 * ### El bug, y por qué ninguna capa lo vio
 * `GroupedListingDTO` se emitía **sin `priceBasis`** y `SealedGroupDTO` **sin `priceBasis` ni
 * `currency`**, los tres requeridos por el contrato. El front decide la visibilidad de «Valor de
 * mercado» con `priceBasis === 'market'`; con `undefined` esa comparación es **siempre falsa**, así
 * que la regla de §N.7 quedó **invertida**: en vez de «se muestra si y solo si el mercado fijó el
 * precio», era «no se muestra nunca» — en el 100% de las fichas.
 *
 * Tres capas de verificación y el campo faltaba en la que nadie miraba:
 *  - los fixtures del front **horneaban** `priceBasis: 'market'`;
 *  - el test de forma (`catalog.dto-closed.spec.ts`) assertaba sobre el **`ListingDTO`** (por-pieza),
 *    que sí lo traía, **no sobre el DTO de GRUPO**;
 *  - ningún test `@real` abría una ficha.
 *
 * Por eso este archivo assertea el **CONJUNTO EXACTO de claves de los DTOs de GRUPO**, que es el
 * nivel donde faltaba. Es el complemento simétrico de `catalog.dto-closed.spec.ts`: aquél vigila que
 * **no salga de más** (fuga), éste que **no falte de menos** (funcionalidad rota).
 */

const CARD = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  externalId: 'sv8-1',
  name: 'Pikachu',
  number: '1',
  rarity: 'Illustration Rare',
  rarityCanonical: 'illustration_rare',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's1',
  imageSmallUrl: null,
  imageLargeUrl: null,
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
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  status: 'listed',
  finish: 'normal',
  ownerType: 'platform',
  folio: 'INV-000001',
  listPriceCents: null,
  tcgplayerProductId: null,
  createdAt: new Date('2026-08-01'),
  card: CARD(),
  ...over,
});

/** Mercado $1,000 ⇒ la curva vende a $1,150 con basis `market` (el caso que el front debe PINTAR). */
const MARKET = 100000;

function pricingMock() {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn((i: { productType: string; rawCondition?: string }) =>
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

/**
 * La forma se assertea sobre el objeto SERIALIZADO (`JSON.parse(JSON.stringify(dto))`), que es lo que
 * de verdad cruza el cable: los opcionales ausentes viajan como `undefined` en memoria pero
 * DESAPARECEN en JSON, mientras que un requerido que falta desaparece igual — y ésa es exactamente la
 * diferencia que B-1 explotó. Comparar el objeto en memoria mezclaría las dos cosas.
 */
const onWire = (dto: unknown) => JSON.parse(JSON.stringify(dto)) as Record<string, unknown>;

/** Claves EXACTAS que el contrato (§DTOs) declara para `GroupedListingDTO` (raw, sin grading). */
const GROUPED_LISTING_KEYS = [
  'card',
  'currency',
  'finish',
  'gradeKey',
  'priceBasis',
  'productType',
  'rawCondition',
  'referenceValue',
  'representativeInventoryItemId',
  'salePriceCents',
  'stockCount',
].sort();

describe('B-1 — `GroupedListingDTO` trae `priceBasis` (el campo que rompía la ficha)', () => {
  function build(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    return new CatalogService(prisma, pricingMock());
  }

  it('`GET /catalog/cards`: el grupo trae `priceBasis` — antes era `undefined` en el 100%', async () => {
    const res = await build([ITEM()]).listCards({ page: 1, pageSize: 20 } as never);
    expect(res.data).toHaveLength(1);
    expect(res.data[0].priceBasis).toBe('market');
  });

  it('CONJUNTO EXACTO de claves del grupo: ninguna de menos (B-1) y ninguna de más (fuga)', async () => {
    const res = await build([ITEM()]).listCards({ page: 1, pageSize: 20 } as never);
    expect(Object.keys(onWire(res.data[0])).sort()).toEqual(GROUPED_LISTING_KEYS);
  });

  it('`GET /catalog/cards/:cardId → listings[]`: mismo grupo, mismo `priceBasis`', async () => {
    const detail = await build([ITEM()]).getCard('c1');
    expect(detail.listings[0].priceBasis).toBe('market');
    expect(Object.keys(onWire(detail.listings[0])).sort()).toEqual(GROUPED_LISTING_KEYS);
  });

  it('EL ESCENARIO DE QA: basis `market` + referencia de MX$5,000 ⇒ el front SÍ pinta «Valor de mercado»', async () => {
    const pricing = pricingMock();
    (pricing.getReferencesBatch as jest.Mock).mockResolvedValue(
      new Map([['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: 500000 }]]),
    );
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => [ITEM()]), count: jest.fn(async () => 1) },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    const res = await new CatalogService(prisma, pricing).listCards({ page: 1, pageSize: 20 } as never);
    const group = res.data[0];
    // La condición EXACTA que evalúa `CardDetailView.tsx`.
    expect(group.priceBasis === 'market').toBe(true);
    expect(group.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 500000 });
    expect(group.salePriceCents).toBe(575000); // $5,000 × 1.15
  });

  it('el basis del grupo es el del REPRESENTANTE: un override POR PIEZA más barato manda', async () => {
    // La pieza con override manual ($10) es la más barata ⇒ representa al grupo ⇒ basis `override`
    // ⇒ el front NO pinta «Valor de mercado», que es lo correcto: el mercado no produjo ese precio.
    const res = await build([ITEM(), ITEM({ id: 'i2', listPriceCents: 1000 })]).listCards({
      page: 1,
      pageSize: 20,
    } as never);
    expect(res.data[0]).toMatchObject({ priceBasis: 'override', salePriceCents: 1000, stockCount: 2 });
  });

  it('sin mercado el grupo NO existe (no se publica), así que no hay basis que pintar', async () => {
    const pricing = pricingMock();
    (pricing.getReferencesBatch as jest.Mock).mockResolvedValue(new Map());
    (pricing.getReference as jest.Mock).mockResolvedValue({ status: 'pending' });
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async () => [ITEM({ listPriceCents: null })]),
        count: jest.fn(async () => 1),
      },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    const res = await new CatalogService(prisma, pricing).listCards({ page: 1, pageSize: 20 } as never);
    expect(res.data).toHaveLength(0);
  });
});

/** Claves EXACTAS que el contrato (§DTOs) declara para `SealedGroupDTO`. */
const SEALED_GROUP_KEYS = [
  'availableCount',
  'card',
  'currency',
  'fromPriceCents',
  'imageUrl',
  'priceBasis',
  'priceSource',
  'productName',
  'referenceValue',
  'representativeItemId',
  'sealedCondition',
  'sealedSubtype',
].sort();

describe('B-2 — `SealedGroupDTO` trae `priceBasis` y `currency`', () => {
  function buildSealed(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
      sealedProduct: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    return new SealedCatalogService(
      prisma,
      pricingMock(),
      { getBool: jest.fn(async () => false), getNumber: jest.fn(async () => 0) } as unknown as SettingsService,
      {} as CatalogService,
    );
  }

  const SEALED = (over: Record<string, unknown> = {}) =>
    ITEM({
      id: 's1',
      productType: 'sealed',
      rawCondition: null,
      sealedSubtype: 'box',
      sealedCondition: 'mint',
      sealedProductName: 'Surging Sparks Booster Box',
      tcgplayerProductId: 555,
      listPriceCents: null,
      ...over,
    });

  it('el grupo de sellado trae `priceBasis` DERIVADO del spread (mercado ⇒ `market`)', async () => {
    const res = await buildSealed([SEALED()]).listSealed({ page: 1, pageSize: 20 } as never);
    expect(res.data[0].priceBasis).toBe('market');
    expect(res.data[0].priceSource).not.toBe('override'); // el detalle propio del sellado se CONSERVA
  });

  it('con override manual POR PIEZA el basis es `override` ⇒ el front NO pinta «Valor de mercado»', async () => {
    const res = await buildSealed([SEALED({ listPriceCents: 999000 })]).listSealed({
      page: 1,
      pageSize: 20,
    } as never);
    expect(res.data[0]).toMatchObject({ priceBasis: 'override', priceSource: 'override' });
  });

  it('CONJUNTO EXACTO de claves del grupo de sellado (incluye `currency`, que también faltaba)', async () => {
    const res = await buildSealed([SEALED()]).listSealed({ page: 1, pageSize: 20 } as never);
    expect(Object.keys(onWire(res.data[0])).sort()).toEqual(SEALED_GROUP_KEYS);
    expect(res.data[0].currency).toBe('MXN');
  });

  it('UNA sola regla de visibilidad para las DOS fichas: el mismo enum decide en single y en sellado', async () => {
    const single = await new CatalogService(
      {
        inventoryItem: { findMany: jest.fn(async () => [ITEM()]), count: jest.fn(async () => 1) },
        card: { findUnique: jest.fn(async () => CARD()) },
      } as unknown as PrismaService,
      pricingMock(),
    ).listCards({ page: 1, pageSize: 20 } as never);
    const sealed = await buildSealed([SEALED()]).listSealed({ page: 1, pageSize: 20 } as never);
    // Es el punto de P-48: el front no ramifica por tipo de producto, compara el MISMO campo.
    expect(single.data[0].priceBasis).toBe(sealed.data[0].priceBasis);
  });
});
