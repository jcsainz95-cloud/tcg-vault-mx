import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';

/**
 * v1.53-b (I-2, enrutado por el gate QA/techlead) — **el hueco que un `!` tapaba con un comentario.**
 *
 * ### Qué se afirmaba, y por qué nadie lo pudo comprobar
 * `catalog.service.ts` emitía el `gradeKey` del grupo así:
 * ```ts
 * // el `!` es SEGURO — el bucle de arriba ya descartó las piezas sin clave
 * gradeKey: this.pricing.tryGradeKeyFor(item)!,
 * ```
 * El veredicto sobre esa línea **partió a los dos gates en dos**: el techlead la descartó como falso
 * positivo, QA trazó la cadena y dijo que había hueco. Los dos tenían media razón, y la mitad que
 * faltaba es la que este archivo fija **ejecutando la cadena en vez de razonar sobre ella**:
 *
 *  - **QA acertó en la CADENA:** una graduada legacy sin identidad de slab **SÍ llega** hasta el
 *    agrupador. `fetchSellable` filtra por `dto.sellable && salePriceCents != null` y **no mira el
 *    `gradeKey`**; `sellable` es `salePriceCents > 0 && status === 'listed'` y **tampoco**; y la rama
 *    de precio MANUAL fija el precio **sin** consultar la identidad. La frase «en la práctica no
 *    llega ninguna» del comentario anterior era **falsa**.
 *  - **El techlead acertó en el `!`:** aun así, `buildGroups` tiene su **propio** `continue` sobre
 *    `lookupKeysOf`, así que la pieza se atajaba **ahí** y `gradeKey: undefined` nunca llegaba al
 *    cable. El `!` no mentía; **el comentario que lo justificaba, sí** — y por eso costó una
 *    discrepancia entre gates.
 *
 * ### Por qué ningún test lo veía
 * `catalog.group-dto-shape.spec.ts` **mockea `tryGradeKeyFor`** con un stub que devuelve
 * `'graded:PSA:10'` para toda graduada, así que en ese spec el `null` **no es representable**. Aquí
 * se usa el cuerpo REAL (`PricingService.prototype.tryGradeKeyFor`): es la única forma de que el
 * escenario exista.
 *
 * ### Qué ancla este archivo (y por qué sobrevive al refactor que quitó el `!`)
 * No ancla la sintaxis; ancla el **comportamiento observable**, que es lo que no puede regresar:
 *  1. la pieza legacy **es vendible** y viaja en `units[]` (la cadena de QA, medida);
 *  2. **no forma grupo** — ni con `gradeKey: undefined`, ni con un grado inventado;
 *  3. una pieza legítima del mismo `cardId` **sí** agrupa, y su `gradeKey` es el suyo (el filtro no
 *    se come de más);
 *  4. **en el CABLE** (tras `JSON.stringify`) todo grupo emitido trae un `gradeKey` string no vacío
 *     — la aserción que habría fallado si el `!` hubiera llegado a producir el `undefined` que
 *     `GroupedListingDTO` declara `string` REQUERIDO.
 */

const CARD = () => ({
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
  imageSmallUrl: null,
  imageLargeUrl: null,
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Surging Sparks', releaseDate: '2024/11/08' },
});

const BASE = {
  cardId: 'c1',
  rawCondition: null,
  sealedSubtype: null,
  sealedCondition: null,
  sealedProductName: null,
  sealedImageUrl: null,
  status: 'listed',
  finish: 'normal',
  ownerType: 'platform',
  tcgplayerProductId: null,
  createdAt: new Date('2026-08-01'),
};

/**
 * **La pieza del hallazgo**, con los cuatro ingredientes exactos de la cadena de QA:
 * `graded` + identidad de slab NULA + `certNumber` (único requisito de `assertPublishableGuards`
 * hasta M-1) + `listPriceCents` MANUAL + `listed`.
 */
const LEGACY_SIN_IDENTIDAD = () => ({
  ...BASE,
  id: 'i-legacy',
  folio: 'INV-000001',
  productType: 'graded',
  gradingCompany: null,
  gradeValue: null,
  certNumber: '12345678',
  listPriceCents: 500_000,
  card: CARD(),
});

/** La misma carta, bien capturada: el control de que el filtro no se come piezas legítimas. */
const GRADED_COMPLETA = () => ({
  ...BASE,
  id: 'i-ok',
  folio: 'INV-000002',
  productType: 'graded',
  gradingCompany: 'PSA',
  gradeValue: '9',
  certNumber: '87654321',
  listPriceCents: 300_000,
  card: CARD(),
});

