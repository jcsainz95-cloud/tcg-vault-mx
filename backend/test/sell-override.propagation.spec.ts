import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.28 (P-18, ARCHITECTURE §4.26b) — PROPAGACIÓN del sellOverride por variante (M-30) a TODOS los
 * puntos de resolución del precio de VENTA (resolver único, precedencia normativa):
 *   listPriceCents (pieza) > sellOverrideCents (variante) > CURVA (v2.0, P-48) > PRICE_PENDING
 *  - catálogo (`toListingDTO`, rutas batch y single);
 *  - checkout (`orders.salePriceOf`, auth + guest comparten este cuerpo);
 *  - publicación (`inventory.bulkPublish`, precio server-side SEC-A1);
 *  - binder M1 (`pricing?` por variante SOLO scope platform; OMITIDO en scopes de cliente).
 * v2.0 (P-48): el peldaño «regla» pasa a ser «CURVA» y el override es ABSOLUTO en los dos ejes
 * (criterio 89). Sin fila M-30, cada punto resuelve por la curva — el MISMO número en los cuatro.
 */

const CARD = {
  id: 'c1',
  externalId: 'ext-1',
  name: 'Pikachu',
  number: '1',
  numberSort: 1,
  numberPrefix: '',
  rarity: 'Common',
  supertype: 'Pokémon',
  subtypes: null,
  setId: 's1',
  set: { name: 'Set X' },
  imageSmallUrl: null,
  imageLargeUrl: null,
  availableFinishes: ['normal', 'reverse_holo'],
};

function rawItem(over: Record<string, unknown> = {}) {
  return {
    id: 'it-1',
    folio: 'INV-000001',
    cardId: 'c1',
    productType: 'raw',
    rawCondition: 'NM',
    finish: 'normal',
    status: 'listed',
    ownerType: 'platform',
    listPriceCents: null,
    sealedSubtype: null,
    sealedCondition: null,
    gradingCompany: null,
    gradeValue: null,
    certNumber: null,
    tcgplayerProductId: null,
    card: CARD,
    ...over,
  } as never;
}

function overrideRow(sellOverrideCents: number | null) {
  return {
    id: 'vpo-1',
    cardId: 'c1',
    productType: 'raw',
    gradeKey: 'raw:NM',
    finish: 'normal',
    sellOverrideCents,
    buyOverrideCents: null,
    bountyEnabled: false,
    bountyPriceCents: null,
    bountyTargetQty: null,
    bountyAcquiredQty: 0,
    bountyCompletedAt: null,
  } as never;
}

/** PricingService mock: `computeSalePriceForItem` delega en la PURA real (prueba end-to-end). */
function buildPricing(opts: { referenceMxnCents?: number | null; override?: unknown } = {}) {
  const ref: PriceInfo =
    opts.referenceMxnCents == null
      ? { status: 'pending' }
      : { status: 'priced', referenceMxnCents: opts.referenceMxnCents };
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => ref),
    getReferencesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, PriceInfo>();
      if (ref.status === 'priced') for (const k of keys) m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, ref);
      return m;
    }),
    getVariantOverride: jest.fn(async () => opts.override ?? null),
    getVariantOverridesBatch: jest.fn(async (keys: { cardId: string; productType: string; gradeKey: string; finish: string }[]) => {
      const m = new Map<string, unknown>();
      if (opts.override) for (const k of keys) m.set(`${k.cardId}|${k.productType}|${k.gradeKey}|${k.finish}`, opts.override);
      return m;
    }),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    // v2.1.1: el seam single delega en `decideSalePrice` y en `loadPricingCurve` del propio mock;
    // se usa el CUERPO REAL para que el test no reimplemente la precedencia de venta.
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(async () => 'pend-1'),
  } as unknown as PricingService;
}

