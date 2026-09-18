import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * WS-E (v1.16-master-set, §4.17c) — PricingService.getReferencesBatch (cierra RB-8/BE-4/D3):
 * resuelve la "referencia vigente = MÁS RECIENTE por acabado" para N ítems en 1 query.
 *
 * H-PERF-1 (perf-catalog-2): la query dejó de traer el histórico completo con `priceReference.findMany`
 * y ahora PODA en la BD (`$queryRaw` con ventana `max_auto_date`) devolviendo O(claves) candidatas, que
 * el mismo `isBetterRef` desempata. Este spec ejercita ese desempate en Node sobre las candidatas que la
 * poda entrega; la EQUIVALENCIA byte-a-byte de esa poda con el algoritmo previo (histórico completo +
 * `pickBestRef`) sobre Postgres real está en `test/integration/references-batch-history-prune.e2e-spec.ts`.
 */

function build(rows: any[]) {
  const queryRaw = jest.fn(async () => rows);
  // findMany NO debe usarse para la referencia (relee el histórico entero, H-PERF-1). Si algún cambio
  // vuelve a él, este spy lo delata.
  const findMany = jest.fn(async () => {
    throw new Error('H-PERF-1: getReferencesBatch no debe leer el histórico con priceReference.findMany');
  });
  const prisma = { priceReference: { findMany }, $queryRaw: queryRaw } as unknown as PrismaService;
  const svc = new PricingService(
    prisma,
    {} as SettingsService,
    {} as FxService,
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, queryRaw, findMany };
}

describe('PricingService.getReferencesBatch', () => {
  it('vacío → Map vacío sin tocar la BD', async () => {
    const { svc, queryRaw, findMany } = build([]);
    const res = await svc.getReferencesBatch([]);
    expect(res.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it('desempata la vigente por (cardId,productType,gradeKey,finish) sobre las candidatas podadas, en 1 query', async () => {
    // La poda de BD entrega las candidatas (manuales perennes + automáticas del día máximo por clave);
    // `isBetterRef` elige la vigente. Aquí: manual (tier absoluto) gana a la automática por 'normal'.
    const rows = [
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 9999, priceUsdCents: null, isManualOverride: true, source: 'manual', capturedDate: new Date('2026-08-17'), cardProductId: null },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 5000, priceUsdCents: null, isManualOverride: false, source: 'pokemontcg_io', capturedDate: new Date('2026-08-10'), cardProductId: null },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo', priceMxnCents: 12000, priceUsdCents: null, isManualOverride: false, source: 'pokemontcg_io', capturedDate: new Date('2026-08-16'), cardProductId: null },
    ];
    const { svc, queryRaw, findMany } = build(rows);
    const res = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'reverse_holo' },
    ]);
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(findMany).not.toHaveBeenCalled();
    expect(res.get('c1|raw|raw:NM|normal')).toMatchObject({ status: 'priced', referenceMxnCents: 9999 });
    expect(res.get('c1|raw|raw:NM|reverse_holo')).toMatchObject({ referenceMxnCents: 12000 });
  });
});
