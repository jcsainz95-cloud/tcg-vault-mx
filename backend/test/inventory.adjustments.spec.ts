import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { InventoryAdjustmentRequestDto } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.20-master-set-everywhere (§4.20e) + v1.20.1-adjustments-clarify — POST /admin/inventory/adjustments:
 *  - motivos: encontrada (crea in_stock) · perdida → lost · danada → damaged · error_captura →
 *    withdrawn (SIN semántica de pérdida; el motivo queda tipado en InventoryAdjustment.reason).
 *  - v1.20.1: respuesta PLURAL `adjustmentIds: string[]` (una fila M-24 por pieza, alineada 1:1 con
 *    inventoryItemIds/folios) + `idempotentReplay`. `batchKey?` SOLO con `encontrada` (idempotencia
 *    InventoryBatch M-21, misma semántica que batchCreate; replay → respuesta original + 200).
 *  - guardarraíl: SOLO piezas platform en {in_stock, listed} → 422 ITEM_NOT_ADJUSTABLE en el resto;
 *    [BE-45] la transición es una guardia ATÓMICA (updateMany condicionado + count) — una carrera
 *    que saque la pieza del allowlist entre lectura y escritura da 422, no pisa el status.
 *  - registro triple: InventoryAdjustment + InventoryMovement(reason=adjustment) en la MISMA tx;
 *    AuditLog action=inventory.adjustment lo escribe el controller.
 *  - validación cruzada: encontrada sin item / resto sin inventoryItemId o note / batchKey con
 *    motivo ≠ encontrada → 400.
 *  - el ajuste JAMÁS vende: nunca escribe status reserved/listed ni crea órdenes.
 */

function buildPricing(over: any = {}): PricingService {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReferencesBatch: jest.fn(async () => new Map()),
    // v2.0 (P-48): la CURVA sustituye a las reglas de venta/compra; UN solo loader (§4.36.2).
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    ...over,
  } as unknown as PricingService;
}

const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;

/** Error que imita el P2002 (unique constraint) de Prisma para el claim del InventoryBatch. */
function p2002(): Error & { code: string } {
  return Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
}

function buildPrisma(over: any = {}) {
  const createdItems: any[] = [];
  const adjustments: any[] = [];
  const movements: any[] = [];
  const batchStore = new Map<string, any>();
  let folioSeq = 100;
  let adjSeq = 0;
  const prisma: any = {
    card: {
      findUnique: jest.fn(async ({ where }: any) =>
        where.id === 'missing'
          ? null
          : { id: where.id, rarity: 'Common', availableFinishes: ['normal', 'reverse_holo'] },
      ),
    },
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
      findUnique: jest.fn(async () => null),
      // [BE-45] guardia atómica: el mock por default "gana" la carrera (count 1).
      updateMany: jest.fn(async () => ({ count: 1 })),
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
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    __createdItems: createdItems,
    __adjustments: adjustments,
    __movements: movements,
    __batchStore: batchStore,
    ...over,
  };
  return prisma;
}

const PLATFORM_ITEM = (status: string, over: any = {}) => ({
  id: 'inv-1',
  folio: 'INV-000001',
  ownerType: 'platform',
  status,
  ...over,
});

