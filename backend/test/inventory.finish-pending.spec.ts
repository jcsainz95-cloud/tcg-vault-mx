import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CreateItemDto } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * Tier 0 — Escalado de pendientes POR ACABADO desde el alta de inventario (M1 → M-19).
 * Bug real corregido: `createItem` llamaba a `escalatePending(...)` SIN el `finish` resuelto,
 * así que un alta holofoil sin referencia encolaba el pendiente como `normal` — el override
 * del admin luego "resolvía" el acabado equivocado y la valuación por versión (M2) quedaba rota.
 */

function buildPricing(refStatus: 'pending' | 'priced' = 'pending') {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn().mockResolvedValue(
      refStatus === 'priced'
        ? { status: 'priced', referenceMxnCents: 10000 }
        : { status: 'pending' },
    ),
  } as unknown as PricingService;
}

const settings = { getNumber: jest.fn().mockResolvedValue(70) } as unknown as SettingsService;

function buildPrisma() {
  const created: any[] = [];
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    card: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'c1',
        rarity: 'Rare Holo',
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
    nextFolio: jest.fn().mockResolvedValue('INV-000042'),
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'inv-42', folio: data.folio, status: data.status };
      }),
    },
    inventoryMovement: { create: jest.fn() },
    __created: created,
  };
  return prisma;
}

const base: CreateItemDto = {
  cardId: 'c1',
  productType: 'raw',
  finish: 'holofoil',
  acquisitionType: 'aportacion_en_especie',
  locationId: 'loc-1',
} as CreateItemDto;

describe('InventoryService.createItem — escalado de pendiente con el finish del alta', () => {
  it('aportación holofoil sin referencia → PRICE_PENDING y encola con finish=holofoil (no normal)', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing('pending');
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await expect(svc.createItem(base, 'admin')).rejects.toMatchObject({ code: 'PRICE_PENDING' });
    expect(pricing.escalatePending).toHaveBeenCalledWith(
      'c1',
      'raw',
      'raw:NM',
      'inventory',
      undefined,
      'holofoil',
      // v1.30 (cardProductId) y v1.42 (sealedProductId, BLOQ-2b): null para un raw (identidad de sellado N/A).
      null,
      null,
    );
    // También consultó la referencia del ACABADO del alta, no la de normal.
    expect(pricing.getReference).toHaveBeenCalledWith('c1', 'raw', 'raw:NM', 'holofoil');
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('aportación holofoil CON referencia: no escala y persiste el finish', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing('priced');
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await svc.createItem(base, 'admin');
    expect(pricing.escalatePending).not.toHaveBeenCalled();
    expect(prisma.__created[0].finish).toBe('holofoil');
    expect(prisma.__created[0].acquisitionCostCents).toBe(7000); // 10000 × 70%
  });

  it('finish fuera de availableFinishes → 422 FINISH_NOT_AVAILABLE (SEC-A1 intacto)', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing('priced');
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await expect(
      svc.createItem({ ...base, finish: 'first_edition_holofoil' } as CreateItemDto, 'admin'),
    ).rejects.toMatchObject({ code: 'FINISH_NOT_AVAILABLE' });
    expect(pricing.escalatePending).not.toHaveBeenCalled();
  });
});
