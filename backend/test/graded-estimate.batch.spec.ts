import { Logger } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { SettingKey } from '../src/modules/settings/settings.constants';
import { DEFAULT_GRADING_COST_TIERS } from '../src/common/graded-estimate';

/**
 * v1.44-graded-estimate — `PricingService.getGradedEstimatesBatch` + `loadGradedEstimateConfig`
 * (ARCHITECTURE §4.38a/c/d).
 *
 * Lo que se prueba aquí es lo que hace que la feature no sea un problema de rendimiento ni de money-
 * safety: UNA sola query con la clave canónica, desempate determinista, recomputo FX, y una config
 * FAIL-CLOSED que jamás inventa un costo de gradeo.
 */

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);

/**
 * v1.50.3 (§4.38m) — `getGradedEstimatesBatch` exige `cfg` + `today` **sin default**, porque el filtro
 * de FRESCURA se aplica ahí dentro, ANTES de `pickBestRef`. Un parámetro opcional habría sido
 * fail-open sobre el criterio 109: cualquier superficie que lo olvidara leería estimados sin filtrar.
 */
const TODAY = '2026-08-28';
const FRESH_CFG = { freshnessDays: 30, manualFreshnessDays: 30 as number | null };
const cfgWith = (over: Partial<typeof FRESH_CFG> = {}) => ({ ...FRESH_CFG, ...over });

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
      // R1: `findMany` devuelve SOLO las filas EXISTENTES — una clave ausente del store simplemente no
      // aparece, igual que en Postgres. Es lo que hace observable «ausente» vs «presente con el seed».
      findMany: jest.fn(async ({ where }: any) =>
        (where.key.in as string[])
          .filter((k) => configStore.has(k))
          .map((k) => ({ key: k, valueJson: configStore.get(k) })),
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

describe('getGradedEstimatesBatch — UNA query con la clave canónica (§4.38a/c)', () => {
  it('consulta productType=graded, los DOS gradeKey, finish=normal y cardProductId=null — una sola vez', async () => {
    const { pricing, findMany } = wire([refRow(), refRow({ gradeKey: 'graded:PSA:9', priceMxnCents: 300_000 })]);
    const map = await pricing.getGradedEstimatesBatch(['c1', 'c1', 'c2'], FRESH_CFG, TODAY);

    expect(findMany).toHaveBeenCalledTimes(1); // +1 query CONSTANTE: nada de N+1.
    const where = findMany.mock.calls[0][0].where;
    expect(where.cardId).toEqual({ in: ['c1', 'c2'] }); // cardIds DISTINTOS
    expect(where.productType).toBe('graded');
    expect(where.gradeKey).toEqual({ in: ['graded:PSA:10', 'graded:PSA:9'] });
    // El grado NO se cruza con el acabado: el estimado es por CARTA (§4.38a).
    expect(where.finish).toBe('normal');
    // El estimado es de la CARTA, no de un CardProduct separado (§4.27).
    expect(where.cardProductId).toBeNull();

    expect(map.get('c1')!.map((e) => e.gradeValue).sort()).toEqual(['10', '9']);
    expect(map.get('c2')).toBeUndefined();
  });

  it('no consulta nada con una lista vacía', async () => {
    const { pricing, findMany } = wire();
    expect((await pricing.getGradedEstimatesBatch([], FRESH_CFG, TODAY)).size).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('INDISTINGUIBILIDAD (§4.38g): el resultado NO transporta `source` ni `isManualOverride`', async () => {
    const { pricing } = wire([refRow()]);
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, TODAY)).get('c1')!;
    expect(ref).toEqual({
      gradeValue: '10',
      gradeKey: 'graded:PSA:10',
      mxnCents: 900_000,
      capturedDate: '2026-08-20',
      // v1.50.2 (§4.38m): `isManual` SÍ entra al tipo interno — decide **si** el elemento se emite (la
      // frescura de feed no se aplica a una decisión humana), nunca **qué**. Sigue sin ser `source`:
      // no dice de QUÉ proveedor vino, solo si un humano lo fijó, y **no viaja al DTO público** (eso
      // lo prueba `SEC-A1` en `graded-estimate.composition.spec.ts` sobre el JSON serializado).
      isManual: true,
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
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, TODAY)).get('c1')!;
    // §O.6: override manual > ingest automático, resuelto DENTRO de la tabla por `isBetterRef`.
    expect(ref.mxnCents).toBe(333_333);
    expect(ref.capturedDate).toBe('2026-08-23');
  });

  it('MONEY-SAFE: una fila con importe <= 0 NO produce estimado (un 0 no es un estimado)', async () => {
    const { pricing } = wire([refRow({ priceMxnCents: 0 }), refRow({ gradeKey: 'graded:PSA:9', priceMxnCents: -5 })]);
    expect((await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, TODAY)).get('c1')).toBeUndefined();
  });

  /**
   * v1.50.3 (GU-A16, §4.38m) — **PRIMERO se descarta lo rancio, DESPUÉS gana el mejor.**
   *
   * Este bloque **cambió de signo** respecto de v1.50.2 y hay que leer por qué antes de revertirlo.
   * v1.50.2 curó el fallo «gana y luego se tira» **eximiendo al manual del decaimiento**
   * (`manualFreshnessDays: null`). El diagnóstico era bueno; el remedio derogaba el **criterio 109** en
   * silencio: un estimado que un humano tecleó una vez podía quedarse en portada para siempre, que es
   * exactamente lo que §O.4 promete que no pasa. QA lo reprodujo con una fila manual de 40 días.
   *
   * La clase de fallo **no venía del decaimiento, venía de filtrar DESPUÉS de resolver**. Invertir el
   * orden la elimina sin eximir a nadie y **sin tocar `isBetterRef`** (§4.27f-2 es una garantía de
   * DINERO sobre escrituras y sobre el comparador; el filtro de frescura es un predicado de EXHIBICIÓN
   * que vive fuera del comparador y solo en esta ruta de lectura).
   */
  describe('el filtro de FRESCURA corre ANTES de pickBestRef (los tres casos de §4.38(i))', () => {
    const HOY = '2026-08-28';
    const VIEJO = D('2026-02-09'); // 200 días
    const FRESCO = D('2026-08-27'); // ayer

    const manual = (over = {}) =>
      refRow({ capturedDate: VIEJO, priceMxnCents: 111_111, isManualOverride: true, source: 'manual', ...over });
    const automatica = (over = {}) =>
      refRow({
        capturedDate: FRESCO,
        priceMxnCents: 222_222,
        isManualOverride: false,
        source: 'pokemonpricetracker',
        ...over,
      });

    it('(a) manual RANCIO + automática FRESCA ⇒ se muestra la AUTOMÁTICA (antes: NADA)', async () => {
      const { pricing } = wire([manual(), automatica()]);
      const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY)).get('c1')!;
      // El fallo silencioso de v1.50.2: el manual ganaba por tier absoluto y la frescura lo tiraba
      // DESPUÉS ⇒ la carta se quedaba sin estimado **pese a tener dato fresco disponible**.
      expect(ref.mxnCents).toBe(222_222);
      expect(ref.capturedDate).toBe('2026-08-27');
      expect(ref.isManual).toBe(false);
    });

    it('(b) manual RANCIO SIN automática ⇒ NO se muestra NADA (criterio 109; antes se mostraba)', async () => {
      const { pricing } = wire([manual()]);
      // §O.4: «mejor callar que presumir un número viejo en una promesa comercial». Éste es el caso
      // que QA reprodujo a mano con 40 días y que v1.50.2 dejaba pasar.
      expect((await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY)).get('c1')).toBeUndefined();
    });

    it('(c) manual FRESCO + automática fresca ⇒ gana el MANUAL (§4.27f-2 INTACTO)', async () => {
      const { pricing } = wire([manual({ capturedDate: FRESCO }), automatica()]);
      const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY)).get('c1')!;
      // Entre las FRESCAS el comparador manda igual que siempre: el override manual sigue siendo tier
      // superior absoluto. Lo que cambió es el CONJUNTO sobre el que compara, no el comparador.
      expect(ref.mxnCents).toBe(111_111);
      expect(ref.isManual).toBe(true);
    });

    it('con `manualFreshnessDays: null` el manual rancio vuelve a ganar (la válvula sigue viva)', async () => {
      const { pricing } = wire([manual(), automatica()]);
      const map = await pricing.getGradedEstimatesBatch(['c1'], cfgWith({ manualFreshnessDays: null }), HOY);
      expect(map.get('c1')![0].mxnCents).toBe(111_111);
    });

    it('la frescura del FEED sigue siendo independiente: una automática rancia se descarta igual', async () => {
      const { pricing } = wire([automatica({ capturedDate: VIEJO })]);
      expect((await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY)).get('c1')).toBeUndefined();
    });

    /**
     * v1.50.3-c (QA) — **la contrapartida no declarada del arreglo de arriba.**
     *
     * Al mover el filtro DENTRO del batch, las filas rancias dejaron de existir para TODO el que lo
     * consume — incluidos `preview` y `review`, que lo consumen a propósito. Medido por QA con una fila
     * manual de 40 días, el diagnóstico de admin respondía
     * `{reason:'NO_PSA10', stale:false, psa10MxnCents:null, capturedDate:null}` cuando la verdad era
     * **«tu cifra expiró»**: `STALE` y `stale:true` quedaron INALCANZABLES pese a estar normados en
     * API_CONTRACT §M2.
     *
     * **No es cosmético: los dos remedios son OPUESTOS.** «No hay cifra» ⇒ captúrala; «la cifra caducó»
     * ⇒ refréscala. Un diagnóstico que los funde manda al operador a teclear de cero un número que ya
     * está en la tabla.
     *
     * El opt-in `includeStaleForDiagnostics` recupera la resolución **sin deshacer el arreglo**: el
     * orden no se toca, la ruta pública no cambia, y la fila rancia se re-inyecta **solo** donde no
     * quedó ninguna fresca.
     */
    describe('`includeStaleForDiagnostics` — el admin ve lo que el filtro se llevó (v1.50.3-c)', () => {
      const DIAG = { includeStaleForDiagnostics: true };

      it('sin el opt-in (ruta PÚBLICA) el manual rancio sigue sin existir: el arreglo NO se deshace', async () => {
        const { pricing } = wire([manual()]);
        expect((await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY)).get('c1')).toBeUndefined();
      });

      it('con el opt-in, la fila rancia SÍ aparece — con su monto y su fecha reales', async () => {
        const { pricing } = wire([manual()]);
        const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, DIAG)).get('c1')!;
        expect(ref.mxnCents).toBe(111_111); // «hay una cifra, y CADUCÓ» ≠ «no hay cifra»
        expect(ref.capturedDate).toBe('2026-02-09');
        expect(ref.isManual).toBe(true); // el ORIGEN viaja: es lo que decide con qué ventana se midió
      });

      it('NO divergE del storefront donde hay dato fresco: la rancia solo entra si no quedó ninguna fresca', async () => {
        // El caso que motivó el arreglo del orden (manual 200 d + automática fresca). Aquí una
        // divergencia sería intolerable: el operador vería un número que la ficha no muestra **sin**
        // que nada se lo explique. Por eso el fallback es por CLAVE y solo cuando la cubeta fresca
        // está vacía.
        const { pricing } = wire([manual(), automatica()]);
        const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, DIAG)).get('c1')!;
        expect(ref.mxnCents).toBe(222_222);
        expect(ref.isManual).toBe(false);
      });

      it('es POR GRADO: PSA 10 fresco convive con un PSA 9 caducado re-inyectado', async () => {
        const { pricing } = wire([
          automatica(), // PSA 10 fresco
          manual({ gradeKey: 'graded:PSA:9', priceMxnCents: 333_333 }), // PSA 9 rancio, sin fresca
        ]);
        const refs = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, DIAG)).get('c1')!;
        const byGrade = Object.fromEntries(refs.map((r) => [r.gradeValue, r]));
        expect(byGrade['10'].mxnCents).toBe(222_222);
        expect(byGrade['9'].mxnCents).toBe(333_333); // sin esto, el gate diría NO_PSA9 («captúralo»)
      });

      it('entre RANCIAS también gana el mejor con el comparador de siempre (no «la primera que salga»)', async () => {
        const { pricing } = wire([
          automatica({ capturedDate: VIEJO, priceMxnCents: 555_555 }),
          manual({ priceMxnCents: 111_111 }),
        ]);
        const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, DIAG)).get('c1')!;
        expect(ref.mxnCents).toBe(111_111); // tier manual absoluto (§4.27f-2), igual que en la fresca
      });

      it('money-safe: una rancia con monto <= 0 NO se re-inyecta (un 0 no es un estimado)', async () => {
        const { pricing } = wire([manual({ priceMxnCents: 0 })]);
        expect(
          (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, DIAG)).get('c1'),
        ).toBeUndefined();
      });

      it('`includeStaleForDiagnostics: false` es exactamente la ruta pública (el opt-in no tiene default)', async () => {
        const { pricing } = wire([manual()]);
        const map = await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, HOY, {
          includeStaleForDiagnostics: false,
        });
        expect(map.get('c1')).toBeUndefined();
      });
    });
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
    const [ref] = (await pricing.getGradedEstimatesBatch(['c1'], FRESH_CFG, TODAY)).get('c1')!;
    expect(ref.mxnCents).toBe(206_000);
  });
});

