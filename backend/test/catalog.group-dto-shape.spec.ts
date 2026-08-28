import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';
import { computeSealedSalePrice } from '../src/common/money';
// D-e (techlead, v2.1.9): las claves se declaran UNA vez y el COMPILADOR las mantiene completas
// (`Record<keyof DTO, true>`). Antes vivían duplicadas a mano en dos specs y sin vínculo con la
// interfaz — un candado de forma cuya forma de referencia se mantiene a mano.
import {
  GROUPED_LISTING_KEYS as ALL_GROUPED_KEYS,
  GROUPED_LISTING_SUMMARY_KEYS as ALL_GROUPED_SUMMARY_KEYS,
  SEALED_GROUP_KEYS as ALL_SEALED_KEYS,
  SEALED_GROUP_SUMMARY_KEYS as ALL_SEALED_SUMMARY_KEYS,
  onWire,
} from './helpers/dto-keys';

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
  // v2.1.9 (T-2): el contrato declara `numberSort: number` y `numberPrefix: string` REQUERIDOS en
  // `CardDTO`. El fixture los omitía, así que desaparecían del JSON y la aserción de conjunto exacto
  // de segundo nivel no los habría visto — el mismo hueco de B-1, un nivel más abajo.
  numberSort: 1,
  numberPrefix: '',
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
    // MERGE v1.50.2 — el gancho de grading se compone en `buildGroups`/`getCard`, así que TODO mock de
    // `PricingService` que pase por ahí debe traer sus tres seams. Dial APAGADO (seed `off`): el gancho
    // no evalúa nada y el DTO sale EXACTAMENTE como sin la feature, que es lo que estos tests afirman.
    loadGradedEstimateConfig: jest.fn(async () => DISABLED_GRADED_ESTIMATE_CONFIG),
    getGradedEstimatesBatch: jest.fn(async () => new Map()),
    getPublishedSlabGradesBatch: jest.fn(async () => new Map()),
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
    // La ficha de sellado construye `listings[]` con `toListingDTO`, que consulta el gate del dial.
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

/**
 * El escenario de estos tests es un **raw sin grading**, así que `gradingCompany`/`gradeValue` (los
 * dos opcionales de `graded`) NO viajan en el JSON. El recorte va EXPLÍCITO aquí, contra la lista
 * COMPLETA que el compilador deriva de la interfaz: si mañana el DTO gana un campo, la lista de
 * `helpers/dto-keys.ts` no compila hasta declararlo, y este test lo exige en el cable.
 */
const withoutGrading = (keys: string[]) =>
  keys.filter(
    (k) =>
      k !== 'gradingCompany' &&
      k !== 'gradeValue' &&
      // v1.50.2: `gradingHighlight` es OPCIONAL y su PRESENCIA **es** la elegibilidad. En estos
      // escenarios el dial del gancho está apagado ⇒ el campo NO existe y la teja se ve EXACTAMENTE
      // como antes de la feature (criterio 100). Su emisión se prueba en `graded-estimate.*.spec.ts`.
      k !== 'gradingHighlight',
  );

/** `GroupedListingDTO` (FICHA) en el escenario raw. */
const GROUPED_LISTING_KEYS = withoutGrading(ALL_GROUPED_KEYS);
/** `GroupedListingSummaryDTO` (REJILLA, v2.1.9 D2) en el escenario raw. */
const GROUPED_LISTING_SUMMARY_KEYS = withoutGrading(ALL_GROUPED_SUMMARY_KEYS);

