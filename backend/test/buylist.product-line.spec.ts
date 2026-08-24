import { ConfigService } from '@nestjs/config';
import { BuylistService } from '../src/modules/buylist/buylist.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.30 (M-32, ARCHITECTURE §4.29) — LÍNEA de buylist por `productId`: cotizar/vender un `CardProduct`
 * SEPARADO (deck_exclusive/promo) como línea PROPIA. Con `productId`: whitelist de acabado =
 * CardProduct.finishes; referencia por su cardProductId; errores PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH.
 * Sin `productId`: comportamiento v1.29 idéntico (retrocompatible). Unicidad: dos líneas con mismo
 * (cardId, finish) y distinto productId son DISTINTAS. SEC-A1 + money-safe intactos.
 */

const pii = new PiiCryptoService(new ConfigService({}));

/** CardProduct simulado, resuelto por tcgplayerProductId. */
interface FakeProduct {
  id: string; // UUID interno
  cardId: string;
  finishes: string[];
}

function svcWith(opts: {
  cardRarity?: string | null;
  availableFinishes?: string[];
  // productos separados por tcgplayerProductId
  products?: Record<number, FakeProduct>;
  // referencia por (cardProduct.id | finish) → cents (o ausente = pending)
  productRefs?: Record<string, number>;
  // referencia del set_base por finish
  baseRefMxnCents?: number | null;
  fallbackPct?: number;
}): {
  svc: BuylistService;
  pricing: {
    findCardProductByTcgId: jest.Mock;
    getReferenceByCardProduct: jest.Mock;
    getReference: jest.Mock;
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.Mock;
    escalatePending: jest.Mock;
  };
} {
  const prisma: any = {
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: opts.cardRarity ?? 'Common',
        availableFinishes: opts.availableFinishes ?? ['normal', 'reverse_holo', 'holofoil'],
      }),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
      // (`this` = este objeto `card`), para no duplicar datos ni criterios.
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
  };
  const products = opts.products ?? {};
  const productRefs = opts.productRefs ?? {};
  const pricing = {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    findCardProductByTcgId: jest.fn(async (tcgId: number) => products[tcgId] ?? null),
    getReferenceByCardProduct: jest.fn(async (cpId: string, _pt: any, _gk: any, finish: string) => {
      const cents = productRefs[`${cpId}|${finish}`];
      return cents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: cents };
    }),
    getReference: jest.fn(async () =>
      opts.baseRefMxnCents == null
        ? { status: 'pending' }
        : { status: 'priced', referenceMxnCents: opts.baseRefMxnCents },
    ),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(),
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  };
  const settings = {
    getRaw: jest.fn().mockResolvedValue(null),
    getNumber: jest.fn().mockResolvedValue(opts.fallbackPct ?? 40),
  } as unknown as SettingsService;
  const svc = new BuylistService(
    prisma as PrismaService,
    pricing as unknown as PricingService,
    settings,
    {} as UsersService,
    pii,
  );
  return { svc, pricing };
}

