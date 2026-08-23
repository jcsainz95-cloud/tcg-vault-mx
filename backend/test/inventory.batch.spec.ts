import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import {
  BatchCreateInventoryRequest,
  BatchInventoryItemInput,
  BulkPublishLineInput,
  BulkPublishRequest,
  CreateItemDto,
  MAX_APORTACION_PCT,
  MAX_BATCH_QTY,
  MAX_LIST_PRICE_CENTS,
} from '../src/modules/inventory/dto/inventory.dto';

/**
 * WS-E (v1.16-master-set, §4.17b) + endurecimiento WS-E — ESCRITURA POR LOTE:
 *  - alta por lote: errores por-línea (1 línea inválida NO tumba el resto, commit parcial → 200);
 *    `qty` expande a N piezas con folios consecutivos; idempotencia/atomicidad por batchKey
 *    (claim-first en $transaction → replay/concurrencia NO duplica; SEC-N2/BE-34).
 *  - bulk-publish: precio DERIVADO server-side; `pct` sin market → PRICE_PENDING (no publica);
 *    override manual gana; errores por-línea; guarda anti-double-sell por status de ORIGEN [MONEY].
 *  - DTOs: `qty` con @Max(500) y `listPriceCents` con @Max (SEC-N1/N3).
 */

function buildPricing(over: any = {}): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReferencesBatch: jest.fn(async () => new Map()),
    loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
    // v1.23-sealed-sales: contexto/ helpers del sellado (default: dial off → sellado solo por override).
    loadSealedSpreads: jest.fn(async () => ({
      spreadPctBySubtype: { box: 18, etb: 22, bundle: 25, tin: 30, blister: 35 },
      fallbackPct: 25,
      sourceOn: false,
    })),
    sealedMarketGradeKeyForItem: jest.fn((item: any) =>
      item.tcgplayerProductId != null ? `sealed:tcg:${item.tcgplayerProductId}` : null,
    ),
    getSealedMarketRef: jest.fn(async () => ({ status: 'pending' })),
    ...over,
    // v1.28 (P-18): controles por variante — sin filas M-30 por default (comportamiento previo).
    getVariantOverridesBatch: jest.fn(async () => new Map()),
    getVariantOverride: jest.fn(async () => null),
  } as unknown as PricingService;
}

const settings = {
  getNumber: jest.fn(async () => 70),
} as unknown as SettingsService;

/** Error que imita el P2002 (unique constraint) de Prisma para el claim del InventoryBatch. */
function p2002(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function buildPrisma(over: any = {}) {
  const createdItems: any[] = [];
  const batchStore = new Map<string, any>();
  let folioSeq = 100;
  const prisma: any = {
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'missing'
          ? null
          : { id: where.id, rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] },
      ),
    },
    nextFolio: jest.fn(async () => `INV-${String(++folioSeq).padStart(6, '0')}`),
    nextFolios: jest.fn(async (n: number) => {
      const out: string[] = [];
      for (let i = 0; i < n; i++) out.push(`INV-${String(++folioSeq).padStart(6, '0')}`);
      return out;
    }),
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        createdItems.push(data);
        return { id: `inv-${createdItems.length}`, folio: data.folio, status: data.status };
      }),
      findMany: jest.fn(async () => []),
      // [BE-45] la publicación usa una guardia atómica updateMany + count (default: "gana").
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    inventoryMovement: { create: jest.fn() },
    inventoryBatch: {
      findUnique: jest.fn(async ({ where }: any) => batchStore.get(where.id) ?? null),
      // Simula la unique constraint: un segundo claim del mismo batchKey lanza P2002.
      create: jest.fn(async ({ data }: any) => {
        if (batchStore.has(data.id)) throw p2002();
        batchStore.set(data.id, { ...data });
        return data;
      }),
      update: jest.fn(async ({ where, data }: any) => {
        const row = { ...(batchStore.get(where.id) ?? {}), ...data };
        batchStore.set(where.id, row);
        return row;
      }),
    },
    // El claim + items + finalize corren en la MISMA tx; el mock ejecuta el callback con el
    // propio prisma como cliente de transacción (los writes usan los mismos jest.fn).
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    __createdItems: createdItems,
    __batchStore: batchStore,
    ...over,
  };
  return prisma;
}

