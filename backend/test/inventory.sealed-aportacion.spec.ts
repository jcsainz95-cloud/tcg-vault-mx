import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { PokemonTcgIoProvider } from '../src/modules/pricing/providers/pokemontcg-io.provider';
import {
  PokeTraceProvider,
  PokemonPriceTrackerProvider,
} from '../src/modules/pricing/providers/graded-sealed.providers';

/**
 * v1.28 (P-19/P-25, fix normativo §4.26g / API_CONTRACT §M1) — la APORTACIÓN de SELLADO valúa por
 * `sealedMarketRef` (clave `sealed:tcg:<productId>` inferida del GRUPO por hermanos mapeados,
 * gateada por el dial `sealedPriceSource`, resolver H-1) — NO por el gradeKey legacy `'sealed'`
 * (que jamás tiene filas de mercado ⇒ todo caía a PRICE_PENDING aunque el mercado exista).
 * También cubre P-19: «Aportación» = `acquisitionPct:100` (costo = mercado × 100 %) y el alta
 * SIN `locationId` (opcional por contrato v1.28).
 */

function buildHarness(opts: { sourceOn?: boolean } = {}) {
  const created: any[] = [];
  const pendingStore: any[] = [];
  const priceRefs: any[] = []; // filas PriceReference en memoria (findFirst = más reciente)
  const siblings: any[] = []; // items sellados existentes (para la inferencia del mapeo)
  let pendSeq = 0;

  const prisma: any = {
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'card-anchor'
          ? { id: 'card-anchor', rarity: null, availableFinishes: ['normal'] }
          : null,
      ),
    },
    inventoryItem: {
      findMany: jest.fn(async ({ where }: any) =>
        siblings.filter(
          (s) =>
            s.productType === where.productType &&
            s.cardId === where.cardId &&
            s.sealedSubtype === where.sealedSubtype &&
            s.tcgplayerProductId != null,
        ),
      ),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `inv-${created.length + 1}`, status: 'in_stock', ...data };
        created.push(row);
        return row;
      }),
    },
    inventoryMovement: { create: jest.fn(async () => ({})) },
    priceReference: {
      findFirst: jest.fn(async ({ where }: any) =>
        priceRefs.find(
          (r) =>
            r.cardId === where.cardId &&
            r.productType === where.productType &&
            r.gradeKey === where.gradeKey &&
            r.finish === where.finish,
        ) ?? null,
      ),
      // M-31 MAYOR-3: getReference ahora lee con findMany + desempate determinista (pickBestRef).
      findMany: jest.fn(async ({ where }: any) =>
        priceRefs.filter(
          (r) =>
            r.cardId === where.cardId &&
            r.productType === where.productType &&
            r.gradeKey === where.gradeKey &&
            r.finish === where.finish,
        ),
      ),
    },
    pendingPriceEntry: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `pend-${++pendSeq}`, ...data };
        pendingStore.push(row);
        return row;
      }),
    },
    nextFolio: jest.fn(async () => `INV-00000${created.length + 1}`),
  };

  const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
    // FX que revienta → fxSnapshotSafe cae a null → se usa el priceMxnCents almacenado (money-safe).
    { getCurrent: async () => { throw new Error('no fx'); } } as unknown as FxService,
    {} as PokemonTcgIoProvider,
    {} as PokemonPriceTrackerProvider,
    {} as PokeTraceProvider,
  );
  jest.spyOn(pricing, 'loadSealedSpreads').mockResolvedValue({
    spreadPctBySubtype: {},
    fallbackPct: 25,
    sourceOn: opts.sourceOn ?? true,
  } as any);

  const svc = new InventoryService(prisma as PrismaService, pricing, settings);
  return { svc, prisma, created, pendingStore, priceRefs, siblings };
}

const sealedAportacion = (over: any = {}) => ({
  cardId: 'card-anchor',
  productType: 'sealed' as const,
  sealedSubtype: 'etb',
  acquisitionType: 'aportacion_en_especie' as const,
  acquisitionPct: 100, // «Aportación» del alta rápida (P-19): 100 % explícito, sin dropdown de %
  ...over,
});

