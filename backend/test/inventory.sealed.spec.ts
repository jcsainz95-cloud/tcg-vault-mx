import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CreateItemDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * v1.1 — Sellado como línea de venta (ARCHITECTURE §3.6, API_CONTRACT §M1):
 *  - precio manual MXN obligatorio para PUBLICAR; sin él queda "precio pendiente".
 *  - sin condición/grade/rareza (sealed con rawCondition → 422 VALIDATION_ERROR).
 */

function buildPricing() {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('sealed'),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
  } as unknown as PricingService;
}
const settings = { getNumber: jest.fn() } as unknown as SettingsService;

function buildPrisma() {
  const created: any[] = [];
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    card: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', rarity: null }) },
    nextFolio: jest.fn().mockResolvedValue('INV-000009'),
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'inv-9', folio: data.folio, status: data.status };
      }),
    },
    inventoryMovement: { create: jest.fn() },
    __created: created,
  };
  return prisma;
}

const base: CreateItemDto = {
  cardId: 'c1',
  productType: 'sealed',
  acquisitionType: 'compra',
} as CreateItemDto;

describe('InventoryService.createItem — sellado', () => {
  it('sellado CON precio manual: persiste listPriceCents y sealedSubtype; no escala pendiente', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing();
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    const res = await svc.createItem(
      { ...base, sealedSubtype: 'etb', listPriceCents: 250000 } as CreateItemDto,
      'admin',
    );
    expect(res.folio).toBe('INV-000009');
    const data = prisma.__created[0];
    expect(data.productType).toBe('sealed');
    expect(data.sealedSubtype).toBe('etb');
    expect(data.listPriceCents).toBe(250000);
    expect(data.rawCondition).toBeNull(); // sin condición
    expect(pricing.escalatePending).not.toHaveBeenCalled();
  });

  it('sellado SIN precio: se crea pero escala a "precio pendiente" (no publicable en Compra)', async () => {
    const prisma = buildPrisma();
    const pricing = buildPricing();
    const svc = new InventoryService(prisma as PrismaService, pricing, settings);
    await svc.createItem({ ...base, sealedSubtype: 'box' } as CreateItemDto, 'admin');
    const data = prisma.__created[0];
    expect(data.listPriceCents).toBeNull();
    // Tier 0: el alta pasa el `finish` resuelto (sealed → siempre `normal`) a la cola por acabado.
    expect(pricing.escalatePending).toHaveBeenCalledWith(
      'c1',
      'sealed',
      'sealed',
      'inventory',
      undefined,
      'normal',
    );
  });

  it('sellado con rawCondition → 422 VALIDATION_ERROR (sellado no lleva condición)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.createItem({ ...base, rawCondition: 'NM' as any, listPriceCents: 1000 } as CreateItemDto, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });
});
