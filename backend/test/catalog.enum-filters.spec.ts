import { CatalogService } from '../src/modules/catalog/catalog.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { DEFAULT_PRICING_CURVE } from '../src/common/pricing-curve';
import { DISABLED_GRADED_ESTIMATE_CONFIG } from '../src/common/graded-estimate';

/**
 * MENOR (QA) — los filtros enum del endpoint PÚBLICO GET /catalog/cards se validan contra la
 * taxonomía real. Un valor inválido (?condition=LP, ?productType=foo) hoy producía un
 * 500 PrismaClientValidationError; ahora responde 400 VALIDATION_ERROR y NUNCA llega a Prisma.
 */
describe('CatalogService.listCards — saneo de filtros enum', () => {
  function build() {
    const prisma: any = { inventoryItem: { findMany: jest.fn(async () => []) } };
    const pricing = {
      loadPricingCurve: jest.fn(async () => DEFAULT_PRICING_CURVE),
      // v2.1.1 (§4.36.5b): el seam de VENTA devuelve una DECISIÓN (monto + veredicto). El mock usa
      // el CUERPO REAL (`PricingService.prototype`): es puro y no toca `this`, así que el test no
      // puede divergir de producción ni reimplementar la matemática.
      decideSalePrice: jest.fn(PricingService.prototype.decideSalePrice),
      gradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      tryGradeKeyFor: jest.fn().mockReturnValue('raw:NM'),
      getReference: jest.fn(async () => ({ status: 'priced', referenceMxnCents: 10000 })),
      // v2.1.1: el seam single delega en `decideSalePrice` y en `loadPricingCurve` del propio mock;
      // se usa el CUERPO REAL para que el test no reimplemente la precedencia de venta.
      computeSalePriceForItem: jest.fn(PricingService.prototype.computeSalePriceForItem),
      // v1.50-graded-estimate (§4.38): dial maestro APAGADO (seed `off`) ⇒ el gancho no se evalúa y no
      // hace NINGUNA de sus dos queries (el coste extra con `off` es solo la lectura de config).
      loadGradedEstimateConfig: jest.fn(async () => DISABLED_GRADED_ESTIMATE_CONFIG),
      getGradedEstimatesBatch: jest.fn(async () => new Map()),
      getPublishedSlabGradesBatch: jest.fn(async () => new Map()),
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

  /**
   * `P-89` · §0-Q punto 1 fila 1 — **un espacio es VACÍO: no filtra, no lanza, y el `where` sale
   * SIN el eje.** El test de HTTP (`test/integration/catalog-enum-filters-empty.e2e-spec.ts`) mide
   * el `200`; éste mide lo que el `200` no puede ver: que el eje **no entró en el `where`**. Un
   * `200` con `where.productType = ' '` sería un listado vacío que parece filtrado — la «cola falsa»
   * que §0-Q prohíbe, del otro lado.
   */
  it.each(['productType', 'condition', 'finish', 'sealedSubtype'] as const)(
    '⭐ `?%s=" "` (solo espacios) ⇒ NO lanza y el eje NO aparece en el `where`',
    async (param) => {
      const { svc, prisma } = build();
      await expect(svc.listCards({ page: 1, pageSize: 20, [param]: ' ' })).resolves.toBeDefined();
      const where = prisma.inventoryItem.findMany.mock.calls[0][0].where;
      // `condition` viaja al `where` como `rawCondition`: se comprueba la ruta de Prisma, no el param.
      expect(where[param === 'condition' ? 'rawCondition' : param]).toBeUndefined();
    },
  );

  it('⭐ `details.value` sigue publicándose en el 400 (llave ya publicada, ⛔ no se retira)', async () => {
    const { svc } = build();
    await expect(svc.listCards({ page: 1, pageSize: 20, finish: 'bogus' })).rejects.toMatchObject({
      details: { field: 'finish', value: 'bogus' },
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