describe('M-32 publicQuote — línea con productId (§4.29b)', () => {
  it('CON productId cotiza ESE producto: whitelist por CardProduct.finishes + referencia por cardProductId + eco de productId', async () => {
    const { svc, pricing } = svcWith({
      cardRarity: 'Common',
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
      productRefs: { 'cp-uuid|holofoil': 20000 },
    });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil', 707029);
    expect(q.productId).toBe(707029);
    expect(q.finish).toBe('holofoil');
    // v2.0 (P-48): $200 de mercado ⇒ pct interpolado 42.5 % ⇒ $85. Ni la rareza ni el acabado entran.
    expect(q.quote.status).toBe('cotizada');
    expect(q.quote.quotedPriceCents).toBe(8500);
    // Leyó la referencia POR producto, no la del set_base.
    expect(pricing.getReferenceByCardProduct).toHaveBeenCalledWith('cp-uuid', 'raw', 'raw:NM', 'holofoil');
    expect(pricing.getReference).not.toHaveBeenCalled();
  });

  it('CON productId de un solo acabado y finish OMITIDO → default-ea a ese acabado', async () => {
    const { svc } = svcWith({
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
      productRefs: { 'cp-uuid|holofoil': 10000 },
    });
    const q = await svc.publicQuote('c1', 'raw', 'NM', undefined, 707029);
    expect(q.finish).toBe('holofoil');
    expect(q.quote.quotedPriceCents).toBe(4000);
  });

  it('CON productId de >1 acabado y finish OMITIDO → 422 FINISH_NOT_AVAILABLE (obligatorio)', async () => {
    const { svc } = svcWith({
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['normal', 'holofoil'] } },
    });
    await expect(svc.publicQuote('c1', 'raw', 'NM', undefined, 707029)).rejects.toMatchObject({
      code: 'FINISH_NOT_AVAILABLE',
    });
  });

  it('CON productId y finish fuera de CardProduct.finishes → 422 FINISH_NOT_AVAILABLE', async () => {
    const { svc } = svcWith({
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
    });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'reverse_holo', 707029)).rejects.toMatchObject({
      code: 'FINISH_NOT_AVAILABLE',
    });
  });

  it('productId inexistente → 422 PRODUCT_NOT_FOUND', async () => {
    const { svc } = svcWith({ products: {} });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'holofoil', 999999)).rejects.toMatchObject({
      code: 'PRODUCT_NOT_FOUND',
    });
  });

  it('productId que NO cuelga del cardId → 422 PRODUCT_CARD_MISMATCH (nunca fusión con set_base)', async () => {
    const { svc, pricing } = svcWith({
      products: { 707029: { id: 'cp-uuid', cardId: 'OTRA-CARTA', finishes: ['holofoil'] } },
    });
    await expect(svc.publicQuote('c1', 'raw', 'NM', 'holofoil', 707029)).rejects.toMatchObject({
      code: 'PRODUCT_CARD_MISMATCH',
    });
    // NUNCA cae al precio del set_base.
    expect(pricing.getReference).not.toHaveBeenCalled();
  });

  it('producto separado SIN precio → precio_pendiente / null (jamás 0)', async () => {
    const { svc } = svcWith({
      cardRarity: 'Common',
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
      productRefs: {}, // sin referencia del producto
    });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'holofoil', 707029);
    expect(q.quote.status).toBe('precio_pendiente');
    expect(q.quote.quotedPriceCents).toBeNull();
  });

  it('SIN productId → comportamiento v1.29 idéntico (no toca resolución de producto)', async () => {
    const { svc, pricing } = svcWith({ cardRarity: 'Common', baseRefMxnCents: null });
    const q = await svc.publicQuote('c1', 'raw', 'NM', 'normal');
    expect(q.productId).toBeUndefined();
    // v2.0 (P-48): sin mercado la línea queda pendiente (el bin NO gana); `priceBasis` reemplaza a
    // `appliedRule`. Lo que este caso verifica sigue siendo que NO se toca la resolución de producto.
    expect(q.priceBasis).toBe('pending');
    expect(pricing.findCardProductByTcgId).not.toHaveBeenCalled();
    expect(pricing.getReferenceByCardProduct).not.toHaveBeenCalled();
  });
});