describe('B-1 — `GroupedListingDTO` trae `priceBasis` (el campo que rompía la ficha)', () => {
  function build(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    return new CatalogService(prisma, pricingMock());
  }

  it('`GET /catalog/cards/:cardId → listings[]` (FICHA): el grupo trae `priceBasis` — antes `undefined` en el 100%', async () => {
    // v2.1.9 (D2): la afirmación de B-1 se mudó de la REJILLA a la FICHA, que es donde `priceBasis`
    // se consume. La rejilla ya no lo recibe (ver el describe de D2, abajo).
    const detail = await build([ITEM()]).getCard('c1');
    expect(detail.listings).toHaveLength(1);
    expect(detail.listings[0].priceBasis).toBe('market');
  });

  it('CONJUNTO EXACTO de claves del grupo de la FICHA: ninguna de menos (B-1) y ninguna de más (fuga)', async () => {
    const detail = await build([ITEM()]).getCard('c1');
    expect(Object.keys(onWire(detail.listings[0])).sort()).toEqual(GROUPED_LISTING_KEYS);
  });

  it('extendido a `data[0].card` (P-30/T-2): la aserción de conjunto exacto baja al SEGUNDO nivel', async () => {
    // Las aserciones de forma solo cubrían el primer nivel, así que un `CardDTO` al que le faltara
    // `displayFinishes` habría pasado — y el tipo lo habría seguido, porque estaba declarado como
    // `ReturnType<typeof toCardDTO>` (el tipo espejando la IMPLEMENTACIÓN, no el contrato).
    const detail = await build([ITEM()]).getCard('c1');
    expect(Object.keys(onWire(detail.listings[0].card)).sort()).toEqual(
      [
        'availableFinishes',
        'displayFinishes',
        'externalId',
        'id',
        'imageLargeUrl',
        'imageSmallUrl',
        'name',
        'number',
        'numberPrefix',
        'numberSort',
        'rarity',
        'setId',
        'setName',
        'subtypes',
        'supertype',
      ].sort(),
    );
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
    const detail = await new CatalogService(prisma, pricing).getCard('c1');
    const group = detail.listings[0];
    // La condición EXACTA que evalúa `CardDetailView.tsx`.
    expect(group.priceBasis === 'market').toBe(true);
    expect(group.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 500000 });
    expect(group.salePriceCents).toBe(575000); // $5,000 × 1.15
  });

  it('el basis del grupo es el del REPRESENTANTE: un override POR PIEZA más barato manda', async () => {
    // La pieza con override manual ($10) es la más barata ⇒ representa al grupo ⇒ basis `override`
    // ⇒ el front NO pinta «Valor de mercado», que es lo correcto: el mercado no produjo ese precio.
    const detail = await build([ITEM(), ITEM({ id: 'i2', listPriceCents: 1000 })]).getCard('c1');
    expect(detail.listings[0]).toMatchObject({
      priceBasis: 'override',
      salePriceCents: 1000,
      stockCount: 2,
    });
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

/** `SealedGroupDTO` (FICHA) / `SealedGroupSummaryDTO` (REJILLA) — derivados de la interfaz declarada. */
const SEALED_GROUP_KEYS = ALL_SEALED_KEYS;
const SEALED_GROUP_SUMMARY_KEYS = ALL_SEALED_SUMMARY_KEYS;

describe('B-2 — `SealedGroupDTO` trae `priceBasis` y `currency`', () => {
  function buildSealed(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async () => items),
        count: jest.fn(async () => items.length),
        // v2.1.9 (D2): la ficha (`sealedDetail`) resuelve primero el representante por `findFirst`.
        findFirst: jest.fn(async () => items[0]),
      },
      sealedProduct: { findMany: jest.fn(async () => []) },
    } as unknown as PrismaService;
    return new SealedCatalogService(
      prisma,
      pricingMock(),
      {
        getBool: jest.fn(async () => false),
        getNumber: jest.fn(async () => 0),
        // La ficha lee los dos feature-flags (`trendEnabled`/`restockEnabled`).
        getString: jest.fn(async () => 'off'),
      } as unknown as SettingsService,
      // La ficha construye `listings[]` por-pieza con el `toListingDTO` de CatalogService.
      new CatalogService(prisma, pricingMock()),
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

  it('la FICHA de sellado trae `priceBasis` DERIVADO del spread (mercado ⇒ `market`)', async () => {
    const { group } = await buildSealed([SEALED()]).sealedDetail('s1');
    expect(group.priceBasis).toBe('market');
    expect(group.priceSource).not.toBe('override'); // el detalle propio del sellado se CONSERVA
  });

  it('con override manual POR PIEZA el basis es `override` ⇒ el front NO pinta «Valor de mercado»', async () => {
    const { group } = await buildSealed([SEALED({ listPriceCents: 999000 })]).sealedDetail('s1');
    expect(group).toMatchObject({ priceBasis: 'override', priceSource: 'override' });
  });

  it('CONJUNTO EXACTO de claves del grupo de sellado en la FICHA (incluye `currency`, que faltaba)', async () => {
    const { group } = await buildSealed([SEALED()]).sealedDetail('s1');
    expect(Object.keys(onWire(group)).sort()).toEqual(SEALED_GROUP_KEYS);
    expect(group.currency).toBe('MXN');
  });

  it('UNA sola regla de visibilidad para las DOS fichas: el mismo enum decide en single y en sellado', async () => {
    const single = await new CatalogService(
      {
        inventoryItem: { findMany: jest.fn(async () => [ITEM()]), count: jest.fn(async () => 1) },
        card: { findUnique: jest.fn(async () => CARD()) },
      } as unknown as PrismaService,
      pricingMock(),
    ).getCard('c1');
    const { group } = await buildSealed([SEALED()]).sealedDetail('s1');
    // Es el punto de P-48: el front no ramifica por tipo de producto, compara el MISMO campo.
    expect(single.listings[0].priceBasis).toBe(group.priceBasis);
  });

  it('D2 · la REJILLA de sellado NO recibe las tres señales de precio', async () => {
    const res = await buildSealed([SEALED()]).listSealed({ page: 1, pageSize: 20 } as never);
    expect(Object.keys(onWire(res.data[0])).sort()).toEqual(SEALED_GROUP_SUMMARY_KEYS);
  });
});

describe('D2 — la REJILLA de singles no recibe `priceBasis` ni `referenceValue`', () => {
  function build(items: Array<Record<string, unknown>>) {
    const prisma = {
      inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    return new CatalogService(prisma, pricingMock());
  }

  it('CONJUNTO EXACTO de la rejilla = el del grupo MENOS las dos señales', async () => {
    const res = await build([ITEM()]).listCards({ page: 1, pageSize: 20 } as never);
    expect(Object.keys(onWire(res.data[0])).sort()).toEqual(GROUPED_LISTING_SUMMARY_KEYS);
    // Dicho también en negativo, que es como se lee el hallazgo del pentester.
    expect(onWire(res.data[0])).not.toHaveProperty('priceBasis');
    expect(onWire(res.data[0])).not.toHaveProperty('referenceValue');
  });

  it('lo que la rejilla SÍ necesita sigue intacto (el recorte no apaga funcionalidad)', async () => {
    const res = await build([ITEM(), ITEM({ id: 'i2' })]).listCards({ page: 1, pageSize: 20 } as never);
    expect(res.data[0]).toMatchObject({ stockCount: 2, currency: 'MXN', productType: 'raw' });
    expect(res.data[0].salePriceCents).toBeGreaterThan(0);
  });
});
