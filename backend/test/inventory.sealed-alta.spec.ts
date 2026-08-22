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
 * v1.36-sealed-alta (M-37, P-35 · ARCHITECTURE §4.32c · API_CONTRACT §M1) — el alta de SELLADO reusa
 * `POST /admin/inventory/items[/batch]` con 4 campos aditivos SOLO para productType='sealed':
 *   tcgplayerProductId + tcgplayerGroupId (se fijan JUNTOS; nace MAPEADA) + sealedImageUrl/Name.
 * Cubre: nace mapeada (valúa la aportación por sealed:tcg:<productId> SIN inferir hermanos),
 * money-safe (sin mercado → 422 PRICE_PENDING, nunca 0), XOR del mapeo → 422 VALIDATION_ERROR,
 * campos ignorados en raw/graded, host allowlist de la imagen (anti stored-XSS), e idempotencia por
 * batchKey con tolerancia por-línea.
 */

function buildHarness(opts: { sourceOn?: boolean } = {}) {
  const created: any[] = [];
  const pendingStore: any[] = [];
  const priceRefs: any[] = [];
  const siblings: any[] = [];
  const batches: any[] = [];
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
    inventoryBatch: {
      findUnique: jest.fn(async ({ where }: any) => batches.find((b) => b.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        const row = { ...data };
        batches.push(row);
        return row;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const b = batches.find((x) => x.id === where.id);
        Object.assign(b, data);
        return b;
      }),
    },
    nextFolio: jest.fn(async () => `INV-00000${created.length + 1}`),
    nextFolios: jest.fn(async (qty: number) =>
      Array.from({ length: qty }, (_, i) => `INV-0000${created.length + i + 1}`),
    ),
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };

  const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;
  const pricing = new PricingService(
    prisma as PrismaService,
    settings,
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
  return { svc, prisma, created, pendingStore, priceRefs, siblings, batches };
}

const IMG_OK = 'https://tcgplayer-cdn.tcgplayer.com/product/777_200w.jpg';

const sealedLine = (over: any = {}) => ({
  cardId: 'card-anchor',
  productType: 'sealed' as const,
  sealedSubtype: 'etb',
  acquisitionType: 'aportacion_en_especie' as const,
  acquisitionPct: 100,
  tcgplayerProductId: 777,
  tcgplayerGroupId: 900,
  sealedImageUrl: IMG_OK,
  sealedProductName: 'Prismatic Evolutions ETB',
  ...over,
});

function seedMarket(h: ReturnType<typeof buildHarness>, productId = 777, priceMxnCents = 250000) {
  h.priceRefs.push({
    cardId: 'card-anchor',
    productType: 'sealed',
    gradeKey: `sealed:tcg:${productId}`,
    finish: 'normal',
    priceMxnCents,
    priceUsdCents: null,
    isManualOverride: false,
    source: 'tcgcsv',
    capturedDate: new Date('2026-08-21'),
  });
}