describe('InventoryService.batchCreate — alta por lote', () => {
  it('1 línea inválida NO tumba las válidas (commit parcial, HTTP 200 a nivel de servicio)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BatchCreateInventoryRequest = {
      batchKey: 'k1',
      items: [
        { cardId: 'c1', productType: 'raw', acquisitionType: 'compra' },
        { cardId: 'missing', productType: 'raw', acquisitionType: 'compra' }, // NOT_FOUND
        { cardId: 'c2', productType: 'raw', acquisitionType: 'compra' },
      ],
    };
    const res = await svc.batchCreate(req, 'admin');
    expect(res.summary).toEqual({ requested: 3, createdItems: 2, failedLines: 1 });
    expect(res.results[0]).toMatchObject({ index: 0, ok: true });
    expect(res.results[1]).toMatchObject({ index: 1, ok: false, error: { code: 'NOT_FOUND' } });
    expect(res.results[2]).toMatchObject({ index: 2, ok: true });
    expect(prisma.__createdItems).toHaveLength(2);
  });

  // BLOQ-1 (DINERO): el alta por lote debe PERSISTIR `acquisitionCostCents`. Antes faltaba en el DTO
  // `BatchInventoryItemInput`, así que ValidationPipe({whitelist:true}) lo borraba en silencio y toda
  // pieza dada de alta por lote (QuickAdd / sellado con «Comprar») nacía con costo NULL.
  it('[BLOQ-1] persiste acquisitionCostCents de la línea (compra) — no queda NULL', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BatchCreateInventoryRequest = {
      batchKey: 'cost1',
      items: [
        { cardId: 'c1', productType: 'raw', acquisitionType: 'compra', acquisitionCostCents: 80000, qty: 2 },
      ],
    };
    const res = await svc.batchCreate(req, 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, acquisitionCostCents: 80000 });
    // Las 2 piezas creadas guardan el costo en la fila (no undefined/null).
    expect(prisma.__createdItems).toHaveLength(2);
    for (const data of prisma.__createdItems) {
      expect(data.acquisitionCostCents).toBe(80000);
    }
  });

  // Un costo 0 es LEGÍTIMO (promo/regalo), a diferencia de un precio de venta → debe persistirse como 0.
  it('[BLOQ-1] acquisitionCostCents=0 (promo/regalo) se persiste como 0, no se pierde', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res = await svc.batchCreate(
      { batchKey: 'cost0', items: [{ cardId: 'c1', productType: 'raw', acquisitionType: 'compra', acquisitionCostCents: 0 }] },
      'admin',
    );
    expect(res.results[0]).toMatchObject({ ok: true });
    expect(prisma.__createdItems[0].acquisitionCostCents).toBe(0);
  });

  it('`qty` expande a N piezas con folios CONSECUTIVOS (una reserva nextFolios)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BatchCreateInventoryRequest = {
      batchKey: 'k2',
      items: [{ cardId: 'c1', productType: 'raw', acquisitionType: 'compra', qty: 3 }],
    };
    const res = await svc.batchCreate(req, 'admin');
    expect(res.results[0]).toMatchObject({ ok: true });
    const line = res.results[0] as any;
    expect(line.folios).toHaveLength(3);
    // Consecutivos.
    expect(line.folios).toEqual(['INV-000101', 'INV-000102', 'INV-000103']);
    expect(res.summary.createdItems).toBe(3);
    expect(prisma.nextFolios).toHaveBeenCalledWith(3);
  });

  it('graded con qty>1 → VALIDATION_ERROR por-línea (cada slab es único)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BatchCreateInventoryRequest = {
      batchKey: 'k3',
      items: [
        {
          cardId: 'c1',
          productType: 'graded',
          gradingCompany: 'PSA',
          gradeValue: '10',
          certNumber: 'X1',
          acquisitionType: 'compra',
          qty: 2,
        },
      ],
    };
    const res = await svc.batchCreate(req, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'VALIDATION_ERROR' } });
    expect(res.summary.createdItems).toBe(0);
  });

  it('idempotencia: replay del mismo batchKey devuelve lo guardado SIN re-crear', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BatchCreateInventoryRequest = {
      batchKey: 'dup',
      items: [{ cardId: 'c1', productType: 'raw', acquisitionType: 'compra', qty: 2 }],
    };
    const first = await svc.batchCreate(req, 'admin');
    expect(first.idempotentReplay).toBe(false);
    expect(prisma.__createdItems).toHaveLength(2);

    const replay = await svc.batchCreate(req, 'admin');
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.summary).toEqual(first.summary);
    expect(replay.results).toEqual(first.results);
    // NO se crearon más piezas ni un segundo claim de InventoryBatch.
    expect(prisma.__createdItems).toHaveLength(2);
    expect(prisma.inventoryBatch.create).toHaveBeenCalledTimes(1);
  });

  it('[SEC-N2/BE-34] atomicidad: claim + items corren en UNA $transaction', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.batchCreate(
      { batchKey: 'tx1', items: [{ cardId: 'c1', productType: 'raw', acquisitionType: 'compra' }] },
      'admin',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('[SEC-N2/BE-34] concurrencia: P2002 en el claim → replay, NO duplica inventario', async () => {
    // Otra corrida (la ganadora) ya dejó el batch persistido con su resultado; el fast-path
    // findUnique NO lo ve (aún null la 1a vez), pero el claim create choca con P2002 y el
    // catch-path lee el resultado ganador y lo replica sin crear items.
    const winnerResult = {
      summary: { requested: 1, createdItems: 1, failedLines: 0 },
      results: [{ index: 0, ok: true, folios: ['INV-000999'], inventoryItemIds: ['inv-w'] }],
    };
    let findCalls = 0;
    const prisma = buildPrisma({
      inventoryBatch: {
        // 1a llamada (fast-path) → null; llamadas posteriores (catch-path) → resultado ganador.
        findUnique: jest.fn(async () =>
          findCalls++ === 0 ? null : { id: 'race', resultJson: winnerResult },
        ),
        create: jest.fn(async () => {
          throw p2002();
        }),
        update: jest.fn(),
      },
    });
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res = await svc.batchCreate(
      { batchKey: 'race', items: [{ cardId: 'c1', productType: 'raw', acquisitionType: 'compra' }] },
      'admin',
    );
    expect(res.idempotentReplay).toBe(true);
    expect(res.summary).toEqual(winnerResult.summary);
    // La corrida perdedora NO creó ninguna pieza física.
    expect(prisma.__createdItems).toHaveLength(0);
  });
});

