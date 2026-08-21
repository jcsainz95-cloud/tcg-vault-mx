import { InventoryController } from '../src/modules/inventory/inventory.controller';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { MasterSetService } from '../src/modules/inventory/master-set.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';

/**
 * v1.28 (P-17, §4.26d / API_CONTRACT §M1) — `GET /admin/inventory/items` gana los filtros
 * ADITIVOS `finish?` y `productType?` (drill-down por casilla del Master Set y de las pestañas
 * Sellado/Gradeadas). Validados contra sus enums → 400 VALIDATION_ERROR; omitidos =
 * comportamiento actual (solo REDUCEN el conjunto ya autorizado por rol).
 */

function buildService() {
  const findMany = jest.fn(async (_args: any) => [] as any[]);
  const count = jest.fn(async () => 0);
  const prisma: any = {
    inventoryItem: { findMany, count },
  };
  const pricing = {
    getReferencesBatch: jest.fn(async () => new Map()),
  } as unknown as PricingService;
  const svc = new InventoryService(prisma as PrismaService, pricing, {} as SettingsService);
  return { svc, findMany };
}

describe('listItems — filtros finish/productType (servicio)', () => {
  it('cardId+finish sirve el drill-down de UNA variante (where con ambos)', async () => {
    const { svc, findMany } = buildService();
    await svc.listItems({ cardId: 'c1', finish: 'reverse_holo' as any, page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cardId: 'c1', finish: 'reverse_holo' }),
      }),
    );
  });

  it('productType=sealed|graded sirve los drill-downs de las pestañas (P-25/P-20)', async () => {
    const { svc, findMany } = buildService();
    await svc.listItems({ cardId: 'c1', productType: 'graded' as any, page: 1, pageSize: 20 });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ cardId: 'c1', productType: 'graded' }),
      }),
    );
  });

  it('omitidos = comportamiento actual (el where NO gana claves nuevas)', async () => {
    const { svc, findMany } = buildService();
    await svc.listItems({ cardId: 'c1', page: 1, pageSize: 20 });
    const where = (findMany.mock.calls[0] as any[])[0].where;
    expect(where).not.toHaveProperty('finish');
    expect(where).not.toHaveProperty('productType');
  });
});

describe('GET /admin/inventory/items — validación de filtros (controller)', () => {
  function buildController() {
    const inventory = { listItems: jest.fn(async () => ({ data: [] })) };
    const controller = new InventoryController(
      inventory as unknown as InventoryService,
      {} as MasterSetService,
      {} as AuditService,
    );
    return { controller, inventory };
  }

  it('finish inválido → 400 VALIDATION_ERROR (contrato §M1 v1.28)', () => {
    const { controller } = buildController();
    expect(() =>
      controller.list(undefined, 'c1', undefined, undefined, undefined, undefined, 'foil_x'),
    ).toThrowMatchingObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('productType inválido → 400 VALIDATION_ERROR', () => {
    const { controller } = buildController();
    expect(() =>
      controller.list(
        undefined,
        'c1',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        'boxed',
      ),
    ).toThrowMatchingObject({ code: 'VALIDATION_ERROR', status: 400 });
  });

  it('valores válidos pasan al servicio tal cual', async () => {
    const { controller, inventory } = buildController();
    await controller.list(
      undefined,
      'c1',
      undefined,
      undefined,
      undefined,
      undefined,
      'reverse_holo',
      'raw',
    );
    expect(inventory.listItems).toHaveBeenCalledWith(
      expect.objectContaining({ cardId: 'c1', finish: 'reverse_holo', productType: 'raw' }),
    );
  });
});

// Matcher auxiliar: BusinessException expone `code` como propiedad y el status vía getStatus().
expect.extend({
  toThrowMatchingObject(received: () => unknown, expected: { code: string; status: number }) {
    try {
      received();
      return { pass: false, message: () => 'expected function to throw' };
    } catch (e: any) {
      const pass = e?.code === expected.code && e?.getStatus?.() === expected.status;
      return {
        pass,
        message: () =>
          `expected throw with code=${expected.code} status=${expected.status}, got code=${e?.code} status=${e?.getStatus?.()}`,
      };
    }
  },
});

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace jest {
    interface Matchers<R> {
      toThrowMatchingObject(expected: { code: string; status: number }): R;
    }
  }
}
