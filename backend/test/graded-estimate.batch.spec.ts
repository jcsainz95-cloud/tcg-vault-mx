import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_GRADING_COST_TIERS } from '../src/common/graded-estimate';

/**
 * v1.44-graded-estimate — `PricingService.getGradedEstimatesBatch` + `loadGradedEstimateConfig`
 * (ARCHITECTURE §4.35a/c/d).
 *
 * Lo que se prueba aquí es lo que hace que la feature no sea un problema de rendimiento ni de money-
 * safety: UNA sola query con la clave canónica, desempate determinista, recomputo FX, y una config
 * FAIL-CLOSED que jamás inventa un costo de gradeo.
 */

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

function refRow(over: Partial<Record<string, unknown>> = {}) {
  return {
    cardId: 'c1',
    productType: 'graded',
    gradeKey: 'graded:PSA:10',
    finish: 'normal',
    priceMxnCents: 900_000,
    priceUsdCents: null,
    isManualOverride: true,
    source: 'manual',
    capturedDate: D('2026-08-20'),
    cardProductId: null,
    ...over,
  };
}

/** Prisma mock con store de ConfigSetting + filas de PriceReference controladas por el test. */
function wire(rows: unknown[] = [], config: Record<string, unknown> = {}) {
  const configStore = new Map<string, unknown>(Object.entries(config));
  const findMany = jest.fn(async (_args: any) => rows);
  const prisma = {
    configSetting: {
      findUnique: jest.fn(async ({ where: { key } }: any) =>
        configStore.has(key) ? { key, valueJson: configStore.get(key) } : null,
      ),
      upsert: jest.fn(async ({ where: { key }, create, update }: any) => {
        configStore.set(key, configStore.has(key) ? update.valueJson : create.valueJson);
        return { key };
      }),
    },
    priceReference: { findMany },
  } as unknown as PrismaService;
  const settings = new SettingsService(prisma);
  // FX que no resuelve ⇒ `fxSnapshotSafe()` = null ⇒ se usa el `priceMxnCents` almacenado.
  const fx = { getCurrent: jest.fn(async () => null) } as unknown as FxService;
  const pricing = new PricingService(prisma, settings, fx, {} as any, {} as any, {} as any);
  return { pricing, prisma, findMany, configStore };
}

