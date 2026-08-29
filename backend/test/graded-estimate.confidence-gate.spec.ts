import {
  DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
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
  // M-43: la NATURALEZA no participa de este gate (la ruta del gancho es INCLUSIVA, §4.38l.4.4B).
  // Se fija al default de la columna para que los casos sigan describiendo SOLO la frescura.
  refKind: 'market',
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
    // v1.50.3: el múltiplo se lee del SEED (100× por §O.7), no se reescribe aquí — un literal duplicado
    // convertiría una corrección de dial en un test rojo que nadie sabe si es la regresión o el cambio.
    expect(r.maxAllowedPsa10MxnCents).toBe(RAW_400 * DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE);
  });

  it('el borde es INCLUSIVO: exactamente `raw × maxRawMultiple` pasa; un centavo más, no', () => {
    const enElBorde = RAW_400 * DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE;
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

  /**
   * v1.50.2 (QA, criterio **112c**) — **el bloqueo se evalúa POR GRADO, no contra literales.**
   *
   * El guard de la rejilla comparaba `publishedSlabGrades.includes('10') || includes('9')`: dos valores
   * HARDCODEADOS, acoplados al valor por defecto del dial. Hoy el resultado observable coincide, pero el
   * día que `grades` admita otro grado, un literal que no se actualiza deja de mirarlo y la guarda de
   * LECTURA se abre en silencio sobre una fila que sí es dinero. Ahora los grados vigilados se DERIVAN
   * de las filas que el gate resolvió, así que el conjunto vigilado y el usado no pueden divergir.
   */
  it.each([['10'], ['9']])('un slab publicado de PSA %s basta para NO promover (por grado, sin literales)', (g) => {
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_000,
      estimates: sanos,
      publishedSlabGrades: [g],
      today: TODAY,
      cfg: cfg(),
    });
    expect(r.reason).toBe('SLAB_PUBLISHED');
  });

  it('un slab de un grado que el gate NO usa (PSA 8) no bloquea el destacado', () => {
    // La guarda vigila los grados que ESTE gate consumió, no cualquier slab publicado de la carta.
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_000,
      estimates: sanos,
      publishedSlabGrades: ['8'],
      today: TODAY,
      cfg: cfg(),
    });
    expect(r.eligible).toBe(true);
    expect(r.highlight.map((e) => e.gradeValue)).toEqual(['10']);
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

/**
 * §4.38m — **v1.50.3: la frescura SÍ aplica al override MANUAL.** Este bloque CAMBIÓ DE SIGNO respecto
 * de v1.50.2 y hay que leer por qué antes de "arreglarlo" de vuelta.
 *
 * v1.50.2 dictaminó «`freshnessDays` no se aplica a filas manuales» y sembró
 * `manualFreshnessDays = null`. El **diagnóstico** que lo motivaba era correcto —`isBetterRef` (tier
 * manual ABSOLUTO, §4.27f-2) elige el manual viejo y **después** la ventana de frescura lo descarta ⇒
 * la carta se queda **sin estimado pese a haber dato fresco**, la clase de fallo «gana y luego se
 * tira»—, pero **el remedio era el equivocado**: eximir al manual del decaimiento **derogaba el
 * criterio 109 en silencio**. QA lo demostró en vivo: una fila manual de **40 días** seguía en la ficha
 * y seguía promocionándose; la misma fila marcada como automática salía `STALE`.
 *
 * **Lo que se arregló es el ORDEN, no quién decae** (GU-A16): `getGradedEstimatesBatch` filtra lo
 * rancio **ANTES** de `pickBestRef`. Este archivo prueba el PREDICADO; los tres casos de la
 * interacción manual ⇄ automática viven en `graded-estimate.batch.spec.ts`, que es donde vive el orden.
 */
describe('§4.38m — la frescura SÍ aplica al override MANUAL (v1.50.3, GU-A16)', () => {
  const HACE_200_DIAS = '2026-02-09';
  const HACE_40_DIAS = '2026-07-19'; // el caso EXACTO que QA reprodujo a mano

  it('un override manual de hace 200 días SÍ es rancio con el seed (`manualFreshnessDays: 30`)', () => {
    const manualViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: true });
    expect(isStaleRef(manualViejo, TODAY, cfg())).toBe(true);
  });

  it('el caso de QA: manual de 40 días ⇒ RANCIO, y desaparece de la ficha (criterio 109)', () => {
    const manual40 = [
      est('10', 900_000, { capturedDate: HACE_40_DIAS, isManual: true }),
      est('9', 500_000, { capturedDate: HACE_40_DIAS, isManual: true }),
    ];
    // §O.4: «mejor callar que presumir un número viejo en una promesa comercial».
    expect(selectGradedEstimates({ productType: 'raw', estimates: manual40, today: TODAY, cfg: cfg() })).toEqual([]);
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_000,
      estimates: manual40,
      today: TODAY,
      cfg: cfg(),
    });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('STALE');
  });

  it('el manual conserva su VENTANA PROPIA: 40 días es rancio a 30, fresco a 60', () => {
    const manual40 = est('10', 900_000, { capturedDate: HACE_40_DIAS, isManual: true });
    // El dial sigue existiendo y sigue siendo asimétrico: lo que cambió es su DEFAULT, no el mecanismo.
    expect(isStaleRef(manual40, TODAY, cfg({ manualFreshnessDays: 30 }))).toBe(true);
    expect(isStaleRef(manual40, TODAY, cfg({ manualFreshnessDays: 60 }))).toBe(false);
    // …y sigue siendo INDEPENDIENTE del de feed: subir el del feed no rescata al manual.
    expect(isStaleRef(manual40, TODAY, cfg({ freshnessDays: 365, manualFreshnessDays: 30 }))).toBe(true);
  });

  it('`null` sigue siendo EXPRESABLE («no decae»), pero ya no es el default', () => {
    const manualViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: true });
    // Es una decisión legítima del dueño — que desactiva el criterio 109 para la vía manual, y por eso
    // el resolver emite `warn` al izarla (I8-bis; se prueba en `graded-estimate.batch.spec.ts`).
    expect(isStaleRef(manualViejo, TODAY, cfg({ manualFreshnessDays: null }))).toBe(false);
  });

  it('una fila AUTOMÁTICA de 200 días también es rancia (la regla no se invirtió, se ALINEÓ)', () => {
    const autoViejo = est('10', 900_000, { capturedDate: HACE_200_DIAS, isManual: false });
    expect(isStaleRef(autoViejo, TODAY, cfg())).toBe(true);
  });
});