describe('InventoryService.bulkPublish — publicar por lote', () => {
  function prismaWithItems(items: any[]) {
    return buildPrisma({
      inventoryItem: {
        findMany: jest.fn(async () => items),
        // [BE-45] guardia atómica de status: updateMany condicionado + count (default: "gana").
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
    });
  }

  const baseItem = (over: any = {}) => ({
    id: 'i1',
    cardId: 'c1',
    productType: 'raw',
    finish: 'normal',
    certNumber: null,
    ownerType: 'platform',
    status: 'in_stock',
    listPriceCents: null,
    card: { rarity: 'Common' },
    ...over,
  });

  it('deriva el precio server-side (fixed → piso) y publica', async () => {
    const items = [baseItem()];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({
        rules: { Common: { mode: 'fixed', value: 500 } },
        fallbackPct: 15,
      })),
      getReferencesBatch: jest.fn(async () => new Map()),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const req: BulkPublishRequest = { items: [{ inventoryItemId: 'i1' }] };
    const res = await svc.bulkPublish(req, 'admin');
    expect(res.results[0]).toMatchObject({
      ok: true,
      status: 'listed',
      salePriceCents: 500,
      priceSource: 'derived',
    });
    expect(res.summary.published).toBe(1);
    // [BE-45] guardia ATÓMICA: el paso a listed va condicionado al allowlist en el propio UPDATE.
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'i1', ownerType: 'platform', status: { in: ['in_stock', 'listed'] } },
        data: expect.objectContaining({ status: 'listed' }),
      }),
    );
  });

  it('`pct` sin market → PRICE_PENDING: NO publica esa pieza (regla "solo lo que tiene precio")', async () => {
    const items = [baseItem({ id: 'i2', cardId: 'c2', card: { rarity: 'Illustration Rare' } })];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
      getReferencesBatch: jest.fn(async () => new Map()), // sin referencia
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.bulkPublish({ items: [{ inventoryItemId: 'i2' }] }, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(res.summary.published).toBe(0);
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('override manual gana; errores por-línea (item no encontrado no tumba el resto)', async () => {
    const items = [baseItem({ id: 'i3', cardId: 'c3', card: { rarity: 'Rare' } })];
    const prisma = prismaWithItems(items);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const req: BulkPublishRequest = {
      items: [
        { inventoryItemId: 'i3', listPriceCents: 99999 }, // manual
        { inventoryItemId: 'ghost' }, // NOT_FOUND
      ],
    };
    const res = await svc.bulkPublish(req, 'admin');
    expect(res.results[0]).toMatchObject({ ok: true, salePriceCents: 99999, priceSource: 'manual' });
    expect(res.results[1]).toMatchObject({ ok: false, error: { code: 'NOT_FOUND' } });
    expect(res.summary).toEqual({ requested: 2, published: 1, failedLines: 1 });
  });

  it('BE-25: iza SALES_PRICE_RULES una vez y resuelve referencias en 1 lote (sin N+1)', async () => {
    const items = [
      baseItem({ id: 'a', cardId: 'c1' }),
      baseItem({ id: 'b', cardId: 'c2' }),
    ];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: { Common: { mode: 'fixed', value: 500 } }, fallbackPct: 15 })),
      getReferencesBatch: jest.fn(async () => new Map()),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await svc.bulkPublish({ items: [{ inventoryItemId: 'a' }, { inventoryItemId: 'b' }] }, 'admin');
    // 1 sola lectura de reglas + 1 solo lote de referencias para las 2 piezas.
    expect((pricing.loadSalesRules as jest.Mock).mock.calls).toHaveLength(1);
    expect((pricing.getReferencesBatch as jest.Mock).mock.calls).toHaveLength(1);
  });

  // ===== [MONEY · WS-E] Guarda anti-double-sell por status de ORIGEN =====

  it('[MONEY] OMITE (ITEM_NOT_PUBLISHABLE) una pieza `reserved` — no la re-abre a un 2º checkout', async () => {
    const items = [baseItem({ id: 'r1', status: 'reserved' })];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: { Common: { mode: 'fixed', value: 500 } }, fallbackPct: 15 })),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.bulkPublish({ items: [{ inventoryItemId: 'r1' }] }, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'ITEM_NOT_PUBLISHABLE' } });
    expect(res.summary.published).toBe(0);
    // Jamás se fuerza status → listed sobre una pieza reservada.
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
  });

  it('[MONEY · BE-45] CARRERA: el snapshot leído era in_stock pero updateMany devuelve count=0 → ITEM_NOT_PUBLISHABLE por-línea', async () => {
    // TOCTOU: entre el findMany y el UPDATE un checkout reservó la pieza. La guardia atómica
    // (updateMany condicionado + count) la detecta y NO re-lista la pieza para un 2º comprador.
    const items = [baseItem({ id: 'race1', status: 'in_stock' })];
    const prisma = prismaWithItems(items);
    prisma.inventoryItem.updateMany = jest.fn(async () => ({ count: 0 }));
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: { Common: { mode: 'fixed', value: 500 } }, fallbackPct: 15 })),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.bulkPublish({ items: [{ inventoryItemId: 'race1' }] }, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'ITEM_NOT_PUBLISHABLE' } });
    expect(res.summary.published).toBe(0);
  });

  it('[MONEY] OMITE piezas `lost` y `damaged` (sin existencia física real → inventario fantasma)', async () => {
    for (const status of ['lost', 'damaged', 'in_custody', 'shipped', 'withdrawn'] as const) {
      const items = [baseItem({ id: status, status })];
      const prisma = prismaWithItems(items);
      const pricing = buildPricing({
        loadSalesRules: jest.fn(async () => ({ rules: { Common: { mode: 'fixed', value: 500 } }, fallbackPct: 15 })),
      });
      const svc = new InventoryService(prisma as PrismaService, pricing, settings);
      const res = await svc.bulkPublish({ items: [{ inventoryItemId: status }] }, 'admin');
      expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'ITEM_NOT_PUBLISHABLE' } });
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    }
  });

  it('[MONEY] una pieza ya `listed` = no-op idempotente (ok:true), y no tumba el lote', async () => {
    const items = [
      baseItem({ id: 'listed1', status: 'listed', listPriceCents: 700 }),
      baseItem({ id: 'stock1', status: 'in_stock' }),
    ];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: { Common: { mode: 'fixed', value: 500 } }, fallbackPct: 15 })),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.bulkPublish(
      { items: [{ inventoryItemId: 'listed1' }, { inventoryItemId: 'stock1' }] },
      'admin',
    );
    expect(res.results[0]).toMatchObject({ ok: true, status: 'listed', priceSource: 'manual' });
    expect(res.results[1]).toMatchObject({ ok: true, status: 'listed' });
    expect(res.summary).toEqual({ requested: 2, published: 2, failedLines: 0 });
  });
});