describe('getGradedEstimatesBatch — UNA query con la clave canónica (§4.35a/c)', () => {
  it('consulta productType=graded, los DOS gradeKey, finish=normal y cardProductId=null — una sola vez', async () => {
    const { pricing, findMany } = wire([refRow(), refRow({ gradeKey: 'graded:PSA:9', priceMxnCents: 300_000 })]);
    const map = await pricing.getGradedEstimatesBatch(['c1', 'c1', 'c2']);

    expect(findMany).toHaveBeenCalledTimes(1); // +1 query CONSTANTE: nada de N+1.
    const where = findMany.mock.calls[0][0].where;
    expect(where.cardId).toEqual({ in: ['c1', 'c2'] }); // cardIds DISTINTOS
    expect(where.productType).toBe('graded');
    expect(where.gradeKey).toEqual({ in: ['graded:PSA:10', 'graded:PSA:9'] });
    // El grado NO se cruza con el acabado: el estimado es por CARTA (§4.35a).
    expect(where.finish).toBe('normal');
    // El estimado es de la CARTA, no de un CardProduct separado (§4.27).
    expect(where.cardProductId).toBeNull();

    expect(map.get('c1')!.map((e) => e.gradeValue).sort()).toEqual(['10', '9']);
    expect(map.get('c2')).toBeUndefined();
  });

  it('no consulta nada con una lista vacía', async () => {
    const { pricing, findMany } = wire();
    expect((await pricing.getGradedEstimatesBatch([])).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('INDISTINGUIBILIDAD (§4.35g): el resultado NO transporta `source` ni `isManualOverride`', async () => {
    const { pricing } = wire([refRow()]);
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'])).get('c1')!;
    expect(ref).toEqual({
      gradeValue: '10',
      gradeKey: 'graded:PSA:10',
      mxnCents: 900_000,
      capturedDate: '2026-08-20',
    });
    expect(Object.keys(ref)).not.toContain('source');
    expect(Object.keys(ref)).not.toContain('isManualOverride');
  });

  it('desempate determinista por clave: gana la fila MÁS RECIENTE (y a igual día, el override manual)', async () => {
    const { pricing } = wire([
      refRow({ capturedDate: D('2026-08-22'), priceMxnCents: 111_111, source: 'pokemonpricetracker', isManualOverride: false }),
      refRow({ capturedDate: D('2026-08-23'), priceMxnCents: 222_222, source: 'pokemonpricetracker', isManualOverride: false }),
      refRow({ capturedDate: D('2026-08-23'), priceMxnCents: 333_333, source: 'manual', isManualOverride: true }),
    ]);
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'])).get('c1')!;
    // §N.6: override manual > ingest automático, resuelto DENTRO de la tabla por `isBetterRef`.
    expect(ref.mxnCents).toBe(333_333);
    expect(ref.capturedDate).toBe('2026-08-23');
  });

  it('MONEY-SAFE: una fila con importe <= 0 NO produce estimado (un 0 no es un estimado)', async () => {
    const { pricing } = wire([refRow({ priceMxnCents: 0 }), refRow({ gradeKey: 'graded:PSA:9', priceMxnCents: -5 })]);
    expect((await pricing.getGradedEstimatesBatch(['c1'])).get('c1')).toBeUndefined();
  });

  it('una referencia en USD se RECOMPUTA con la FX vigente (mismo lector que getReference)', async () => {
    const { pricing, prisma } = wire([
      refRow({ priceUsdCents: 10_000, priceMxnCents: 150_000, isManualOverride: false, source: 'pokemonpricetracker' }),
    ]);
    // FX viva: 20.00 + 3% de colchón ⇒ 100 USD = 2060 MXN = 206000 centavos (no los 150000 congelados).
    (pricing as unknown as { fx: FxService }).fx = {
      getCurrent: jest.fn(async () => ({ rate: 20, bufferPct: 3 })),
    } as unknown as FxService;
    void prisma;
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'])).get('c1')!;
    expect(ref.mxnCents).toBe(206_000);
  });
});

describe('loadGradedEstimateConfig — fail-closed en dos niveles (§4.35d)', () => {
  it('con el dial `off` (seed) devuelve la config APAGADA sin leer nada más', async () => {
    const { pricing, prisma } = wire();
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg.enabled).toBe(false);
    expect(cfg.gradingCostTiers).toEqual([]);
    expect(cfg.grades).toEqual([]);
    // UNA sola lectura de settings (la del dial maestro): con `off` el backend ni siquiera evalúa nada.
    expect((prisma as any).configSetting.findUnique).toHaveBeenCalledTimes(1);
  });

  it('con el dial `on` devuelve grados, frescura, umbral y la tabla del seed', async () => {
    const { pricing } = wire([], { [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on' });
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg).toEqual({
      enabled: true,
      grades: ['10', '9'],
      highlightGrades: ['10'],
      freshnessDays: 30,
      minUpsidePct: 30,
      gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
    });
  });

  it('tabla de escalones CORRUPTA/ausente ⇒ [] (nada se destaca), JAMÁS un default de código', async () => {
    for (const corrupta of [null, 'nope', [], [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 0 }]]) {
      const { pricing } = wire([], {
        [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on',
        [SettingKey.GRADING_COST_TIERS]: corrupta,
      });
      expect((await pricing.loadGradedEstimateConfig()).gradingCostTiers).toEqual([]);
    }
  });

  it('umbrales y listas inválidos SÍ caen a su seed (no son dinero; sin tabla no hay gate)', async () => {
    const { pricing } = wire([], {
      [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on',
      [SettingKey.GRADING_MIN_UPSIDE_PCT]: 'mucho',
      [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: 0,
      [SettingKey.GRADED_ESTIMATE_GRADES]: ['11'],
    });
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg.minUpsidePct).toBe(30);
    expect(cfg.freshnessDays).toBe(30);
    expect(cfg.grades).toEqual(['10', '9']);
  });

  it('`highlightGrades ⊆ grades` también EN LECTURA (un badge huérfano no se pinta)', async () => {
    const { pricing } = wire([], {
      [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on',
      [SettingKey.GRADED_ESTIMATE_GRADES]: ['9'],
      [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: ['10'],
    });
    expect((await pricing.loadGradedEstimateConfig()).highlightGrades).toEqual([]);
  });

  it('la variante de ADMIN lee la config COMPLETA aunque el dial esté apagado', async () => {
    const { pricing } = wire();
    const cfg = await pricing.loadGradedEstimateConfigForAdmin();
    expect(cfg.enabled).toBe(false); // espejo read-only del dial M10
    expect(cfg.grades).toEqual(['10', '9']);
    expect(cfg.gradingCostTiers).toEqual(DEFAULT_GRADING_COST_TIERS); // el editor de M2 SÍ los ve
  });
});