/** `PricingService` con el CUERPO REAL de `tryGradeKeyFor` — sin esto el escenario no existe. */
function pricingWithRealKey(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    loadGradedEstimateConfig: jest.fn(async () => DISABLED_GRADED_ESTIMATE_CONFIG),
    getGradedEstimatesBatch: jest.fn(async () => new Map()),
    getPublishedSlabGradesBatch: jest.fn(async () => new Map()),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    // ⚠️ EL PUNTO DEL ARCHIVO: el cuerpo real, que sí puede devolver `null`.
    tryGradeKeyFor: jest.fn(PricingService.prototype.tryGradeKeyFor),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    getReference: jest.fn(async () => ({ status: 'pending' })),
    getReferencesBatch: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    sealedMarketGradeKeyForItem: jest.fn(() => null),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: {},
      fallbackPct: 25,
      sourceOn: true,
    })),
  } as unknown as PricingService;
}

function serviceWith(items: Array<Record<string, unknown>>): CatalogService {
  const prisma = {
    inventoryItem: {
      findMany: jest.fn(async () => items),
      count: jest.fn(async () => items.length),
    },
    card: { findUnique: jest.fn(async () => CARD()) },
  } as unknown as PrismaService;
  return new CatalogService(prisma, pricingWithRealKey());
}

/** Lo que el cliente REALMENTE recibe: un campo `undefined` desaparece al serializar. */
const onWire = <T>(v: T): Record<string, unknown> => JSON.parse(JSON.stringify(v));

describe('I-2 — la cadena de QA existe: la pieza legacy SÍ llega al agrupador', () => {
  it('`fetchSellable` NO la filtra: es `sellable`, con precio, y viaja en `units[]` de la ficha', async () => {
    const detail = await serviceWith([LEGACY_SIN_IDENTIDAD()]).getCard('c1');
    // Esta es la afirmación que desmiente el comentario anterior («en la práctica no llega ninguna»).
    expect(detail.units).toHaveLength(1);
    expect(detail.units[0].sellable).toBe(true);
    expect(detail.units[0].salePriceCents).toBe(500_000);
    // Y su precio es el override EXPLÍCITO del admin, no un PSA 10 inventado: por eso el hallazgo
    // NO es una fuga de dinero. `priceBasis` lo dice en el propio DTO.
    expect(detail.units[0].priceBasis).toBe('override');
    // La identidad sigue ausente en el cable: no se rellenó con nada.
    expect(onWire(detail.units[0])).not.toHaveProperty('gradingCompany');
    expect(onWire(detail.units[0])).not.toHaveProperty('gradeValue');
  });
});

describe('I-2 — y aun así NO forma grupo: el `gradeKey` requerido nunca sale `undefined`', () => {
  it('FICHA (`listings[]`): la pieza sin identidad no produce publicación agrupada', async () => {
    const detail = await serviceWith([LEGACY_SIN_IDENTIDAD()]).getCard('c1');
    expect(detail.listings).toEqual([]);
  });

  it('REJILLA (`GET /catalog/cards`): tampoco aparece en Compra', async () => {
    const res = await serviceWith([LEGACY_SIN_IDENTIDAD()]).listCards({ page: 1, pageSize: 20 });
    expect(res.data).toEqual([]);
    expect(res.total).toBe(0);
  });

  it('el filtro NO se come de más: la graduada BIEN capturada sí agrupa, con SU grado', async () => {
    const detail = await serviceWith([LEGACY_SIN_IDENTIDAD(), GRADED_COMPLETA()]).getCard('c1');
    // Dos piezas vendibles, UN solo grupo: el de la que tiene identidad.
    expect(detail.units).toHaveLength(2);
    expect(detail.listings).toHaveLength(1);
    expect(detail.listings[0].gradeKey).toBe('graded:PSA:9');
    expect(detail.listings[0].representativeInventoryItemId).toBe('i-ok');
    // `stockCount` cuenta los MIEMBROS del grupo — la legacy no se coló como miembro fantasma.
    expect(detail.listings[0].stockCount).toBe(1);
    // Y jamás el grado más caro: `graded:PSA:10` era el default que este pase retiró.
    expect(detail.listings[0].gradeKey).not.toBe('graded:PSA:10');
  });

  it('EN EL CABLE: todo grupo emitido trae `gradeKey` string NO VACÍO (el contrato lo exige)', async () => {
    const detail = await serviceWith([LEGACY_SIN_IDENTIDAD(), GRADED_COMPLETA()]).getCard('c1');
    const res = await serviceWith([LEGACY_SIN_IDENTIDAD(), GRADED_COMPLETA()]).listCards({ page: 1, pageSize: 20 });
    for (const group of [...detail.listings, ...res.data]) {
      const wire = onWire(group);
      // `toHaveProperty` es deliberado: un `undefined` se cae en `JSON.stringify` y la clave
      // DESAPARECE. Comprobar el valor sin comprobar la presencia no habría visto el defecto.
      expect(wire).toHaveProperty('gradeKey');
      expect(typeof wire.gradeKey).toBe('string');
      expect((wire.gradeKey as string).length).toBeGreaterThan(0);
    }
  });
});