describe('alta de SELLADO nace MAPEADA (P-35, §4.32c)', () => {
  it('con productId+groupId + mercado → persiste mapeo/imagen/nombre y valúa la aportación EN EL ACTO', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h); // sealed:tcg:777 → MX$2500
    const res = await h.svc.createItem(sealedLine() as any, 'op-1');
    // Valuó sin inferir hermanos (no hay ninguno): mercado × 100 %.
    expect(res.acquisitionCostCents).toBe(250000);
    expect(h.prisma.inventoryItem.findMany).not.toHaveBeenCalled(); // no fallback por hermanos
    // Nace mapeada + display de API persistido.
    expect(h.created[0]).toMatchObject({
      productType: 'sealed',
      tcgplayerProductId: 777,
      tcgplayerGroupId: 900,
      sealedImageUrl: IMG_OK,
      sealedProductName: 'Prismatic Evolutions ETB',
    });
  });

  it('MONEY-SAFE: nace mapeada pero SIN mercado (o dial off) → 422 PRICE_PENDING, jamás 0 ni pieza', async () => {
    const h = buildHarness({ sourceOn: true }); // sin seedMarket → sin fila de mercado
    await expect(h.svc.createItem(sealedLine() as any, 'op-1')).rejects.toMatchObject({
      code: 'PRICE_PENDING',
    });
    expect(h.created).toHaveLength(0);
    // Escala con la clave de MERCADO del productId mapeado (paridad bulk-publish ④).
    expect(h.pendingStore[0]).toMatchObject({ gradeKey: 'sealed:tcg:777', context: 'inventory' });
  });

  it('XOR del mapeo: productId sin groupId → 422 VALIDATION_ERROR (se fijan juntos)', async () => {
    const h = buildHarness({ sourceOn: true });
    await expect(
      h.svc.createItem(sealedLine({ tcgplayerGroupId: undefined }) as any, 'op-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(h.created).toHaveLength(0);
  });

  it('XOR del mapeo: groupId sin productId → 422 VALIDATION_ERROR', async () => {
    const h = buildHarness({ sourceOn: true });
    await expect(
      h.svc.createItem(sealedLine({ tcgplayerProductId: undefined }) as any, 'op-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('sellado SIN mapeo (ambos ausentes) sigue el camino previo (inferencia por hermanos)', async () => {
    const h = buildHarness({ sourceOn: true });
    h.siblings.push({ productType: 'sealed', cardId: 'card-anchor', sealedSubtype: 'etb', tcgplayerProductId: 777 });
    seedMarket(h);
    const res = await h.svc.createItem(
      sealedLine({ tcgplayerProductId: undefined, tcgplayerGroupId: undefined, sealedImageUrl: undefined, sealedProductName: undefined }) as any,
      'op-1',
    );
    expect(res.acquisitionCostCents).toBe(250000);
    expect(h.prisma.inventoryItem.findMany).toHaveBeenCalled(); // usó la inferencia por hermanos
    expect(h.created[0].tcgplayerProductId).toBeNull(); // no hereda el mapeo
  });
});

describe('host allowlist de la imagen del sellado (anti stored-XSS, §4.32c)', () => {
  it('URL de host confiable (tcgplayer-cdn) se persiste', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h);
    await h.svc.createItem(sealedLine() as any, 'op-1');
    expect(h.created[0].sealedImageUrl).toBe(IMG_OK);
  });

  it.each([
    'https://evil.example.com/x.jpg',
    'http://tcgplayer-cdn.tcgplayer.com/x.jpg', // no https
    'javascript:alert(1)',
    'data:image/png;base64,AAAA',
    'https://user:pass@tcgplayer.com/x.jpg', // userinfo
    'not a url',
  ])('URL fuera del allowlist «%s» → null (fallback a la Card ancla)', async (badUrl) => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h);
    await h.svc.createItem(sealedLine({ sealedImageUrl: badUrl }) as any, 'op-1');
    expect(h.created[0].sealedImageUrl).toBeNull();
  });
});

describe('campos aditivos IGNORADOS en raw/graded', () => {
  it('raw con tcgplayerProductId/imagen → columnas de sellado quedan null', async () => {
    const h = buildHarness({ sourceOn: true });
    h.priceRefs.push({
      cardId: 'card-anchor', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal',
      priceMxnCents: 10000, priceUsdCents: null, isManualOverride: false, source: 'manual',
      capturedDate: new Date('2026-08-21'),
    });
    await h.svc.createItem(
      {
        cardId: 'card-anchor',
        productType: 'raw',
        acquisitionType: 'aportacion_en_especie',
        acquisitionPct: 100,
        tcgplayerProductId: 777,
        tcgplayerGroupId: 900,
        sealedImageUrl: IMG_OK,
        sealedProductName: 'no debe persistir',
      } as any,
      'op-1',
    );
    expect(h.created[0]).toMatchObject({
      productType: 'raw',
      tcgplayerProductId: null,
      tcgplayerGroupId: null,
      sealedImageUrl: null,
      sealedProductName: null,
    });
  });
});

describe('alta por LOTE de sellado (batch) — mapeo + idempotencia + tolerancia por-línea', () => {
  it('línea válida nace mapeada; una línea con XOR inválido NO tumba la buena (HTTP 200 tolerante)', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h, 777);
    const res = await h.svc.batchCreate(
      {
        batchKey: 'bk-1',
        items: [
          sealedLine() as any, // ok, nace mapeada
          sealedLine({ tcgplayerGroupId: undefined }) as any, // XOR inválido
        ],
      },
      'op-1',
    );
    expect(res.summary).toMatchObject({ requested: 2, createdItems: 1, failedLines: 1 });
    expect(res.results[0]).toMatchObject({ index: 0, ok: true });
    expect(res.results[1]).toMatchObject({ index: 1, ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(h.created[0]).toMatchObject({ tcgplayerProductId: 777, tcgplayerGroupId: 900, sealedImageUrl: IMG_OK });
  });

  it('replay por el MISMO batchKey devuelve el resultado guardado sin re-crear (idempotencia)', async () => {
    const h = buildHarness({ sourceOn: true });
    seedMarket(h, 777);
    const first = await h.svc.batchCreate({ batchKey: 'bk-2', items: [sealedLine() as any] }, 'op-1');
    expect(first.idempotentReplay).toBe(false);
    const createdCount = h.created.length;
    const replay = await h.svc.batchCreate({ batchKey: 'bk-2', items: [sealedLine() as any] }, 'op-1');
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.summary).toEqual(first.summary);
    expect(h.created.length).toBe(createdCount); // no re-creó piezas
  });
});