describe('M-32 batchQuote — errores por-ítem + unicidad de línea (§4.29c/d)', () => {
  it('PRODUCT_NOT_FOUND / PRODUCT_CARD_MISMATCH salen ok:false por-ítem y NO tumban el lote', async () => {
    const { svc } = svcWith({
      cardRarity: 'Common',
      baseRefMxnCents: 10000,
      products: {
        707029: { id: 'cp-ok', cardId: 'c1', finishes: ['holofoil'] },
        707030: { id: 'cp-mismatch', cardId: 'OTRA', finishes: ['holofoil'] },
      },
      productRefs: { 'cp-ok|holofoil': 10000 },
    });
    const { results } = await svc.batchQuote([
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'normal' }, // set_base OK
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', productId: 707029 }, // OK
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', productId: 999999 }, // NOT_FOUND
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', productId: 707030 }, // MISMATCH
    ]);
    expect(results[0].ok).toBe(true);
    expect(results[1]).toMatchObject({ ok: true, productId: 707029 });
    expect(results[2]).toMatchObject({ ok: false, error: { code: 'PRODUCT_NOT_FOUND' } });
    expect(results[3]).toMatchObject({ ok: false, error: { code: 'PRODUCT_CARD_MISMATCH' } });
  });

  it('dos ítems mismo (cardId, finish) distinto productId → DOS líneas DISTINTAS (no se funden)', async () => {
    const { svc } = svcWith({
      cardRarity: 'Common',
      products: {
        704841: { id: 'cp-base', cardId: 'c1', finishes: ['holofoil'] },
        707029: { id: 'cp-promo', cardId: 'c1', finishes: ['holofoil'] },
      },
      productRefs: { 'cp-base|holofoil': 10000, 'cp-promo|holofoil': 50000 },
    });
    const { results } = await svc.batchQuote([
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', productId: 704841 },
      { cardId: 'c1', productType: 'raw', rawCondition: 'NM', finish: 'holofoil', productId: 707029 },
    ]);
    expect(results[0]).toMatchObject({ ok: true, productId: 704841 });
    expect(results[1]).toMatchObject({ ok: true, productId: 707029 });
    // Precios DISTINTOS: cada línea leyó la referencia de SU producto (40% de 10000 vs 50000).
    expect((results[0] as any).quote.quotedPriceCents).toBe(4000);
    expect((results[1] as any).quote.quotedPriceCents).toBe(25000); // $500 ⇒ 50 % = $250
  });
});

