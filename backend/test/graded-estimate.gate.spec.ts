import {
  DEFAULT_GRADING_COST_TIERS,
  GradedEstimateConfig,
  GradedEstimateInput,
  GradingCostTier,
  businessDateCdmx,
  evaluateGradingHighlight,
  findGradingCostTier,
  isStaleEstimate,
  selectGradedEstimates,
  validateGradingCostTiers,
  DISABLED_GRADED_ESTIMATE_CONFIG,
} from '../src/common/graded-estimate';

/**
 * v1.44-graded-estimate — LÓGICA PURA del «gancho de grading» (ARCHITECTURE §4.38c/d, PROJECT §N).
 *
 * Cubre los flujos negativos que §4.38i marca como OBLIGATORIOS: sin PSA 9 ⇒ ficha sí / destacado no;
 * sin ningún estimado; graded y sealed NUNCA; tabla vacía o con hueco ⇒ **jamás costo 0**; estimado
 * rancio; y la partición §4.38-0 (subir `minUpsidePct` no apaga la ficha).
 */

const TODAY = '2026-08-23';

/**
 * Config sana. **v1.44.1 (GU-A8):** los tres interruptores son independientes en el TIPO —
 * `enabled` (espejo del dial M10), `estimatesEnabled` (ficha) y `highlightEnabled` (teja/vitrina)— con
 * el invariante `highlightEnabled ⇒ estimatesEnabled ⇒ enabled`. `cfg({enabled:false})` respeta ese
 * invariante y apaga los tres, para que un test no pueda construir un estado imposible por descuido.
 */
function cfg(over: Partial<GradedEstimateConfig> = {}): GradedEstimateConfig {
  const enabled = over.enabled ?? true;
  return {
    // v1.50.2: se parte de la config APAGADA compartida y se ENCIENDE lo que el test necesita, para
    // que un dial nuevo no obligue a tocar cada helper de test (ni deje uno con un default distinto
    // al de producción, que es como se cuelan los falsos verdes).
    ...DISABLED_GRADED_ESTIMATE_CONFIG,
    enabled,
    estimatesEnabled: enabled,
    highlightEnabled: enabled,
    ingestEnabled: false,
    grades: ['10', '9'],
    highlightGrades: ['10'],
    freshnessDays: 30,
    minUpsidePct: 30,
    gradingCostTiers: DEFAULT_GRADING_COST_TIERS,
    ...over,
  };
}

/**
 * v1.50.2: `isManual` es AUTOMÁTICO por defecto en los helpers (`false`) porque es el caso que ejerce
 * la ventana de frescura. El manual se pide EXPLÍCITAMENTE (`estManual`), para que ningún test se
 * apoye por accidente en la excepción de §4.38m.
 */
const est = (
  gradeValue: string,
  mxnCents: number,
  capturedDate = TODAY,
  isManual = false,
): GradedEstimateInput => ({
  gradeValue,
  mxnCents,
  capturedDate,
  isManual,
});

// El helper `estManual` (fila fijada a mano) vive en `graded-estimate.confidence-gate.spec.ts`, que es
// donde se prueba la asimetría de frescura de §4.38m. Aquí todas las filas son AUTOMÁTICAS a propósito:
// son las que ejercen la ventana de frescura.

