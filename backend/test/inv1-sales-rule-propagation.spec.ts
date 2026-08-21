import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingKey } from '../src/modules/settings/settings.constants';

/**
 * INV-1 — Prueba de propagación END-TO-END (backend, sin DB real):
 *   REAL SettingsService + REAL PricingService + REAL CatalogService cableados sobre un
 *   PrismaService mock con un store en memoria de ConfigSetting.
 *
 * Objetivo: demostrar que tras CAMBIAR `SALES_PRICE_RULES` (persistencia = el MISMO
 * `prisma.configSetting.upsert` que hace `PricingController.putSalesRules`), el
 * `CatalogService.toListingDTO` de un item de plataforma `listed` SIN `listPriceCents`
 * devuelve el NUEVO `salePriceCents` derivado de la regla — probando que el backend
 * SÍ propaga el cambio en tiempo de lectura.
 *
 * NOTA sobre "vía SettingsService.update": `sales_price_rules` NO está en `SETTING_DTO_MAP`,
 * así que `SettingsService.update({ salesPriceRules })` lo RECHAZA ('unknown setting key').
 * El camino de escritura REAL de producción es `PricingController.putSalesRules` →
 * `prisma.configSetting.upsert(key='sales_price_rules')`. La prueba usa ese mismo upsert y lo
 * documenta explícitamente (último `it`).
 */

// ---- Store en memoria de ConfigSetting + PrismaService mock ----
function makePrisma(item: any) {
  const configStore = new Map<string, unknown>();
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
      ),
      upsert: jest.fn(async ({ where: { key }, create, update }: any) => {
        const valueJson = configStore.has(key) ? update.valueJson : create.valueJson;
        configStore.set(key, valueJson);
        return { key, valueJson };
      }),
    },
    // Sin PriceReference: el item Common resuelve por regla `fixed` (piso, no depende de market).
    priceReference: { findFirst: jest.fn(async () => null), findMany: jest.fn(async () => []) },
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

function persistSalesRules(prisma: PrismaService, rules: Record<string, unknown>) {
  // Réplica EXACTA del upsert de PricingController.putSalesRules (camino de escritura real).
  return (prisma as any).configSetting.upsert({
    where: { key: SettingKey.SALES_PRICE_RULES },
    create: { key: SettingKey.SALES_PRICE_RULES, valueJson: rules, updatedBy: 'admin' },
    update: { valueJson: rules, updatedBy: 'admin' },
  });
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

describe('INV-1 — propagación de SALES_PRICE_RULES a /catalog (Settings+Pricing+Catalog reales)', () => {
  it('cambiar la regla fixed de Common MUEVE el salePriceCents de toListingDTO (sin ctx)', async () => {
    const item = platformItem();
    const { prisma, pricing, catalog } = wire(item);

    // Estado inicial = default sembrado (Common fixed 500) leído por el SettingsService real.
    const before = await pricing.loadSalesRules();
    expect(before.rules['Common']).toEqual({ mode: 'fixed', value: 500 });

    const dto0 = await catalog.toListingDTO(item as any);
    expect(dto0.salePriceCents).toBe(500);
    expect(dto0.sellable).toBe(true);

    // Cambia la regla por el MISMO upsert que usa PricingController.putSalesRules.
    await persistSalesRules(prisma, {
      Common: { mode: 'fixed', value: 900 },
      Uncommon: { mode: 'fixed', value: 1000 },
      Holo: { mode: 'fixed', value: 1000 },
      'Reverse Holo': { mode: 'fixed', value: 1000 },
    });

    const after = await pricing.loadSalesRules();
    expect(after.rules['Common']).toEqual({ mode: 'fixed', value: 900 });

    const dto1 = await catalog.toListingDTO(item as any);
    expect(dto1.salePriceCents).toBe(900); // <-- el precio SE MOVIÓ: backend propaga.
    expect(dto1.sellable).toBe(true);
  });

  it('el cambio también se ve a través de listCards → fetchSellable (ruta de request completa)', async () => {
    const item = platformItem();
    const { prisma, catalog } = wire(item);

    const page0 = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(page0.data).toHaveLength(1);
    expect(page0.data[0].salePriceCents).toBe(500);

    await persistSalesRules(prisma, { Common: { mode: 'fixed', value: 1234 } });

    const page1 = await catalog.listCards({ page: 1, pageSize: 20 });
    expect(page1.data[0].salePriceCents).toBe(1234); // propagación en la ruta pública real.
  });

  it('listPriceCents (override manual) SOMBREA la regla: el precio queda CONGELADO (angle c)', async () => {
    const item = platformItem({ listPriceCents: 4242 });
    const { prisma, catalog } = wire(item);

    const dto0 = await catalog.toListingDTO(item as any);
    expect(dto0.salePriceCents).toBe(4242);

    await persistSalesRules(prisma, { Common: { mode: 'fixed', value: 900 } });

    const dto1 = await catalog.toListingDTO(item as any);
    expect(dto1.salePriceCents).toBe(4242); // el override gana; cambiar la regla NO lo mueve.
  });

  it('SettingsService.update NO puede escribir sales_price_rules (no está en SETTING_DTO_MAP)', async () => {
    const { settings } = wire(platformItem());
    await expect(
      settings.update({ salesPriceRules: { Common: { mode: 'fixed', value: 900 } } } as any),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    // Confirma que el único camino de escritura de reglas de venta es PricingController.putSalesRules.
  });
});