describe('M-32 createRequest — snapshot + escalada de pendiente con cardProductId (§4.29d)', () => {
  const VALID_CLABE = '012345678901234567';

  function prismaForCreate() {
    const prisma: any = {
      card: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'c1',
          rarity: 'Common',
          availableFinishes: ['normal', 'holofoil'],
        }),
        // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
        // `findUnique` por ítem). El mock delega en el MISMO `findUnique` del fixture
        // (`this` = este objeto `card`), para no duplicar datos ni criterios.
        findMany: jest.fn(async function (this: any, args: any) {
          const ids: string[] = args?.where?.id?.in ?? [];
          const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
          return rows.filter(Boolean);
        }),
      },
      kycProfile: { findUnique: jest.fn().mockResolvedValue(null), upsert: jest.fn() },
      sellRequest: {
        aggregate: jest.fn().mockResolvedValue({ _sum: { quotedTotalCents: 0 } }),
        create: jest.fn(async ({ data }: any) => ({
          id: 'sr-1',
          status: data.status,
          quotedTotalCents: data.quotedTotalCents,
          items: data.items.create.map((it: any, i: number) => ({
            id: `it-${i}`,
            cardId: it.cardId,
            card: { id: it.cardId, name: 'Voltaic', number: '084' },
            productType: it.productType,
            rawCondition: it.rawCondition ?? null,
            finish: it.finish,
            cardProductId: it.cardProductId ?? null,
            rarity: it.rarity,
            ruleMode: it.ruleMode,
            ruleValue: it.ruleValue,
            ruleSource: it.ruleSource,
            quotedPriceCents: it.quotedPriceCents,
            approvedPriceCents: null,
            itemStatus: it.itemStatus,
            inventoryItemId: null,
          })),
        })),
      },
      $transaction: jest.fn(async (cb: any) => cb(prisma)),
    };
    return prisma;
  }

  function pricingForCreate(opts: { products: Record<number, FakeProduct>; productRefs: Record<string, number> }) {
    return {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      findCardProductByTcgId: jest.fn(async (tcgId: number) => opts.products[tcgId] ?? null),
      getReferenceByCardProduct: jest.fn(async (cpId: string, _pt: any, _gk: any, finish: string) => {
        const cents = opts.productRefs[`${cpId}|${finish}`];
        return cents == null ? { status: 'pending' } : { status: 'priced', referenceMxnCents: cents };
      }),
      getReference: jest.fn(async () => ({ status: 'pending' })),
      // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
      settlePendingForVariant: jest.fn(async () => undefined),
      escalatePending: jest.fn(),
      getVariantOverridesBatch: jest.fn(async () => new Map()),
      getVariantOverride: jest.fn(async () => null),
    };
  }

  const settings = {
    getRaw: jest.fn().mockResolvedValue(null),
    getNumber: jest.fn(async (key: string) => {
      if (key === 'buylist_cap_per_request_cents') return 100_000_000;
      if (key === 'buylist_cap_per_month_cents') return 100_000_000;
      if (key === 'ine_threshold_cents') return 100_000_000;
      if (key === 'buylist_price_fallback_pct') return 40;
      return 0;
    }),
  } as unknown as SettingsService;

  it('persiste cardProductId en el SellRequestItem y lo ecoa en el DTO', async () => {
    const prisma = prismaForCreate();
    const pricing = pricingForCreate({
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
      productRefs: { 'cp-uuid|holofoil': 10000 },
    });
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing as unknown as PricingService,
      settings,
      {} as UsersService,
      pii,
    );
    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any, productId: 707029 }],
      VALID_CLABE,
    );
    expect(res.items[0].productId).toBe(707029);
    const created = prisma.sellRequest.create.mock.calls[0][0].data.items.create[0];
    expect(created.cardProductId).toBe(707029);
    expect(created.finish).toBe('holofoil');
  });

  it('línea de producto sin precio → escala a PendingPriceEntry CON su cardProductId (money-safe)', async () => {
    const prisma = prismaForCreate();
    const pricing = pricingForCreate({
      products: { 707029: { id: 'cp-uuid', cardId: 'c1', finishes: ['holofoil'] } },
      productRefs: {}, // sin precio → pct pendiente
    });
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing as unknown as PricingService,
      settings,
      {} as UsersService,
      pii,
    );
    // INE keys para no bloquear por hasPendingLine (INE_REQUIRED).
    await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'holofoil' as any, productId: 707029 }],
      VALID_CLABE,
      { front: 'k-front', back: 'k-back' },
    );
    // v2.0 (§4.36.5c): la escalada pasa por el seam simétrico `settlePendingForVariant`, con la RAZÓN
    // y con el `cardProductId` en la clave lógica de la cola (resolver el set_base NO cierra la del
    // producto separado — money-safe).
    expect(pricing.settlePendingForVariant).toHaveBeenCalledWith(
      'no_market',
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', cardProductId: 707029 },
      'buylist',
    );
  });

  it('SIN productId → NO snapshotea cardProductId (retrocompat) y NO resuelve producto', async () => {
    const prisma = prismaForCreate();
    const pricing = pricingForCreate({ products: {}, productRefs: {} });
    // set_base con referencia para que cotice sin pendiente.
    pricing.getReference = jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 }));
    const svc = new BuylistService(
      prisma as PrismaService,
      pricing as unknown as PricingService,
      settings,
      {} as UsersService,
      pii,
    );
    const res = await svc.createRequest(
      'user-1',
      [{ cardId: 'c1', productType: 'raw' as any, rawCondition: 'NM' as any, finish: 'normal' as any }],
      VALID_CLABE,
    );
    expect(res.items[0].productId).toBeUndefined();
    const created = prisma.sellRequest.create.mock.calls[0][0].data.items.create[0];
    expect(created.cardProductId).toBeUndefined();
    expect(pricing.findCardProductByTcgId).not.toHaveBeenCalled();
  });
});
