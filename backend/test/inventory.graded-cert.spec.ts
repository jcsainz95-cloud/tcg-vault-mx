import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { CreateItemDto, UpdateItemDto } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.2 (M-12) — Gradeadas por certificado (API_CONTRACT §M1, ARCHITECTURE §3.2):
 *  - `certNumber` (nº de certificado PSA/CGC) es REQUERIDO para publicar una gradeada;
 *    sin él, el alta responde 422 VALIDATION_ERROR (no se publica).
 *  - con certNumber se persiste; y no se guardan campos de foto (v1.2 M-13, sin fotos propias).
 */

function buildPricing() {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
    // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
    // puede divergir de producción ni reimplementar la matemática.
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn().mockReturnValue('graded:PSA:10'),
    // v2.0 (§4.36.5c): el MISMO seam escala Y cierra la cola.
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn().mockResolvedValue(undefined),
    getReference: jest.fn(),
  } as unknown as PricingService;
}
const settings = { getNumber: jest.fn() } as unknown as SettingsService;

function buildPrisma() {
  const created: any[] = [];
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    card: {
      findUnique: jest.fn().mockResolvedValue({ id: 'c1', rarity: null }),
      // v2.1.1: `createRequest` carga las cartas EN LOTE (mata el N+1 que hacía un
      // `findUnique` por ítem). Delega en el MISMO `findUnique` del fixture (`this`).
      findMany: jest.fn(async function (this: any, args: any) {
        const ids: string[] = args?.where?.id?.in ?? [];
        const rows = await Promise.all(ids.map((id) => this.findUnique({ where: { id } })));
        return rows.filter(Boolean);
      }),
    },
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

/**
 * v1.2 (M-12) — la invariante "gradeada publicada exige certNumber" también rige en el UPDATE.
 * El PATCH no puede publicar (status:listed) ni mantener publicada una gradeada sin certNumber,
 * ni quitar el cert de una gradeada listada. Estado RESULTANTE del PATCH → 422 VALIDATION_ERROR.
 */
function buildUpdatePrisma(item: any) {
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue(item),
      update: jest.fn(async ({ data }: any) => ({ ...item, ...data })),
    },
  };
  return prisma;
}

describe('InventoryService.updateItem — gradeada (certNumber)', () => {
  const gradedInStock = {
    id: 'inv-10',
    productType: 'graded',
    status: 'in_stock',
    certNumber: null,
    locationId: 'loc-1',
  };

  it('PATCH que publica una gradeada SIN certNumber → 422 VALIDATION_ERROR', async () => {
    const prisma = buildUpdatePrisma(gradedInStock);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.updateItem('inv-10', { status: 'listed' } as UpdateItemDto),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('PATCH que QUITA el certNumber de una gradeada publicada → 422 VALIDATION_ERROR', async () => {
    const prisma = buildUpdatePrisma({
      ...gradedInStock,
      status: 'listed',
      certNumber: 'PSA-12345678',
    });
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.updateItem('inv-10', { certNumber: '   ' } as UpdateItemDto),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });

  it('PATCH que publica una gradeada CON certNumber → OK', async () => {
    const prisma = buildUpdatePrisma({ ...gradedInStock, certNumber: 'PSA-12345678' });
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res: any = await svc.updateItem('inv-10', { status: 'listed' } as UpdateItemDto);
    expect(res.status).toBe('listed');
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
  });

  it('PATCH que publica una gradeada aportando el certNumber en el mismo dto → OK', async () => {
    const prisma = buildUpdatePrisma(gradedInStock);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res: any = await svc.updateItem('inv-10', {
      status: 'listed',
      certNumber: 'PSA-99999999',
    } as UpdateItemDto);
    expect(res.status).toBe('listed');
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
  });

  it('PATCH a una gradeada NO publicada (in_stock) sin cert → OK (la invariante solo aplica al publicar)', async () => {
    const prisma = buildUpdatePrisma(gradedInStock);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res: any = await svc.updateItem('inv-10', { gradeValue: '9' } as UpdateItemDto);
    expect(res.gradeValue).toBe('9');
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
  });

  it('PATCH a una raw publicada sin cert → OK (la invariante solo aplica a gradeadas)', async () => {
    const prisma = buildUpdatePrisma({
      id: 'inv-20',
      productType: 'raw',
      status: 'in_stock',
      certNumber: null,
      locationId: 'loc-1',
    });
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    const res: any = await svc.updateItem('inv-20', { status: 'listed' } as UpdateItemDto);
    expect(res.status).toBe('listed');
    expect(prisma.inventoryItem.update).toHaveBeenCalled();
  });
});