// ===== DTOs: topes de qty y listPriceCents (SEC-N1 / SEC-N3) =====

describe('BatchInventoryItemInput — validación de qty y listPriceCents', () => {
  const base = { cardId: 'c1', productType: 'raw', acquisitionType: 'compra' };

  async function validateLine(over: any) {
    return validate(plainToInstance(BatchInventoryItemInput, { ...base, ...over }));
  }

  it('acepta qty en el límite (500)', async () => {
    expect(await validateLine({ qty: MAX_BATCH_QTY })).toHaveLength(0);
  });

  it('[SEC-N1] rechaza qty por encima del @Max (DoS de generate_series)', async () => {
    const errors = await validateLine({ qty: MAX_BATCH_QTY + 1 });
    expect(errors.some((e) => e.property === 'qty')).toBe(true);
  });

  it('rechaza qty < 1', async () => {
    const errors = await validateLine({ qty: 0 });
    expect(errors.some((e) => e.property === 'qty')).toBe(true);
  });

  it('acepta listPriceCents en el límite', async () => {
    expect(await validateLine({ listPriceCents: MAX_LIST_PRICE_CENTS })).toHaveLength(0);
  });

  it('[SEC-N3] rechaza listPriceCents por encima del @Max (Int32/overflow)', async () => {
    const errors = await validateLine({ listPriceCents: MAX_LIST_PRICE_CENTS + 1 });
    expect(errors.some((e) => e.property === 'listPriceCents')).toBe(true);
  });

  // M-2 (SEC): acquisitionPct con @Max de política — un vault_operator no puede inflar el costo de
  // aportación (costo = referencia × pct/100) por encima del techo de negocio (100%).
  it('acepta acquisitionPct en el límite de política (100)', async () => {
    expect(await validateLine({ acquisitionPct: MAX_APORTACION_PCT })).toHaveLength(0);
  });

  it('[M-2] rechaza acquisitionPct por encima del @Max (inflado de costo de aportación)', async () => {
    const errors = await validateLine({ acquisitionPct: MAX_APORTACION_PCT + 1 });
    expect(errors.some((e) => e.property === 'acquisitionPct')).toBe(true);
  });

  it('[M-2] rechaza acquisitionPct negativo', async () => {
    const errors = await validateLine({ acquisitionPct: -1 });
    expect(errors.some((e) => e.property === 'acquisitionPct')).toBe(true);
  });

  // BLOQ-1 (DINERO): `acquisitionCostCents` DEBE estar decorado en el DTO para que el
  // ValidationPipe({whitelist:true}) NO lo elimine. Un campo con decoradores queda whitelisted; sin
  // ellos, whitelist lo borra en silencio (raíz del bug). Estos casos afirman las MISMAS reglas que
  // CreateItemDto: opcional, entero, @Min(0) (un costo 0 es válido — promo/regalo).
  it('[BLOQ-1] acepta acquisitionCostCents entero >= 0 (0 legítimo)', async () => {
    expect(await validateLine({ acquisitionCostCents: 0 })).toHaveLength(0);
    expect(await validateLine({ acquisitionCostCents: 80000 })).toHaveLength(0);
  });

  it('[BLOQ-1] rechaza acquisitionCostCents negativo y no-entero (queda whitelisted, no se borra)', async () => {
    expect((await validateLine({ acquisitionCostCents: -1 })).some((e) => e.property === 'acquisitionCostCents')).toBe(true);
    expect((await validateLine({ acquisitionCostCents: 1.5 })).some((e) => e.property === 'acquisitionCostCents')).toBe(true);
  });

  // SEC N-2 (money-safe): `acquisitionCostCents` con @Max (misma cota que el dinero manual) — un
  // vault_operator no puede inyectar un costo cercano a Int32 que desborde los agregados de P&L.
  it('[SEC-N2] acepta acquisitionCostCents en el límite (MAX_LIST_PRICE_CENTS)', async () => {
    expect(await validateLine({ acquisitionCostCents: MAX_LIST_PRICE_CENTS })).toHaveLength(0);
  });

  it('[SEC-N2] rechaza acquisitionCostCents por encima del @Max (overflow de P&L)', async () => {
    const errors = await validateLine({ acquisitionCostCents: MAX_LIST_PRICE_CENTS + 1 });
    expect(errors.some((e) => e.property === 'acquisitionCostCents')).toBe(true);
  });
});

