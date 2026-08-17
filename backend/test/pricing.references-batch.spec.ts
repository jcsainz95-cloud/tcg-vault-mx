import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * WS-E (v1.16-master-set, §4.17c) — PricingService.getReferencesBatch (cierra RB-8/BE-4/D3):
 * resuelve la "referencia vigente = MÁS RECIENTE por acabado" para N ítems en 1 query.
 */

function build(rows: any[]) {
  const findMany = jest.fn(async () => rows);
  const prisma = { priceReference: { findMany } } as unknown as PrismaService;
  const svc = new PricingService(
    prisma,
    {} as SettingsService,
    {} as FxService,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, findMany };
}

describe('PricingService.getReferencesBatch', () => {
  it('vacío → Map vacío sin tocar la BD', async () => {
    const { svc, findMany } = build([]);
    const res = await svc.getReferencesBatch([]);
    expect(res.size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('toma la MÁS RECIENTE por (cardId,productType,gradeKey,finish) en 1 query', async () => {
    // findMany ya viene ordenado capturedDate desc; la primera fila por clave es la vigente.
    const rows = [
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 9999, source: 'manual', capturedDate: new Date('2026-08-17') },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 5000, source: 'pokemontcg_io', capturedDate: new Date('2026-08-10') },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo', priceMxnCents: 12000, source: 'pokemontcg_io', capturedDate: new Date('2026-08-16') },
    ];
    const { svc, findMany } = build(rows);
    const res = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' },
    ]);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(res.get('c1|raw|raw:NM|normal')).toMatchObject({ status: 'priced', referenceMxnCents: 9999 });
    expect(res.get('c1|raw|raw:NM|reverse_holo')).toMatchObject({ referenceMxnCents: 12000 });
  });
});
