import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_PRICING_CURVE, PricingCurve } from '../src/common/pricing-curve';

/**
 * INV-1 — Prueba de propagación END-TO-END (backend, sin DB real):
 *   REAL SettingsService + REAL PricingService + REAL CatalogService cableados sobre un
 *   PrismaService mock con un store en memoria de ConfigSetting.
 *
 * v2.0 (P-48, §4.36.8/§4.36.9c): el dial que se mueve ya no es `SALES_PRICE_RULES` sino **la CURVA**
 * (`pricing_curve`). Objetivo intacto y ahora más importante: demostrar que **mover un punto REPRECIA
 * en LECTURA, sin re-publicar nada** — que es exactamente por qué el cut-over no necesita migración de
 * dinero (el precio de venta NO está persistido, §4.36.9c).
 *
 * NOTA sobre "vía SettingsService.update": `pricing_curve` NO está en `SETTING_DTO_MAP`, así que
 * `SettingsService.update({ pricingCurve })` lo RECHAZA. El camino de escritura REAL es
 * `PUT /admin/pricing/curve` → `prisma.configSetting.upsert(key='pricing_curve')`. La prueba usa ese
 * mismo upsert y lo documenta explícitamente (último `it`).
 */

// ---- Store en memoria de ConfigSetting + PrismaService mock ----
function makePrisma(item: any) {
  const configStore = new Map<string, unknown>();
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
      ),
      // v1.44 (§4.35d): `SettingsService.getRawMany` lee VARIAS claves en una query y devuelve SOLO
      // las filas EXISTENTES (una clave ausente no aparece — así se distingue de «presente con seed»).
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => configStore.has(k))
          .map((k) => ({ key: k, valueJson: configStore.get(k) })),
      ),
      upsert: jest.fn(async ({ where: { key }, create, update }: any) => {
        const valueJson = configStore.has(key) ? update.valueJson : create.valueJson;
        configStore.set(key, valueJson);
        return { key, valueJson };
      }),
    },
    // v2.0: el precio SALE del mercado, así que el item necesita su `PriceReference` ($100 de mercado).
    priceReference: {
      findFirst: jest.fn(async () => null),
      findMany: jest.fn(async () => [
        {
          priceMxnCents: 10000,
          priceUsdCents: null,
          fxRate: null,
          fxBufferPct: null,
          source: 'tcgcsv_singles',
          isManualOverride: false,
          cardProductId: null,
          capturedDate: new Date('2026-08-24'),
          id: 'pr1',
        },
      ]),
    },
    // v1.28 (P-18): sin filas M-30 por default (comportamiento previo).
    variantPriceOverride: { findMany: jest.fn(async () => []) },
    inventoryItem: { findMany: jest.fn(async () => [item]) },
  } as unknown as PrismaService;
  return { prisma, configStore };
}

// FX que devuelve null → fxSnapshotSafe() = null (sin recomputo); nunca lanza.
const fxStub = { getCurrent: jest.fn(async () => null) } as unknown as FxService;

function wire(item: any) {
  const { prisma, configStore } = makePrisma(item);
  const settings = new SettingsService(prisma);
  const pricing = new PricingService(prisma, settings, fxStub, {} as any, {} as any, {} as any);
  const catalog = new CatalogService(prisma, pricing);
  return { prisma, configStore, settings, pricing, catalog };
}

/** Réplica EXACTA del upsert de `PUT /admin/pricing/curve` (camino de escritura real de M2). */
function persistCurve(prisma: PrismaService, curve: PricingCurve) {
  return (prisma as unknown as { configSetting: { upsert: (a: unknown) => Promise<unknown> } }).configSetting.upsert({
    where: { key: SettingKey.PRICING_CURVE },
    create: { key: SettingKey.PRICING_CURVE, valueJson: curve, updatedBy: 'admin' },
    update: { valueJson: curve, updatedBy: 'admin' },
  });
}

/** El seed de §N.2 con el PISO movido (el dial más sensible del eje de venta). */
function curveWithFloor(floorCents: number): PricingCurve {
  const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
  c.sale.floorCents = floorCents;
  return c;
}

/** El seed con el markup del tramo alto movido (mueve el precio de las cartas con mercado). */
function curveWithTopMultiplier(multiplierBp: number): PricingCurve {
  const c = JSON.parse(JSON.stringify(DEFAULT_PRICING_CURVE)) as PricingCurve;
  c.sale.points[1].multiplierBp = multiplierBp;
  return c;
}

