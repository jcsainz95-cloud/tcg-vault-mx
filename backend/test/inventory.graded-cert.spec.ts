import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CreateItemDto } from '../src/modules/inventory/dto/inventory.dto';

/**
 * v1.2 (M-12) — Gradeadas por certificado (API_CONTRACT §M1, ARCHITECTURE §3.2):
 *  - `certNumber` (nº de certificado PSA/CGC) es REQUERIDO para publicar una gradeada;
 *    sin él, el alta responde 422 VALIDATION_ERROR (no se publica).
 *  - con certNumber se persiste; y no se guardan campos de foto (v1.2 M-13, sin fotos propias).
 */

function buildPricing() {
  return {
    gradeKeyFor: jest.fn().mockReturnValue('graded:PSA:10'),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
  } as unknown as PricingService;
}
const settings = { getNumber: jest.fn() } as unknown as SettingsService;

function buildPrisma() {
  const created: any[] = [];
  const prisma: any = {
    card: { findUnique: jest.fn().mockResolvedValue({ id: 'c1', rarity: null }) },
    nextFolio: jest.fn().mockResolvedValue('INV-000010'),
    inventoryItem: {
      create: jest.fn(async ({ data }: any) => {
        created.push(data);
        return { id: 'inv-10', folio: data.folio, status: data.status };
      }),
    },
    inventoryMovement: { create: jest.fn() },
    __created: created,
  };
  return prisma;
}

const base: CreateItemDto = {
  cardId: 'c1',
  productType: 'graded',
  gradingCompany: 'PSA' as any,
  gradeValue: '10',
  acquisitionType: 'compra',
} as CreateItemDto;

describe('InventoryService.createItem — gradeada (certNumber)', () => {
  it('gradeada SIN certNumber → 422 VALIDATION_ERROR (no se publica)', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.createItem({ ...base, listPriceCents: 500000 } as CreateItemDto, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.inventoryItem.create).not.toHaveBeenCalled();
  });

  it('gradeada con certNumber vacío → 422 VALIDATION_ERROR', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.createItem({ ...base, certNumber: '   ' } as CreateItemDto, 'admin'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('gradeada CON certNumber: persiste certNumber y no guarda campos de foto', async () => {
    const prisma = buildPrisma();
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res = await svc.createItem(
      { ...base, certNumber: 'PSA-12345678', listPriceCents: 500000 } as CreateItemDto,
      'admin',
    );
    expect(res.folio).toBe('INV-000010');
    const data = prisma.__created[0];
    expect(data.certNumber).toBe('PSA-12345678');
    expect(data.gradingCompany).toBe('PSA');
    expect(data.gradeValue).toBe('10');
    expect(data.rawCondition).toBeNull();
    expect(data).not.toHaveProperty('frontPhotoKey');
    expect(data).not.toHaveProperty('backPhotoKey');
    expect(data).not.toHaveProperty('extraPhotoKeys');
  });
});
