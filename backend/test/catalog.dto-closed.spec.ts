import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PricingService, PriceInfo, toPublicPriceInfo } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * S48-M2 (v2.1.6, fase de seguridad / API_CONTRACT §M2) — **el DTO es CERRADO**.
 *
 * `PriceInfo.isManualOverride` **nunca estuvo declarado** en el contrato y el backend lo emitía igual
 * a endpoints **anónimos**: un mapa **scrapeable** de qué cartas llevan precio fijado a mano — o sea
 * dónde falló el feed automático y dónde es más probable que el precio esté desalineado.
 *
 * Y quitarlo **no basta**: `PriceSource` incluye el valor `manual`, así que **`source` filtra la misma
 * señal**. Norma: `source` se omite en toda superficie pública/anónima y solo viaja en
 * `vault_operator+`.
 *
 * ### Por qué este archivo assertea el CONJUNTO EXACTO de claves
 * «Aditivo es seguro» vale para el **consumidor**, no para el **emisor**: publicar de más no rompe a
 * nadie, **filtra**. Todos los tests previos comprobaban que los campos esperados ESTUVIERAN, y por eso
 * un campo de más vivió meses sin que nada fallara. Es la otra cara del hueco de `details` (v2.1.5):
 * aquél **apagó funcionalidad**, éste **publicó información**.
 */

const CARD = {
  id: 'c1',
  externalId: 'x1',
  name: 'Pikachu',
  number: '25',
  rarity: 'Common',
  rarityCanonical: 'comun',
  supertype: 'Pokémon',
  subtypes: [],
  setId: 's1',
  imageSmallUrl: null,
  imageLargeUrl: null,
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Base', series: 'Base', releaseDate: '1999/01/09', printedTotal: 102 },
};

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  cardId: 'c1',
  productType: 'raw',
  rawCondition: 'NM',
  sealedSubtype: null,
  sealedCondition: null,
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  status: 'listed',
  finish: 'normal',
  ownerType: 'platform',
  folio: 'INV-000001',
  listPriceCents: null,
  createdAt: new Date('2026-08-01'),
  card: CARD,
  ...over,
});

/** Referencia de mercado FIJADA A MANO: el caso exacto que no debe poder inferirse desde fuera. */
const MANUAL_REF: PriceInfo = {
  status: 'priced',
  referenceMxnCents: 100000,
  source: 'manual',
  capturedDate: '2026-08-24',
};

function pricingMock() {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => MANUAL_REF),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

describe('S48-M2 — `toPublicPriceInfo` es el único cuerpo que decide qué sale a superficie pública', () => {
  it('proyecta por LISTA BLANCA: quita `source` y conserva carga + frescura', () => {
    expect(toPublicPriceInfo(MANUAL_REF)).toEqual({
      status: 'priced',
      referenceMxnCents: 100000,
      capturedDate: '2026-08-24',
    });
  });

  it('un campo INTERNO futuro tampoco saldría (se construye, no se hace `delete`)', () => {
    const withInternals = { ...MANUAL_REF, isManualOverride: true, secretoDeFeed: 'x' } as PriceInfo;
    expect(Object.keys(toPublicPriceInfo(withInternals)).sort()).toEqual([
      'capturedDate',
      'referenceMxnCents',
      'status',
    ]);
  });

  it('`pending` sigue siendo `pending` a secas (sin campos fantasma)', () => {
    expect(toPublicPriceInfo({ status: 'pending' })).toEqual({ status: 'pending' });
  });
});

describe('S48-M2 — `GET /catalog/*` (ANÓNIMO): el `referenceValue` no filtra procedencia', () => {
  it('`isManualOverride` NO viaja — ni siquiera con una referencia fijada a mano', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(dto.referenceValue).not.toHaveProperty('isManualOverride');
  });

  it('`source` TAMPOCO viaja: `PriceSource` incluye `manual`, así que filtraba la MISMA señal', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(dto.referenceValue).not.toHaveProperty('source');
  });

  it('CONJUNTO EXACTO de claves (§M2): ni una de más — «publicar de más no rompe a nadie, FILTRA»', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(Object.keys(dto.referenceValue).sort()).toEqual(['capturedDate', 'referenceMxnCents', 'status']);
  });

  it('la CARGA y la frescura sí llegan: el comprador ve el valor y qué tan fresco es', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(dto.referenceValue).toMatchObject({
      status: 'priced',
      referenceMxnCents: 100000,
      capturedDate: '2026-08-24',
    });
  });

  it('el PRECIO no cambia por la proyección (esto es presentación, no dinero)', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(dto.salePriceCents).toBe(115000); // $1,000 × 1.15
    expect(dto.priceBasis).toBe('market');
    expect(dto.sellable).toBe(true);
  });

  it('NO se tocan `referenceValue` como concepto ni `priceBasis`: siguen viajando (§N.7 los MANDA)', async () => {
    const svc = new CatalogService({} as PrismaService, pricingMock());
    const dto = await svc.toListingDTO(ITEM() as never);
    // Seguridad reclasificó a la baja la «fuga» de estos dos porque están mandados por escrito.
    // Este test es el candado para que una sobrecorrección futura no los quite.
    expect(dto).toHaveProperty('referenceValue');
    expect(dto).toHaveProperty('priceBasis');
  });
});
