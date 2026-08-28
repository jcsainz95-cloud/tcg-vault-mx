import {
  DEFAULT_GRADING_COST_TIERS,
  DISABLED_GRADED_ESTIMATE_CONFIG,
  GradedEstimateConfig,
  GradedEstimateInput,
  evaluateGradingHighlight,
  isStaleRef,
  selectGradedEstimates,
} from '../src/common/graded-estimate';

/**
 * v1.50.2 — **GATE DE CONFIANZA** (ARCHITECTURE §4.38k) + **INV-D** (§4.38l) + la **asimetría de
 * frescura** (§4.38m). Es el pase que permitió publicar la cifra en la REJILLA.
 *
 * La decisión del humano fue: *sí quiero la cifra en la rejilla, **condicionada a que el número sea
 * confiable***. La rejilla es promoción MASIVA: ahí un número malo no es un dato feo, es una
 * **afirmación comercial falsa multiplicada por N filas**. La ficha es informativa y su contrato con
 * el lector es otro: muestra lo que hay, con su disclaimer.
 *
 * ### Por qué hay UNA PRUEBA POR COTA y no una sola de «magnitud»
 * §4.38k.2 lo pide explícitamente: las tres cotas **no son redundantes**, cada una ataja un error
 * distinto, y con una prueba conjunta **relajar una cota podría no romper ninguna prueba**. Con una
 * prueba por cota, quitar una rompe la suya y el que la quite tiene que leer por qué existe.
 */

const TODAY = '2026-08-28';

function cfg(over: Partial<GradedEstimateConfig> = {}): GradedEstimateConfig {
  return {
    ...DISABLED_GRADED_ESTIMATE_CONFIG,
    enabled: true,
    estimatesEnabled: true,
    highlightEnabled: true,
    grades: ['10', '9'],
    highlightGrades: ['10'],
    freshnessDays: 30,
    minUpsidePct: 30,
    gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
    ...over,
  };
}

const est = (
  gradeValue: string,
  mxnCents: number,
  over: Partial<GradedEstimateInput> = {},
): GradedEstimateInput => ({
  gradeValue,
  mxnCents,
  capturedDate: TODAY,
  isManual: false,
  ...over,
});

/** Raw publicado a MX$400.00 — el mismo caso del ejemplo del arquitecto. */
const RAW_400 = 40_000;
const base = { productType: 'raw' as const, rawSalePriceCents: RAW_400, today: TODAY };

describe('§4.38k.2 — COTA INFERIOR `psa10 > salePriceCents`: caza el ERROR DE UNIDADES', () => {
  /**
   * **La dirección del error es lo contraintuitivo, y por eso esta prueba existe.** Uno espera que un
   * error de moneda INFLE el número; pero USD→MXN mal aplicado lo **DEPRIME** ~19×. Un PSA 10 de
   * **USD 60** guardado como **MX$60** queda muy por DEBAJO del raw de MX$400 ⇒ **el múltiplo máximo
   * no lo ve**. Solo la cota inferior lo caza.
   */
  it('el caso USD-COMO-MXN: PSA 10 de USD 60 escrito como MX$60 contra un raw de MX$400 ⇒ NOT_ABOVE_RAW', () => {
    const usdComoMxn = 6_000; // 60.00 «pesos» que en realidad eran 60 dólares (≈ MX$1,140)
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', usdComoMxn), est('9', 5_000)],
      cfg: cfg(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('NOT_ABOVE_RAW');
    // Y la razón por la que la cota SUPERIOR no sirve para esto: el múltiplo es 0.15, no 475.
    expect(usdComoMxn).toBeLessThan(RAW_400 * cfg().maxRawMultiple);
  });

  it('empate `psa10 === salePriceCents` TAMBIÉN se descarta (la comparación es ESTRICTA)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', RAW_400), est('9', RAW_400)],
      cfg: cfg(),
    });
    expect(r.reason).toBe('NOT_ABOVE_RAW');
  });

  it('un céntimo por encima ya pasa la cota inferior (falla más adelante, no aquí)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', RAW_400 + 1), est('9', RAW_400 + 1)],
      cfg: cfg(),
    });
    expect(r.reason).not.toBe('NOT_ABOVE_RAW');
  });
});