describe('findGradingCostTier — intervalos SEMIABIERTOS [min, max)', () => {
  it('resuelve cada escalón del seed y NO deja huecos en los centavos intermedios', () => {
    // El defecto que el arquitecto detectó en «hasta $2,000 / de $2,001 en adelante»: $2,000.50.
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 200_050)?.costMxnCents).toBe(110_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 0)?.costMxnCents).toBe(70_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 1)?.costMxnCents).toBe(70_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 499_999)?.costMxnCents).toBe(110_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 999_999)?.costMxnCents).toBe(180_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 1_999_999)?.costMxnCents).toBe(300_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 4_999_999)?.costMxnCents).toBe(600_000);
  });

  it('BORDE: el límite superior pertenece al escalón SIGUIENTE (más caro = conservador)', () => {
    // `[min, max)`: exactamente $2,000.00 cae en el escalón de arriba. Desviación de 1 centavo en la
    // dirección que ENCARECE el gate («mejor sobreestimar el costo que prometer de más»).
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 199_999)?.costMxnCents).toBe(70_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 200_000)?.costMxnCents).toBe(110_000);
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 5_000_000)?.costMxnCents).toBe(1_200_000);
  });

  it('el ÚLTIMO escalón es ABIERTO: cubre cualquier valor por arriba', () => {
    expect(findGradingCostTier(DEFAULT_GRADING_COST_TIERS, 99_999_999)?.costMxnCents).toBe(1_200_000);
  });

  it('MONEY-SAFE: tabla vacía / con hueco / desordenada / que no arranca en 0 ⇒ null (jamás costo 0)', () => {
    const hueco: GradingCostTier[] = [
      { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
      // salta de 200000 a 300000: los centavos intermedios quedarían SIN escalón.
      { minValueMxnCents: 300_000, maxValueMxnCents: null, costMxnCents: 110_000 },
    ];
    const desordenada: GradingCostTier[] = [
      { minValueMxnCents: 0, maxValueMxnCents: 500_000, costMxnCents: 70_000 },
      { minValueMxnCents: 200_000, maxValueMxnCents: null, costMxnCents: 110_000 },
    ];
    const sinCero: GradingCostTier[] = [
      { minValueMxnCents: 100, maxValueMxnCents: null, costMxnCents: 70_000 },
    ];
    const costoCero: GradingCostTier[] = [
      { minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 0 },
    ];
    expect(findGradingCostTier([], 100_000)).toBeNull();
    // Un valor DENTRO del primer escalón de una tabla con hueco tampoco resuelve: la tabla entera es
    // inválida ⇒ nada se destaca (no se «rescata» la parte sana).
    expect(findGradingCostTier(hueco, 100_000)).toBeNull();
    expect(findGradingCostTier(hueco, 250_000)).toBeNull();
    expect(findGradingCostTier(desordenada, 100_000)).toBeNull();
    expect(findGradingCostTier(sinCero, 50)).toBeNull();
    expect(findGradingCostTier(costoCero, 100_000)).toBeNull();
  });
});

describe('validateGradingCostTiers — invariantes I1–I5 con código de contrato', () => {
  it('el SEED es válido', () => {
    expect(validateGradingCostTiers(DEFAULT_GRADING_COST_TIERS)).toBeNull();
  });

  it('I1 — array vacío ⇒ GRADING_TIERS_EMPTY', () => {
    expect(validateGradingCostTiers([])?.code).toBe('GRADING_TIERS_EMPTY');
  });

  it('I2 — costMxnCents 0 / negativo / no entero / absurdo ⇒ VALIDATION_ERROR (nunca 0)', () => {
    const one = (cost: unknown) => [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: cost }];
    expect(validateGradingCostTiers(one(0))?.code).toBe('VALIDATION_ERROR');
    expect(validateGradingCostTiers(one(-1))?.code).toBe('VALIDATION_ERROR');
    expect(validateGradingCostTiers(one(70_000.5))?.code).toBe('VALIDATION_ERROR');
    expect(validateGradingCostTiers(one(10_000_001))?.code).toBe('VALIDATION_ERROR'); // anti-typo
    expect(validateGradingCostTiers(one(1))).toBeNull(); // >= 1 es el mínimo legal
  });

  it('I2 — max <= min en una fila ⇒ VALIDATION_ERROR', () => {
    expect(
      validateGradingCostTiers([
        { minValueMxnCents: 0, maxValueMxnCents: 0, costMxnCents: 70_000 },
        { minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70_000 },
      ])?.code,
    ).toBe('VALIDATION_ERROR');
  });

  it('I3 — no arranca en 0 o va desordenada ⇒ GRADING_TIERS_NOT_CONTIGUOUS', () => {
    expect(
      validateGradingCostTiers([{ minValueMxnCents: 1, maxValueMxnCents: null, costMxnCents: 70_000 }])?.code,
    ).toBe('GRADING_TIERS_NOT_CONTIGUOUS');
    expect(
      validateGradingCostTiers([
        { minValueMxnCents: 0, maxValueMxnCents: 500_000, costMxnCents: 70_000 },
        { minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 110_000 },
      ])?.code,
    ).toBe('GRADING_TIERS_NOT_CONTIGUOUS');
  });

  it('I4 — hueco o solape ⇒ GRADING_TIERS_NOT_CONTIGUOUS con los pares (i, i+1) infractores', () => {
    const hueco = validateGradingCostTiers([
      { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
      { minValueMxnCents: 300_000, maxValueMxnCents: null, costMxnCents: 110_000 },
    ]);
    expect(hueco?.code).toBe('GRADING_TIERS_NOT_CONTIGUOUS');
    expect(hueco?.details.offending).toEqual([{ i: 0, next: 1 }]);
    const solape = validateGradingCostTiers([
      { minValueMxnCents: 0, maxValueMxnCents: 400_000, costMxnCents: 70_000 },
      { minValueMxnCents: 300_000, maxValueMxnCents: null, costMxnCents: 110_000 },
    ]);
    expect(solape?.code).toBe('GRADING_TIERS_NOT_CONTIGUOUS');
  });

  it('I5 — último escalón NO abierto, o un `null` en medio ⇒ GRADING_TIERS_NOT_OPEN_ENDED', () => {
    expect(
      validateGradingCostTiers([{ minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 }])?.code,
    ).toBe('GRADING_TIERS_NOT_OPEN_ENDED');
    expect(
      validateGradingCostTiers([
        { minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70_000 },
        { minValueMxnCents: 200_000, maxValueMxnCents: null, costMxnCents: 110_000 },
      ])?.code,
    ).toBe('GRADING_TIERS_NOT_CONTIGUOUS'); // el `null` en medio rompe antes la contigüidad
  });
});

