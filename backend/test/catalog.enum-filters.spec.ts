import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * MENOR (QA) — los filtros enum del endpoint PÚBLICO GET /catalog/cards se validan contra la
 * taxonomía real. Un valor inválido (?condition=LP, ?productType=foo) hoy producía un
 * 500 PrismaClientValidationError; ahora responde 400 VALIDATION_ERROR y NUNCA llega a Prisma.
 */
describe('CatalogService.listCards — saneo de filtros enum', () => {
  function build() {
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => []) } };
    const pricing = {
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
      computeSalePriceForItem: jest.fn(async (_i: any, r: number | null) => ({
        salePriceCents: r,
        status: r == null ? 'pending' : 'priced',
        appliedRule: { mode: 'pct', value: 15 },
        ruleSource: 'fallback',
      })),
    } as unknown as PricingService;
    return { svc: new CatalogService(prisma as PrismaService, pricing), prisma };
  }

  it('?condition=LP (raw ya no admite LP) → 400 VALIDATION_ERROR, sin tocar Prisma', async () => {
    const { svc, prisma } = build();
    await expect(svc.listCards({ page: 1, pageSize: 20, condition: 'LP' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('?productType=foo → 400 VALIDATION_ERROR, sin tocar Prisma', async () => {
    const { svc, prisma } = build();
    await expect(svc.listCards({ page: 1, pageSize: 20, productType: 'foo' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
    expect(prisma.inventoryItem.findMany).not.toHaveBeenCalled();
  });

  it('?sealedSubtype=jumbo (no existe) → 400 VALIDATION_ERROR', async () => {
    const { svc } = build();
    await expect(svc.listCards({ page: 1, pageSize: 20, sealedSubtype: 'jumbo' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('valores válidos (productType=raw, condition=NM, sealedSubtype=etb) pasan a Prisma', async () => {
    const { svc, prisma } = build();
    await svc.listCards({ page: 1, pageSize: 20, productType: 'raw', condition: 'NM' });
    await svc.listCards({ page: 1, pageSize: 20, productType: 'sealed', sealedSubtype: 'etb' });
    expect(prisma.inventoryItem.findMany).toHaveBeenCalledTimes(2);
    const where1 = prisma.inventoryItem.findMany.mock.calls[0][0].where;
    expect(where1.productType).toBe('raw');
    expect(where1.rawCondition).toBe('NM');
    const where2 = prisma.inventoryItem.findMany.mock.calls[1][0].where;
    expect(where2.sealedSubtype).toBe('etb');
  });
});