describe('§4.38k.2 — COTA SUPERIOR `psa10 <= salePriceCents × maxRawMultiple`: caza el CERO DE MÁS', () => {
  it('MX$19,000 tecleado como MX$190,000 sobre un raw de MX$400 (múltiplo 475) ⇒ ABOVE_MAX_MULTIPLE', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 19_000_000), est('9', 100_000)],
      cfg: cfg(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('ABOVE_MAX_MULTIPLE');
    // El operador ve CONTRA QUÉ se comparó (§M2: `maxAllowedPsa10MxnCents` viaja al preview de admin).
    expect(r.maxAllowedPsa10MxnCents).toBe(RAW_400 * 50);
  });

  it('el borde es INCLUSIVO: exactamente `raw × maxRawMultiple` pasa; un centavo más, no', () => {
    const enElBorde = RAW_400 * 50;
    expect(
      evaluateGradingHighlight({ ...base, estimates: [est('10', enElBorde), est('9', enElBorde)], cfg: cfg() })
        .reason,
    ).not.toBe('ABOVE_MAX_MULTIPLE');
    expect(
      evaluateGradingHighlight({
        ...base,
        estimates: [est('10', enElBorde + 1), est('9', enElBorde)],
        cfg: cfg(),
      }).reason,
    ).toBe('ABOVE_MAX_MULTIPLE');
  });

  it('es un DIAL: subir `maxRawMultiple` deja pasar el mismo caso (la política es del dueño)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 19_000_000), est('9', 100_000)],
      cfg: cfg({ maxRawMultiple: 1000 }),
    });
    expect(r.reason).not.toBe('ABOVE_MAX_MULTIPLE');
  });
});

describe('§4.38k.2 — COTA DE ORDEN `psa10 >= psa9`: caza el GRADO INTERCAMBIADO', () => {
  it('un PSA 10 por DEBAJO de su PSA 9 es incoherente por construcción ⇒ GRADE_ORDER_INVERTED', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 100_000), est('9', 150_000)], // capturados cruzados
      cfg: cfg(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('GRADE_ORDER_INVERTED');
  });

  it('el EMPATE `psa10 === psa9` es válido (raro, pero no incoherente)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 150_000), est('9', 150_000)],
      cfg: cfg(),
    });
    expect(r.reason).not.toBe('GRADE_ORDER_INVERTED');
  });
});

describe('§4.38k.2 — las tres cotas son COMPLEMENTARIAS (ninguna cubre a las otras)', () => {
  /**
   * El candado contra «esta cota sobra»: para cada una hay un caso que **solo ella** rechaza. Si
   * alguien elimina una, este test señala exactamente qué error real vuelve a pasar.
   */
  it.each([
    ['NOT_ABOVE_RAW (unidades)', 6_000, 5_000, 'NOT_ABOVE_RAW'],
    ['ABOVE_MAX_MULTIPLE (cero de más)', 19_000_000, 100_000, 'ABOVE_MAX_MULTIPLE'],
    ['GRADE_ORDER_INVERTED (grados cruzados)', 100_000, 150_000, 'GRADE_ORDER_INVERTED'],
  ])('%s se rechaza, y NINGUNA otra cota lo habría atajado', (_n, psa10, psa9, reason) => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', psa10 as number), est('9', psa9 as number)],
      cfg: cfg(),
    });
    expect(r.reason).toBe(reason);
  });
});

describe('§4.38k.3 — la FICHA no aplica la cota de magnitud (INFORMAR ≠ PROMOVER)', () => {
  /**
   * Si el dueño fijó a mano un estimado raro, la ficha debe **mostrárselo**: es su dato, con su
   * disclaimer, y ocultarlo le impediría **darse cuenta del error**. Suprimirlo también ahí
   * convertiría un dato visible-y-corregible en una **desaparición silenciosa**.
   */
  it.each([
    ['USD como MXN (por debajo del raw)', 6_000, 5_000],
    ['un cero de más', 19_000_000, 100_000],
    ['grados cruzados', 100_000, 150_000],
  ])('%s: la ficha SIGUE informando las dos cifras aunque la rejilla no promueva', (_n, psa10, psa9) => {
    const estimates = [est('10', psa10 as number), est('9', psa9 as number)];
    const ficha = selectGradedEstimates({ productType: 'raw', estimates, today: TODAY, cfg: cfg() });
    expect(ficha.map((e) => e.gradeValue)).toEqual(['10', '9']);
    expect(evaluateGradingHighlight({ ...base, estimates, cfg: cfg() }).eligible).toBe(false);
  });
});