describe('InventoryService.adjust — transiciones por motivo (§4.20e)', () => {
  it.each([
    ['perdida', 'lost'],
    ['danada', 'damaged'],
    ['error_captura', 'withdrawn'],
  ] as const)('%s → %s con registro triple (adjustment + movement en tx)', async (reason, toStatus) => {
    const prisma = buildPrisma();
    prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM('in_stock'));
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);

    const res = await svc.adjust(
      { reason, inventoryItemId: 'inv-1', note: 'levantamiento agosto' } as InventoryAdjustmentRequestDto,
      'op-1',
    );

    // v1.20.1: respuesta plural — arrays de longitud 1 en motivos por-pieza, sin replay.
    expect(res).toEqual({
      adjustmentIds: ['adj-1'],
      reason,
      inventoryItemIds: ['inv-1'],
      folios: ['INV-000001'],
      fromStatus: 'in_stock',
      toStatus,
      idempotentReplay: false,
    });
    // [BE-45] Transición por guardia ATÓMICA de status (updateMany condicionado al allowlist;
    // nunca a reserved/listed: el ajuste no vende ni publica).
    expect(prisma.inventoryItem.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'inv-1',
        ownerType: 'platform',
        status: { in: ['in_stock', 'listed'] },
      },
      data: { status: toStatus },
    });
    // Movement con reason=adjustment (distinguible de mark lost/damaged) + actor + note.
    expect(prisma.__movements[0]).toMatchObject({
      itemId: 'inv-1',
      fromStatus: 'in_stock',
      toStatus,
      reason: 'adjustment',
      actorUserId: 'op-1',
      note: 'levantamiento agosto',
    });
    // Fila InventoryAdjustment tipada (M-24) con motivo/actor/from/to.
    expect(prisma.__adjustments[0]).toMatchObject({
      inventoryItemId: 'inv-1',
      reason,
      fromStatus: 'in_stock',
      toStatus,
      actorUserId: 'op-1',
      note: 'levantamiento agosto',
    });
    // Todo dentro de UNA transacción.
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('encontrada: crea pieza in_stock (ownerType platform) con adjustment + movement por pieza; qty>1 = una fila por pieza y adjustmentIds 1:1', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);

    const res = await svc.adjust(
      {
        reason: 'encontrada',
        item: { cardId: 'c1', productType: 'raw', acquisitionType: 'compra', qty: 2 },
      } as InventoryAdjustmentRequestDto,
      'op-1',
    );

    expect(res.reason).toBe('encontrada');
    expect(res.fromStatus).toBeNull();
    expect(res.toStatus).toBe('in_stock');
    expect(res.idempotentReplay).toBe(false);
    // v1.20.1: TODAS las filas M-24, alineadas 1:1 con inventoryItemIds/folios.
    expect(res.adjustmentIds).toEqual(['adj-1', 'adj-2']);
    expect(res.inventoryItemIds).toHaveLength(2);
    expect(res.folios).toHaveLength(2);
    // Piezas nacen in_stock / platform (paridad con el alta normal).
    expect(prisma.__createdItems).toHaveLength(2);
    for (const item of prisma.__createdItems) {
      expect(item.status).toBe('in_stock');
      expect(item.ownerType).toBe('platform');
    }
    // M-24: UNA fila InventoryAdjustment POR PIEZA creada + movement reason=adjustment por pieza.
    expect(prisma.__adjustments).toHaveLength(2);
    expect(prisma.__movements).toHaveLength(2);
    for (const m of prisma.__movements) expect(m.reason).toBe('adjustment');
    for (const a of prisma.__adjustments) {
      expect(a.reason).toBe('encontrada');
      expect(a.fromStatus).toBeNull();
      expect(a.toStatus).toBe('in_stock');
    }
    // Sin batchKey no se toca InventoryBatch.
    expect(prisma.inventoryBatch.create).not.toHaveBeenCalled();
  });

  it('encontrada: acquisitionType default aportacion_en_especie (referencia × pct) si se omite', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing();
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await svc.adjust(
      { reason: 'encontrada', item: { cardId: 'c1', productType: 'raw' } } as InventoryAdjustmentRequestDto,
      'op-1',
    );
    expect(prisma.__createdItems[0].acquisitionType).toBe('aportacion_en_especie');
    // Con la referencia de 10000 y pct 70 → costo derivado server-side (paridad alta normal).
    expect(prisma.__createdItems[0].acquisitionCostCents).toBe(7000);
  });

  it('encontrada SIN referencia de precio (aportación) → 422 PRICE_PENDING y NO crea nada (ni claimea el batchKey)', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing({
      getReference: jest.fn(async () => ({ status: 'pending' })),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await expect(
      svc.adjust(
        {
          reason: 'encontrada',
          batchKey: 'bk-fail',
          item: { cardId: 'c1', productType: 'raw' },
        } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    expect(prisma.__createdItems).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
    // El batchKey NO quedó claimeado: un reintento con la misma key vuelve a intentar limpio.
    expect(prisma.inventoryBatch.create).not.toHaveBeenCalled();
  });
});

describe('InventoryService.adjust — idempotencia por batchKey (v1.20.1, solo encontrada)', () => {
  const foundReq = (batchKey: string) =>
    ({
      reason: 'encontrada',
      batchKey,
      item: { cardId: 'c1', productType: 'raw', acquisitionType: 'compra', qty: 2 },
    }) as InventoryAdjustmentRequestDto;

  it('replay del mismo batchKey devuelve la respuesta ORIGINAL guardada + idempotentReplay:true SIN re-crear', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);

    const first = await svc.adjust(foundReq('bk-1'), 'op-1');
    expect(first.idempotentReplay).toBe(false);
    expect(first.adjustmentIds).toEqual(['adj-1', 'adj-2']);
    expect(prisma.__createdItems).toHaveLength(2);

    const replay = await svc.adjust(foundReq('bk-1'), 'op-1');
    expect(replay.idempotentReplay).toBe(true);
    // Respuesta ORIGINAL (mismos ids/folios), no una nueva.
    expect(replay.adjustmentIds).toEqual(first.adjustmentIds);
    expect(replay.inventoryItemIds).toEqual(first.inventoryItemIds);
    expect(replay.folios).toEqual(first.folios);
    // NO se crearon más piezas/filas ni un segundo claim de InventoryBatch (mecanismo M-21).
    expect(prisma.__createdItems).toHaveLength(2);
    expect(prisma.__adjustments).toHaveLength(2);
    expect(prisma.inventoryBatch.create).toHaveBeenCalledTimes(1);
  });

  it('claim atómico PRIMERO dentro de la tx (kind=adjust) + resultado persistido como fuente del replay', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.adjust(foundReq('bk-2'), 'op-1');
    expect(prisma.inventoryBatch.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ id: 'bk-2', kind: 'adjust', actorUserId: 'op-1', requested: 2 }),
    });
    const stored = prisma.__batchStore.get('bk-2');
    expect(stored.createdItems).toBe(2);
    expect(stored.resultJson).toMatchObject({
      reason: 'encontrada',
      adjustmentIds: ['adj-1', 'adj-2'],
      idempotentReplay: false,
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('concurrencia: P2002 en el claim → replay del ganador, NO duplica piezas', async () => {
    const winner = {
      adjustmentIds: ['adj-w'],
      reason: 'encontrada',
      inventoryItemIds: ['inv-w'],
      folios: ['INV-000999'],
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: false,
    };
    let findCalls = 0;
    const prisma = buildPrisma({
      inventoryBatch: {
        // 1a llamada (fast-path) → null; llamadas posteriores (catch-path) → resultado ganador.
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
    const res = await svc.adjust(foundReq('bk-race'), 'op-1');
    expect(res.idempotentReplay).toBe(true);
    expect(res.adjustmentIds).toEqual(['adj-w']);
    expect(res.inventoryItemIds).toEqual(['inv-w']);
  });

  it.each(['perdida', 'danada', 'error_captura'] as const)(
    'batchKey con motivo %s → 400 VALIDATION_ERROR (solo encontrada lo acepta)',
    async (reason) => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM('in_stock'));
      const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
      await expect(
        svc.adjust(
          { reason, inventoryItemId: 'inv-1', note: 'x', batchKey: 'bk-x' } as InventoryAdjustmentRequestDto,
          'op-1',
        ),
      ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.__adjustments).toHaveLength(0);
    },
  );
});

describe('InventoryService.adjust — guardarraíles (§4.20e)', () => {
  it.each(['reserved', 'in_custody', 'picking', 'shipped', 'delivered', 'lost', 'damaged', 'withdrawn'])(
    'status %s NO es ajustable → 422 ITEM_NOT_ADJUSTABLE (sin escritura)',
    async (status) => {
      const prisma = buildPrisma();
      prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM(status));
      const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
      await expect(
        svc.adjust(
          { reason: 'perdida', inventoryItemId: 'inv-1', note: 'x' } as InventoryAdjustmentRequestDto,
          'op-1',
        ),
      ).rejects.toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', status: 422 });
      expect(prisma.inventoryItem.updateMany).not.toHaveBeenCalled();
      expect(prisma.__adjustments).toHaveLength(0);
      expect(prisma.__movements).toHaveLength(0);
    },
  );

  it('[BE-45] CARRERA de status: el pre-check pasa pero updateMany devuelve count=0 → 422 y NO escribe registro', async () => {
    // Simula el TOCTOU: la pieza estaba in_stock al leerla, pero un checkout concurrente la puso
    // `reserved` antes del UPDATE. La guardia atómica (count!==1) la protege: 422 + rollback.
    const prisma = buildPrisma();
    prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM('in_stock'));
    prisma.inventoryItem.updateMany = jest.fn(async () => ({ count: 0 }));
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.adjust(
        { reason: 'perdida', inventoryItemId: 'inv-1', note: 'x' } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE', status: 422 });
    // La excepción se lanza ANTES de movement/adjustment (dentro de la tx → rollback real en BD).
    expect(prisma.__movements).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });

  it('pieza de CLIENTE (ownerType=customer) NO es ajustable aunque esté in_stock-like → 422', async () => {
    const prisma = buildPrisma();
    prisma.inventoryItem.findUnique = jest.fn(async () =>
      PLATFORM_ITEM('in_custody', { ownerType: 'customer', ownerUserId: 'u1' }),
    );
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.adjust(
        { reason: 'danada', inventoryItemId: 'inv-1', note: 'x' } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'ITEM_NOT_ADJUSTABLE' });
  });

  it('`listed` SÍ es ajustable (in_stock y listed son el alcance normado)', async () => {
    const prisma = buildPrisma();
    prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM('listed'));
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res = await svc.adjust(
      { reason: 'perdida', inventoryItemId: 'inv-1', note: 'x' } as InventoryAdjustmentRequestDto,
      'op-1',
    );
    expect(res.fromStatus).toBe('listed');
    expect(res.toStatus).toBe('lost');
  });

  it('pieza inexistente → 404 NOT_FOUND', async () => {
    const prisma = buildPrisma(); // findUnique → null por default
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.adjust(
        { reason: 'perdida', inventoryItemId: 'nope', note: 'x' } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it.each([
    [{ reason: 'encontrada' }, 'encontrada sin item'],
    [{ reason: 'perdida', note: 'x' }, 'perdida sin inventoryItemId'],
    [{ reason: 'perdida', inventoryItemId: 'inv-1' }, 'perdida sin note'],
    [{ reason: 'error_captura', inventoryItemId: 'inv-1', note: '   ' }, 'note en blanco'],
  ] as const)('validación cruzada 400 VALIDATION_ERROR: %j (%s)', async (dto, _desc) => {
    const prisma = buildPrisma();
    prisma.inventoryItem.findUnique = jest.fn(async () => PLATFORM_ITEM('in_stock'));
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.adjust(dto as unknown as InventoryAdjustmentRequestDto, 'op-1'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('graded con qty>1 → VALIDATION_ERROR (paridad con el alta por lote)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.adjust(
        {
          reason: 'encontrada',
          item: {
            cardId: 'c1',
            productType: 'graded',
            gradingCompany: 'PSA',
            gradeValue: '10',
            certNumber: '123',
            qty: 2,
          },
        } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('InventoryController.adjust — auditoría + status HTTP (§4.20e / v1.20.1)', () => {
  function buildController() {
    const inventory = {
      adjust: jest.fn(async () => ({
        adjustmentIds: ['adj-1'],
        reason: 'perdida',
        inventoryItemIds: ['inv-1'],
        folios: ['INV-000001'],
        fromStatus: 'in_stock',
        toStatus: 'lost',
        idempotentReplay: false,
      })),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const ctrl = new InventoryController(inventory as any, {} as any, audit as any);
    return { ctrl, inventory, audit };
  }

  it('escribe AuditLog action=inventory.adjustment con usuario (entityId = primer adjustmentId); 200 para perdida/danada/error_captura', async () => {
    const { ctrl, audit } = buildController();
    const res = { status: jest.fn() } as any;
    const out = await ctrl.adjust(
      { reason: 'perdida', inventoryItemId: 'inv-1', note: 'n' } as InventoryAdjustmentRequestDto,
      { id: 'op-1', role: 'vault_operator' as any },
      res,
    );
    expect(out.adjustmentIds).toEqual(['adj-1']);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'op-1',
        actorRole: 'vault_operator',
        action: 'inventory.adjustment',
        entityType: 'InventoryAdjustment',
        entityId: 'adj-1',
        after: expect.objectContaining({ adjustmentIds: ['adj-1'], idempotentReplay: false }),
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('201 para encontrada (crea piezas, procesamiento nuevo)', async () => {
    const { ctrl, inventory } = buildController();
    (inventory.adjust as jest.Mock).mockResolvedValue({
      adjustmentIds: ['adj-9', 'adj-10'],
      reason: 'encontrada',
      inventoryItemIds: ['inv-9', 'inv-10'],
      folios: ['INV-000009', 'INV-000010'],
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: false,
    });
    const res = { status: jest.fn() } as any;
    await ctrl.adjust(
      { reason: 'encontrada', item: { cardId: 'c1', productType: 'raw' } } as InventoryAdjustmentRequestDto,
      { id: 'op-1', role: 'super_admin' as any },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it('v1.20.1: replay idempotente por batchKey → 200 AUNQUE el motivo sea encontrada', async () => {
    const { ctrl, inventory, audit } = buildController();
    (inventory.adjust as jest.Mock).mockResolvedValue({
      adjustmentIds: ['adj-9'],
      reason: 'encontrada',
      inventoryItemIds: ['inv-9'],
      folios: ['INV-000009'],
      fromStatus: null,
      toStatus: 'in_stock',
      idempotentReplay: true,
    });
    const res = { status: jest.fn() } as any;
    const out = await ctrl.adjust(
      {
        reason: 'encontrada',
        batchKey: 'bk-1',
        item: { cardId: 'c1', productType: 'raw' },
      } as InventoryAdjustmentRequestDto,
      { id: 'op-1', role: 'super_admin' as any },
      res,
    );
    expect(out.idempotentReplay).toBe(true);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        after: expect.objectContaining({ idempotentReplay: true }),
      }),
    );
  });
});