// SEC N-2 (money-safe) — misma cota @Max en CreateItemDto.acquisitionCostCents (alta por-pieza).
describe('CreateItemDto — @Max de acquisitionCostCents (SEC N-2)', () => {
  const base = { cardId: 'c1', productType: 'raw', acquisitionType: 'compra' };
  const validateItem = (over: any) => validate(plainToInstance(CreateItemDto, { ...base, ...over }));

  it('acepta acquisitionCostCents en el límite y 0 (promo/regalo)', async () => {
    expect(await validateItem({ acquisitionCostCents: 0 })).toHaveLength(0);
    expect(await validateItem({ acquisitionCostCents: MAX_LIST_PRICE_CENTS })).toHaveLength(0);
  });

  it('rechaza acquisitionCostCents por encima del @Max', async () => {
    const errors = await validateItem({ acquisitionCostCents: MAX_LIST_PRICE_CENTS + 1 });
    expect(errors.some((e) => e.property === 'acquisitionCostCents')).toBe(true);
  });
});

describe('BulkPublishLineInput — validación de listPriceCents', () => {
  it('acepta el límite y rechaza por encima', async () => {
    const ok = await validate(
      plainToInstance(BulkPublishLineInput, { inventoryItemId: 'i1', listPriceCents: MAX_LIST_PRICE_CENTS }),
    );
    expect(ok).toHaveLength(0);
    const bad = await validate(
      plainToInstance(BulkPublishLineInput, {
        inventoryItemId: 'i1',
        listPriceCents: MAX_LIST_PRICE_CENTS + 1,
      }),
    );
    expect(bad.some((e) => e.property === 'listPriceCents')).toBe(true);
  });
});
