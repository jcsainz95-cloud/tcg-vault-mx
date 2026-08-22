import {
  CardProductResolverService,
  normalizeCardNumber,
  normalizeName,
} from '../src/modules/catalog/card-product-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { TcgcsvSingleProductRef, TcgcsvPriceRow } from '../src/modules/pricing/pricing.types';

/**
 * v1.29 (ARCHITECTURE §4.27d) — CardProductResolverService: agrupa por `productId` EXACTO (no por
 * número), persiste UN `CardProduct` por productId con su `kind`/`finishes`, escribe `PriceReference`
 * POR VARIANTE (source=tcgcsv_singles) SOLO con marketPrice>0, y recomputa `availableFinishes` desde
 * `CardProduct`. Sin red (los fetch se mockean). Cubre el caso Pitch Black: la energía especial NO
 * gana un `normal` fantasma (el Deck Exclusive vive como su propio producto).
 */

// Voltaic Lightning Energy 084/084: producto de set (holofoil+reverse) + Deck Exclusive (normal).
const PRODUCTS: TcgcsvSingleProductRef[] = [
  { productId: 704841, name: 'Voltaic Lightning Energy - 084/084', number: '084/084' },
  { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
];
const PRICES: TcgcsvPriceRow[] = [
  { productId: 704841, subTypeName: 'Holofoil', marketPrice: 0.5 },
  { productId: 704841, subTypeName: 'Reverse Holofoil', marketPrice: null }, // sin precio ⇒ «—»
  { productId: 707029, subTypeName: 'Normal', marketPrice: 1.25 },
];

function clientMock(
  over: Partial<{ products: TcgcsvSingleProductRef[]; prices: TcgcsvPriceRow[]; groups: any[] }> = {},
): TcgcsvCatalogClient {
  return {
    getProducts: jest.fn(async () => over.products ?? PRODUCTS),
    getPrices: jest.fn(async () => over.prices ?? PRICES),
    listGroups: jest.fn(async () => over.groups ?? []),
  } as unknown as TcgcsvCatalogClient;
}

function prismaMock(
  set: { id: string; name: string; pptSetId: string | null },
  localCards: { id: string; number: string; tcgplayerId: string | null }[],
) {
  const cardProductUpserts: any[] = [];
  const priceUpserts: any[] = [];
  let seq = 0;
  const prisma = {
    cardSet: { findUnique: jest.fn(async () => set) },
    card: { findMany: jest.fn(async () => localCards) },
    cardProduct: {
      upsert: jest.fn(async (args: any) => {
        cardProductUpserts.push(args);
        return { id: `cp-${args.where.tcgplayerProductId}` };
      }),
    },
    priceReference: {
      findUnique: jest.fn(async () => null), // sin fila previa
      upsert: jest.fn(async (args: any) => {
        priceUpserts.push(args);
        return { id: `pr-${seq++}` };
      }),
    },
  } as unknown as PrismaService;
  return { prisma, cardProductUpserts, priceUpserts };
}

const fxMock = () =>
  ({ getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 3, source: 'banxico', effectiveDate: '2026-08-22' })) } as unknown as FxService);

