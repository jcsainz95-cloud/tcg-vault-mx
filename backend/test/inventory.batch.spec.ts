import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import {
  BatchCreateInventoryRequest,
  BulkPublishRequest,
} from '../src/modules/inventory/dto/inventory.dto';

/**
 * WS-E (v1.16-master-set, §4.17b) — ESCRITURA POR LOTE:
 *  - alta por lote: errores por-línea (1 línea inválida NO tumba el resto, commit parcial → 200);
 *    `qty` expande a N piezas con folios consecutivos; idempotencia por batchKey (replay no duplica).
 *  - bulk-publish: precio DERIVADO server-side; `pct` sin market → PRICE_PENDING (no publica);
 *    override manual gana; errores por-línea.
 */

function buildPricing(over: any = {}): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReferencesBatch: jest.fn(async () => new Map()),
    loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
    ...over,
  } as unknown as PricingService;
}

const settings = {
  getNumber: jest.fn(async () => 70),
} as unknown as SettingsService;

function buildPrisma(over: any = {}) {
  const createdItems: any[] = [];
  const batches: any[] = [];
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
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
    },
    inventoryMovement: { create: jest.fn() },
    inventoryBatch: {
      findUnique: jest.fn(async ({ where }: any) => batches.find((b) => b.id === where.id) ?? null),
      create: jest.fn(async ({ data }: any) => {
        batches.push(data);
        return data;
      }),
    },
    __createdItems: createdItems,
    __batches: batches,
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
    // NO se crearon más piezas ni un segundo InventoryBatch.
    expect(prisma.__createdItems).toHaveLength(2);
    expect(prisma.inventoryBatch.create).toHaveBeenCalledTimes(1);
  });
});

describe('InventoryService.bulkPublish — publicar por lote', () => {
  function prismaWithItems(items: any[]) {
    return buildPrisma({
      inventoryItem: {
        findMany: jest.fn(async () => items),
        update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
      },
    });
  }

  it('deriva el precio server-side (fixed → piso) y publica', async () => {
    const items = [
      {
        id: 'i1',
        cardId: 'c1',
        productType: 'raw',
        finish: 'normal',
        certNumber: null,
        ownerType: 'platform',
        listPriceCents: null,
        card: { rarity: 'Common' },
      },
    ];
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
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'i1' }, data: expect.objectContaining({ status: 'listed' }) }),
    );
  });

  it('`pct` sin market → PRICE_PENDING: NO publica esa pieza (regla "solo lo que tiene precio")', async () => {
    const items = [
      {
        id: 'i2',
        cardId: 'c2',
        productType: 'raw',
        finish: 'normal',
        certNumber: null,
        ownerType: 'platform',
        listPriceCents: null,
        card: { rarity: 'Illustration Rare' }, // premium → fallback pct, sin market → pending
      },
    ];
    const prisma = prismaWithItems(items);
    const pricing = buildPricing({
      loadSalesRules: jest.fn(async () => ({ rules: {}, fallbackPct: 15 })),
      getReferencesBatch: jest.fn(async () => new Map()), // sin referencia
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.bulkPublish({ items: [{ inventoryItemId: 'i2' }] }, 'admin');
    expect(res.results[0]).toMatchObject({ ok: false, error: { code: 'PRICE_PENDING' } });
    expect(res.summary.published).toBe(0);
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('override manual gana; errores por-línea (item no encontrado no tumba el resto)', async () => {
    const items = [
      {
        id: 'i3',
        cardId: 'c3',
        productType: 'raw',
        finish: 'normal',
        certNumber: null,
        ownerType: 'platform',
        listPriceCents: null,
        card: { rarity: 'Rare' },
      },
    ];
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
      { id: 'a', cardId: 'c1', productType: 'raw', finish: 'normal', certNumber: null, ownerType: 'platform', listPriceCents: null, card: { rarity: 'Common' } },
      { id: 'b', cardId: 'c2', productType: 'raw', finish: 'normal', certNumber: null, ownerType: 'platform', listPriceCents: null, card: { rarity: 'Common' } },
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
});