/**
 * v1.50.3-c (§4.38n.2-bis, GU-A24) — **`isManual` en el diagnóstico: los dos sabores de `STALE`.**
 *
 * Nace del `?reason=STALE` de la lista de revisión. Una fila rancia **manual** es *la afirmación del
 * dueño que expiró* ⇒ **recapturar o borrar**; una **automática** es *el feed que dejó de cubrir esa
 * carta* ⇒ **mirar el ingest, no la carta**. Remedios **opuestos**, y `reason: STALE` a secas no los
 * distingue: sin este campo cada fila obligaría a una segunda llamada, la fricción que la lista existe
 * para eliminar.
 *
 * **Invariante que estas pruebas fijan:** `isManual` y `capturedDate` describen **LA MISMA fila** (la
 * más antigua de las presentes, que es la que decide la frescura). Una fecha de una fila y un remedio
 * de otra sería peor que no dar el remedio.
 */
describe('§4.38n.2-bis — `isManual` acompaña a `capturedDate` (misma fila)', () => {
  const VIEJO = '2026-02-09'; // 200 días
  const AYER = '2026-08-27';

  it('con una sola fila, `isManual` es el origen de esa fila', () => {
    for (const manual of [true, false]) {
      const r = evaluateGradingHighlight({
        ...base,
        estimates: [est('10', 900_000, { capturedDate: VIEJO, isManual: manual })],
        cfg: cfg(),
      });
      expect(r.reason).toBe('NO_PSA9'); // sin PSA 9 no se llega a STALE; el campo se emite igual
      expect(r.capturedDate).toBe(VIEJO);
      expect(r.isManual).toBe(manual);
    }
  });

  it('con dos grados, manda la MÁS ANTIGUA — la misma que reporta `capturedDate`', () => {
    // PSA 10 fresco automático + PSA 9 viejo MANUAL ⇒ la que decide la frescura (y el remedio) es el
    // PSA 9 manual. Reportar `isManual:false` aquí mandaría al operador a mirar el ingest por una
    // cifra que puso él.
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [
        est('10', 900_000, { capturedDate: AYER, isManual: false }),
        est('9', 500_000, { capturedDate: VIEJO, isManual: true }),
      ],
      cfg: cfg(),
    });
    expect(r.reason).toBe('STALE');
    expect(r.capturedDate).toBe(VIEJO);
    expect(r.isManual).toBe(true);
  });

  it('y al revés: PSA 9 fresco manual + PSA 10 viejo automático ⇒ `isManual:false` (mirar el ingest)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [
        est('10', 900_000, { capturedDate: VIEJO, isManual: false }),
        est('9', 500_000, { capturedDate: AYER, isManual: true }),
      ],
      cfg: cfg(),
    });
    expect(r.reason).toBe('STALE');
    expect(r.capturedDate).toBe(VIEJO);
    expect(r.isManual).toBe(false);
  });

  it('empate de fechas ⇒ manda PSA 10 (determinista y estable, no «la que salga»)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [
        est('10', 900_000, { capturedDate: VIEJO, isManual: true }),
        est('9', 500_000, { capturedDate: VIEJO, isManual: false }),
      ],
      cfg: cfg(),
    });
    expect(r.isManual).toBe(true);
  });

  it('sin ninguna fila ⇒ `isManual:false` con `capturedDate:null` — el dato que manda es la fecha', () => {
    // `false` significa «no lo puso una persona», NO «lo puso el ingest»: para eso hace falta que exista
    // fila, y eso lo dice `capturedDate`. El contrato declara `isManual: boolean`, no anulable.
    const r = evaluateGradingHighlight({ ...base, estimates: [], cfg: cfg() });
    expect(r.reason).toBe('NO_PSA10');
    expect(r.capturedDate).toBeNull();
    expect(r.isManual).toBe(false);
  });

  it('se emite también cuando la carta SÍ es elegible (es diagnóstico, no un flag de error)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [
        est('10', 900_000, { isManual: true }),
        est('9', 500_000, { isManual: true }),
      ],
      cfg: cfg(),
    });
    expect(r.eligible).toBe(true);
    expect(r.isManual).toBe(true);
  });
});
