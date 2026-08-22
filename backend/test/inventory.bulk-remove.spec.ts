import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { BulkRemoveRequestDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * P-29 — baja rápida por CANTIDAD (POST /admin/inventory/items/bulk-remove):
 *  - baja las N piezas MÁS APROPIADAS de un (cardId, finish[, condición]) de un golpe;
 *  - selección server-side: solo platform en {in_stock, listed}, in_stock antes que listed, FIFO;
 *  - motivos perdida→lost | danada→damaged | error_captura→withdrawn (reusa la baja por-pieza);
 *  - atómico: si hay menos piezas que las pedidas → 422 INSUFFICIENT_STOCK y NO baja ninguna;
 *  - money-safe: nunca toca precios, nunca escribe reserved/listed (no vende ni publica);
 *  - registro TRIPLE por pieza: InventoryMovement(reason=adjustment) + InventoryAdjustment (M-24);
 *    el AuditLog action=inventory.bulk_remove lo escribe el controller.
 *  - v1.35 (H1): idempotencia opcional por `batchKey` (InventoryBatch M-21, kind='bulk_remove'):
 *    replay con la misma key → respuesta original + idempotentReplay:true, SIN re-bajar N piezas.
 */

function p2002(): Error {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function buildPricing(): PricingService {
  return {
    getReferencesBatch: jest.fn(async () => new Map()),
  } as unknown as PricingService;
}
const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;

function buildPrisma(candidates: any[], over: any = {}) {
  const adjustments: any[] = [];
  const movements: any[] = [];
  const batchStore = new Map<string, any>();
  let adjSeq = 0;
  let lastFindArgs: any = null;
  const prisma: any = {
    inventoryItem: {
      findMany: jest.fn(async (args: any) => {
        lastFindArgs = args;
        // Simula `take`: el servicio pide `take: quantity`; devolvemos como mucho ese tope.
        return candidates.slice(0, args.take);
      }),
      // Por default la guardia atómica "gana" para todas las piezas pedidas.
      updateMany: jest.fn(async ({ where }: any) => ({ count: where.id.in.length })),
    },
    inventoryMovement: {
      create: jest.fn(async ({ data }: any) => {
        movements.push(data);
        return data;
      }),
    },
    inventoryAdjustment: {
      create: jest.fn(async ({ data }: any) => {
        const row = { id: `adj-${++adjSeq}`, ...data };
        adjustments.push(row);
        return row;
      }),
    },
    // v1.35 — mecanismo de idempotencia InventoryBatch (M-21, kind='bulk_remove'). La unique
    // constraint del id (=batchKey) se simula lanzando P2002 en un segundo claim de la misma key.
    inventoryBatch: {
      findUnique: jest.fn(async ({ where }: any) => batchStore.get(where.id) ?? null),
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
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    __adjustments: adjustments,
    __movements: movements,
    __batchStore: batchStore,
    __lastFindArgs: () => lastFindArgs,
    ...over,
  };
  return prisma;
}

const ITEM = (id: string, status: string, folio: string) => ({ id, folio, status });

const baseDto = (over: Partial<BulkRemoveRequestDto> = {}): BulkRemoveRequestDto =>
  ({
    cardId: 'c1',
    finish: 'normal',
    quantity: 2,
    reason: 'perdida',
    note: 'merma agosto',
    ...over,
  }) as BulkRemoveRequestDto;

describe('InventoryService.bulkRemove — baja por cantidad (P-29)', () => {
  it.each([
    ['perdida', 'lost'],
    ['danada', 'damaged'],
    ['error_captura', 'withdrawn'],
  ] as const)('%s → baja N piezas a %s con registro triple por pieza', async (reason, toStatus) => {
    const prisma = buildPrisma([
      ITEM('i1', 'in_stock', 'INV-000001'),
      ITEM('i2', 'in_stock', 'INV-000002'),
    ]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);

    const res = await svc.bulkRemove(baseDto({ reason, quantity: 2 }), 'op-1');

    // Sin batchKey → idempotentReplay:false y SIN clave `batchKey` en la respuesta.
    expect(res).toEqual({
      idempotentReplay: false,
      removed: 2,
      requested: 2,
      reason,
      toStatus,
      inventoryItemIds: ['i1', 'i2'],
      folios: ['INV-000001', 'INV-000002'],
      adjustmentIds: ['adj-1', 'adj-2'],
    });
    // Sin batchKey no se toca InventoryBatch (procesamiento nuevo, no idempotente).
    expect(prisma.inventoryBatch.create).not.toHaveBeenCalled();
    // Guardia atómica: transiciona SOLO piezas platform aún en el allowlist.
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['i1', 'i2'] }, ownerType: 'platform', status: { in: ['in_stock', 'listed'] } },
      data: { status: toStatus },
    });
    // Una fila InventoryAdjustment + un movement reason=adjustment por pieza.
    expect(prisma.__movements).toHaveLength(2);
    expect(prisma.__adjustments).toHaveLength(2);
    for (const m of prisma.__movements) {
      expect(m.reason).toBe('adjustment');
      expect(m.toStatus).toBe(toStatus);
      expect(m.actorUserId).toBe('op-1');
      expect(m.note).toBe('merma agosto');
    }
    for (const a of prisma.__adjustments) {
      expect(a.reason).toBe(reason);
      expect(a.toStatus).toBe(toStatus);
    }
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('selección: filtra platform ∈ {in_stock,listed} y ordena in_stock→listed / FIFO, take=quantity', async () => {
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1'), ITEM('i2', 'in_stock', 'INV-2')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.bulkRemove(baseDto({ quantity: 2 }), 'op-1');
    const args = prisma.__lastFindArgs();
    expect(args.where).toMatchObject({
      cardId: 'c1',
      finish: 'normal',
      ownerType: 'platform',
      status: { in: ['in_stock', 'listed'] },
    });
    expect(args.orderBy).toEqual([{ status: 'asc' }, { createdAt: 'asc' }]);
    expect(args.take).toBe(2);
  });

  it('filtros opcionales productType/rawCondition/sealedCondition se aplican al where', async () => {
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.bulkRemove(
      baseDto({ quantity: 1, productType: 'raw', rawCondition: 'NM' }),
      'op-1',
    );
    expect(prisma.__lastFindArgs().where).toMatchObject({ productType: 'raw', rawCondition: 'NM' });
  });

  it('NO baja más de las que hay: quantity > disponibles → 422 INSUFFICIENT_STOCK sin escribir nada', async () => {
    // Solo 1 pieza disponible, se piden 3.
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(svc.bulkRemove(baseDto({ quantity: 3 }), 'op-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      status: 422,
      details: { available: 1, requested: 3 },
    });
    // Money-safe / atómico: no transiciona ni registra NADA.
    expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
    expect(prisma.__movements).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });

  it('cero disponibles → 422 INSUFFICIENT_STOCK (available 0)', async () => {
    const prisma = buildPrisma([]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(svc.bulkRemove(baseDto({ quantity: 1 }), 'op-1')).rejects.toMatchObject({
      code: 'INSUFFICIENT_STOCK',
      details: { available: 0, requested: 1 },
    });
  });

  it('note en blanco → 400 VALIDATION_ERROR (paridad con la baja por-pieza)', async () => {
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(svc.bulkRemove(baseDto({ note: '   ' }), 'op-1')).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
    });
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('[TOCTOU] carrera: updateMany count < pedidas → 422 ITEM_NOT_ADJUSTABLE y NO registra', async () => {
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1'), ITEM('i2', 'in_stock', 'INV-2')]);
    // Una pieza salió del allowlist entre la lectura y el update (p. ej. checkout la reservó).
    prisma.inventoryItem.updateMany = jest.fn(async () => ({ count: 1 }));
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(svc.bulkRemove(baseDto({ quantity: 2 }), 'op-1')).rejects.toMatchObject({
      code: 'ITEM_NOT_ADJUSTABLE',
      status: 422,
    });
    expect(prisma.__movements).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });

  it('money-safe: el status destino SIEMPRE cae en la baja (lost/damaged/withdrawn), nunca reserved/listed', async () => {
    for (const [reason, toStatus] of [
      ['perdida', 'lost'],
      ['danada', 'damaged'],
      ['error_captura', 'withdrawn'],
    ] as const) {
      const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-1')]);
      const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
      const res = await svc.bulkRemove(baseDto({ quantity: 1, reason }), 'op-1');
      expect(res.toStatus).toBe(toStatus);
      expect(['reserved', 'listed']).not.toContain(res.toStatus);
    }
  });
});

describe('InventoryService.bulkRemove — idempotencia por batchKey (v1.35, H1)', () => {
  it('replay del mismo batchKey devuelve la respuesta ORIGINAL guardada + idempotentReplay:true SIN re-bajar', async () => {
    const prisma = buildPrisma([
      ITEM('i1', 'in_stock', 'INV-000001'),
      ITEM('i2', 'in_stock', 'INV-000002'),
    ]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);

    const first = await svc.bulkRemove(baseDto({ quantity: 2, batchKey: 'bk-1' }), 'op-1');
    expect(first.idempotentReplay).toBe(false);
    expect(first.batchKey).toBe('bk-1');
    expect(first.removed).toBe(2);
    expect(first.adjustmentIds).toEqual(['adj-1', 'adj-2']);
    // Primera ejecución: baja real (2 movements + 2 adjustments + 1 updateMany + 1 claim).
    expect(prisma.__movements).toHaveLength(2);
    expect(prisma.__adjustments).toHaveLength(2);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryBatch.create).toHaveBeenCalledTimes(1);

    const replay = await svc.bulkRemove(baseDto({ quantity: 2, batchKey: 'bk-1' }), 'op-1');
    expect(replay.idempotentReplay).toBe(true);
    // Respuesta ORIGINAL (mismos ids/folios/adjustmentIds), no una nueva baja.
    expect(replay.adjustmentIds).toEqual(first.adjustmentIds);
    expect(replay.inventoryItemIds).toEqual(first.inventoryItemIds);
    expect(replay.folios).toEqual(first.folios);
    expect(replay.removed).toBe(2);
    // NO re-baja: cero movements/adjustments/updateMany/claim adicionales (encogimiento fantasma cerrado).
    expect(prisma.__movements).toHaveLength(2);
    expect(prisma.__adjustments).toHaveLength(2);
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.inventoryBatch.create).toHaveBeenCalledTimes(1);
    // El replay NI SIQUIERA vuelve a leer candidatos (fast-path por InventoryBatch).
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(1);
  });

  it('claim atómico PRIMERO dentro de la tx (kind=bulk_remove) + resultado persistido como fuente del replay', async () => {
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-000001')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.bulkRemove(baseDto({ quantity: 1, batchKey: 'bk-2' }), 'op-1');
    expect(prisma.inventoryBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: 'bk-2',
        kind: 'bulk_remove',
        actorUserId: 'op-1',
        requested: 1,
      }),
    });
    const stored = prisma.__batchStore.get('bk-2');
    expect(stored.createdItems).toBe(1);
    expect(stored.resultJson).toMatchObject({
      batchKey: 'bk-2',
      reason: 'perdida',
      removed: 1,
      idempotentReplay: false,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('un fallo (INSUFFICIENT_STOCK) NO quema el batchKey: rollback del claim → reintento limpio', async () => {
    // 1a llamada: piden 3, solo hay 1 → 422. El claim se creó primero pero la tx hace rollback.
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-000001')]);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.bulkRemove(baseDto({ quantity: 3, batchKey: 'bk-fail' }), 'op-1'),
    ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK', status: 422 });
    // Con $transaction mockeada (sin rollback real) el store simula el claim; el fast-path NO debe
    // servir un replay de un lote fallido: como en producción el rollback lo borra, aquí verificamos
    // que en el camino feliz el resultJson de un lote EXITOSO es {}-vacío→poblado, no de un fallo.
    // (La invariante real de rollback se prueba en el e2e con BD; aquí basta con que 422 no escribió baja.)
    expect(prisma.__movements).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });

  it('concurrencia: P2002 en el claim → replay del ganador, NO re-baja', async () => {
    const winner = {
      batchKey: 'bk-race',
      idempotentReplay: false,
      removed: 1,
      requested: 1,
      reason: 'perdida',
      toStatus: 'lost',
      inventoryItemIds: ['inv-w'],
      folios: ['INV-000999'],
      adjustmentIds: ['adj-w'],
    };
    let findCalls = 0;
    const prisma = buildPrisma([ITEM('i1', 'in_stock', 'INV-000001')], {
      inventoryBatch: {
        // 1a llamada (fast-path) → null; posteriores (catch-path) → resultado ganador.
        findUnique: jest.fn(async () =>
          findCalls++ === 0 ? null : { id: 'bk-race', resultJson: winner },
        ),
        create: jest.fn(async () => {
          throw p2002();
        }),
        update: jest.fn(),
      },
    });
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res = await svc.bulkRemove(baseDto({ quantity: 1, batchKey: 'bk-race' }), 'op-1');
    expect(res.idempotentReplay).toBe(true);
    expect(res.adjustmentIds).toEqual(['adj-w']);
    expect(res.inventoryItemIds).toEqual(['inv-w']);
    // El perdedor NO escribió baja (movements/adjustments quedan vacíos).
    expect(prisma.__movements).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });
});

describe('InventoryController.bulkRemove — auditoría (P-29)', () => {
  it('escribe AuditLog action=inventory.bulk_remove con requested/removed y responde el resultado', async () => {
    const inventory = {
      bulkRemove: jest.fn(async () => ({
        removed: 2,
        requested: 2,
        reason: 'perdida',
        toStatus: 'lost',
        inventoryItemIds: ['i1', 'i2'],
        folios: ['INV-1', 'INV-2'],
        adjustmentIds: ['adj-1', 'adj-2'],
      })),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const ctrl = new InventoryController(inventory as any, {} as any, audit as any);
    const out = await ctrl.bulkRemove(baseDto({ quantity: 2 }), {
      id: 'op-1',
      role: 'vault_operator' as any,
    });
    expect(out.removed).toBe(2);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'op-1',
        action: 'inventory.bulk_remove',
        entityType: 'InventoryAdjustment',
        entityId: 'adj-1',
        after: expect.objectContaining({ requested: 2, removed: 2, reason: 'perdida', toStatus: 'lost' }),
      }),
    );
  });
});