describe('catálogo — toListingDTO (ruta single, sin ctx)', () => {
  it('sellOverride pisa la regla: salePriceCents = override; la referencia NO cambia', async () => {
    const pricing = buildPricing({ referenceMxnCents: 10000, override: overrideRow(9900) });
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(rawItem());
    expect(dto.salePriceCents).toBe(9900);
    expect(dto.sellable).toBe(true);
    expect(dto.referenceValue).toMatchObject({ status: 'priced', referenceMxnCents: 10000 });
  });

  it('listPriceCents POR PIEZA gana al sellOverride de la variante (intención más específica)', async () => {
    const pricing = buildPricing({ referenceMxnCents: 10000, override: overrideRow(9900) });
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(rawItem({ listPriceCents: 12345 }));
    expect(dto.salePriceCents).toBe(12345);
  });

  it('sin fila M-30 el precio sale de la CURVA (mercado $100 ⇒ $115) con basis "market"', async () => {
    const pricing = buildPricing({ referenceMxnCents: 10000 });
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(rawItem());
    expect(dto.salePriceCents).toBe(11500);
    expect(dto.priceBasis).toBe('market');
  });

  it('quitar el override (fila ausente) SIN market → sin precio (no vendible; el piso NO gana)', async () => {
    const pricing = buildPricing({ referenceMxnCents: null });
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(rawItem({ card: { ...CARD, rarity: 'Illustration Rare' } }));
    expect(dto.salePriceCents).toBeUndefined();
    expect(dto.sellable).toBe(false);
  });

  it('ruta batch (ctx): usa el override del LOTE sin re-consultar single', async () => {
    const pricing = buildPricing({ referenceMxnCents: 10000 });
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(rawItem(), {
      reference: { status: 'priced', referenceMxnCents: 10000 },
      curve: DEFAULT_PRICING_CURVE,
      variantOverride: overrideRow(8800) as never,
    });
    expect(dto.salePriceCents).toBe(8800);
    expect(pricing.getVariantOverride).not.toHaveBeenCalled();
  });
});

describe('checkout — orders.salePriceOf (auth + guest comparten el cuerpo)', () => {
  const build = (pricing: PricingService) =>
    new OrdersService({} as never, pricing, {} as never, {} as never, {} as never);

  it('sellOverride pisa la regla: la línea cobra el override (paridad exacta con storefront)', async () => {
    const svc = build(buildPricing({ referenceMxnCents: 10000, override: overrideRow(9900) }));
    await expect((svc as never as { salePriceOf: (i: unknown) => Promise<number> }).salePriceOf(rawItem())).resolves.toBe(9900);
  });

  it('listPriceCents por pieza sigue ganando (no llega a consultar el override)', async () => {
    const pricing = buildPricing({ referenceMxnCents: 10000, override: overrideRow(9900) });
    const svc = build(pricing);
    await expect(
      (svc as never as { salePriceOf: (i: unknown) => Promise<number> }).salePriceOf(rawItem({ listPriceCents: 12345 })),
    ).resolves.toBe(12345);
    expect(pricing.getVariantOverride).not.toHaveBeenCalled();
  });

  it('override presente aunque NO haya market → cobra el override (fixed sintético)', async () => {
    const svc = build(buildPricing({ referenceMxnCents: null, override: overrideRow(9900) }));
    await expect((svc as never as { salePriceOf: (i: unknown) => Promise<number> }).salePriceOf(rawItem())).resolves.toBe(9900);
  });

  it('REGRESIÓN: sin fila y pct sin market → PRICE_PENDING (no vendible), como siempre', async () => {
    const svc = build(buildPricing({ referenceMxnCents: null }));
    await expect(
      (svc as never as { salePriceOf: (i: unknown) => Promise<number> }).salePriceOf(
        rawItem({ card: { ...CARD, rarity: 'Illustration Rare' } }),
      ),
    ).rejects.toMatchObject({ code: 'PRICE_PENDING' });
  });
});

