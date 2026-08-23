import { PricingService } from '../src/modules/pricing/pricing.service';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { OrdersService } from '../src/modules/orders/orders.service';
import { SealedCatalogService } from '../src/modules/catalog/sealed-catalog.service';
import { InventoryService } from '../src/modules/inventory/inventory.service';

/**
 * H-1 (v1.24-sealed-dedup) — el gating del precio de VENTA del sellado (gate del mercado por dial +
 * pura `computeSealedSalePrice`, incluida la REGLA ÚNICA de override>0) vive en UN solo cuerpo:
 * `PricingService.resolveSealedSalePrice`. Este spec prueba (a) el resolver único y su gate, y
 * (b) que catálogo (`toListingDTO`), Compra (`orders.salePriceOf`) y grid (`loadPricedSealed`)
 * producen EXACTAMENTE el mismo precio para el caso money-safe del override degenerado (0 centavos).
 */

// PricingService real: `resolveSealedSalePrice`/`gateSealedMarketCents` son PUROS (no tocan deps).
function realPricing(): PricingService {
  return new PricingService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
}

const CTX_ON = { spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: true };
const CTX_OFF = { spreadPctBySubtype: { box: 18 }, fallbackPct: 25, sourceOn: false };
const PRICED = { status: 'priced' as const, referenceMxnCents: 100000 };
const PENDING = { status: 'pending' as const };
// v1.43 (IMP-C): referencias de mercado por FUENTE. `tcgcsv` = ingest automático (gateado por dial);
// `manual` = override humano «FIJAR PRECIO» (NO gateado por el dial).
const TCGCSV = { status: 'priced' as const, referenceMxnCents: 100000, source: 'tcgcsv' as const };
const MANUAL = {
  status: 'priced' as const,
  referenceMxnCents: 100000,
  source: 'manual' as const,
  isManualOverride: true,
};

describe('PricingService.gateSealedMarketCents — gate ÚNICO del mercado (dial + priced)', () => {
  it('dial ON + priced → referenceMxnCents', () => {
    expect(realPricing().gateSealedMarketCents(PRICED, true)).toBe(100000);
  });
  it('dial OFF → null (mercado TCGCSV inerte, §4.23a)', () => {
    expect(realPricing().gateSealedMarketCents(PRICED, false)).toBeNull();
  });
  it('ref pending / undefined / null → null', () => {
    expect(realPricing().gateSealedMarketCents(PENDING, true)).toBeNull();
    expect(realPricing().gateSealedMarketCents(undefined, true)).toBeNull();
    expect(realPricing().gateSealedMarketCents(null, true)).toBeNull();
  });
});

// v1.43 (IMP-C, §4.23a) — el dial gobierna SOLO la fuente automática (tcgcsv). El override manual de
// mercado sobrevive al dial. Los 4 combos {manual, tcgcsv} × {sourceOn true/false}:
describe('PricingService.gateSealedMarketCents — v1.43 (IMP-C): fuente vs override manual × dial', () => {
  const g = () => realPricing();

  it('tcgcsv + dial ON → referenceMxnCents (mercado de fuente cuenta)', () => {
    expect(g().gateSealedMarketCents(TCGCSV, true)).toBe(100000);
  });
  it('tcgcsv + dial OFF → null (mercado de fuente INERTE, fail-closed)', () => {
    expect(g().gateSealedMarketCents(TCGCSV, false)).toBeNull();
  });
  it('manual + dial ON → referenceMxnCents (override sobrevive)', () => {
    expect(g().gateSealedMarketCents(MANUAL, true)).toBe(100000);
  });
  it('manual + dial OFF → referenceMxnCents (override NO lo gatea el dial — arregla el bucle IMP-C)', () => {
    expect(g().gateSealedMarketCents(MANUAL, false)).toBe(100000);
  });
  it('discrimina también por source="manual" aunque isManualOverride no venga en el PriceInfo', () => {
    const manualBySourceOnly = { status: 'priced' as const, referenceMxnCents: 100000, source: 'manual' as const };
    expect(g().gateSealedMarketCents(manualBySourceOnly, false)).toBe(100000);
  });
});

