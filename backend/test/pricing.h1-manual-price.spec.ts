import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { firstPresentAmount, hasManualPrice, isPresentAmount } from '../src/common/money';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import {
  BulkPublishLineInput,
  CreateItemDto,
  UpdateItemDto,
} from '../src/modules/inventory/dto/inventory.dto';

/**
 * E5-bis (v2.1.4, ARCHITECTURE §4.36.6) — **H-1 en el peldaño 1 de la precedencia de venta**.
 *
 * La doctrina «presente ⇔ `> 0`» estaba bien resuelta para los overrides de VARIANTE (M-30) y para el
 * SELLADO, pero el `listPriceCents` POR PIEZA no la heredó: `orders` exigía `> 0` y otros cinco seams
 * solo `!= null`. Efecto de un `listPriceCents = 0`: el **checkout** lo trataba como ausente y cobraba
 * la curva, mientras **storefront**, **binder** y **publicación** lo daban por presente y resolvían a
 * `0` ⇒ no vendible. La misma pieza, cuatro comportamientos.
 *
 * La dirección de la unificación es la de `orders` (§N.0): que la pieza quede priceada **por curva**
 * —quizá más cara de lo que alguien tecleó— es el error RECUPERABLE; que quede invisible o se venda en
 * `0` es el irrecuperable.
 *
 * **Prohibido repetir el `> 0` a mano**: así se llegó al hueco. Hay UN predicado y los seis lo llaman.
 */

const CARD = {
  id: 'c1',
  name: 'Pikachu',
  number: '25',
  rarity: 'Common',
  rarityCanonical: 'comun',
  setId: 's1',
  availableFinishes: ['normal'],
  set: { id: 's1', name: 'Base' },
};

const ITEM = (over: Record<string, unknown> = {}) => ({
  id: 'i1',
  folio: 'INV-000001',
  cardId: 'c1',
  productType: 'raw',
  rawCondition: 'NM',
  finish: 'normal',
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  sealedSubtype: null,
  ownerType: 'platform',
  status: 'listed',
  listPriceCents: 0, // ⚠️ el estado degenerado que D5 destapó
  createdAt: new Date('2026-08-01'),
  card: CARD,
  ...over,
});

/** Mercado $1,000 ⇒ la curva vende a $1,150 (1.15×, múltiplo de $25: no se mueve). */
const MARKET = 100000;
const CURVE_PRICE = 115000;

function pricingMock() {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
    gradeKeyFor: jest.fn(() => 'raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: MARKET })),
    getReferencesBatch: jest.fn(async () => new Map([['c1|raw|raw:NM|normal', { status: 'priced', referenceMxnCents: MARKET }]])),
    getVariantOverride: jest.fn(async () => null),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getSeparateProductsByCard: jest.fn(async () => new Map()),
    getPricedRawFinishesBatch: jest.fn(async () => new Map()),
    loadSealedSpreads: jest.fn(async () => ({ spreadPctBySubtype: {}, fallbackPct: 25, sourceOn: false })),
    settlePendingForVariant: jest.fn(async () => undefined),
  } as unknown as PricingService;
}

describe('E5-bis — el predicado H-1 es UNO (§4.36.6)', () => {
  it('`isPresentAmount`: solo `> 0` cuenta como presente', () => {
    expect(isPresentAmount(1)).toBe(true);
    expect(isPresentAmount(0)).toBe(false);
    expect(isPresentAmount(-5)).toBe(false);
    expect(isPresentAmount(null)).toBe(false);
    expect(isPresentAmount(undefined)).toBe(false);
  });

  it('`hasManualPrice`: un `0` es AUSENTE ⇒ cae al siguiente peldaño', () => {
    expect(hasManualPrice({ listPriceCents: 9900 })).toBe(true);
    expect(hasManualPrice({ listPriceCents: 0 })).toBe(false);
    expect(hasManualPrice({ listPriceCents: null })).toBe(false);
    expect(hasManualPrice({})).toBe(false);
  });

  it('`firstPresentAmount` NO es `??`: un `0` no cortocircuita el siguiente peldaño', () => {
    // Éste era el bug de `inventory:2211` — el `0` tapaba el sellOverride de la variante.
    const zero: number | null = 0;
    expect(zero ?? 5000).toBe(0); // lo que hacía antes
    expect(firstPresentAmount(0, 5000)).toBe(5000); // lo que dice §4.36.6
    expect(firstPresentAmount(null, undefined, 0, 7000)).toBe(7000);
    expect(firstPresentAmount(0, null)).toBeNull();
    expect(firstPresentAmount(9900, 5000)).toBe(9900); // la intención más específica sigue ganando
  });
});

