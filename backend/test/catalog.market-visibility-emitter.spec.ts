import { CatalogService } from '../src/modules/catalog/catalog.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { PricingService, toPublicPriceInfo } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { computeSealedSalePrice } from '../src/common/money';
import { onWire } from './helpers/dto-keys';

/**
 * v2.1.9 · D2 (API_CONTRACT §DTOs `ListingDTO` / §N.7 · ARCHITECTURE §4.36.7b.2) —
 * **la regla de visibilidad del «Valor de mercado» se impone en el EMISOR, no en el navegador.**
 *
 * ### Qué estaba mal
 * §N.7 dice que el bloque «Valor de mercado» se muestra **si y solo si `priceBasis === 'market'`**.
 * Eso se cumplía **solo en el front**: un `curl` sin token a `GET /catalog/listings/<id>` devolvía
 * `priceBasis:"override"` **junto con el número de mercado** — exactamente el bloque que la UI tiene
 * PROHIBIDO pintar. El PoC del pentester era literal. Una regla que solo vive en el navegador no es
 * una regla: es una sugerencia.
 *
 * El argumento que la sostenía («`referenceValue` sigue viajando porque el mismo DTO alimenta
 * superficies admin y de valuación, y stripearlo por endpoint haría que `PriceInfo` significara cosas
 * distintas según la ruta») quedó **derogado por escrito**: `toPublicPriceInfo` **ya** recortaba por
 * superficie (quita `source`), así que la premisa era falsa.
 *
 * ### Qué se verifica aquí, y por qué así
 *  - El `iff` **en las dos direcciones**: con `market` el número **está**; con `floor`/`override`/
 *    `pending` **no está**. Una sola dirección dejaría pasar «no lo mando nunca», que apaga
 *    funcionalidad (es B-1 otra vez, del otro lado).
 *  - Sobre el **JSON serializado**, que es lo que cruza el cable: un opcional ausente viaja como
 *    `undefined` en memoria y **desaparece** en JSON. Comparar el objeto en memoria mezcla las cosas.
 *  - **A los dos niveles**: rejilla (que ya no recibe ninguna de las dos señales) y ficha (que
 *    conserva `priceBasis` y recorta el número).
 *
 * ⚠️ Esto **NO releva al front** de obedecer `priceBasis`: es defensa en profundidad.
 */

const CARD = (over: Record<string, unknown> = {}) => ({
  id: 'c1',
  externalId: 'sv8-1',
  name: 'Pikachu',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Common',
  rarityCanonical: 'common',
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
  listPriceCents: null,
  tcgplayerProductId: null,
  createdAt: new Date('2026-08-01T00:00:00Z'),
  card: CARD(),
  ...over,
});

/** Referencia de mercado con la que se prueban las dos direcciones del `iff`. */
const MARKET_REF = { status: 'priced', referenceMxnCents: 500_000, capturedDate: '2026-08-24', source: 'tcgplayer' };

function pricingMock(ref: Record<string, unknown> | undefined = MARKET_REF) {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    getReferencesBatch: jest.fn(async () => new Map(ref ? [['c1|raw|raw:NM|normal', ref]] : [])),
    getReference: jest.fn(async () => ref ?? { status: 'pending' }),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
    gradeKeyFor: () => 'raw:NM',
    sealedMarketGradeKeyForItem: (i: { tcgplayerProductId: number | null }) =>
      i.tcgplayerProductId != null ? `sealed:tcg:${i.tcgplayerProductId}` : null,
    // La matemática REAL de la curva (no una mock que invente basis): lo que se está verificando es
    // el recorte del emisor, no el precio — así que el basis tiene que salir del cuerpo de verdad.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: true })),
    gateSealedMarketCents: (r: { status?: string; referenceMxnCents?: number } | undefined, on: boolean) =>
      on && r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null,
    getSealedMarketRef: jest.fn(async () => ref ?? { status: 'pending' }),
    resolveSealedSalePrice: (
      item: { listPriceCents: number | null; sealedSubtype: string | null },
      r: { status?: string; referenceMxnCents?: number } | undefined,
      ctx: { sourceOn: boolean; spreadPctBySubtype: Record<string, number>; fallbackPct: number },
    ) =>
      computeSealedSalePrice(
        item.listPriceCents,
        item.sealedSubtype as never,
        ctx.sourceOn && r?.status === 'priced' ? (r.referenceMxnCents ?? null) : null,
        ctx.spreadPctBySubtype,
        ctx.fallbackPct,
      ),
  } as unknown as PricingService;
}

