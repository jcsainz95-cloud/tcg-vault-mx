import { PricingService } from '../src/modules/pricing/pricing.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { FxService } from '../src/modules/pricing/fx.service';

/**
 * ⭐⭐ H-PERF-1 (perf-catalog-2) — CANARIO que MUERDE la sobre-lectura del histórico.
 *
 * El defecto: `getReferencesBatch` / `getPricedRawFinishesBatch` leían la `PriceReference` de la
 * carta SIN cota de fecha (`findMany` con `orderBy capturedDate desc`, o `distinct` en memoria), así
 * que para cada carta del catálogo materializaban TODA su historia de precios (una fila por día) para
 * quedarse con la vigente. Medido a escala local: 3.000 publicadas × 60 días = 180.000 filas leídas
 * para devolver 3.000 — sobre-lectura de 60×, y `getReferencesBatch` tardaba ~2.300 ms.
 *
 * El arreglo poda el histórico EN LA BD (`$queryRaw` con ventana `max_auto_date` / `SELECT DISTINCT`),
 * devolviendo O(claves) filas. Esta prueba es el CANARIO: FALLA si alguien reintroduce el defecto
 * volviendo al `findMany` de todo el histórico. Es DETERMINISTA (N=1): no depende de tiempos ni
 * carreras, solo de QUÉ query se emite. La igualdad byte-a-byte de la SALIDA (money-safe) la cubre
 * `test/integration/references-batch-history-prune.e2e-spec.ts` contra Postgres real.
 */
function build() {
  const queryRaw = jest.fn();
  const findMany = jest.fn(async () => {
    throw new Error(
      'REGRESIÓN H-PERF-1: getReferencesBatch/getPricedRawFinishesBatch NO deben leer el histórico ' +
        'completo con priceReference.findMany. Deben podar en la BD (ver $queryRaw con `max_auto_date` / ' +
        '`SELECT DISTINCT`). Ver el docstring de este canario.',
    );
  });
  const prisma = {
    priceReference: { findMany },
    $queryRaw: queryRaw,
  } as unknown as PrismaService;
  const svc = new PricingService(
    prisma,
    {} as SettingsService,
    {} as FxService, // fx.getCurrent indefinido ⇒ fxSnapshotSafe cae a null ⇒ liveMxnCents = priceMxnCents
    {} as any,
    {} as any,
    {} as any,
  );
  return { svc, queryRaw, findMany };
}

/** Texto SQL estático del `Prisma.sql` (los fragmentos entre parámetros). */
function sqlText(arg: any): string {
  if (arg == null) return '';
  if (typeof arg.sql === 'string') return arg.sql;
  if (Array.isArray(arg.strings)) return arg.strings.join(' ');
  return String(arg);
}

describe('H-PERF-1 — getReferencesBatch PODA el histórico (no lo relee entero)', () => {
  it('emite UNA query de poda ($queryRaw con ventana max_auto_date) y NO lee el histórico con findMany', async () => {
    const { svc, queryRaw, findMany } = build();
    // El stub devuelve YA la vigente por clave (lo que la poda de BD garantiza).
    queryRaw.mockResolvedValueOnce([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal', priceMxnCents: 9999, priceUsdCents: null, isManualOverride: true, source: 'manual', capturedDate: new Date('2026-06-01'), cardProductId: null },
    ]);
    const res = await svc.getReferencesBatch([
      { cardId: 'c1', productType: 'raw', gradeKey: 'raw:NM', finish: 'normal' },
    ]);

    expect(findMany).not.toHaveBeenCalled(); // ⛔ jamás el histórico completo
    expect(queryRaw).toHaveBeenCalledTimes(1);
    const text = sqlText(queryRaw.mock.calls[0][0]);
    // La poda del histórico: ventana por clave + filtro de vigencia. Sin esto se releía todo.
    expect(text).toMatch(/max_auto_date/);
    expect(text).toMatch(/is_manual/);
    expect(text).toMatch(/PriceReference/);
    // La vigente se proyecta tal cual (money-safe: mismo PriceInfo que antes).
    expect(res.get('c1|raw|raw:NM|normal')).toMatchObject({ status: 'priced', referenceMxnCents: 9999, source: 'manual' });
  });

  it('vacío → Map vacío sin tocar la BD', async () => {
    const { svc, queryRaw, findMany } = build();
    const res = await svc.getReferencesBatch([]);
    expect(res.size).toBe(0);
    expect(queryRaw).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });
});

describe('H-PERF-1 — getPricedRawFinishesBatch resuelve el DISTINCT en la BD', () => {
  it('emite SELECT DISTINCT ($queryRaw) y NO deduplica en memoria sobre el histórico', async () => {
    const { svc, queryRaw, findMany } = build();
    queryRaw.mockResolvedValueOnce([
      { cardId: 'c1', finish: 'normal' },
      { cardId: 'c1', finish: 'reverse_holo' },
      { cardId: 'c2', finish: 'normal' },
    ]);
    const res = await svc.getPricedRawFinishesBatch(['c1', 'c2']);

    expect(findMany).not.toHaveBeenCalled();
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(sqlText(queryRaw.mock.calls[0][0])).toMatch(/SELECT DISTINCT/i);
    expect([...(res.get('c1') ?? [])].sort()).toEqual(['normal', 'reverse_holo']);
    expect([...(res.get('c2') ?? [])]).toEqual(['normal']);
  });
});
