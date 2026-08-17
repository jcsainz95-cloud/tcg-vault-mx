import { InventoryService } from '../src/modules/inventory/inventory.service';
import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { InventoryAdjustmentRequestDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * v1.18-master-set-everywhere (§4.18e) — POST /admin/inventory/adjustments:
 *  - motivos: encontrada (crea in_stock) · perdida → lost · danada → damaged · error_captura →
 *    withdrawn (SIN semántica de pérdida; el motivo queda tipado en InventoryAdjustment.reason).
 *  - guardarraíl: SOLO piezas platform en {in_stock, listed} → 422 ITEM_NOT_ADJUSTABLE en el resto.
 *  - registro triple: InventoryAdjustment + InventoryMovement(reason=adjustment) en la MISMA tx;
 *    AuditLog action=inventory.adjustment lo escribe el controller.
 *  - validación cruzada: encontrada sin item / resto sin inventoryItemId o note → 400.
 *  - el ajuste JAMÁS vende: nunca escribe status reserved/listed ni crea órdenes.
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

const settings = { getNumber: jest.fn(async () => 70) } as unknown as SettingsService;

function buildPrisma(over: any = {}) {
  const createdItems: any[] = [];
  const adjustments: any[] = [];
  const movements: any[] = [];
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
      update: jest.fn(async ({ where, data }: any) => ({ id: where.id, ...data })),
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
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    __createdItems: createdItems,
    __adjustments: adjustments,
    __movements: movements,
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

describe('InventoryService.adjust — transiciones por motivo (§4.18e)', () => {
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

    expect(res).toEqual({
      adjustmentId: 'adj-1',
      reason,
      inventoryItemIds: ['inv-1'],
      folios: ['INV-000001'],
      fromStatus: 'in_stock',
      toStatus,
    });
    // Transición del status (nunca a reserved/listed: el ajuste no vende ni publica).
    expect(prisma.inventoryItem.update).toHaveBeenCalledWith({
      where: { id: 'inv-1' },
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
    // Fila InventoryAdjustment tipada (M-22) con motivo/actor/from/to.
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

  it('encontrada: crea pieza in_stock (ownerType platform) con adjustment + movement por pieza; qty>1 = una fila por pieza', async () => {
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
    expect(res.inventoryItemIds).toHaveLength(2);
    expect(res.folios).toHaveLength(2);
    expect(res.adjustmentId).toBe('adj-1');
    // Piezas nacen in_stock / platform (paridad con el alta normal).
    expect(prisma.__createdItems).toHaveLength(2);
    for (const item of prisma.__createdItems) {
      expect(item.status).toBe('in_stock');
      expect(item.ownerType).toBe('platform');
    }
    // M-22: UNA fila InventoryAdjustment POR PIEZA creada + movement reason=adjustment por pieza.
    expect(prisma.__adjustments).toHaveLength(2);
    expect(prisma.__movements).toHaveLength(2);
    for (const m of prisma.__movements) expect(m.reason).toBe('adjustment');
    for (const a of prisma.__adjustments) {
      expect(a.reason).toBe('encontrada');
      expect(a.fromStatus).toBeNull();
      expect(a.toStatus).toBe('in_stock');
    }
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

  it('encontrada SIN referencia de precio (aportación) → 422 PRICE_PENDING y NO crea nada', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing({
      getReference: jest.fn(async () => ({ status: 'pending' })),
    });
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await expect(
      svc.adjust(
        { reason: 'encontrada', item: { cardId: 'c1', productType: 'raw' } } as InventoryAdjustmentRequestDto,
        'op-1',
      ),
    ).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    expect(prisma.__createdItems).toHaveLength(0);
    expect(prisma.__adjustments).toHaveLength(0);
  });
});

describe('InventoryService.adjust — guardarraíles (§4.18e)', () => {
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
      expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
      expect(prisma.__adjustments).toHaveLength(0);
      expect(prisma.__movements).toHaveLength(0);
    },
  );

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

describe('InventoryController.adjust — auditoría + status HTTP (§4.18e)', () => {
  function buildController() {
    const inventory = {
      adjust: jest.fn(async () => ({
        adjustmentId: 'adj-1',
        reason: 'perdida',
        inventoryItemIds: ['inv-1'],
        folios: ['INV-000001'],
        fromStatus: 'in_stock',
        toStatus: 'lost',
      })),
    };
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const ctrl = new InventoryController(inventory as any, {} as any, audit as any);
    return { ctrl, inventory, audit };
  }

  it('escribe AuditLog action=inventory.adjustment con usuario; 200 para perdida/danada/error_captura', async () => {
    const { ctrl, audit } = buildController();
    const res = { status: jest.fn() } as any;
    const out = await ctrl.adjust(
      { reason: 'perdida', inventoryItemId: 'inv-1', note: 'n' } as InventoryAdjustmentRequestDto,
      { id: 'op-1', role: 'vault_operator' as any },
      res,
    );
    expect(out.adjustmentId).toBe('adj-1');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: 'op-1',
        actorRole: 'vault_operator',
        action: 'inventory.adjustment',
        entityType: 'InventoryAdjustment',
        entityId: 'adj-1',
      }),
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('201 para encontrada (crea piezas)', async () => {
    const { ctrl, inventory } = buildController();
    (inventory.adjust as jest.Mock).mockResolvedValue({
      adjustmentId: 'adj-9',
      reason: 'encontrada',
      inventoryItemIds: ['inv-9'],
      folios: ['INV-000009'],
      fromStatus: null,
      toStatus: 'in_stock',
    });
    const res = { status: jest.fn() } as any;
    await ctrl.adjust(
      { reason: 'encontrada', item: { cardId: 'c1', productType: 'raw' } } as InventoryAdjustmentRequestDto,
      { id: 'op-1', role: 'super_admin' as any },
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });
});