describe('CardProductResolverService.resolveCardProductsForSet (§4.27d)', () => {
  it('MATA EL FANTASMA: set_base (704841)=[holofoil,reverse_holo]; Deck Exclusive (707029)=deck_exclusive con SU normal', async () => {
    const { prisma, cardProductUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }], // ancla del set_base por tcgplayerId
    );
    const reconcile = jest.fn(async () => 0);
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-me05');

    expect((prisma as any).cardProduct.upsert).toHaveBeenCalledTimes(2);
    const byPid = new Map(cardProductUpserts.map((u) => [u.where.tcgplayerProductId, u.create]));
    // El producto de SET: EXACTAMENTE 2 acabados, sin normal fantasma.
    expect(byPid.get(704841).kind).toBe('set_base');
    expect(byPid.get(704841).finishes).toEqual(['reverse_holo', 'holofoil']);
    // El Deck Exclusive: producto APARTE (kind deck_exclusive) con su normal, colgado por número.
    expect(byPid.get(707029).kind).toBe('deck_exclusive');
    expect(byPid.get(707029).finishes).toEqual(['normal']);
    // Ambos cuelgan de la misma carta (el número enruta, no funde).
    expect(byPid.get(704841).cardId).toBe('c-energy');
    expect(byPid.get(707029).cardId).toBe('c-energy');
    // Reconcile de la carta tocada (recompone availableFinishes SOLO de set_base ⇒ 2 casillas).
    expect(reconcile).toHaveBeenCalledWith(['c-energy']);
    expect(res).toMatchObject({ groupId: 24688, joined: 2, products: 2 });
  });

  it('PRECIO POR VARIANTE money-safe: escribe tcgcsv_singles con marketPrice>0; OMITE marketPrice null («—»)', async () => {
    const { prisma, priceUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-me05');

    // holofoil (0.5) y el normal del deck (1.25) SÍ; el reverse_holo (marketPrice null) NO.
    expect(priceUpserts).toHaveLength(2);
    const finishes = priceUpserts.map((u) => u.create.finish).sort();
    expect(finishes).toEqual(['holofoil', 'normal']);
    for (const u of priceUpserts) {
      expect(u.create.source).toBe('tcgcsv_singles');
      expect(u.create.cardProductId).toBeDefined();
      // USD→MXN Banxico: 0.5 USD → 50 usdCents → 50*18*1.03 = 927 MXN cents.
      expect(u.create.priceMxnCents).toBeGreaterThan(0);
      expect(u.create.priceUsdCents).toBeGreaterThan(0);
    }
    expect(res?.pricesWritten).toBe(2);
  });

  it('energía especial: 2 acabados (holofoil, reverse_holo), NO 3 — el set_base nunca trajo Normal', async () => {
    const { prisma, cardProductUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(prisma, clientMock(), { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fxMock());
    await svc.resolveCardProductsForSet('local-me05');
    const setBase = cardProductUpserts.find((u) => u.where.tcgplayerProductId === 704841)!.create;
    expect(setBase.finishes).toHaveLength(2);
    expect(setBase.finishes).not.toContain('normal');
  });

  it('REGRESIÓN M-33: dos productos de la MISMA carta con el MISMO finish ⇒ 2 upserts con la CLAVE de 6 campos (distinto cardProductId), sin colisión lógica', async () => {
    // Reproduce exactamente el caso que estallaba en prod (log Railway me5): dos CardProduct de la
    // misma carta exponiendo el MISMO Finish (holofoil). Con la clave VIEJA de 5 campos (cardId,
    // productType, gradeKey, finish, capturedDate) ambos upserts apuntarían al MISMO renglón y el
    // segundo CREATE chocaría contra el índice único viejo. Con la clave de 6 campos (incluye
    // cardProductId) son renglones DISTINTOS. Este test fija que el código usa la clave de 6 campos.
    const products: TcgcsvSingleProductRef[] = [
      { productId: 704841, name: 'Voltaic Lightning Energy - 084/084', number: '084/084' },
      { productId: 707029, name: 'Voltaic Lightning Energy - Deck Exclusives', number: '084/084' },
    ];
    const prices: TcgcsvPriceRow[] = [
      { productId: 704841, subTypeName: 'Holofoil', marketPrice: 0.5 },
      { productId: 707029, subTypeName: 'Holofoil', marketPrice: 1.25 }, // MISMO finish, otro producto
    ];
    const { prisma, priceUpserts } = prismaMock(
      { id: 'local-me05', name: 'Pitch Black', pptSetId: '24688' },
      [{ id: 'c-energy', number: '084', tcgplayerId: '704841' }],
    );
    const svc = new CardProductResolverService(
      prisma,
      clientMock({ products, prices }),
      { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler,
      fxMock(),
    );

    await svc.resolveCardProductsForSet('local-me05');

    // Dos upserts, ambos holofoil, misma carta — pero DISTINTO cardProductId en la clave de 6 campos.
    expect(priceUpserts).toHaveLength(2);
    for (const u of priceUpserts) {
      const key = u.where.cardId_productType_gradeKey_finish_capturedDate_cardProductId;
      // La CLAVE es la de 6 campos (no la vieja de 5): la propiedad existe y trae cardProductId.
      expect(key).toBeDefined();
      expect(key.finish).toBe('holofoil');
      expect(key.cardId).toBe('c-energy');
      expect(key.cardProductId).toBeDefined();
      // Blindaje anti-regresión: NUNCA debe usarse la clave vieja de 5 campos.
      expect(u.where).not.toHaveProperty('cardId_productType_gradeKey_finish_capturedDate');
    }
    const cardProductIds = priceUpserts.map(
      (u) => u.where.cardId_productType_gradeKey_finish_capturedDate_cardProductId.cardProductId,
    );
    // Los dos productos generan claves DISTINTAS (difieren SOLO por cardProductId) ⇒ sin colisión.
    expect(new Set(cardProductIds).size).toBe(2);
  });

  it('sin groupId ÚNICO ⇒ null, NO toca CardProduct ni reconcilia (money-safe)', async () => {
    const { prisma } = prismaMock({ id: 'local-x', name: 'Ambiguous', pptSetId: null }, [{ id: 'c1', number: '1', tcgplayerId: null }]);
    const reconcile = jest.fn(async () => 0);
    const client = clientMock({ groups: [{ groupId: 1, name: 'Ambiguous A' }, { groupId: 2, name: 'Ambiguous B' }] });
    const svc = new CardProductResolverService(prisma, client, { reconcile } as unknown as FinishReconciler, fxMock());

    const res = await svc.resolveCardProductsForSet('local-x');

    expect(res).toBeNull();
    expect((prisma as any).cardProduct.upsert).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
  });
});

describe('normalizeCardNumber / normalizeName (helpers del join)', () => {
  it('normalizeCardNumber colapsa "084/084"→"84" y conserva prefijos ("TG12")', () => {
    expect(normalizeCardNumber('084/084')).toBe('84');
    expect(normalizeCardNumber('84')).toBe('84');
    expect(normalizeCardNumber('TG12')).toBe('TG12');
  });
  it('normalizeName deja solo alfanuméricos en minúsculas', () => {
    expect(normalizeName('ME05: Pitch Black')).toBe('me05pitchblack');
  });
});