function platformItem(over: Partial<any> = {}) {
  const card = {
    id: 'c1', externalId: 'x', name: 'Pikachu', number: '1', numberSort: 1, numberPrefix: '',
    rarity: 'Common', supertype: 'Pokémon', subtypes: [], setId: 's',
    imageSmallUrl: null, imageLargeUrl: null, availableFinishes: ['normal'],
    set: { id: 's', name: 'Base Set', releaseDate: '1999/01/09' },
  };
  return {
    id: 'i1', cardId: 'c1', productType: 'raw', rawCondition: 'NM', sealedSubtype: null,
    sealedCondition: null, gradingCompany: null, gradeValue: null, certNumber: null,
    status: 'listed', ownerType: 'platform', finish: 'normal', tcgplayerProductId: null,
    listPriceCents: null, createdAt: new Date('2026-08-01'), card, ...over,
  };
}

describe('INV-1 — propagación de la CURVA a /catalog (Settings+Pricing+Catalog reales)', () => {
  it('mover un PUNTO de la curva MUEVE el salePriceCents de toListingDTO (repricio EN LECTURA)', async () => {
    const item = platformItem();
    const { prisma, pricing, catalog } = wire(item);

    // Estado inicial = seed de §N.2 leído por el SettingsService real: $100 × 1.15 = $115.
    const before = await pricing.loadPricingCurve();
    expect(before.sale.points[1]).toEqual({ marketCents: 8000, multiplierBp: 11500 });

    const dto0 = await catalog.toListingDTO(item as never);
    expect(dto0.salePriceCents).toBe(11500);
    expect(dto0.priceBasis).toBe('market');
    expect(dto0.sellable).toBe(true);

    // El dueño sube el markup del tramo alto a 1.40× por el MISMO upsert de PUT /admin/pricing/curve.
    await persistCurve(prisma, curveWithTopMultiplier(14000));

    const after = await pricing.loadPricingCurve();
    expect(after.sale.points[1].multiplierBp).toBe(14000);

    const dto1 = await catalog.toListingDTO(item as never);
    // $100 × 1.40 = $140 (múltiplo de $5, el redondeo no lo mueve). SIN re-publicar la pieza.
    expect(dto1.salePriceCents).toBe(14000);
    expect(dto1.sellable).toBe(true);
  });

  it('el cambio también se ve a través de listCards → fetchSellable (ruta de request completa)', async () => {
    const item = platformItem();
    const { prisma, catalog } = wire(item);

    const page0 = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(page0.data).toHaveLength(1);
    expect(page0.data[0].salePriceCents).toBe(11500);

    await persistCurve(prisma, curveWithTopMultiplier(20000));

    const page1 = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(page1.data[0].salePriceCents).toBe(20000); // propagación en la ruta pública real.
  });

  it('subir el PISO por encima del mercado cambia el basis a "floor" (y la ficha oculta el mercado)', async () => {
    const item = platformItem();
    const { prisma, catalog } = wire(item);

    expect((await catalog.toListingDTO(item as never)).priceBasis).toBe('market');

    // Piso $2,000 > $100 × 1.15 ⇒ el piso gana el `max`.
    await persistCurve(prisma, curveWithFloor(200000));

    const dto = await catalog.toListingDTO(item as never);
    expect(dto.salePriceCents).toBe(200000);
    expect(dto.priceBasis).toBe('floor'); // §N.7: con `floor` el bloque «Valor de mercado» DESAPARECE
  });

  it('listPriceCents (override manual) SOMBREA la curva: el precio queda CONGELADO (angle c)', async () => {
    const item = platformItem({ listPriceCents: 4242 });
    const { prisma, catalog } = wire(item);

    const dto0 = await catalog.toListingDTO(item as never);
    expect(dto0.salePriceCents).toBe(4242);
    expect(dto0.priceBasis).toBe('override');

    await persistCurve(prisma, curveWithTopMultiplier(20000));

    const dto1 = await catalog.toListingDTO(item as never);
    expect(dto1.salePriceCents).toBe(4242); // el override gana; mover la curva NO lo mueve (criterio 89).
  });

  it('SettingsService.update NO puede escribir pricing_curve (no está en SETTING_DTO_MAP)', async () => {
    const { settings } = wire(platformItem());
    await expect(
      settings.update({ pricingCurve: DEFAULT_PRICING_CURVE } as never),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Confirma que el único camino de escritura de la curva es PUT /admin/pricing/curve.
  });
});