function buildCatalog(items: Array<Record<string, unknown>>, ref = MARKET_REF as Record<string, unknown> | undefined) {
  const prisma = {
    inventoryItem: { findMany: jest.fn(async () => items), count: jest.fn(async () => items.length) },
    card: { findUnique: jest.fn(async () => CARD()) },
  } as unknown as PrismaService;
  return new CatalogService(prisma, pricingMock(ref));
}

describe('D2 · el proyector — `toPublicPriceInfo` parametrizado por `priceBasis`', () => {
  const info = { status: 'priced' as const, referenceMxnCents: 500_000, capturedDate: '2026-08-24', source: 'tcgplayer' as never };

  it('con `market` el número y su frescura VIAJAN (la dirección que apaga funcionalidad si se rompe)', () => {
    expect(toPublicPriceInfo(info, 'market')).toEqual({
      status: 'priced',
      referenceMxnCents: 500_000,
      capturedDate: '2026-08-24',
    });
  });

  it.each(['floor', 'override', 'pending', 'bounty'] as const)(
    'con `%s` sale `{ status }` a secas — ni número ni `capturedDate`',
    (basis) => {
      // `capturedDate` acompaña al número: sin número, la frescura no informa de nada.
      expect(toPublicPriceInfo(info, basis)).toEqual({ status: 'priced' });
    },
  );

  it('SIN `priceBasis` el recorte por basis NO aplica: bóveda/portafolio y admin quedan intactos', () => {
    // §N.7 excluye explícitamente esas superficies — ahí el cliente ve el mercado de lo que YA POSEE.
    // Omitir el argumento es deliberado, no un olvido: no "unifiques" pasando el basis también ahí.
    expect(toPublicPriceInfo(info)).toEqual({
      status: 'priced',
      referenceMxnCents: 500_000,
      capturedDate: '2026-08-24',
    });
  });

  it('la PROCEDENCIA (`source`) sigue fuera en toda superficie pública (S48-M2, sin regresión)', () => {
    expect(toPublicPriceInfo(info, 'market')).not.toHaveProperty('source');
    expect(toPublicPriceInfo(info)).not.toHaveProperty('source');
  });
});

describe('D2 · FICHA de single — el `iff` sobre el JSON serializado, en las DOS direcciones', () => {
  it('basis `market` ⇒ el número de mercado ESTÁ (y `priceBasis` también)', async () => {
    const detail = await buildCatalog([ITEM()]).getCard('c1');
    const group = onWire(detail.listings[0]);
    expect(group.priceBasis).toBe('market');
    expect(group.referenceValue).toEqual({
      status: 'priced',
      referenceMxnCents: 500_000,
      capturedDate: '2026-08-24',
    });
  });

  it('basis `override` (pieza con precio manual) ⇒ el número NO está, `priceBasis` SÍ', async () => {
    const detail = await buildCatalog([ITEM({ listPriceCents: 1000 })]).getCard('c1');
    const group = onWire(detail.listings[0]);
    expect(group.priceBasis).toBe('override');
    // La mitad que la UI tenía PROHIBIDO pintar y el backend mandaba igual.
    expect(group.referenceValue).toEqual({ status: 'priced' });
    expect(JSON.stringify(group)).not.toContain('500000');
  });

  it('`units[]` (por-pieza) obedece el MISMO `iff` que el grupo', async () => {
    const detail = await buildCatalog([ITEM({ listPriceCents: 1000 })]).getCard('c1');
    const unit = onWire(detail.units[0]);
    expect(unit.priceBasis).toBe('override');
    expect(unit.referenceValue).toEqual({ status: 'priced' });
  });

  it('GET /catalog/listings/:id — el endpoint del PoC del pentester: `priceBasis` SÍ, número NO', async () => {
    // `priceBasis` se CONSERVA aquí por ECONOMÍA, no por secreto: es detalle por pieza (1 request =
    // 1 carta) y devuelve el mismo `ListingDTO` que `units[]`, donde es público por decisión LOCKED.
    // Lo que se cierra es el LISTADO, que es donde la señal se vuelve mapa.
    const listing = onWire(await buildCatalog([ITEM({ listPriceCents: 1000 })]).getListing('i1'));
    expect(listing.priceBasis).toBe('override');
    expect(listing.referenceValue).toEqual({ status: 'priced' });
  });

  it('GET /catalog/listings/:id con basis `market`: el número SÍ viaja (no se rompió la compra)', async () => {
    const listing = onWire(await buildCatalog([ITEM()]).getListing('i1'));
    expect(listing.priceBasis).toBe('market');
    expect(listing.referenceValue).toMatchObject({ referenceMxnCents: 500_000 });
  });
});

