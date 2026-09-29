import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { makeRefsRawQuery } from './helpers/refs-raw-emulate';

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

/**
 * P-53 ALTO-3 (§3) — CANARIO de la INVERSIÓN de precedencia en getReferencesBatch (money, storefront).
 *
 * Este describe usa el EMULADOR REAL de la poda `$queryRaw` (`makeRefsRawQuery`, el mismo que reproduce
 * `max_auto_date`), no un `queryRaw` que devuelve las filas ya podadas: la inversión NO vive en
 * `isBetterRef`, vive en la VENTANA. Antes del arreglo la ventana usaba `capturedDate` a secas, así que
 * la primaria buena (capturedDate viejo + evidenceDate=hoy, que el escritor P-53 CONGELA) quedaba FUERA
 * de `max_auto_date` (fijado por el fallback con capturedDate=hoy) y nunca llegaba a `isBetterRef`.
 */
describe('PricingService.getReferencesBatch — P-53 ALTO-3: frescura efectiva en la ventana', () => {
  function build(rows: any[]) {
    const queryRaw = makeRefsRawQuery(rows);
    const findMany = jest.fn(async () => {
      throw new Error('H-PERF-1: getReferencesBatch no debe leer el histórico con findMany');
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
    return { svc, queryRaw };
  }

  const OLD = new Date('2026-09-01');
  const TODAY = new Date('2026-09-18');

  it('la primaria tcgcsv_singles con capturedDate viejo + evidenceDate=HOY GANA al fallback pokemontcg_io capturedDate=HOY', async () => {
    // La primaria «buena»: precio estable en USD, el escritor diario solo avanzó evidenceDate (capturedDate
    // sigue viejo). El fallback de MENOR precedencia (pokemontcg_io, cardProductId=null) lo escribe
    // refreshCardPrices con capturedDate=HOY. Con el arreglo, la primaria cuenta como fresca (evidencia hoy)
    // ⇒ entra en la ventana y le gana al fallback por sourceRank a igual fecha efectiva.
    const rows = [
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 100000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv_singles', capturedDate: OLD, evidenceDate: TODAY, cardProductId: null, refKind: 'market' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 50000, priceUsdCents: null, isManualOverride: false, source: 'pokemontcg_io', capturedDate: TODAY, evidenceDate: null, cardProductId: null, refKind: 'market' },
    ];
    const { svc } = build(rows);
    const res = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    ]);
    // SIN el arreglo: max_auto_date=HOY (fallback) ⇒ la primaria (captured OLD) se EXCLUYE ⇒ gana 50000.
    // CON el arreglo: frescura efectiva de la primaria = HOY ⇒ entra y gana por precedencia de fuente.
    expect(res.get('c1|raw|raw:NM|normal')).toMatchObject({
      status: 'priced',
      referenceMxnCents: 100000,
      source: 'tcgcsv_singles',
    });
  });

  it('CA-10: con evidenceDate=null en TODAS las filas (día del deploy) la selección es IDÉNTICA a hoy', async () => {
    // Misma forma que el caso anterior pero SIN evidencia (legado): la primaria conserva capturedDate viejo
    // y NADIE avanzó evidencia ⇒ COALESCE = capturedDate ⇒ la primaria queda fuera de la ventana y gana el
    // fallback fresco, exactamente como producción hoy. El arreglo NO cambia este resultado.
    const rows = [
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 100000, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv_singles', capturedDate: OLD, evidenceDate: null, cardProductId: null, refKind: 'market' },
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 50000, priceUsdCents: null, isManualOverride: false, source: 'pokemontcg_io', capturedDate: TODAY, evidenceDate: null, cardProductId: null, refKind: 'market' },
    ];
    const { svc } = build(rows);
    const res = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    ]);
    expect(res.get('c1|raw|raw:NM|normal')).toMatchObject({ referenceMxnCents: 50000, source: 'pokemontcg_io' });
  });
});
