/**
 * 🔒 CANDADO — `MarketingAnnotationsService` (h1, API_CONTRACT §MKT.E; ARCHITECTURE §13.4.6).
 *
 * Lo que fija, FAIL-FIRST:
 *  - Una anotación con PII en `label` o `destino` ⇒ `422 VALIDATION_ERROR` y **NO se guarda** (el
 *    `create`/`update` de Prisma NO se llama). Si alguien quita `assertClean`, estos tests se ponen rojos.
 *  - `destino` SOLO aplica a `kind='promocion'` ⇒ en otro `kind`, un destino no vacío es `422`.
 *  - CRUD feliz y `404` en PATCH/DELETE de un id inexistente.
 *
 * Sin BD: Prisma mockeado.
 */
import { MarketingAnnotationKind } from '@prisma/client';
import { MarketingAnnotationsService } from '../src/modules/marketing/marketing-annotations.service';
import { BusinessException } from '../src/common/business.exception';

const statusOf = async (fn: () => Promise<unknown>): Promise<number> => {
  try {
    await fn();
    return 200;
  } catch (e) {
    if (e instanceof BusinessException) return e.getStatus();
    throw e;
  }
};

function mockPrisma() {
  const row = {
    id: 'a1',
    date: new Date('2026-10-06T00:00:00.000Z'),
    kind: MarketingAnnotationKind.promocion,
    label: 'Promo de otoño',
    destino: '/es/promos/otono',
    createdAt: new Date('2026-10-01T12:00:00.000Z'),
  };
  const marketingDateAnnotation = {
    create: jest.fn().mockResolvedValue(row),
    update: jest.fn().mockResolvedValue(row),
    delete: jest.fn().mockResolvedValue(row),
    findUnique: jest.fn().mockResolvedValue({ kind: MarketingAnnotationKind.promocion, destino: '/es/promos/otono', id: 'a1' }),
    findMany: jest.fn().mockResolvedValue([row]),
  };
  return { prisma: { marketingDateAnnotation } as never, marketingDateAnnotation };
}

const USER = 'admin-1';

describe('MarketingAnnotationsService — validación PII (fail-first) y CRUD', () => {
  it('crea una anotación limpia ⇒ fecha como YYYY-MM-DD, destino preservado', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const out = await svc.create(
      { date: '2026-10-06', kind: MarketingAnnotationKind.promocion, label: 'Promo de otoño', destino: '/es/promos/otono' },
      USER,
    );
    expect(marketingDateAnnotation.create).toHaveBeenCalledTimes(1);
    expect(out.date).toBe('2026-10-06');
    expect(out.destino).toBe('/es/promos/otono');
  });

  it('⛔ label con correo ⇒ 422 y NO llama a create', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() =>
      svc.create({ date: '2026-10-06', kind: MarketingAnnotationKind.evento, label: 'avisar a prueba@correo.com' }, USER),
    );
    expect(status).toBe(422);
    expect(marketingDateAnnotation.create).not.toHaveBeenCalled();
  });

  it('⛔ label con CURP ⇒ 422 y NO llama a create', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() =>
      svc.create({ date: '2026-10-06', kind: MarketingAnnotationKind.evento, label: 'cliente MAGL850315HDFRSL09' }, USER),
    );
    expect(status).toBe(422);
    expect(marketingDateAnnotation.create).not.toHaveBeenCalled();
  });

  it('⛔ destino con teléfono ⇒ 422 y NO llama a create', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() =>
      svc.create({ date: '2026-10-06', kind: MarketingAnnotationKind.promocion, label: 'Promo', destino: 'whatsapp 5512345678' }, USER),
    );
    expect(status).toBe(422);
    expect(marketingDateAnnotation.create).not.toHaveBeenCalled();
  });

  it('⛔ destino en kind != promocion ⇒ 422 (destino solo aplica a promoción)', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() =>
      svc.create({ date: '2026-10-06', kind: MarketingAnnotationKind.evento, label: 'Card Show', destino: '/es/algo' }, USER),
    );
    expect(status).toBe(422);
    expect(marketingDateAnnotation.create).not.toHaveBeenCalled();
  });

  it('forPeriod devuelve la forma embebida {date, kind, label, destino?}', async () => {
    const { prisma } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const out = await svc.forPeriod('2026-10-05', '2026-10-11');
    expect(out).toEqual([{ date: '2026-10-06', kind: 'promocion', label: 'Promo de otoño', destino: '/es/promos/otono' }]);
  });

  it('PATCH de id inexistente ⇒ 404 y NO llama a update', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    marketingDateAnnotation.findUnique.mockResolvedValueOnce(null);
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() => svc.update('nope', { label: 'x' }));
    expect(status).toBe(404);
    expect(marketingDateAnnotation.update).not.toHaveBeenCalled();
  });

  it('DELETE de id inexistente ⇒ 404 y NO llama a delete', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    marketingDateAnnotation.findUnique.mockResolvedValueOnce(null);
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() => svc.remove('nope'));
    expect(status).toBe(404);
    expect(marketingDateAnnotation.delete).not.toHaveBeenCalled();
  });

  it('PATCH que mete PII en label ⇒ 422 y NO llama a update', async () => {
    const { prisma, marketingDateAnnotation } = mockPrisma();
    const svc = new MarketingAnnotationsService(prisma);
    const status = await statusOf(() => svc.update('a1', { label: 'cliente @juanito' }));
    expect(status).toBe(422);
    expect(marketingDateAnnotation.update).not.toHaveBeenCalled();
  });
});