/**
 * Estado SEMBRADO: `prisma/seed.ts` escribe UNA FILA por cada `SETTING_DEFAULTS`, así que en una BD
 * sembrada la clave del costo EXISTE. Los tests que quieren probar el camino feliz la ponen explícita;
 * los que prueban el fail-closed la DEJAN FUERA a propósito (R1: ausente ⇒ tabla vacía).
 */
const SEEDED_TIERS = { [SettingKey.GRADING_COST_TIERS]: DEFAULT_GRADING_COST_TIERS };
const ON = { [SettingKey.GRADED_ESTIMATES_ENABLED]: 'on' };

describe('loadGradedEstimateConfig — fail-closed en dos niveles (§4.38d)', () => {
  it('con el dial `off` (seed) devuelve la config APAGADA sin evaluar nada', async () => {
    const { pricing, prisma } = wire();
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg.enabled).toBe(false);
    // GU-A8: el dial apaga LOS TRES interruptores (invariante highlight ⇒ estimates ⇒ enabled).
    expect(cfg.estimatesEnabled).toBe(false);
    expect(cfg.highlightEnabled).toBe(false);
    expect(cfg.gradingCostTiers).toEqual([]);
    expect(cfg.grades).toEqual([]);
    // IMPORTANTE-2: UNA sola query de settings por request (las 6 claves en un `findMany`), no 6
    // lecturas sueltas. Con `off` el backend ni siquiera evalúa nada.
    expect((prisma as any).configSetting.findMany).toHaveBeenCalledTimes(1);
    expect((prisma as any).configSetting.findUnique).not.toHaveBeenCalled();
  });

  it('IMPORTANTE-2 — con el dial `on` la config sigue costando UNA sola query de settings', async () => {
    const { pricing, prisma } = wire([], { ...SEEDED_TIERS, ...ON });
    await pricing.loadGradedEstimateConfig();
    expect((prisma as any).configSetting.findMany).toHaveBeenCalledTimes(1);
    expect((prisma as any).configSetting.findUnique).not.toHaveBeenCalled();
    // Las DOCE claves del gancho (v1.50.2: los 2 diales M10 + las 10 de M2) van en el MISMO
    // `where.key.in`. La afirmación importante NO es «doce» sino **UNA sola query**: la regresión que
    // QA midió como +7 fue exactamente una lectura POR CLAVE, así que añadir diales no puede volver a
    // convertir esto en +N.
    const keys = (prisma as any).configSetting.findMany.mock.calls[0][0].where.key.in;
    expect(new Set(keys)).toEqual(
      new Set([
        SettingKey.GRADED_ESTIMATES_ENABLED,
        SettingKey.GRADED_ESTIMATE_GRADES,
        SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES,
        SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS,
        SettingKey.GRADING_MIN_UPSIDE_PCT,
        SettingKey.GRADING_COST_TIERS,
        SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
        SettingKey.GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
        SettingKey.GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
        SettingKey.GRADED_ESTIMATE_SOURCE_STAT,
        SettingKey.GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
        SettingKey.GRADED_ESTIMATE_INGEST_ENABLED,
      ]),
    );
  });

  it('con el dial `on` y la tabla SEMBRADA devuelve grados, frescura, umbral y escalones', async () => {
    const { pricing } = wire([], { ...SEEDED_TIERS, ...ON });
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg).toEqual({
      enabled: true,
      estimatesEnabled: true,
      highlightEnabled: true,
      grades: ['10', '9'],
      highlightGrades: ['10'],
      freshnessDays: 30,
      minUpsidePct: 30,
      gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
      // v1.50.3 — seeds ALINEADOS a `PROJECT.md` §O.7 (GU-A17). Los tres corregidos van con su valor
      // del criterio, no con el que el código eligió: `manualFreshnessDays` 30 (era `null` ⇒ derogaba
      // el criterio 109), `minSampleCount` 5 (era 3 ⇒ permisivo) y `maxRawMultiple` 100 (era 50 ⇒
      // suprimía sin explicación las cartas de 50×–100×). `ingestEnabled: false` = fail-closed: el
      // ingest no gasta un solo crédito hasta que el dueño lo encienda.
      ingestEnabled: false,
      manualFreshnessDays: 30,
      maxRawMultiple: 100,
      minSampleCount: 5,
      sourceStat: 'median',
      ingestMaxCardsPerRun: 250,
      ingestConfigInvalid: false,
      // v1.50.3 (§4.38n.3): flag INTERNO —no viaja al DTO— que la LISTA DE REVISIÓN usa para decidir
      // entre evaluar (dial `off` = decisión) y `409` (clave corrupta = intención perdida).
      maxRawMultipleInvalid: false,
    });
  });

  /**
   * v1.50.3 (GU-A17) — **un test que lee EL SEED, no el comportamiento.**
   *
   * Los tres diales divergían de `PROJECT.md` §O.7 y **nadie lo notó durante todo un pase**: un seed
   * equivocado no rompe nada, no lanza, no falla ningún test de comportamiento — simplemente hace que
   * el sistema aplique un criterio distinto del que el producto escribió. Por eso el candado tiene que
   * ser sobre **el valor**, con el número del criterio escrito al lado: es lo único que convierte una
   * regresión de seed en un test rojo en vez de en una divergencia silenciosa de otro año.
   */
  it.each([
    ['manualFreshnessDays', 30, 'criterio 109: el override manual decae a los 30 días'],
    ['minSampleCount', 5, 'criterio 111(a) / §O.7: `minSalesSample` = 5 ventas mínimas'],
    ['maxRawMultiple', 100, 'criterio 111(c) / §O.7: `maxGradedMultiple` = 100×'],
  ])('el SEED de `%s` es %i — %s', async (key, expected) => {
    const { pricing } = wire([], { ...SEEDED_TIERS, ...ON });
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg[key as 'minSampleCount']).toBe(expected);
  });

  it('R1 — clave `grading_cost_tiers` AUSENTE ⇒ tabla VACÍA (NO cae al seed de código)', async () => {
    // El caso que el bucle de «corrupta» NO cubría: la fila no existe. `SettingsService.get()` haría
    // fallback a `SETTING_DEFAULTS` y el gate correría con los 6 escalones; §4.38d dice lo contrario.
    const { pricing } = wire([], ON);
    expect((await pricing.loadGradedEstimateConfig()).gradingCostTiers).toEqual([]);
    // …y el resto de la config SÍ cae a su seed (son umbrales/listas, no dinero).
    const cfg = await pricing.loadGradedEstimateConfig();
    expect(cfg).toMatchObject({ enabled: true, grades: ['10', '9'], minUpsidePct: 30, freshnessDays: 30 });
  });

  it('tabla de escalones PRESENTE pero corrupta ⇒ [] (nada se destaca), JAMÁS un default de código', async () => {
    for (const corrupta of [null, 'nope', [], [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 0 }]]) {
      const { pricing } = wire([], { ...ON, [SettingKey.GRADING_COST_TIERS]: corrupta });
      expect((await pricing.loadGradedEstimateConfig()).gradingCostTiers).toEqual([]);
    }
  });

  it('`highlightGrades ⊆ grades` también EN LECTURA (un badge huérfano no se pinta)', async () => {
    const { pricing } = wire([], {
      ...SEEDED_TIERS,
      ...ON,
      [SettingKey.GRADED_ESTIMATE_GRADES]: ['9'],
      [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: ['10'],
    });
    expect((await pricing.loadGradedEstimateConfig()).highlightGrades).toEqual([]);
  });

  it('la variante de ADMIN lee la config COMPLETA aunque el dial esté apagado', async () => {
    const { pricing } = wire([], SEEDED_TIERS);
    const cfg = await pricing.loadGradedEstimateConfigForAdmin();
    expect(cfg.enabled).toBe(false); // espejo read-only del dial M10
    expect(cfg.grades).toEqual(['10', '9']);
    expect(cfg.gradingCostTiers).toEqual(DEFAULT_GRADING_COST_TIERS); // el editor de M2 SÍ los ve
  });

  it('R1 — la variante de ADMIN muestra la config EFECTIVA: sin fila, el editor ve `[]`, no una tabla fantasma', async () => {
    const { pricing } = wire();
    expect((await pricing.loadGradedEstimateConfigForAdmin()).gradingCostTiers).toEqual([]);
  });
});