describe('D2 · REJILLA de singles — las dos señales no viajan, en el JSON', () => {
  it('`GET /catalog/cards`: ni `priceBasis` ni `referenceValue`, con basis `market`', async () => {
    const res = await buildCatalog([ITEM()]).listCards({ page: 1, pageSize: 20 } as never);
    const row = onWire(res.data[0]);
    expect(row).not.toHaveProperty('priceBasis');
    expect(row).not.toHaveProperty('referenceValue');
    // Y el precio de venta —lo único que la rejilla necesita— sigue ahí.
    expect(row.salePriceCents).toBe(575_000);
  });

  it('tampoco con basis `override`: la rejilla NO publica el mapa de qué cartas llevan precio a mano', async () => {
    const res = await buildCatalog([ITEM({ listPriceCents: 1000 })]).listCards({ page: 1, pageSize: 20 } as never);
    const row = onWire(res.data[0]);
    expect(row).not.toHaveProperty('priceBasis');
    expect(JSON.stringify(row)).not.toContain('override');
  });
});

describe('D2 · SELLADO — la ficha recorta el número; la rejilla pierde también `priceSource`', () => {
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

  function buildSealed(items: Array<Record<string, unknown>>, ref = MARKET_REF as Record<string, unknown> | undefined) {
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async () => items),
        count: jest.fn(async () => items.length),
        findFirst: jest.fn(async () => items[0]),
      },
      sealedProduct: { findMany: jest.fn(async () => []) },
      card: { findUnique: jest.fn(async () => CARD()) },
    } as unknown as PrismaService;
    const pricing = {
      ...pricingMock(ref),
      getReferencesBatch: jest.fn(async () => new Map(ref ? [['c1|sealed|sealed:tcg:555|normal', ref]] : [])),
    } as unknown as PricingService;
    return new SealedCatalogService(
      prisma,
      pricing,
      {
        getBool: jest.fn(async () => false),
        getNumber: jest.fn(async () => 0),
        getString: jest.fn(async () => 'off'),
      } as unknown as SettingsService,
      new CatalogService(prisma, pricing),
    );
  }

  it('FICHA con basis `market` (spread sobre mercado) ⇒ el número ESTÁ', async () => {
    const { group } = await buildSealed([SEALED()]).sealedDetail('s1');
    const g = onWire(group);
    expect(g.priceBasis).toBe('market');
    expect(g.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 500_000 });
  });

  it('FICHA con override manual ⇒ `priceBasis="override"`, `priceSource="override"` y SIN número', async () => {
    const { group } = await buildSealed([SEALED({ listPriceCents: 999_000 })]).sealedDetail('s1');
    const g = onWire(group);
    expect(g).toMatchObject({ priceBasis: 'override', priceSource: 'override' });
    expect(g.referenceValue).toEqual({ status: 'priced' });
  });

  it('REJILLA: se van `priceBasis`, `referenceValue` Y `priceSource` — de él se DERIVA el basis', async () => {
    // Dejar `priceSource` publicaría la MISMA señal con otro nombre: es el error que v2.1.6 documentó
    // al retirar `isManualOverride` y descubrir que `source` filtraba igual.
    const res = await buildSealed([SEALED({ listPriceCents: 999_000 })]).listSealed({ page: 1, pageSize: 20 } as never);
    const row = onWire(res.data[0]);
    expect(row).not.toHaveProperty('priceBasis');
    expect(row).not.toHaveProperty('priceSource');
    expect(row).not.toHaveProperty('referenceValue');
    expect(JSON.stringify(row)).not.toContain('override');
  });

  it('la rejilla de sellado conserva lo que sí necesita (precio «desde», conteo, identidad)', async () => {
    const res = await buildSealed([SEALED({ listPriceCents: 999_000 })]).listSealed({ page: 1, pageSize: 20 } as never);
    expect(res.data[0]).toMatchObject({
      fromPriceCents: 999_000,
      availableCount: 1,
      productName: 'Surging Sparks Booster Box',
      currency: 'MXN',
    });
  });
});