describe('isStaleEstimate — frescura date-only', () => {
  it('dentro de la ventana = fresco; fuera = rancio; el borde EXACTO sigue fresco', () => {
    expect(isStaleEstimate('2026-08-23', TODAY, 30)).toBe(false);
    expect(isStaleEstimate('2026-07-24', TODAY, 30)).toBe(false); // exactamente 30 días
    expect(isStaleEstimate('2026-07-23', TODAY, 30)).toBe(true); // 31 días
  });

  it('un capturedDate FUTURO (reloj torcido) NO es rancio; una fecha malformada SÍ (fail-closed)', () => {
    expect(isStaleEstimate('2026-12-31', TODAY, 30)).toBe(false);
    expect(isStaleEstimate('no-es-fecha', TODAY, 30)).toBe(true);
    expect(isStaleEstimate('', TODAY, 30)).toBe(true);
  });
});

describe('businessDateCdmx — fecha de NEGOCIO date-only', () => {
  it('devuelve YYYY-MM-DD en el huso de CDMX (no el del contenedor)', () => {
    // 2026-08-24T04:00:00Z = 2026-08-23 22:00 en CDMX ⇒ la fecha de NEGOCIO sigue siendo el 23.
    expect(businessDateCdmx(new Date('2026-08-24T04:00:00Z'))).toBe('2026-08-23');
    expect(businessDateCdmx(new Date('2026-08-24T12:00:00Z'))).toBe('2026-08-24');
  });
});

describe('selectGradedEstimates — FICHA (SIN gate de ROI)', () => {
  it('emite PSA 10 y PSA 9 en orden DESCENDENTE', () => {
    const out = selectGradedEstimates({
      productType: 'raw',
      estimates: [est('9', 300_000), est('10', 900_000)],
      today: TODAY,
      cfg: cfg(),
    });
    expect(out.map((e) => e.gradeValue)).toEqual(['10', '9']);
  });

  it('los grados son INDEPENDIENTES: con PSA 10 y sin PSA 9 emite UN elemento', () => {
    const out = selectGradedEstimates({
      productType: 'raw',
      estimates: [est('10', 900_000)],
      today: TODAY,
      cfg: cfg(),
    });
    expect(out.map((e) => e.gradeValue)).toEqual(['10']);
  });

  it('omite el grado con dato <= 0, rancio o ausente (nunca lo emite en 0)', () => {
    const out = selectGradedEstimates({
      productType: 'raw',
      estimates: [est('10', 0), est('9', 300_000, '2026-01-01')],
      today: TODAY,
      cfg: cfg(),
    });
    expect(out).toEqual([]); // ⇒ el caller OMITE el campo (jamás emite []).
  });

  it('dial APAGADO ⇒ [] aunque haya dato fresco (fail-closed)', () => {
    expect(
      selectGradedEstimates({
        productType: 'raw',
        estimates: [est('10', 900_000), est('9', 300_000)],
        today: TODAY,
        cfg: cfg({ enabled: false }),
      }),
    ).toEqual([]);
  });

  it('criterio 105 — una GRADEADA y un SELLADO nunca traen estimados', () => {
    for (const productType of ['graded', 'sealed'] as const) {
      expect(
        selectGradedEstimates({
          productType,
          estimates: [est('10', 900_000), est('9', 300_000)],
          today: TODAY,
          cfg: cfg(),
        }),
      ).toEqual([]);
    }
  });

  it('solo emite los grados que el dial `grades` expone', () => {
    const out = selectGradedEstimates({
      productType: 'raw',
      estimates: [est('10', 900_000), est('9', 300_000)],
      today: TODAY,
      cfg: cfg({ grades: ['10'] }),
    });
    expect(out.map((e) => e.gradeValue)).toEqual(['10']);
  });
});