describe('aportación de SELLADO — valuación por sealedMarketRef (fix §4.26g)', () => {
  it('grupo con UN productId mapeado + dial on + mercado → costo = sealedMarketRef × 100 %', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    h.priceRefs.push({
      cardId: 'card-anchor',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:777',
      finish: 'normal',
      priceMxnCents: 250000,
      priceUsdCents: null,
      isManualOverride: false,
      source: 'tcgcsv',
      capturedDate: new Date('2026-08-21'),
    });
    const res = await h.svc.createItem(sealedAportacion(), 'op-1');
    expect(res.acquisitionCostCents).toBe(250000); // mercado × 100 % (P-19 «Aportación»)
    expect(h.created[0]).toMatchObject({ productType: 'sealed', acquisitionPct: 100 });
    // El costo se valuó (nada pendiente de MERCADO); la única fila es el escalado v1.1 del
    // precio de VENTA del sellado sin listPriceCents (comportamiento preexistente, intacto).
    expect(h.pendingStore.filter((p) => p.gradeKey.startsWith('sealed:tcg'))).toHaveLength(0);
  });

  it('pct default (70) del formulario clásico sigue aplicando sobre el mercado del sellado', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'sealed', gradeKey: 'sealed:tcg:777', finish: 'normal',
      priceMxnCents: 100000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv',
      capturedDate: new Date('2026-08-21'),
    });
    const res = await h.svc.createItem(sealedAportacion({ acquisitionPct: undefined }), 'op-1');
    expect(res.acquisitionCostCents).toBe(70000); // dial aportacionPct=70 intacto
  });

  it('dial sealedPriceSource=off → mercado INERTE → 422 PRICE_PENDING escalado con la clave de MERCADO', async () => {
    const h = buildHarness({ sourceOn: false });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'sealed', gradeKey: 'sealed:tcg:777', finish: 'normal',
      priceMxnCents: 250000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv',
      capturedDate: new Date('2026-08-21'),
    });
    await expect(h.svc.createItem(sealedAportacion(), 'op-1')).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    expect(h.created).toHaveLength(0); // money-safe: no nace pieza sin costo valuable
    expect(h.pendingStore[0]).toMatchObject({
      cardId: 'card-anchor',
      productType: 'sealed',
      gradeKey: 'sealed:tcg:777', // clave de MERCADO (paridad con bulk-publish ④)
      context: 'inventory',
    });
  });

  it('grupo SIN hermano mapeado → PRICE_PENDING con el gradeKey estructural legacy `sealed`', async () => {
    const h = buildHarness({ sourceOn: true });
    await expect(h.svc.createItem(sealedAportacion(), 'op-1')).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed', context: 'inventory' });
  });

  it('grupo AMBIGUO (≥2 productIds mapeados) → PRICE_PENDING (no se adivina con dinero)', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push(
      { productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 },
      { productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 888 },
    );
    await expect(h.svc.createItem(sealedAportacion(), 'op-1')).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    expect(h.created).toHaveLength(0);
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed' });
  });

  it('mapeado pero SIN ingest (sin fila de mercado) → PRICE_PENDING con la clave de mercado', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    await expect(h.svc.createItem(sealedAportacion(), 'op-1')).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777' });
  });

  it('la pieza nueva NO hereda el mapeo (la curación sigue siendo exclusiva del endpoint M2)', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'sealed', gradeKey: 'sealed:tcg:777', finish: 'normal',
      priceMxnCents: 250000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv',
      capturedDate: new Date('2026-08-21'),
    });
    await h.svc.createItem(sealedAportacion(), 'op-1');
    // v1.36: el alta escribe la columna de mapeo explícitamente; SIN mapeo en el DTO nace `null`
    // (unmapped), no hereda el productId del hermano (la curación por hermanos es solo para VALUAR).
    expect(h.created[0].tcgplayerProductId).toBeNull();
  });
});

describe('alta sin ubicación (P-19: locationId opcional, contrato v1.28)', () => {
  it('una pieza puede nacer SIN locationId (la bóveda física se define después)', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'sealed', gradeKey: 'sealed:tcg:777', finish: 'normal',
      priceMxnCents: 250000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv',
      capturedDate: new Date('2026-08-21'),
    });
    const res = await h.svc.createItem(sealedAportacion({ locationId: undefined }), 'op-1');
    expect(res.status).toBe('in_stock');
    expect(h.created[0].locationId).toBeUndefined();
    // El movimiento de alta también tolera la ausencia de ubicación.
    expect(h.prisma.inventoryMovement.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ toLocationId: undefined }) }),
    );
  });

  it('raw «Aportación» con pct 100 valúa a mercado del acabado (regresión P-19)', async () => {
    const h = buildHarness({ sourceOn: true });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal',
      priceMxnCents: 12000, priceUsdCents: null, isManualOverride: false, source: 'manual',
      capturedDate: new Date('2026-08-21'),
    });
    const res = await h.svc.createItem(
      {
        cardId: 'card-anchor',
        productType: 'raw',
        acquisitionType: 'aportacion_en_especie',
        acquisitionPct: 100,
      } as any,
      'op-1',
    );
    expect(res.acquisitionCostCents).toBe(12000);
  });
});