describe('§4.38l — INV-D: con SLAB PUBLICADO esa fila es DINERO, no un estimado', () => {
  const sanos = [est('10', 900_000), est('9', 500_000)];

  it('la REJILLA no promueve: `SLAB_PUBLISHED`', () => {
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_000,
      estimates: sanos,
      publishedSlabGrades: ['10'],
      today: TODAY,
      cfg: cfg(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('SLAB_PUBLISHED');
  });

  it('la FICHA omite SOLO ese grado — los grados son independientes, no se apaga la carta entera', () => {
    const ficha = selectGradedEstimates({
      productType: 'raw',
      estimates: sanos,
      publishedSlabGrades: ['10'],
      today: TODAY,
      cfg: cfg(),
    });
    expect(ficha.map((e) => e.gradeValue)).toEqual(['9']);
  });

  /**
   * Es la mitad que la guarda de ESCRITURA (`409`) no puede cubrir: las filas escritas ANTES de que
   * la regla existiera ya están en la tabla, y solo la lectura las neutraliza.
   */
  it('neutraliza también las filas escritas ANTES de la regla (por eso la guarda de lectura es necesaria)', () => {
    const ficha = selectGradedEstimates({
      productType: 'raw',
      estimates: sanos,
      publishedSlabGrades: ['10', '9'],
      today: TODAY,
      cfg: cfg(),
    });
    expect(ficha).toEqual([]);
  });
});

describe('§4.38m — la frescura NO se aplica a un override MANUAL', () => {
  const HACE_200_DIAS = '2026-02-09';

  /**
   * El fallo silencioso que esto cierra: `isBetterRef` elige el manual (tier ABSOLUTO, §4.27f-2) y
   * **después** la ventana de frescura lo descarta ⇒ la carta se queda **sin estimado PESE A HABER
   * dato fresco disponible**. La clase entera de fallo es «gana y luego se tira».
   *
   * Se arregla AQUÍ y no en `isBetterRef` a propósito: tocar el comparador habría **degradado una
   * invariante de DINERO** (ninguna escritura automática pisa un precio humano) para resolver un
   * problema de **presentación**.
   */
  it('un override manual de hace 200 días NO es rancio con el seed (`manualFreshnessDays: null`)', () => {
    const manualViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: true });
    expect(isStaleRef(manualViejo, TODAY, cfg())).toBe(false);
  });

  it('la MISMA fila, si fuera AUTOMÁTICA, sí sería rancia (la asimetría es real, no un no-op)', () => {
    const autoViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: false });
    expect(isStaleRef(autoViejo, TODAY, cfg())).toBe(true);
  });

  it('regresión (m): override manual VIEJO + automático fresco ⇒ se MUESTRA el manual', () => {
    // `getGradedEstimatesBatch` ya resolvió la precedencia DENTRO de la tabla y entregó el MANUAL
    // (tier absoluto). Lo que se prueba aquí es que la capa de frescura no lo tire después.
    const ganador = [
      est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: true }),
      est('9', 500_000, { capturedDate: HACE_200_DIAS, isManual: true }),
    ];
    const ficha = selectGradedEstimates({ productType: 'raw', estimates: ganador, today: TODAY, cfg: cfg() });
    expect(ficha.map((e) => e.mxnCents)).toEqual([900_000, 500_000]);
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_000,
      estimates: ganador,
      today: TODAY,
      cfg: cfg(),
    });
    expect(r.eligible).toBe(true);
  });

  it('`manualFreshnessDays` es la VÁLVULA: fijado, el manual también decae (sin cambio de contrato)', () => {
    const manualViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: true });
    expect(isStaleRef(manualViejo, TODAY, cfg({ manualFreshnessDays: 30 }))).toBe(true);
    expect(isStaleRef(manualViejo, TODAY, cfg({ manualFreshnessDays: 3650 }))).toBe(false);
  });
});