describe('evaluateGradingHighlight — TEJA/VITRINA (CON gate de ROI sobre PSA 9)', () => {
  // Carta raw a MX$1,000 con PSA 10 = MX$9,000 (escalón 3: [500k,1M) ⇒ costo MX$1,800).
  const base = {
    productType: 'raw' as const,
    rawSalePriceCents: 100_000,
    today: TODAY,
  };

  it('camino feliz: PSA 9 por encima del umbral ⇒ elegible, con el badge de `highlightGrades`', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 900_000), est('9', 500_000)],
      cfg: cfg(),
    });
    // umbral = ceil((100000 + 180000) × 1.30) = 364000 ; 500000 >= 364000 ⇒ elegible.
    expect(r.eligible).toBe(true);
    expect(r.reason).toBeUndefined();
    expect(r.gradingCostMxnCents).toBe(180_000);
    expect(r.thresholdMxnCents).toBe(364_000);
    expect(r.netUpsidePsa9MxnCents).toBe(500_000 - 280_000); // = 220000 (> 0 garantizado)
    expect(r.highlight.map((e) => e.gradeValue)).toEqual(['10']); // el badge pinta PSA 10…
    // …pero el GATE se evaluó con PSA 9 aunque PSA 9 no se pinte.
  });

  it('BORDE del umbral: `psa9 === umbral` ⇒ elegible; un centavo menos ⇒ BELOW_MIN_UPSIDE', () => {
    const at = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 900_000), est('9', 364_000)],
      cfg: cfg(),
    });
    expect(at.eligible).toBe(true);
    const below = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 900_000), est('9', 363_999)],
      cfg: cfg(),
    });
    expect(below.eligible).toBe(false);
    expect(below.reason).toBe('BELOW_MIN_UPSIDE');
    expect(below.highlight).toEqual([]);
  });

  it('el umbral redondea con ceil (dirección que hace el gate MÁS estricto)', () => {
    // (100001 + 110000) × 1.30 = 273001.3 ⇒ ceil = 273002 (no 273001).
    //
    // ⚠️ v1.50.2 — el PSA 10 de este fixture SUBIÓ de 150_000 a 400_000, y no es un ajuste cosmético:
    // con 150_000 el PSA 9 (273_001) quedaba POR ENCIMA del PSA 10, que es justo lo que la cota de
    // ORDEN (§4.38k.2) declara incoherente ⇒ el gate cortaba en `GRADE_ORDER_INVERTED` y nunca llegaba
    // a calcular el umbral. El fixture viejo describía un mundo imposible; el nuevo mantiene EXACTA la
    // afirmación del test (el `ceil` del umbral) sobre un caso coherente.
    const r = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 100_001,
      today: TODAY,
      estimates: [est('10', 400_000), est('9', 273_001)],
      cfg: cfg(),
    });
    expect(r.thresholdMxnCents).toBe(273_002);
    expect(r.eligible).toBe(false);
  });

  it('MENOR-1 — umbral EXACTAMENTE entero: `psa9 === umbral` pasa (aritmética entera, sin deriva de flotante)', () => {
    // `costBase = 30000 + 70000 = 100000`; con `minUpsidePct = 10` el umbral EXACTO es 110000.
    // `100000 × (1 + 10/100)` da 110000.00000000001 en IEEE-754 ⇒ `ceil` = 110001 ⇒ la carta que
    // IGUALA el umbral quedaba fuera, contra el «si y solo si >=» del criterio 97.
    const tiers: GradingCostTier[] = [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70_000 }];
    const at = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 30_000,
      today: TODAY,
      estimates: [est('10', 900_000), est('9', 110_000)],
      cfg: cfg({ minUpsidePct: 10, gradingCostTiers: tiers }),
    });
    expect(at.thresholdMxnCents).toBe(110_000); // ni 110001
    expect(at.eligible).toBe(true);

    // …y un centavo por debajo sigue siendo BELOW_MIN_UPSIDE (el borde no se aflojó).
    const below = evaluateGradingHighlight({
      productType: 'raw',
      rawSalePriceCents: 30_000,
      today: TODAY,
      estimates: [est('10', 900_000), est('9', 109_999)],
      cfg: cfg({ minUpsidePct: 10, gradingCostTiers: tiers }),
    });
    expect(below.eligible).toBe(false);
    expect(below.reason).toBe('BELOW_MIN_UPSIDE');
  });

  it('MENOR-1 — `eligible` y `thresholdMxnCents` NUNCA se contradicen (barrido de pct enteros)', () => {
    const tiers: GradingCostTier[] = [{ minValueMxnCents: 0, maxValueMxnCents: null, costMxnCents: 70_000 }];
    for (const pct of [0, 1, 5, 7, 10, 13, 30, 33, 100, 333, 1000]) {
      for (const raw of [30_000, 100_001, 123_457]) {
        const costBase = raw + 70_000;
        const exacto = Math.ceil((costBase * (100 + pct)) / 100);
        for (const psa9 of [exacto - 1, exacto, exacto + 1]) {
          const r = evaluateGradingHighlight({
            productType: 'raw',
            rawSalePriceCents: raw,
            today: TODAY,
            // v1.50.2: el PSA 10 acompaña al PSA 9 hacia arriba. Con `pct` alto el umbral supera el
            // 900_000 fijo del fixture viejo y el gate cortaba en `GRADE_ORDER_INVERTED` antes de
            // evaluar el umbral — que es lo que este barrido mide. El escalón es único y abierto, así
            // que mover el PSA 10 NO cambia el costo ni, por tanto, el umbral esperado.
            estimates: [est('10', Math.max(900_000, psa9)), est('9', psa9)],
            cfg: cfg({ minUpsidePct: pct, gradingCostTiers: tiers }),
          });
          expect(r.thresholdMxnCents).toBe(exacto);
          // El diagnóstico que ve el admin y la decisión del gate son la MISMA función escalón.
          expect(r.eligible).toBe(psa9 >= exacto);
        }
      }
    }
  });

  it('el ESCALÓN lo resuelve el PSA 10 (valor declarado): dos cartas de valor distinto pagan distinto', () => {
    const barata = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 150_000), est('9', 120_000)],
      cfg: cfg(),
    });
    const cara = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 6_000_000), est('9', 120_000)],
      // v1.50.2: este test mide la RESOLUCIÓN DEL ESCALÓN, no la magnitud. Con el seed (50) un PSA 10
      // de 6M sobre un raw de 100k da múltiplo 60 y el gate cortaría en `ABOVE_MAX_MULTIPLE` antes de
      // llegar al escalón. Se sube la cota SOLO en este caso, dejando la afirmación intacta; el
      // comportamiento de la cota tiene sus propias pruebas, una por cota.
      cfg: cfg({ maxRawMultiple: 1000 }),
    });
    expect(barata.gradingCostMxnCents).toBe(70_000);
    expect(cara.gradingCostMxnCents).toBe(1_200_000);
    // La cara necesita MUCHO más upside para ser destacada (umbral mayor con el mismo precio raw).
    expect(cara.thresholdMxnCents!).toBeGreaterThan(barata.thresholdMxnCents!);
  });

  it('criterio 98 — sin PSA 9 NO se promueve (aunque el PSA 10 sea enorme)', () => {
    const r = evaluateGradingHighlight({ ...base, estimates: [est('10', 9_000_000)], cfg: cfg() });
    expect(r.eligible).toBe(false);
    expect(r.reason).toBe('NO_PSA9');
  });

  it('sin PSA 10 no hay forma de resolver el escalón ⇒ NO_PSA10', () => {
    const r = evaluateGradingHighlight({ ...base, estimates: [est('9', 900_000)], cfg: cfg() });
    expect(r.reason).toBe('NO_PSA10');
  });

  it('un estimado RANCIO tumba el destacado (manda el más antiguo de los dos)', () => {
    const r = evaluateGradingHighlight({
      ...base,
      estimates: [est('10', 900_000, '2026-01-01'), est('9', 500_000)],
      cfg: cfg(),
    });
    expect(r.reason).toBe('STALE');
    expect(r.stale).toBe(true);
    expect(r.capturedDate).toBe('2026-01-01'); // diagnóstico: el más antiguo
  });

  it('MONEY-SAFE — tabla vacía o con hueco ⇒ NO_COST_TIER y CERO montos (jamás costo 0)', () => {
    for (const tiers of [
      [] as GradingCostTier[],
      [
        { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
        { minValueMxnCents: 300_000, maxValueMxnCents: null, costMxnCents: 110_000 },
      ] as GradingCostTier[],
    ]) {
      const r = evaluateGradingHighlight({
        ...base,
        // Upside brutal: si el costo se asumiera 0, esta carta se destacaría. NO debe destacarse.
        estimates: [est('10', 9_000_000), est('9', 8_000_000)],
        // v1.50.2: idem — lo que se prueba es «SIN ESCALÓN NO HAY DESTACADO, jamás costo 0». La cota
        // de magnitud se relaja aquí para que el gate llegue hasta el paso 7 y falle POR LA RAZÓN QUE
        // ESTE TEST AFIRMA (`NO_COST_TIER`) y no por una anterior.
        cfg: cfg({ gradingCostTiers: tiers, maxRawMultiple: 1000 }),
      });
      expect(r.eligible).toBe(false);
      expect(r.reason).toBe('NO_COST_TIER');
      expect(r.gradingCostMxnCents).toBeNull();
      expect(r.thresholdMxnCents).toBeNull();
      expect(r.netUpsidePsa9MxnCents).toBeNull();
    }
  });

  it('sin precio de venta del grupo ⇒ NOT_PUBLISHED (no hay contra qué comparar)', () => {
    expect(
      evaluateGradingHighlight({ ...base, rawSalePriceCents: null, estimates: [est('10', 900_000), est('9', 500_000)], cfg: cfg() }).reason,
    ).toBe('NOT_PUBLISHED');
    expect(
      evaluateGradingHighlight({ ...base, rawSalePriceCents: 0, estimates: [est('10', 900_000), est('9', 500_000)], cfg: cfg() }).reason,
    ).toBe('NOT_PUBLISHED');
  });

  it('dial apagado ⇒ FEATURE_OFF; graded/sealed ⇒ NOT_RAW', () => {
    const estimates = [est('10', 900_000), est('9', 500_000)];
    expect(evaluateGradingHighlight({ ...base, estimates, cfg: cfg({ enabled: false }) }).reason).toBe('FEATURE_OFF');
    expect(evaluateGradingHighlight({ ...base, productType: 'graded', estimates, cfg: cfg() }).reason).toBe('NOT_RAW');
    expect(evaluateGradingHighlight({ ...base, productType: 'sealed', estimates, cfg: cfg() }).reason).toBe('NOT_RAW');
  });

  it('PARTICIÓN §4.38-0 — subir `minUpsidePct` quita el DESTACADO pero NO apaga la FICHA', () => {
    const estimates = [est('10', 900_000), est('9', 500_000)];
    const estricto = cfg({ minUpsidePct: 500 });
    expect(evaluateGradingHighlight({ ...base, estimates, cfg: estricto }).eligible).toBe(false);
    // La MISMA carta sigue mostrando SUS DOS cifras en la ficha: el dial de curaduría no la toca.
    expect(
      selectGradedEstimates({ productType: 'raw', estimates, today: TODAY, cfg: estricto }).map((e) => e.gradeValue),
    ).toEqual(['10', '9']);
  });
});