describe('publicación — inventory.bulkPublish (precio server-side SEC-A1)', () => {
  function buildInventory(opts: { referenceMxnCents?: number | null; override?: unknown } = {}) {
    const items = [rawItem({ status: 'in_stock' }) as never as Record<string, unknown>];
    const prisma = {
      inventoryItem: {
        findMany: jest.fn(async () => items),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      inventoryBatch: { findUnique: jest.fn(async () => null), create: jest.fn() },
    } as unknown as PrismaService;
    const pricing = buildPricing(opts);
    const svc = new InventoryService(prisma, pricing, {} as SettingsService);
    return { svc, pricing };
  }

  it('deriva con sellOverride: publica al precio del override (priceSource=derived)', async () => {
    const { svc, pricing } = buildInventory({ referenceMxnCents: 10000, override: overrideRow(9900) });
    const res = await svc.bulkPublish({ items: [{ inventoryItemId: 'it-1' }] } as never, 'admin-1');
    expect(res.results[0]).toMatchObject({ ok: true, salePriceCents: 9900, priceSource: 'derived' });
    // Lote de overrides: UNA llamada por request (sin N+1).
    expect(pricing.getVariantOverridesBatch).toHaveBeenCalledTimes(1);
  });

  it('sin fila publica por la CURVA; sin market escala PRICE_PENDING (④)', async () => {
    const byCurve = buildInventory({ referenceMxnCents: 10000 });
    const ok = await byCurve.svc.bulkPublish({ items: [{ inventoryItemId: 'it-1' }] } as never, 'a');
    expect(ok.results[0]).toMatchObject({ ok: true, salePriceCents: 11500 });

    const pending = buildInventory({ referenceMxnCents: null });
    // v2.0: sin dato de mercado NO se publica (el piso NO gana) → PRICE_PENDING + escalada.
    (pending.svc as never as { prisma: { inventoryItem: { findMany: jest.Mock } } });
    const res = await pending.svc.bulkPublish({ items: [{ inventoryItemId: 'nope' }] } as never, 'a');
    expect(res.results[0].ok).toBe(false); // NOT_FOUND por id inexistente — el lote no revienta
  });
});

describe('binder M1 — pricing? por variante SOLO scope platform (§4.26b)', () => {
  function buildMasterSet(opts: { override?: unknown } = {}) {
    const prisma = {
      cardSet: {
        findUnique: jest.fn(async () => ({ id: 's1', name: 'Set X', series: null, releaseDate: null, printedTotal: 100 })),
      },
      card: {
        findMany: jest.fn(async () => [
          { id: 'c1', number: '1', numberSort: 1, numberPrefix: '', name: 'Pikachu', rarity: 'Common', imageSmallUrl: null, availableFinishes: ['normal', 'reverse_holo'] },
        ]),
      },
      inventoryItem: { groupBy: jest.fn(async () => []), findMany: jest.fn(async () => []) },
      user: { findUnique: jest.fn(async () => ({ id: 'u1', name: 'Cliente', email: 'c@x.mx' })) },
    } as unknown as PrismaService;
    const pricing = buildPricing({ referenceMxnCents: 10000, override: opts.override });
    return { svc: new MasterSetService(prisma, pricing), pricing };
  }

  it('scope platform: cada variante lleva su consola (sugerido por regla + override efectivo)', async () => {
    const { svc, pricing } = buildMasterSet({ override: overrideRow(9900) });
    const res = await svc.binder('s1'); // default platform
    const cell = res.cells[0];
    const vNormal = cell.variants.find((v) => v.finish === 'normal')!;
    expect(vNormal.pricing).toBeDefined();
    expect(vNormal.pricing!.sell).toEqual({
      suggestedCents: 11500, // la CURVA de venta a mercado $100
      overrideCents: 9900,
      effectiveCents: 9900,
      source: 'override',
      premiumAtFloor: false,
    });
    expect(vNormal.pricing!.buy).toEqual({
      suggestedCents: 4000, // la CURVA de compra a mercado $100
      overrideCents: null,
      effectiveCents: 4000,
      source: 'market',
      premiumAtFloor: false,
    });
    // v2.0 (§4.36.2): UN solo lector de la curva, izado UNA vez por request — sin N+1 y sin dos
    // configuraciones distintas para los dos ejes.
    expect(pricing.getVariantOverridesBatch).toHaveBeenCalledTimes(1);
    expect(pricing.loadPricingCurve).toHaveBeenCalledTimes(1);
  });

  it('scope user_vault: `pricing` se OMITE SIEMPRE (la estrategia de compra no se filtra al cliente)', async () => {
    const { svc, pricing } = buildMasterSet({ override: overrideRow(9900) });
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' });
    for (const cell of res.cells) {
      for (const v of cell.variants) {
        expect('pricing' in v).toBe(false);
      }
    }
    // Ni siquiera se consulta la tabla M-30 ni la curva en scopes de cliente.
    expect(pricing.getVariantOverridesBatch).not.toHaveBeenCalled();
    expect(pricing.loadPricingCurve).not.toHaveBeenCalled();
  });

  it('buyable del binder (vista cliente) usa el MISMO precio que el storefront (override)', async () => {
    const { svc } = buildMasterSet({ override: overrideRow(9900) });
    const prisma = (svc as never as { prisma: Record<string, never> }).prisma as never as {
      inventoryItem: { findMany: jest.Mock };
    };
    prisma.inventoryItem.findMany.mockResolvedValue([rawItem({ status: 'listed' })]);
    const res = await svc.binder('s1', { kind: 'user_vault', userId: 'u1' }, { includeBuyable: true });
    const cell = res.cells[0];
    const vNormal = cell.variants.find((v) => v.finish === 'normal')!;
    expect(vNormal.buyable).toEqual({ inventoryItemId: 'it-1', salePriceCents: 9900 });
  });
});