describe('E5-bis — una pieza con `listPriceCents = 0` da el MISMO precio en TODAS las superficies', () => {
  it('storefront / ficha (`toListingDTO`): cobra la CURVA, no $0 — y es vendible', async () => {
    const pricing = pricingMock();
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(ITEM() as never);
    expect(dto.salePriceCents).toBe(CURVE_PRICE);
    expect(dto.priceBasis).toBe('market'); // NO 'override': el 0 no es un override
    expect(dto.sellable).toBe(true); // antes: false, la pieza desaparecía de Compra
  });

  it('checkout (`orders.quote`): el MISMO número que el storefront', async () => {
    const pricing = pricingMock();
    const prisma = { inventoryItem: { findMany: jest.fn(async () => [ITEM()]) } } as unknown as PrismaService;
    const settings = {
      getNumber: jest.fn(async () => 16),
      getStripeFee: jest.fn(async () => ({ stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 })),
    } as unknown as SettingsService;
    const svc = new OrdersService(prisma, pricing, settings, {} as StripeService, {} as CatalogService);
    const res = await svc.quote(['i1']);
    expect(res.items[0].unitPriceCents).toBe(CURVE_PRICE);
  });

  it('publicación (`resolvePublishSalePrice`): deriva por la curva en vez de listar a $0', async () => {
    const { InventoryService } = await import('../src/modules/inventory/inventory.service');
    const pricing = pricingMock();
    const svc = new InventoryService({} as PrismaService, pricing, {} as SettingsService);
    const ctx = await (svc as never as { loadPublishPricingCtx: (i: unknown[]) => Promise<unknown> })
      .loadPublishPricingCtx([ITEM({ status: 'in_stock' })]);
    const resolved = await (
      svc as never as {
        resolvePublishSalePrice: (i: unknown, l: number | null, c: unknown) => Promise<{ ok: boolean; salePriceCents?: number; priceSource?: string }>;
      }
    ).resolvePublishSalePrice(ITEM({ status: 'in_stock' }), null, ctx);
    expect(resolved).toMatchObject({ ok: true, salePriceCents: CURVE_PRICE, priceSource: 'derived' });
  });

  it('un `0` en la LÍNEA de bulk-publish no enmascara el override de la PIEZA', async () => {
    const { InventoryService } = await import('../src/modules/inventory/inventory.service');
    const pricing = pricingMock();
    const svc = new InventoryService({} as PrismaService, pricing, {} as SettingsService);
    const item = ITEM({ status: 'in_stock', listPriceCents: 9900 });
    const ctx = await (svc as never as { loadPublishPricingCtx: (i: unknown[]) => Promise<unknown> }).loadPublishPricingCtx([item]);
    const resolved = await (
      svc as never as {
        resolvePublishSalePrice: (i: unknown, l: number | null, c: unknown) => Promise<{ salePriceCents?: number; priceSource?: string }>;
      }
    ).resolvePublishSalePrice(item, 0, ctx);
    // Con `??` el `0` de la línea ganaba y publicaba a $0.
    expect(resolved).toMatchObject({ salePriceCents: 9900, priceSource: 'manual' });
  });

  it('el override MANUAL legítimo (`> 0`) sigue ganando en todas partes (no se cambió nada sano)', async () => {
    const pricing = pricingMock();
    const svc = new CatalogService({} as PrismaService, pricing);
    const dto = await svc.toListingDTO(ITEM({ listPriceCents: 9900 }) as never);
    expect(dto.salePriceCents).toBe(9900);
    expect(dto.priceBasis).toBe('override');
  });
});

describe('E5-bis — la ESCRITURA impide crear el estado (`@Min(1)`, cinturón y tirantes)', () => {
  const cases: Array<[string, new () => object, Record<string, unknown>]> = [
    ['POST /admin/inventory/items', CreateItemDto, { cardId: 'c1', productType: 'raw', rawCondition: 'NM' }],
    ['PATCH /admin/inventory/items/:id', UpdateItemDto, {}],
    ['líneas de bulk-publish', BulkPublishLineInput, { inventoryItemId: 'i1' }],
  ];

  it.each(cases)('%s rechaza `listPriceCents: 0`', async (_label, Dto, base) => {
    const errs = await validate(plainToInstance(Dto, { ...base, listPriceCents: 0 }));
    expect(errs.some((e) => e.property === 'listPriceCents')).toBe(true);
  });

  it.each(cases)('%s acepta `listPriceCents: 1` y la ausencia', async (_label, Dto, base) => {
    expect(
      (await validate(plainToInstance(Dto, { ...base, listPriceCents: 1 }))).some((e) => e.property === 'listPriceCents'),
    ).toBe(false);
    expect(
      (await validate(plainToInstance(Dto, { ...base }))).some((e) => e.property === 'listPriceCents'),
    ).toBe(false);
  });
});
