import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UpdateItemDto } from '../src/modules/inventory/dto/inventory.dto';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';

/**
 * v1.53 (ARCHITECTURE §4.40.5b · §9 **D-BG-4** · API_CONTRACT §M1, ADITIVO) —
 * **`PATCH /admin/inventory/items/:id` gana `gradingCompany`.**
 *
 * ### El agujero que cierra
 * Hasta v1.52 el `PATCH` aceptaba `gradeValue` y `certNumber` **pero no la empresa graduadora**, de
 * modo que una pieza `productType='graded'` con `gradingCompany` nula era **incorregible por la vía
 * normal**. Y esas piezas existen: las crea `convertToInventory` (§9 D-BG-3), que no tiene de dónde
 * sacar la identidad del slab.
 *
 * Con la retirada del default `graded:PSA:10` (§4.40.4) esas piezas pasan a valuarse `pending` —que
 * es la verdad— y **este campo es lo que permite repararlas con el slab físico en la mano**. Sin él,
 * el arreglo dejaría al operador mirando una cola que no puede vaciar.
 */

function buildPricing(): PricingService {
  return {
    loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
    decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
    gradeKeyFor: jest.fn(PricingService.prototype.gradeKeyFor),
    tryGradeKeyFor: jest.fn(PricingService.prototype.tryGradeKeyFor),
    settlePendingForVariant: jest.fn(async () => undefined),
    escalatePending: jest.fn(async () => undefined),
    getReference: jest.fn(),
  } as unknown as PricingService;
}
const settings = { getNumber: jest.fn() } as unknown as SettingsService;

function buildPrisma(item: Record<string, unknown>) {
  const prisma: any = {
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
    inventoryItem: {
      findUnique: jest.fn(async () => item),
      update: jest.fn(async ({ data }: any) => ({ ...item, ...data })),
    },
  };
  return prisma;
}

/** La pieza que sale de `convertToInventory`: graduada, sin empresa ni grado. */
const convertida = {
  id: 'inv-1',
  folio: 'INV-000001',
  cardId: 'c1',
  productType: 'graded',
  status: 'in_stock',
  gradingCompany: null,
  gradeValue: null,
  certNumber: null,
  finish: 'normal',
  locationId: 'loc-1',
};

describe('UpdateItemDto — `gradingCompany` (ADITIVO, §4.40.5b)', () => {
  it('el DTO ACEPTA `gradingCompany` (antes lo borraba el whitelist del ValidationPipe)', async () => {
    const dto = plainToInstance(UpdateItemDto, { gradingCompany: 'PSA', gradeValue: '9' });
    expect(await validate(dto)).toHaveLength(0);
    expect(dto.gradingCompany).toBe('PSA');
  });

  it('acepta las DOS graduadoras del schema, y sólo esas', async () => {
    for (const co of ['PSA', 'CGC']) {
      expect(await validate(plainToInstance(UpdateItemDto, { gradingCompany: co }))).toHaveLength(0);
    }
    // `BGS` NO existe en el sistema (`enum GradingCompany { PSA, CGC }`): aceptarlo es otra decisión
    // de producto (§4.40.6), no un `@IsIn` más ancho.
    const bgs = await validate(plainToInstance(UpdateItemDto, { gradingCompany: 'BGS' }));
    expect(bgs).toHaveLength(1);
  });

  it('sigue siendo OPCIONAL: un PATCH que no lo manda es válido (aditivo, no breaking)', async () => {
    expect(await validate(plainToInstance(UpdateItemDto, { status: 'listed' }))).toHaveLength(0);
  });
});

describe('updateItem — la REPARACIÓN de una pieza sin identidad de slab', () => {
  it('persiste `gradingCompany` en una pieza `graded` (el caso que era imposible)', async () => {
    const prisma = buildPrisma(convertida);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await svc.updateItem('inv-1', {
      gradingCompany: 'CGC',
      gradeValue: '8.5',
      certNumber: '99887766',
    } as UpdateItemDto);
    const data = prisma.inventoryItem.update.mock.calls[0][0].data;
    expect(data).toMatchObject({ gradingCompany: 'CGC', gradeValue: '8.5', certNumber: '99887766' });
  });

  it('reparada la identidad, la pieza deja de estar `pending` y resuelve el grado QUE REALMENTE ES', () => {
    const pricing = buildPricing();
    // Antes de reparar: sin clave ⇒ sin referencia ⇒ pendiente.
    expect(pricing.tryGradeKeyFor(convertida as never)).toBeNull();
    // Después: la clave es la del slab real, NO `graded:PSA:10`.
    expect(
      pricing.tryGradeKeyFor({ ...convertida, gradingCompany: 'CGC', gradeValue: '8.5' } as never),
    ).toBe('graded:CGC:8.5');
  });

  it('en `raw`/`sealed` se IGNORA (el tipo de la pieza sale de BD, no del body — SEC-A1)', async () => {
    for (const productType of ['raw', 'sealed']) {
      const prisma = buildPrisma({ ...convertida, productType, gradingCompany: null });
      const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
      await svc.updateItem('inv-1', { gradingCompany: 'PSA' } as UpdateItemDto);
      const data = prisma.inventoryItem.update.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('gradingCompany');
    }
  });

  it('no relaja NADA de lo que ya había: publicar una graduada sin cert sigue siendo 422', async () => {
    const prisma = buildPrisma(convertida);
    const svc = new InventoryService(prisma as PrismaService, buildPricing(), settings);
    await expect(
      svc.updateItem('inv-1', { gradingCompany: 'PSA', status: 'listed' } as UpdateItemDto),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.inventoryItem.update).not.toHaveBeenCalled();
  });
});