/**
 * GU-A8 (§4.38d, v1.44.1) — **`AUSENTE ≠ INVÁLIDA`**. La justificación vieja de la excepción de seed
 * («sin tabla no hay gate») solo valía si AMBAS claves fallaban a la vez: con la tabla VÁLIDA y
 * `grading_min_upside_pct` corrupto, un 200 configurado se volvía el seed 30 — **más permisivo que la
 * intención del admin, en silencio, en la superficie que promociona**.
 *
 * | Estado | `grading_cost_tiers` | umbrales y listas |
 * |---|---|---|
 * | Válida | se usa | se usa |
 * | AUSENTE | `[]` (nada se destaca) | **seed** |
 * | PRESENTE pero INVÁLIDA | `[]` (nada se destaca) | **nada se destaca** (NO cae al seed) |
 */
describe('GU-A8 — AUSENTE ≠ INVÁLIDA: los tres estados de cada clave (§4.38d)', () => {
  /** Valores que EXISTEN en la fila pero violan su invariante (solo llegan por edición fuera de banda). */
  const INVALID = {
    [SettingKey.GRADING_MIN_UPSIDE_PCT]: 'mucho',
    [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]: 0, // fuera de [1,365]
    [SettingKey.GRADED_ESTIMATE_GRADES]: ['11'], // fuera de {"10","9"}
    [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]: ['8', '8'], // inválido + duplicado
  } as const;

  describe('estado AUSENTE ⇒ SEED (deliberado: es el primer deploy, antes de M-41)', () => {
    it('sin ninguna fila de umbrales/listas, la config cae a su seed y TODO sigue vivo', async () => {
      const { pricing } = wire([], { ...SEEDED_TIERS, ...ON });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg).toMatchObject({
        minUpsidePct: 30,
        freshnessDays: 30,
        grades: ['10', '9'],
        highlightGrades: ['10'],
        estimatesEnabled: true, // la ficha informa
        highlightEnabled: true, // …y la vitrina promueve
      });
    });
  });

  describe('estado PRESENTE-pero-INVÁLIDA ⇒ nada se destaca (NO se adivina la intención)', () => {
    it('`minUpsidePct` corrupto NO cae al seed 30: apaga la PROMOCIÓN y deja viva la FICHA', async () => {
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADING_MIN_UPSIDE_PCT]: INVALID[SettingKey.GRADING_MIN_UPSIDE_PCT],
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg.highlightEnabled).toBe(false); // el gate NO corre con un umbral inventado
      expect(cfg.estimatesEnabled).toBe(true); // …pero `minUpsidePct` no participa en la ficha
      expect(cfg.enabled).toBe(true); // el ESPEJO del dial M10 no miente: el dial sigue `on`
    });

    it('`highlightGrades` corrupto apaga la PROMOCIÓN y deja viva la FICHA (no gobierna la ficha)', async () => {
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES]:
          INVALID[SettingKey.GRADED_ESTIMATE_HIGHLIGHT_GRADES],
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg.highlightEnabled).toBe(false);
      expect(cfg.estimatesEnabled).toBe(true);
    });

    it('`freshnessDays` corrupto apaga TAMBIÉN la ficha (sin umbral fiable no se afirma «vigente»)', async () => {
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS]:
          INVALID[SettingKey.GRADED_ESTIMATE_FRESHNESS_DAYS],
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg.estimatesEnabled).toBe(false);
      expect(cfg.highlightEnabled).toBe(false); // invariante: highlight ⇒ estimates
    });

    it('`grades` corrupto apaga TAMBIÉN la ficha (gobierna qué grados expone)', async () => {
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADED_ESTIMATE_GRADES]: INVALID[SettingKey.GRADED_ESTIMATE_GRADES],
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg.estimatesEnabled).toBe(false);
      expect(cfg.highlightEnabled).toBe(false);
    });

    it('el ESCENARIO del hallazgo: tabla VÁLIDA + `minUpsidePct` corrupto ⇒ el gate NO corre con 30', async () => {
      // Antes de GU-A8 esto devolvía `minUpsidePct: 30` con la tabla buena ⇒ el gate corría MÁS
      // permisivo que el 200 que el admin había configurado, y nadie se enteraba.
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADING_MIN_UPSIDE_PCT]: { pct: 200 }, // shape equivocado (restore parcial)
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      expect(cfg.gradingCostTiers).toEqual(DEFAULT_GRADING_COST_TIERS); // la tabla SÍ es válida…
      expect(cfg.highlightEnabled).toBe(false); // …y aun así no se destaca nada
    });
  });

  describe('observabilidad OBLIGATORIA — un apagado silencioso sería tan malo como el default silencioso', () => {
    const warnSpy = () =>
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);

    afterEach(() => jest.restoreAllMocks());

    it('loguea `warn` con LA CLAVE y EL INVARIANTE violado', async () => {
      const warn = warnSpy();
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADING_MIN_UPSIDE_PCT]: 'mucho',
      });
      await pricing.loadGradedEstimateConfig();
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      expect(msgs.some((m) => m.includes(SettingKey.GRADING_MIN_UPSIDE_PCT))).toBe(true);
      expect(msgs.some((m) => m.includes('[0, 1000]'))).toBe(true); // el invariante, no solo «inválida»
    });

    it('una clave AUSENTE no genera ruido (el primer deploy no es una anomalía)', async () => {
      const warn = warnSpy();
      const { pricing } = wire([], { ...SEEDED_TIERS, ...ON }); // umbrales/listas ausentes
      await pricing.loadGradedEstimateConfig();
      expect(warn).not.toHaveBeenCalled();
    });

    /**
     * I8-bis (v1.50.3, §4.38m) — `manualFreshnessDays: null` **no es una clave corrupta**: es una
     * decisión legítima del dueño. Pero **desactiva el criterio 109 para la vía manual** (un estimado
     * tecleado a mano puede quedarse en portada indefinidamente), así que no puede tomarse en silencio.
     * Es la misma doctrina que «la vitrina no puede vaciarse en silencio»: lo que se exige no es
     * prohibirlo, es que sea AUDIBLE.
     */
    it('I8-bis — `manualFreshnessDays: null` emite `warn` (desactiva el criterio 109) SIN apagar nada', async () => {
      const warn = warnSpy();
      const { pricing } = wire([], {
        ...SEEDED_TIERS,
        ...ON,
        [SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS]: null,
      });
      const cfg = await pricing.loadGradedEstimateConfig();
      const msgs = warn.mock.calls.map((c) => String(c[0]));
      expect(msgs.some((m) => m.includes(SettingKey.GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS))).toBe(true);
      expect(msgs.some((m) => m.includes('109'))).toBe(true); // el criterio que se desactiva, por número
      // …y NO apaga ninguna superficie: `null` es válido, solo es ruidoso.
      expect(cfg.estimatesEnabled).toBe(true);
      expect(cfg.highlightEnabled).toBe(true);
      expect(cfg.manualFreshnessDays).toBeNull();
    });

    it('el seed 30 NO genera ruido (solo el `null` explícito lo hace)', async () => {
      const warn = warnSpy();
      const { pricing } = wire([], { ...SEEDED_TIERS, ...ON });
      expect((await pricing.loadGradedEstimateConfig()).manualFreshnessDays).toBe(30);
      expect(warn).not.toHaveBeenCalled();
    });

    it('la tabla de costo PRESENTE pero corrupta también se loguea (aunque su reason sea NO_COST_TIER)', async () => {
      const warn = warnSpy();
      const { pricing } = wire([], { ...ON, [SettingKey.GRADING_COST_TIERS]: 'nope' });
      await pricing.loadGradedEstimateConfig();
      expect(warn.mock.calls.some((c) => String(c[0]).includes(SettingKey.GRADING_COST_TIERS))).toBe(
        true,
      );
    });
  });
});