describe('PricingService.resolveSealedSalePrice — regla ÚNICA de override', () => {
  const svc = () => realPricing();

  it('override>0 gana (precedencia máxima)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 99900, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r).toMatchObject({ salePriceCents: 99900, source: 'override' });
  });

  it('override=0 DEGENERADO → se ignora → mercado×spread (NO cobra gratis)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 0, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r).toMatchObject({ salePriceCents: 118000, source: 'subtype_spread' });
  });

  it('override NEGATIVO → se ignora → mercado×spread', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: -1, sealedSubtype: 'box' }, PRICED, CTX_ON);
    expect(r.salePriceCents).toBe(118000);
  });

  it('override=0 + dial OFF (sin market efectivo) → pending (no publicable)', () => {
    const r = svc().resolveSealedSalePrice({ listPriceCents: 0, sealedSubtype: 'box' }, PRICED, CTX_OFF);
    expect(r.status).toBe('pending');
    expect(r.salePriceCents).toBeNull();
  });

  it('sin override + market → mercado×spread; sin market → pending', () => {
    expect(
      svc().resolveSealedSalePrice({ listPriceCents: null, sealedSubtype: 'box' }, PRICED, CTX_ON).salePriceCents,
    ).toBe(118000);
    expect(
      svc().resolveSealedSalePrice({ listPriceCents: null, sealedSubtype: 'box' }, PENDING, CTX_ON).salePriceCents,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Consistencia cross-sitio: catálogo, Compra (orders) y grid dan el MISMO precio.
// ---------------------------------------------------------------------------
function card(over: Partial<any> = {}) {
  return {
    id: 'c1',
    externalId: 'sv8-100',
    name: 'Booster Box',
    number: '1',
    numberSort: 1,
    numberPrefix: '',
    rarity: null,
    supertype: null,
    subtypes: [],
    setId: 'set1',
    imageSmallUrl: 'https://img/s.png',
    imageLargeUrl: 'https://img/l.png',
    availableFinishes: ['normal'],
    set: { id: 'set1', name: 'Surging Sparks' },
    ...over,
  };
}

// Pieza SELLADA con override DEGENERADO (0 centavos), mapeada (productId 100), mercado priceado.
function sealedPiece(over: Partial<any> = {}) {
  return {
    id: 'i1',
    folio: 'INV-000001',
    cardId: 'c1',
    productType: 'sealed',
    status: 'listed',
    ownerType: 'platform',
    listPriceCents: 0, // override DEGENERADO
    sealedSubtype: 'box',
    sealedCondition: 'mint',
    finish: 'normal',
    tcgplayerProductId: 100,
    createdAt: new Date('2026-08-01T00:00:00Z'),
    card: card(),
    ...over,
  };
}

const EXPECTED = 118000; // 100000 × 1.18 (spread box), NO 0 (override degenerado ignorado)

describe('H-1 — mismo precio en catálogo, Compra (orders) y grid para override=0', () => {
  it('los tres sitios coinciden en EXPECTED (mercado×spread, no gratis)', async () => {
    // --- catálogo: toListingDTO con contexto pre-cargado (mercado priceado) ---
    const pricingCat = realPricing();
    const catalog = new CatalogService({} as any, pricingCat);
    const dto = await catalog.toListingDTO(sealedPiece() as any, {
      reference: PRICED,
      sealedSpreads: CTX_ON,
    });
    expect(dto.salePriceCents).toBe(EXPECTED);
    expect(dto.sellable).toBe(true);

    // --- Compra: orders.salePriceOf (private) con loaders espiados ---
    const pricingOrders = realPricing();
    jest.spyOn(pricingOrders, 'loadSealedSpreads').mockResolvedValue(CTX_ON);
    jest.spyOn(pricingOrders, 'getSealedMarketRef').mockResolvedValue(PRICED as any);
    const orders = new OrdersService(
      {} as any,
      pricingOrders,
      {} as any,
      {} as any,
      {} as any,
    );
    const orderPrice = await (orders as any).salePriceOf(sealedPiece());
    expect(orderPrice).toBe(EXPECTED);

    // --- grid: loadPricedSealed (private) con prisma + loaders mockeados ---
    const pricingGrid = realPricing();
    jest.spyOn(pricingGrid, 'loadSealedSpreads').mockResolvedValue(CTX_ON);
    jest
      .spyOn(pricingGrid, 'getReferencesBatch')
      .mockResolvedValue(new Map([['c1|sealed|sealed:tcg:100|normal', PRICED as any]]));
    const prismaGrid = {
      inventoryItem: { findMany: jest.fn(async () => [sealedPiece()]) },
    } as any;
    const sealedCatalog = new SealedCatalogService(prismaGrid, pricingGrid, {} as any, {} as any);
    const priced = await (sealedCatalog as any).loadPricedSealed({});
    expect(priced).toHaveLength(1);
    expect(priced[0].salePriceCents).toBe(EXPECTED);
    expect(priced[0].source).toBe('subtype_spread');
  });
});

// ---------------------------------------------------------------------------
// 4º call-site del resolver ÚNICO: inventory.bulkPublish (§M1). Cierra el gap del
// test de convergencia (antes cubría 3 de 4 consumidores de resolveSealedSalePrice).
// Prueba (a) un sellado SIN mapeo (sin market, sin override) → PRICE_PENDING, NO se
// publica; (b) un sellado mapeado + mercado priceado (sin override) → converge al MISMO
// EXPECTED (mercado×spread) que catálogo/Compra/grid, publicado como `derived`.
// ---------------------------------------------------------------------------
describe('H-1 — inventory.bulkPublish es el 4º consumidor del resolver único', () => {
  it('sellado sin mapeo → PRICE_PENDING; sellado mapeado (sin override) → EXPECTED (mismo que los otros 3)', async () => {
    // (a) sin mapeo: tcgplayerProductId null → sin clave de mercado → sin market → pending.
    const unmapped = sealedPiece({ id: 'iA', folio: 'INV-00000A', tcgplayerProductId: null, listPriceCents: null });
    // (b) mapeado (productId 100) + SIN override (listPriceCents null) → mercado×spread.
    const mapped = sealedPiece({ id: 'iB', folio: 'INV-00000B', tcgplayerProductId: 100, listPriceCents: null });

    // v1.26 (④): la línea sin precio ESCALA a la cola (escalatePending, dentro de PricingService) →
    // el prisma COMPARTIDO necesita `pendingPriceEntry` para que la rama priceless devuelva
    // PRICE_PENDING (no un TypeError). PricingService e InventoryService comparten el MISMO prisma
    // (como en producción), así que la escalada se ejerce de verdad.
    const prismaInv = {
      inventoryItem: {
        findMany: jest.fn(async () => [unmapped, mapped]),
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      pendingPriceEntry: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async () => ({ id: 'pend-A' })),
      },
    } as any;

    const pricingInv = new PricingService(prismaInv, {} as any, {} as any, {} as any, {} as any, {} as any);
    jest.spyOn(pricingInv, 'loadSalesRules').mockResolvedValue({ rules: { rarityRules: {}, finishRules: {}, fallbackPct: 15 }, fallbackPct: 15 });
    jest.spyOn(pricingInv, 'loadSealedSpreads').mockResolvedValue(CTX_ON);
    jest
      .spyOn(pricingInv, 'getReferencesBatch')
      .mockResolvedValue(new Map([['c1|sealed|sealed:tcg:100|normal', PRICED as any]]));

    const inventory = new InventoryService(prismaInv, pricingInv, {} as any);

    const res = await inventory.bulkPublish(
      { items: [{ inventoryItemId: 'iA' }, { inventoryItemId: 'iB' }] } as any,
      'admin-1',
    );

    const lineA = res.results.find((r) => r.inventoryItemId === 'iA')! as any;
    const lineB = res.results.find((r) => r.inventoryItemId === 'iB')! as any;
    // (a) sin mapeo → no publicable, PRICE_PENDING (nunca se descarta; entra a la cola).
    expect(lineA.ok).toBe(false);
    expect(lineA.error.code).toBe('PRICE_PENDING');
    // (b) mapeado → publicado y CONVERGE al mismo EXPECTED que catálogo/Compra/grid.
    expect(lineB.ok).toBe(true);
    expect(lineB.salePriceCents).toBe(EXPECTED);
    expect(lineB.priceSource).toBe('derived');
    expect(res.summary.published).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// v1.43 (IMP-C) — BUCLE CERRADO cola↔publicar con el dial `off`. Reproduce el
// síntoma reportado por el gate E2E y prueba que el fix lo mata:
//   dial off → publicar sellado sin precio → PRICE_PENDING (se ESCALA a la cola)
//   → «FIJAR PRECIO» (manualOverride, source='manual'/isManualOverride) → re-publicar
//   USA el override (mercado×spread) y NO re-crea el pendiente, con sellable=true.
// PricingService e InventoryService comparten el MISMO prisma (como en producción):
// el override que escribe `manualOverride` lo LEE de vuelta el `getReferencesBatch`
// REAL del segundo publish, y el gate H-1 lo deja pasar aunque `sourceOn=false`.
// ---------------------------------------------------------------------------
describe('H-1 v1.43 (IMP-C) — bucle cerrado: dial OFF + override manual mata el re-escalado', () => {
  // matcher de cláusula `{ in: [...] }` | escalar | ausente
  const matchIn = (clause: any, val: any) =>
    clause == null ? true : clause.in != null ? clause.in.includes(val) : clause === val;

  function makeSharedPrisma(item: any) {
    const priceRefs: any[] = [];
    const pending: any[] = [];
    let seq = 0;
    return {
      _pending: pending,
      inventoryItem: {
        findMany: jest.fn(async ({ where }: any) => {
          const ids = where?.id?.in;
          return [item]
            .filter((i) => (ids ? ids.includes(i.id) : true))
            .map((i) => ({ ...i }));
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          if (item.id !== where.id) return { count: 0 };
          const okStatus =
            where.status?.in == null || where.status.in.includes(item.status);
          if (item.ownerType !== where.ownerType || !okStatus) return { count: 0 };
          Object.assign(item, data);
          return { count: 1 };
        }),
      },
      priceReference: {
        findMany: jest.fn(async ({ where }: any) =>
          priceRefs.filter(
            (r) =>
              matchIn(where.cardId, r.cardId) &&
              matchIn(where.productType, r.productType) &&
              matchIn(where.gradeKey, r.gradeKey) &&
              matchIn(where.finish, r.finish),
          ),
        ),
        findFirst: jest.fn(async ({ where }: any) =>
          priceRefs.find(
            (r) =>
              r.cardId === where.cardId &&
              r.productType === where.productType &&
              r.gradeKey === where.gradeKey &&
              r.finish === where.finish &&
              (where.cardProductId === undefined ||
                r.cardProductId === where.cardProductId),
          ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = {
            id: `pr-${++seq}`,
            cardProductId: null,
            priceUsdCents: null,
            isManualOverride: false,
            ...data,
          };
          priceRefs.push(row);
          return row;
        }),
        update: jest.fn(async ({ where, data }: any) => {
          const row = priceRefs.find((r) => r.id === where.id);
          Object.assign(row, data);
          return row;
        }),
      },
      pendingPriceEntry: {
        findFirst: jest.fn(async ({ where }: any) =>
          pending.find(
            (p) =>
              p.cardId === where.cardId &&
              p.productType === where.productType &&
              p.gradeKey === where.gradeKey &&
              p.finish === where.finish &&
              p.status === where.status &&
              (where.cardProductId === undefined ||
                p.cardProductId === (where.cardProductId ?? null)) &&
              (where.sealedProductId === undefined ||
                p.sealedProductId === (where.sealedProductId ?? null)),
          ) ?? null,
        ),
        create: jest.fn(async ({ data }: any) => {
          const row = { id: `pend-${++seq}`, cardProductId: null, sealedProductId: null, ...data };
          pending.push(row);
          return row;
        }),
        updateMany: jest.fn(async ({ where, data }: any) => {
          let c = 0;
          for (const p of pending) {
            if (
              p.cardId === where.cardId &&
              p.productType === where.productType &&
              p.gradeKey === where.gradeKey &&
              p.finish === where.finish &&
              p.status === where.status
            ) {
              Object.assign(p, data);
              c++;
            }
          }
          return { count: c };
        }),
      },
    } as any;
  }

  it('publicar (dial off, sin precio)→PRICE_PENDING; FIJAR PRECIO; re-publicar→sellable sin re-escalar', async () => {
    // Sellado MAPEADO (productId 100) SIN override de pieza (listPriceCents null) → deriva por mercado.
    const item = sealedPiece({ listPriceCents: null, status: 'in_stock' });
    const prisma = makeSharedPrisma(item);

    const pricing = new PricingService(prisma, {} as any, {} as any, {} as any, {} as any, {} as any);
    // Dial OFF (sourceOn=false): el mercado de FUENTE (tcgcsv) quedaría inerte; el override manual NO.
    jest
      .spyOn(pricing, 'loadSalesRules')
      .mockResolvedValue({ rules: { rarityRules: {}, finishRules: {}, fallbackPct: 15 }, fallbackPct: 15 } as any);
    jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue(CTX_OFF);
    jest.spyOn(pricing, 'getVariantOverridesBatch').mockResolvedValue(new Map());

    const inventory = new InventoryService(prisma, pricing, {} as any);
    const publish = () =>
      inventory.bulkPublish({ items: [{ inventoryItemId: item.id }] } as any, 'admin-1');

    // 1) Publicar con dial off y SIN precio → PRICE_PENDING + escala a la cola (1 pendiente open).
    const first = await publish();
    expect(first.results[0].ok).toBe(false);
    expect((first.results[0] as any).error.code).toBe('PRICE_PENDING');
    expect(prisma.pendingPriceEntry.create).toHaveBeenCalledTimes(1);
    expect(prisma._pending.filter((p: any) => p.status === 'open')).toHaveLength(1);
    // La pieza NO se publicó (sigue in_stock).
    expect(item.status).toBe('in_stock');

    // 2) «FIJAR PRECIO»: override manual de MERCADO en la clave sealed:tcg:100 (source='manual').
    await pricing.manualOverride(item.cardId, 'sealed', 'sealed:tcg:100', 100000, 'normal');
    // El override resolvió el pendiente (0 open).
    expect(prisma._pending.filter((p: any) => p.status === 'open')).toHaveLength(0);

    // 3) Re-publicar: el override SOBREVIVE al dial off (gate H-1) → mercado×spread → sellable.
    const createsBefore = prisma.pendingPriceEntry.create.mock.calls.length;
    const second = await publish();
    expect(second.results[0].ok).toBe(true);
    expect((second.results[0] as any).salePriceCents).toBe(EXPECTED); // 100000×1.18, NUNCA 0
    expect((second.results[0] as any).priceSource).toBe('derived');
    expect(second.summary.published).toBe(1);
    expect(item.status).toBe('listed');
    // NO se re-creó el pendiente (bucle roto): create NO se llamó de nuevo.
    expect(prisma.pendingPriceEntry.create.mock.calls.length).toBe(createsBefore);
    expect(prisma._pending.filter((p: any) => p.status === 'open')).toHaveLength(0);
  });
});
