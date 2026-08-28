/**
 * graded-estimate.ts (v1.50.2, ARCHITECTURE §4.38, PROJECT §O v2.0) — «gancho de grading»: lógica PURA
 * del estimado por grado y del gate de CURADURÍA. Zona compartida (`common/`), sin dependencias de
 * infra (importable desde tests, seeds y `settings.constants`), hermana de `money.ts` /
 * `pricing-curve.ts`.
 *
 * LA PARTICIÓN QUE GOBIERNA TODO (§4.38-0): INFORMAR ≠ PROMOVER.
 *   - FICHA  (`gradedEstimates`)  → `selectGradedEstimates`  → SIN gate: basta dato FRESCO y > 0.
 *   - TEJA/VITRINA (`gradingHighlight`) → `evaluateGradingHighlight` → CON gate de ROI sobre PSA 9.
 * Una carta puede mostrar sus estimados en la ficha y NO estar destacada. Es deliberado.
 *
 * SEC-A1 (reforzado): de `evaluateGradingHighlight` SOLO `eligible` + `highlight` llegan al cliente
 * (y `highlight` lo hace como PRESENCIA del campo). `netUpsidePsa9MxnCents`, `thresholdMxnCents`,
 * `gradingCostTier` y `reason` alimentan el ORDEN de la vitrina y el diagnóstico de admin; JAMÁS el DTO
 * público. Por eso las puras reciben `{ gradeValue, mxnCents, capturedDate, isManual }` y NUNCA
 * `source` / `isManualOverride`.
 *
 * ⚠️ **Precisión sobre `isManual` (v1.50.2, §4.38m).** El párrafo anterior decía que las puras «nunca»
 * saben nada del origen; desde la frescura asimétrica **sí reciben `isManual`**, y esconderlo aquí no
 * lo hacía menos cierto. La línea que de verdad no se cruza es más estrecha y es la que importa:
 * `isManual` decide **SI** un elemento se emite (a una decisión humana no se le aplica la frescura de
 * *feed*), **nunca QUÉ** se emite —ni el monto, ni el shape, ni el orden— y **no viaja al DTO**. Así la
 * indistinguibilidad fase 1 ⇄ 2 (§4.38g) sigue intacta para el cliente: mirando la respuesta no puede
 * saber de dónde salió el número. `source` / `isManualOverride`, que sí serían origen crudo, quedan
 * fuera del tipo (ausentes **por construcción**, no por disciplina).
 *
 * MONEY-SAFE: sin escalón NO hay destacado (jamás un costo de gradeo asumido en 0); un estimado ≤ 0 no
 * es un estimado; un arreglo vacío NUNCA se emite (el caller OMITE el campo).
 */

/** Escalón de costo de gradeo: intervalo SEMIABIERTO `[min, max)` de VALOR DECLARADO → costo, en centavos MXN. */
export interface GradingCostTier {
  minValueMxnCents: number;
  /** `null` SOLO en el ÚLTIMO escalón («de X en adelante»). */
  maxValueMxnCents: number | null;
  /** Costo puerta a puerta (cuota PSA + envío internacional + retorno + manejo). Entero >= 1, JAMÁS 0. */
  costMxnCents: number;
}

/**
 * Config efectiva del gancho, izada UNA vez por request (patrón BE-25).
 *
 * **v1.44.1 (GU-A8, §4.38d) — TRES interruptores, no uno.** El fail-closed distingue *AUSENTE* de
 * *PRESENTE-pero-INVÁLIDA*, y una clave inválida apaga **solo la superficie que gobierna**:
 *
 * | Flag | Qué apaga | Se pone en `false` por |
 * |---|---|---|
 * | `enabled` | — (es el **espejo** del dial M10; viaja al DTO de admin) | dial `graded_estimates_enabled != 'on'` |
 * | `estimatesEnabled` | **ficha + teja + vitrina** (implica apagar todo) | dial `off`, o `grades`/`freshnessDays` **presente-e-inválida** |
 * | `highlightEnabled` | **teja + vitrina** (la ficha sigue informando) | lo anterior, o `minUpsidePct`/`highlightGrades` **presente-e-inválida** |
 *
 * Invariante: `highlightEnabled ⇒ estimatesEnabled ⇒ enabled`. Los dos últimos son **internos**: el DTO
 * del contrato (`GradedEstimateConfigDTO`) solo lleva `enabled` — ver `toGradedEstimateConfigDTO`.
 */
export interface GradedEstimateConfig {
  /**
   * ESPEJO READ-ONLY del dial M10 `graded_estimates_enabled` (fail-closed, seed `off`). Es el `enabled`
   * del DTO de admin; **no** lo apaga una clave corrupta (eso se refleja en el `reason` del preview y en
   * el `warn`, §4.38d › Observabilidad), porque el contrato lo define como espejo del dial.
   */
  enabled: boolean;
  /** ¿La FICHA puede informar? Gobierna `selectGradedEstimates`. */
  estimatesEnabled: boolean;
  /** ¿La TEJA/VITRINA pueden promover? Gobierna `evaluateGradingHighlight`. Implica `estimatesEnabled`. */
  highlightEnabled: boolean;
  /** Grados que la FICHA expone (seed `["10","9"]`). */
  grades: string[];
  /** Grados que el BADGE pinta (⊆ `grades`; seed `["10"]`). */
  highlightGrades: string[];
  /**
   * Ventana de frescura en días (seed 30) — aplica a las DOS superficies de LECTURA (ficha y vitrina).
   *
   * ⚠️ **ACOPLAMIENTO v1.50.3 (§4.38m.2): esta clave hace DOS trabajos, no uno.** Además de la ventana
   * de LECTURA, es la ventana de EVIDENCIA en la ESCRITURA: el ingest descarta la fila del proveedor
   * cuya **última venta observada** sea más vieja que `freshnessDays` (sin ese gate, cada corrida
   * reescribía `capturedDate = hoy` sobre una mediana congelada y el feed rancio parecía fresco para
   * siempre). Consecuencia operativa **al mover el dial**: bajarlo a 7 aprieta las dos (se exhibe menos
   * **y** se ingesta menos); subirlo a 90 afloja las dos y admite hasta **180 días** de antigüedad
   * exhibida (90 de evidencia en el momento de escribir + 90 de exhibición desde la captura). Es un
   * solo dial a propósito —dos ventanas independientes se desincronizarían sin que nadie lo note—, pero
   * quien lo mueve tiene que saber que mueve las dos.
   */
  freshnessDays: number;
  /** Umbral de ROI del gate de CURADURÍA (seed 30). NO afecta la ficha. */
  minUpsidePct: number;
  /** Tabla de escalones del gate de CURADURÍA. Vacía ⇒ nada se destaca. NO afecta la ficha. */
  gradingCostTiers: GradingCostTier[];

  // ===================== v1.50.2 — gate de confianza (§4.38k) + ingest (§4.38h) =====================

  /**
   * ESPEJO READ-ONLY del segundo dial M10, `graded_estimate_ingest_enabled` (seed `off`). Gobierna la
   * **obtención** (¿gastamos créditos y escribimos filas?), NO la **exhibición** (`enabled`). Son dos
   * diales a propósito: con uno solo, el operador tendría que elegir entre «no puedo probar el ingest
   * sin publicar» y «no puedo publicar sin encender el gasto» (§4.38d).
   */
  ingestEnabled: boolean;
  /**
   * Decaimiento del OVERRIDE MANUAL, **seed 30** (= `freshnessDays`), §4.38m / criterio 109. El
   * override manual **SÍ caduca**, y se mide contra su fecha de captura.
   *
   * ⚠️ **El seed `null` («no decae») quedó DEROGADO en v1.50.3** (GU-A16 deroga GU-A15). El argumento
   * anterior —«un override manual no es un feed; su vigencia la revoca otro humano, no el calendario»—
   * está **retirado**: derogaba el criterio 109 por default justo en la mitad del sistema donde el
   * número lo puso una persona y nadie lo vuelve a mirar. El fallo que aquel seed intentaba curar (un
   * manual viejo ganaba por tier absoluto y **después** la frescura lo tiraba, dejando la carta sin
   * estimado pese a haber dato fresco) se arregló donde tocaba: **invirtiendo el ORDEN** —
   * `PricingService.getGradedEstimatesBatch` descarta lo rancio **antes** de `pickBestRef`.
   *
   * `null` **sigue siendo expresable** (rango `null | [1, 3650]`) y significa «no decae», pero es una
   * decisión explícita del humano con consecuencia declarada —desactiva el criterio 109 para la vía
   * manual— y el resolver emite `warn` obligatorio al izarla (I8-bis). Valor efectivo y rango:
   * `DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS` (más abajo en este archivo) es la fuente de verdad.
   */
  manualFreshnessDays: number | null;
  /**
   * Cota SUPERIOR de magnitud, **seed 100** (`maxGradedMultiple` de §O.7 / criterio 111c), §4.38k.2.
   * Solo la REJILLA la aplica; la ficha nunca. *(Era 50 hasta v1.50.3: un seed más estricto que el
   * criterio no produce datos malos, produce **ausencias** — suprimía el tramo 50×–100× sin explicarlo.)*
   */
  maxRawMultiple: number;
  /**
   * Muestra mínima del proveedor para aceptar una fila AUTOMÁTICA, **seed 5** (`minSalesSample` de §O.7
   * / criterio 111a), §4.38k.1. *(Era 3 hasta v1.50.3: dejaba entrar cifras de 3 y 4 ventas, que es
   * justo el ruido que la cota existe para filtrar.)* Se aplica **en la ESCRITURA** (ingest):
   * `PriceReference` no tiene dónde persistir el `count` sin DDL, y gatearlo al escribir mantiene M-42
   * como DATA/seed puro. Consecuencia asumida: cambiarlo afecta solo a escrituras futuras (para
   * re-aplicarlo hay que re-correr el ingest).
   */
  minSampleCount: number;
  /** Cuál número del proveedor ES el precio (seed `median`), §4.38h.2. */
  sourceStat: GradedEstimateSourceStat;
  /** Tope DURO de cartas por corrida del ingest (seed 250), §4.38h.3. */
  ingestMaxCardsPerRun: number;
  /**
   * INTERNO (no viaja al DTO): ¿alguna de las 3 claves del INGEST está PRESENTE-pero-INVÁLIDA? Los
   * diales del ingest **no** apagan una superficie de lectura —corromperlos no puede vaciar una vitrina
   * cuyo dato ya está escrito—, pero **sí** deben impedir que el job escriba: con `minSampleCount` o
   * `sourceStat` corruptos no sabemos *qué* número es el precio ni *cuánta* muestra exigimos, y adivinar
   * eso es escribir dinero a ciegas. Mismo espíritu que `estimatesEnabled`/`highlightEnabled`.
   */
  ingestConfigInvalid: boolean;
  /**
   * INTERNO (no viaja al DTO), v1.50.3 (§4.38n.3): ¿`graded_estimate_max_raw_multiple` está
   * PRESENTE-pero-INVÁLIDA? Es la ÚNICA clave de la que depende la **coherencia de magnitud** (las
   * cotas inferior y de orden de grados son invariantes de producto, sin dial).
   *
   * Existe aparte de `highlightEnabled` porque ése ya está apagado por *tres* claves distintas y no
   * permite distinguir cuál falló. La **lista de revisión** necesita esa distinción: tolera el dial `off`
   * (es una decisión) pero **rechaza con `409`** una config corrupta (es intención perdida), y para eso
   * tiene que poder nombrar la clave en el error. Misma doctrina que `ingestConfigInvalid`.
   */
  maxRawMultipleInvalid: boolean;
}

/**
 * Qué estadístico del proveedor se publica. **`median` por defecto y no `average`**: en PSA 10 de
 * cartas caras una venta atípica es lo normal, y el promedio la arrastra entera. `smart` es una
 * derivación PROPIETARIA no documentada del proveedor — construir sobre ella es exactamente lo que P-6
 * prohíbe —, así que existe como escotilla del operador, no como default.
 */
export type GradedEstimateSourceStat = 'median' | 'average' | 'smart';

/** El `GradedEstimateConfigDTO` del contrato (§M2). Los flags internos de GU-A8 NO forman parte de él. */
export type GradedEstimateConfigDTO = Omit<
  GradedEstimateConfig,
  'estimatesEnabled' | 'highlightEnabled' | 'ingestConfigInvalid' | 'maxRawMultipleInvalid'
>;

/**
 * Proyección al DTO del contrato. **Existe para que añadir estado interno al resolver NO cambie la forma
 * de `GET/PUT /admin/pricing/graded-estimates` ni del `config` del preview** (antes se devolvía el objeto
 * interno tal cual, así que cualquier campo nuevo se filtraba al contrato sin querer).
 */
export function toGradedEstimateConfigDTO(cfg: GradedEstimateConfig): GradedEstimateConfigDTO {
  return {
    enabled: cfg.enabled,
    ingestEnabled: cfg.ingestEnabled,
    grades: cfg.grades,
    highlightGrades: cfg.highlightGrades,
    freshnessDays: cfg.freshnessDays,
    minUpsidePct: cfg.minUpsidePct,
    gradingCostTiers: cfg.gradingCostTiers,
    // v1.50.2 — los 5 diales editables del gate de confianza y del ingest (contrato §M2).
    manualFreshnessDays: cfg.manualFreshnessDays,
    maxRawMultiple: cfg.maxRawMultiple,
    minSampleCount: cfg.minSampleCount,
    sourceStat: cfg.sourceStat,
    ingestMaxCardsPerRun: cfg.ingestMaxCardsPerRun,
  };
}

/** Un estimado por grado, ya resuelto a MXN. Deliberadamente SIN `source`/`isManualOverride` (§4.38g). */
export interface GradedEstimateInput {
  /** `"10"` | `"9"` (string abierto en el TIPO: añadir un grado no es cambio de contrato). */
  gradeValue: string;
  mxnCents: number;
  /** `YYYY-MM-DD` (date-only, misma convención que `PriceReference.capturedDate @db.Date`). */
  capturedDate: string;
  /**
   * v1.50.2 (§4.38m) — ¿es un OVERRIDE MANUAL? Decide **SI** el elemento se emite (la frescura de feed
   * no se le aplica), **NUNCA QUÉ** se emite: ni el monto, ni el shape, ni el render dependen de él, y
   * **no viaja al DTO**. La garantía (g) —fase 1 y fase 2 indistinguibles para el cliente— queda
   * intacta: un cliente no puede distinguir una fila manual de una automática mirando la respuesta.
   */
  isManual: boolean;
}

/** Razón accionable por la que un grupo NO quedó destacado (solo admin/diagnóstico, §4.38d). */
export type HighlightReason =
  | 'FEATURE_OFF'
  | 'NOT_RAW'
  | 'NOT_PUBLISHED'
  | 'NO_PSA10'
  | 'NO_PSA9'
  | 'STALE'
  | 'NO_COST_TIER'
  | 'BELOW_MIN_UPSIDE'
  // ---- v1.50.2 ----
  /** INV-D (§4.38l): hay un SLAB PUBLICADO de ese grado ⇒ esa fila es DINERO real, no un estimado. */
  | 'SLAB_PUBLISHED'
  /** Cota INFERIOR de magnitud: `psa10 <= salePriceCents`. Caza el ERROR DE UNIDADES (USD como MXN). */
  | 'NOT_ABOVE_RAW'
  /** Cota SUPERIOR: `psa10 > salePriceCents × maxRawMultiple`. Caza el cero de más / typo al alza. */
  | 'ABOVE_MAX_MULTIPLE'
  /** Cota de ORDEN: `psa10 < psa9`. Caza el grado INTERCAMBIADO (las dos filas capturadas cruzadas). */
  | 'GRADE_ORDER_INVERTED';

export interface GradingHighlightResult<T extends GradedEstimateInput = GradedEstimateInput> {
  eligible: boolean;
  reason?: HighlightReason;
  /** Vacío si `!eligible`. El caller OMITE el campo público cuando está vacío (jamás emite `[]`). */
  highlight: T[];
  gradingCostTier: GradingCostTier | null;
  gradingCostMxnCents: number | null;
  thresholdMxnCents: number | null;
  /** Clave de ORDEN de la vitrina + insumo del preview de admin. NO viaja al cliente. */
  netUpsidePsa9MxnCents: number | null;
  /**
   * v1.50.2 — cota SUPERIOR efectiva (`salePriceCents × maxRawMultiple`, truncada a entero) para que el
   * operador vea en el `preview` **contra qué** se comparó. `null` si no hay precio de venta resoluble.
   * Diagnóstico de ADMIN: jamás viaja al cliente.
   */
  maxAllowedPsa10MxnCents: number | null;
  /**
   * Montos crudos por grado tal como se leyeron (o `null` si ausente/<= 0). Sirven al DESEMPATE de la
   * vitrina (PSA 10 desc) y al diagnóstico de admin. **NUNCA** salen en el DTO público.
   */
  psa10MxnCents: number | null;
  psa9MxnCents: number | null;
  /** `true` si algún grado presente está RANCIO (> `freshnessDays`). Solo diagnóstico. */
  stale: boolean;
  /** El `capturedDate` MÁS ANTIGUO entre los grados presentes (el que manda para la frescura). */
  capturedDate: string | null;
}

/** MVP: única graduadora soportada (§O.1; CGC/BGS/TAG fuera de alcance). */
export const GRADED_ESTIMATE_COMPANY = 'PSA' as const;

/**
 * Conjunto CERRADO de grados soportados (I7 del `PUT`). El gate SIEMPRE necesita PSA 9 aunque el badge
 * no lo pinte, por eso el batch lee siempre los dos. Grados PSA <= 8 quedan fuera de alcance (§O.1).
 */
export const GRADED_ESTIMATE_GRADE_VALUES: readonly string[] = ['10', '9'];

/** `gradeKey` canónico del estimado (§4.38a). Empata con `buildGradeKey({productType:'graded'})`. */
export function gradedEstimateGradeKey(gradeValue: string): string {
  return `graded:${GRADED_ESTIMATE_COMPANY}:${gradeValue}`;
}

/** Las claves canónicas que lee `getGradedEstimatesBatch` (constante: `['graded:PSA:10','graded:PSA:9']`). */
export const GRADED_ESTIMATE_GRADE_KEYS: readonly string[] =
  GRADED_ESTIMATE_GRADE_VALUES.map(gradedEstimateGradeKey);

/**
 * Cota ANTI-TYPO del costo de gradeo (I2): MX$100,000 en centavos. Un costo por encima es casi seguro un
 * error de dedo del admin; y un costo 0 (prohibido por `>= 1`) es exactamente lo que haría perder dinero
 * al comprador. Mismo patrón que `FIXED_CENTS_MAX` / `SEALED_SPREAD_PCT_MAX`.
 */
export const GRADING_COST_MAX_CENTS = 10_000_000;

/** I6: rangos de los umbrales del gate. */
export const GRADING_MIN_UPSIDE_PCT_MAX = 1000;
export const GRADED_ESTIMATE_FRESHNESS_DAYS_MIN = 1;
export const GRADED_ESTIMATE_FRESHNESS_DAYS_MAX = 365;

/**
 * Seed de `grading_cost_tiers` (§4.38d / PROJECT §O.2.1), intervalos SEMIABIERTOS `[min, max)` en
 * centavos MXN. Cubre el total PUERTA A PUERTA para un comprador en México (cuota PSA + envío
 * internacional + retorno asegurado + manejo), no la cuota pelona. SUPUESTO revisable por el dueño.
 *
 * Por qué semiabiertos y no «hasta $2,000 / de $2,001 en adelante»: con límites INCLUSIVOS en pesos, un
 * valor de $2,000.50 (200050 centavos) caería en un HUECO y la carta quedaría no elegible por un defecto
 * de modelado. Con `[min, max)` la tabla cubre TODOS los enteros >= 0 por construcción. Único delta
 * contra la tabla del PO: exactamente $2,000.00 cae en el escalón siguiente (más caro) — desviación de 1
 * centavo en dirección CONSERVADORA (encarece el gate).
 */
export const DEFAULT_GRADING_COST_TIERS: GradingCostTier[] = [
  { minValueMxnCents: 0, maxValueMxnCents: 200_000, costMxnCents: 70_000 },
  { minValueMxnCents: 200_000, maxValueMxnCents: 500_000, costMxnCents: 110_000 },
  { minValueMxnCents: 500_000, maxValueMxnCents: 1_000_000, costMxnCents: 180_000 },
  { minValueMxnCents: 1_000_000, maxValueMxnCents: 2_000_000, costMxnCents: 300_000 },
  { minValueMxnCents: 2_000_000, maxValueMxnCents: 5_000_000, costMxnCents: 600_000 },
  { minValueMxnCents: 5_000_000, maxValueMxnCents: null, costMxnCents: 1_200_000 },
];

/** Seeds de los diales NO-dinero (umbrales/listas). Su ausencia SÍ puede caer aquí (§4.38d). */
export const DEFAULT_GRADED_ESTIMATE_GRADES: string[] = ['10', '9'];
export const DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES: string[] = ['10'];
export const DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS = 30;
export const DEFAULT_GRADING_MIN_UPSIDE_PCT = 30;

// ===== v1.50.2 — seeds y rangos de los 5 diales nuevos de M2 (I8/I9, contrato §M2) =====
//
// ⚠️ **v1.50.3 (GU-A17, §4.38k.0) — TRES seeds corregidos, y el porqué importa más que los números.**
// Los tres divergían de `PROJECT.md` §O.7 **en silencio**. Por la regla de conflicto, **PROJECT manda
// sobre el contrato y el contrato sobre el código**: un seed que contradice el criterio no es una
// «elección de implementación», es el criterio sin cumplir. Dos eran PERMISIVOS (dejaban pasar lo que
// el criterio quería filtrar) y el tercero era conservador — pero un default conservador que nadie
// declaró **también** miente: suprimía sin explicación justo las cartas con upside entre 50× y 100×,
// que son las que la feature existe para encontrar.

/**
 * ¿Cada cuántos días decae un override MANUAL? **Seed 30** (= `freshnessDays`), criterio **109**.
 *
 * ⚠️ **v1.50.3 — era `null` («no decae») y eso DEROGABA el criterio 109 por default** (GU-A15 derogada
 * por GU-A16, §4.38m). §O.4 dice «mejor callar que presumir un número viejo en una promesa comercial»,
 * y QA lo demostró: una fila manual de **40 días** seguía en la ficha y seguía promocionándose. El
 * mecanismo funcionaba; era el **default** el que lo apagaba justo en la mitad del sistema donde el
 * número lo puso una persona y nadie lo vuelve a mirar.
 *
 * `null` **sigue siendo expresable** (rango `null | [1, 3650]`), pero deja de ser el default y tiene una
 * consecuencia declarada: **desactiva el criterio 109 para la vía manual**. Por eso el resolver emite
 * `warn` obligatorio al izar la config con `null` (I8-bis): la misma doctrina que «la vitrina no puede
 * vaciarse en silencio».
 */
export const DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS: number | null = 30;
export const GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MIN = 1;
export const GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MAX = 3650;

/**
 * Cota SUPERIOR de magnitud (§4.38k.2) = `maxGradedMultiple` de §O.7.
 *
 * ⚠️ **v1.50.3 — era 50; §O.7 dice 100×.** Éste era el conservador, y por eso fue el que más costó ver:
 * un seed más estricto que el criterio no produce datos malos, produce **ausencias**. Suprimía sin
 * explicación las cartas con múltiplo entre 50× y 100× — exactamente el tramo que la feature existe
 * para encontrar — y quien mirara la vitrina concluiría «no hay joyas», no «el dial está mal».
 */
export const DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE = 100;
/**
 * I9: `maxRawMultiple > 1` **estricto**, y NO es cosmético. Con `<= 1` la cota superior chocaría con la
 * INFERIOR (`psa10 > salePriceCents`) y **ninguna** carta podría destacarse jamás: una vitrina vacía
 * permanente y sin explicación. Por eso el mínimo es exclusivo.
 */
export const GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MIN_EXCLUSIVE = 1;
export const GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MAX = 1000;

/**
 * Muestra mínima del proveedor, aplicada en la ESCRITURA (§4.38k.1) = `minSalesSample` de §O.7.
 *
 * ⚠️ **v1.50.3 — era 3; §O.7 y el criterio 111(a) dicen 5.** Permisivo: dejaba entrar cifras con 3 y 4
 * ventas, que es justo el ruido que la cota existe para filtrar.
 */
export const DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT = 5;
export const GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MIN = 1;
export const GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MAX = 100;

/** Qué número del proveedor ES el precio (§4.38h.2). La MEDIANA, no el promedio. */
export const GRADED_ESTIMATE_SOURCE_STAT_VALUES: readonly GradedEstimateSourceStat[] = [
  'median',
  'average',
  'smart',
];
export const DEFAULT_GRADED_ESTIMATE_SOURCE_STAT: GradedEstimateSourceStat = 'median';

/** Tope DURO de cuota por corrida del ingest (§4.38h.3). Un error de alcance no quema el día. */
export const DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN = 250;
export const GRADED_ESTIMATE_INGEST_MAX_CARDS_MIN = 1;
export const GRADED_ESTIMATE_INGEST_MAX_CARDS_MAX = 5000;

/**
 * Config APAGADA e INERTE — el estado del dial `off` (seed) y el que usan los tests de «con `off` el
 * backend ni siquiera evalúa nada». Con `grades`/`gradingCostTiers` vacíos, las puras devuelven `[]` y
 * `FEATURE_OFF` **aunque alguien las llamara por error**: el fail-closed no depende de que el caller
 * recuerde comprobar el flag. Se declara aquí (una sola vez) para que `pricing.service` y los tests no
 * mantengan tres copias divergentes del mismo objeto.
 */
export const DISABLED_GRADED_ESTIMATE_CONFIG: GradedEstimateConfig = {
  enabled: false,
  estimatesEnabled: false,
  highlightEnabled: false,
  ingestEnabled: false,
  grades: [],
  highlightGrades: [],
  freshnessDays: DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS,
  minUpsidePct: DEFAULT_GRADING_MIN_UPSIDE_PCT,
  gradingCostTiers: [],
  manualFreshnessDays: DEFAULT_GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS,
  maxRawMultiple: DEFAULT_GRADED_ESTIMATE_MAX_RAW_MULTIPLE,
  minSampleCount: DEFAULT_GRADED_ESTIMATE_MIN_SAMPLE_COUNT,
  sourceStat: DEFAULT_GRADED_ESTIMATE_SOURCE_STAT,
  ingestMaxCardsPerRun: DEFAULT_GRADED_ESTIMATE_INGEST_MAX_CARDS_PER_RUN,
  ingestConfigInvalid: false,
  maxRawMultipleInvalid: false,
};

/** I8 — `manualFreshnessDays`: `null` (no decae) o entero en `[1, 3650]`. `null` es un valor, no ausencia. */
export function validateGradedEstimateManualFreshnessDays(v: unknown): string | null {
  if (v === null) return null;
  return isInt(v) &&
    v >= GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MIN &&
    v <= GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MAX
    ? null
    : `must be null or an integer in [${GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MIN}, ${GRADED_ESTIMATE_MANUAL_FRESHNESS_DAYS_MAX}] (days)`;
}

/** I9 — `maxRawMultiple`: número **> 1** (estricto) y <= 1000. Ver por qué el `> 1` importa arriba. */
export function validateGradedEstimateMaxRawMultiple(v: unknown): string | null {
  return typeof v === 'number' &&
    Number.isFinite(v) &&
    v > GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MIN_EXCLUSIVE &&
    v <= GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MAX
    ? null
    : `must be a number > ${GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MIN_EXCLUSIVE} and <= ${GRADED_ESTIMATE_MAX_RAW_MULTIPLE_MAX} ` +
        '(<= 1 would collide with the lower bound psa10 > salePriceCents and empty the showcase forever)';
}

/** I8 — `minSampleCount`: entero en `[1, 100]`. */
export function validateGradedEstimateMinSampleCount(v: unknown): string | null {
  return isInt(v) &&
    v >= GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MIN &&
    v <= GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MAX
    ? null
    : `must be an integer in [${GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MIN}, ${GRADED_ESTIMATE_MIN_SAMPLE_COUNT_MAX}]`;
}

/** I8 — `sourceStat` ∈ {median, average, smart}. */
export function validateGradedEstimateSourceStat(v: unknown): string | null {
  return typeof v === 'string' && (GRADED_ESTIMATE_SOURCE_STAT_VALUES as readonly string[]).includes(v)
    ? null
    : `must be one of ${GRADED_ESTIMATE_SOURCE_STAT_VALUES.join('|')}`;
}

/** I8 — `ingestMaxCardsPerRun`: entero en `[1, 5000]`. */
export function validateGradedEstimateIngestMaxCards(v: unknown): string | null {
  return isInt(v) && v >= GRADED_ESTIMATE_INGEST_MAX_CARDS_MIN && v <= GRADED_ESTIMATE_INGEST_MAX_CARDS_MAX
    ? null
    : `must be an integer in [${GRADED_ESTIMATE_INGEST_MAX_CARDS_MIN}, ${GRADED_ESTIMATE_INGEST_MAX_CARDS_MAX}] (cards per run)`;
}

/** Error de validación de la tabla de escalones: código de contrato + detalle accionable. */
export interface GradingTiersError {
  code:
    | 'GRADING_TIERS_EMPTY'
    | 'GRADING_TIERS_NOT_CONTIGUOUS'
    | 'GRADING_TIERS_NOT_OPEN_ENDED'
    | 'VALIDATION_ERROR';
  message: string;
  details: Record<string, unknown>;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v);
}

/**
 * Valida la tabla de escalones (I1–I5) — el MISMO validador que usa el `PUT` (422 con código propio) y
 * la lectura fail-closed del resolver. Devuelve `null` si es válida.
 *
 * I1 array no vacío · I2 forma/rangos por fila (`costMxnCents` entero en [1, GRADING_COST_MAX_CENTS]) ·
 * I3 orden ascendente por `min` y primera fila `min === 0` · I4 contigüidad exacta sin huecos ni solapes ·
 * I5 último escalón abierto (`max === null`) y ninguno más.
 */
export function validateGradingCostTiers(v: unknown): GradingTiersError | null {
  if (!Array.isArray(v)) {
    return {
      code: 'VALIDATION_ERROR',
      message: 'gradingCostTiers must be an array of { minValueMxnCents, maxValueMxnCents, costMxnCents }',
      details: { field: 'gradingCostTiers' },
    };
  }
  // I1 — vacío: sin tabla no hay gate (y NUNCA un costo asumido en cero).
  if (v.length === 0) {
    return {
      code: 'GRADING_TIERS_EMPTY',
      message: 'gradingCostTiers must not be empty',
      details: { field: 'gradingCostTiers' },
    };
  }
  // I2 — forma y rangos por fila.
  for (let i = 0; i < v.length; i++) {
    const row = v[i] as Record<string, unknown> | null;
    if (row == null || typeof row !== 'object' || Array.isArray(row)) {
      return {
        code: 'VALIDATION_ERROR',
        message: `tier[${i}] must be an object { minValueMxnCents, maxValueMxnCents, costMxnCents }`,
        details: { field: 'gradingCostTiers', index: i },
      };
    }
    const { minValueMxnCents: min, maxValueMxnCents: max, costMxnCents: cost } = row;
    if (!isInt(min) || min < 0) {
      return {
        code: 'VALIDATION_ERROR',
        message: `tier[${i}].minValueMxnCents must be an integer >= 0 (cents)`,
        details: { field: 'gradingCostTiers', index: i },
      };
    }
    if (max !== null && (!isInt(max) || max <= min)) {
      return {
        code: 'VALIDATION_ERROR',
        message: `tier[${i}].maxValueMxnCents must be null or an integer > minValueMxnCents`,
        details: { field: 'gradingCostTiers', index: i },
      };
    }
    // MONEY-SAFE (misma guardia L1 que `OverrideDto` `@Min(1)`): un costo de gradeo 0 es EXACTAMENTE lo
    // que haría que el comprador pierda dinero. Nunca 0, nunca negativo, nunca absurdo (anti-typo).
    if (!isInt(cost) || cost < 1 || cost > GRADING_COST_MAX_CENTS) {
      return {
        code: 'VALIDATION_ERROR',
        message: `tier[${i}].costMxnCents must be an integer in [1, ${GRADING_COST_MAX_CENTS}] (cents; never 0)`,
        details: { field: 'gradingCostTiers', index: i },
      };
    }
  }
  const tiers = v as GradingCostTier[];
  // I3 — cobertura desde cero + orden ascendente estricto por `min`.
  if (tiers[0].minValueMxnCents !== 0) {
    return {
      code: 'GRADING_TIERS_NOT_CONTIGUOUS',
      message: 'the first tier must start at minValueMxnCents = 0 (coverage from zero)',
      details: { field: 'gradingCostTiers', index: 0 },
    };
  }
  const unordered: number[] = [];
  for (let i = 1; i < tiers.length; i++) {
    if (tiers[i].minValueMxnCents <= tiers[i - 1].minValueMxnCents) unordered.push(i);
  }
  if (unordered.length > 0) {
    return {
      code: 'GRADING_TIERS_NOT_CONTIGUOUS',
      message: 'tiers must be sorted ascending by minValueMxnCents',
      details: { field: 'gradingCostTiers', unordered },
    };
  }
  // I4 — contigüidad exacta: el techo de un escalón ES el piso del siguiente (ni hueco ni solape).
  const offending: { i: number; next: number }[] = [];
  for (let i = 0; i < tiers.length - 1; i++) {
    if (tiers[i].maxValueMxnCents !== tiers[i + 1].minValueMxnCents) offending.push({ i, next: i + 1 });
  }
  if (offending.length > 0) {
    return {
      code: 'GRADING_TIERS_NOT_CONTIGUOUS',
      message: 'tiers[i].maxValueMxnCents must equal tiers[i+1].minValueMxnCents (no gaps, no overlaps)',
      details: { field: 'gradingCostTiers', offending },
    };
  }
  // I5 — último escalón ABIERTO y ningún otro `null` (si no, la tabla tendría un techo y un hueco arriba).
  const nulls = tiers.map((t, i) => (t.maxValueMxnCents === null ? i : -1)).filter((i) => i >= 0);
  if (nulls.length !== 1 || nulls[0] !== tiers.length - 1) {
    return {
      code: 'GRADING_TIERS_NOT_OPEN_ENDED',
      message: 'only the LAST tier may have maxValueMxnCents = null (open-ended), and it must have it',
      details: { field: 'gradingCostTiers', nullAt: nulls },
    };
  }
  return null;
}

/**
 * Lectura FAIL-CLOSED de la tabla (§4.38d): clave ausente, corrupta o que no cumple I1–I5 ⇒ tabla
 * VACÍA ⇒ **nada se destaca**. JAMÁS se cae a un default de código para el COSTO (a diferencia de
 * `minUpsidePct`/`freshnessDays`/`grades`, que son umbrales/listas y sí caen a su seed: su ausencia no
 * puede producir un gate optimista porque sin tabla no hay gate).
 */
export function sanitizeGradingCostTiers(v: unknown): GradingCostTier[] {
  if (validateGradingCostTiers(v) != null) return [];
  return (v as GradingCostTier[]).map((t) => ({
    minValueMxnCents: t.minValueMxnCents,
    maxValueMxnCents: t.maxValueMxnCents,
    costMxnCents: t.costMxnCents,
  }));
}

/**
 * Escalón cuyo intervalo SEMIABIERTO `[min, max)` contiene `valueMxnCents`. Tabla vacía, con hueco, con
 * solape, desordenada o con un costo inválido ⇒ `null` ⇒ `NO_COST_TIER` ⇒ **sin destacado** (jamás un
 * costo asumido en 0). La validación se re-aplica aquí para que la función sea segura ante cualquier
 * caller, no solo ante la lectura ya saneada.
 */
export function findGradingCostTier(
  tiers: GradingCostTier[],
  valueMxnCents: number,
): GradingCostTier | null {
  if (!isInt(valueMxnCents) || valueMxnCents < 0) return null;
  if (validateGradingCostTiers(tiers) != null) return null;
  for (const t of tiers) {
    if (
      valueMxnCents >= t.minValueMxnCents &&
      (t.maxValueMxnCents === null || valueMxnCents < t.maxValueMxnCents)
    ) {
      return t;
    }
  }
  return null;
}

/** ¿`s` es una fecha date-only `YYYY-MM-DD` válida? */
function parseDateOnlyUtc(s: string): number | null {
  if (typeof s !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Fecha de NEGOCIO (CDMX), date-only `YYYY-MM-DD` — la misma convención que `capturedDate` (`@db.Date`).
 * Se usa como `today` del gate de frescura. Se calcula con `Intl` (sin dependencias) para no depender del
 * huso del contenedor.
 */
export function businessDateCdmx(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/**
 * `stale(e) := diffDays(today, e.capturedDate) > cfg.freshnessDays`.
 * - Un `capturedDate` FUTURO (reloj torcido / borde de huso) NO es rancio: es fresco.
 * - Una fecha malformada se trata como RANCIA (fail-closed: sin fecha confiable no se promociona
 *   ni se informa una cifra).
 */
export function isStaleEstimate(capturedDate: string, today: string, freshnessDays: number): boolean {
  const captured = parseDateOnlyUtc(capturedDate);
  const ref = parseDateOnlyUtc(today);
  if (captured == null || ref == null) return true;
  const diffDays = Math.floor((ref - captured) / 86_400_000);
  return diffDays > freshnessDays;
}

/** Orden de render NORMATIVO: grado DESCENDENTE (PSA 10 primero). */
function byGradeDesc(a: { gradeValue: string }, b: { gradeValue: string }): number {
  const av = Number(a.gradeValue);
  const bv = Number(b.gradeValue);
  if (Number.isFinite(av) && Number.isFinite(bv) && av !== bv) return bv - av;
  return String(b.gradeValue).localeCompare(String(a.gradeValue));
}

/**
 * v1.50.2 (§4.38m) — frescura ASIMÉTRICA por ORIGEN de la fila:
 *
 * ```
 * stale(e) := e.isManual ? (manualFreshnessDays == null ? false : diff > manualFreshnessDays)
 *                        : diff > freshnessDays
 * ```
 *
 * ⚠️ **v1.50.3 (GU-A16, §4.38m) — el manual SÍ decae; el seed pasó de `null` a 30.** La versión anterior
 * de este comentario argumentaba que «un override manual no es un feed, lo revoca un humano, no el
 * calendario». El **diagnóstico** que lo motivaba era correcto —`isBetterRef` (tier manual ABSOLUTO,
 * §4.27f-2) elegía el manual viejo y la ventana de frescura lo descartaba después, dejando la carta sin
 * estimado **pese a haber dato fresco**: la clase de fallo «gana y luego se tira»—, pero **el remedio
 * era el equivocado**. El criterio **109** mide la antigüedad *«contra la fecha de captura para un
 * override manual; el umbral es de 30 días»*, y §O.4 remata: *«mejor callar que presumir un número viejo
 * en una promesa comercial»*. Eximir al manual del decaimiento **derogaba el criterio en silencio**.
 *
 * **Lo que sí se arregló es el ORDEN de las dos operaciones**, no quién decae:
 * `PricingService.getGradedEstimatesBatch` filtra lo rancio **ANTES** de `pickBestRef`, así que un
 * manual rancio ya no puede ganar y luego caerse — deja el paso a la automática fresca, y si no hay
 * ninguna, **no se emite nada** (que es lo que el criterio pide). **`isBetterRef` sigue intacto**: el
 * filtro vive FUERA del comparador y solo en la ruta de lectura del gancho, así que §4.27f-2 —una
 * garantía de DINERO sobre escrituras— no se toca.
 *
 * `manualFreshnessDays == null` sigue siendo expresable y significa «no decae», pero **ya no es el
 * default** y desactiva el criterio 109 para la vía manual ⇒ el resolver emite `warn` al izar la config
 * (I8-bis, §4.38m). Es una decisión del humano, no un estado al que se llegue por omisión.
 */
export function isStaleRef(
  e: GradedEstimateInput,
  today: string,
  cfg: Pick<GradedEstimateConfig, 'freshnessDays' | 'manualFreshnessDays'>,
): boolean {
  return isStaleByOrigin(e.capturedDate, e.isManual === true, today, cfg);
}

/**
 * v1.50.3-c (techlead) — **el MISMO predicado de `isStaleRef`, sobre los dos datos que de verdad
 * decide**: la fecha de captura y el ORIGEN de la fila. Nada más.
 *
 * Existe porque el llamador de la ruta de lectura (`PricingService.getGradedEstimatesBatch`) tiene
 * filas de `PriceReference`, no `GradedEstimateInput`, y para preguntar «¿está rancia?» fabricaba un
 * objeto falso con **`mxnCents: 0`**. Funcionaba —el predicado ignora el monto— pero un `0` es un
 * centinela **inválido** en cualquier otro contexto de este archivo (`usable()` lo trata como «no es un
 * estimado», money-safe), así que era una trampa esperando al siguiente lector que lo copiara.
 *
 * `isStaleRef` queda como el envoltorio para quien ya tiene el input completo: **una sola verdad sobre
 * qué es fresco**, dos formas de preguntarla.
 */
export function isStaleByOrigin(
  capturedDate: string,
  isManual: boolean,
  today: string,
  cfg: Pick<GradedEstimateConfig, 'freshnessDays' | 'manualFreshnessDays'>,
): boolean {
  if (isManual) {
    // `null` NO es el seed (lo fue hasta v1.50.3, GU-A15 derogada): es una elección explícita del
    // operador que desactiva el criterio 109 para la vía manual, y se izó con `warn` (I8-bis).
    if (cfg.manualFreshnessDays == null) return false;
    return isStaleEstimate(capturedDate, today, cfg.manualFreshnessDays);
  }
  return isStaleEstimate(capturedDate, today, cfg.freshnessDays);
}

/**
 * ¿El estimado de `gradeValue` sirve? (existe, > 0, fresco y **sin slab publicado de ese grado**).
 *
 * `publishedSlabGrades` (v1.50.2, INV-D §4.38l) es la guarda de LECTURA: si la carta tiene un slab
 * PUBLICADO de ese grado, esa fila **no es un estimado** — es la referencia de mercado real que fija el
 * precio de venta de esa pieza física. Va aquí, en el helper compartido, para que **ninguna** de las dos
 * superficies pueda olvidarla; y neutraliza además las filas escritas ANTES de la guarda de escritura,
 * que el `422`/`409` del override por sí solo no alcanza.
 */
function usable<T extends GradedEstimateInput>(
  estimates: T[],
  gradeValue: string,
  today: string,
  cfg: Pick<GradedEstimateConfig, 'freshnessDays' | 'manualFreshnessDays'>,
  publishedSlabGrades: readonly string[],
): T | null {
  const e = estimates.find((x) => x.gradeValue === gradeValue);
  if (e == null) return null;
  if (!isInt(e.mxnCents) || e.mxnCents <= 0) return null; // un 0 NO es un estimado (money-safe).
  if (isStaleRef(e, today, cfg)) return null;
  if (publishedSlabGrades.includes(gradeValue)) return null; // INV-D: es precio REAL, no estimado.
  return e;
}

/**
 * FICHA (`gradedEstimates`) — SIN gate de ROI (§4.38c). Devuelve los grados de `cfg.grades` con dato
 * FRESCO y > 0, en orden descendente. Los grados son INDEPENDIENTES: tener PSA 10 y no PSA 9 emite un
 * arreglo de UN elemento.
 *
 * `[]` ⇒ el caller **OMITE** el campo (jamás emite `[]`: un arreglo vacío es un contenedor renderizable
 * y, peor, filtraría la decisión del gate).
 */
export function selectGradedEstimates<T extends GradedEstimateInput>(input: {
  productType: 'raw' | 'graded' | 'sealed';
  estimates: T[];
  /** v1.50.2 (INV-D, §4.38l): grados con SLAB PUBLICADO ⇒ ese grado se OMITE (es dinero, no estimado). */
  publishedSlabGrades?: readonly string[];
  today: string;
  cfg: GradedEstimateConfig;
}): T[] {
  const { productType, estimates, today, cfg } = input;
  const publishedSlabGrades = input.publishedSlabGrades ?? [];
  // 1. fail-closed: dial M10 `off` (seed) **o** GU-A8 — `grades`/`freshnessDays` PRESENTE-e-INVÁLIDA.
  //    Sin un umbral de frescura confiable no se puede afirmar que una cifra esté vigente, así que la
  //    ficha tampoco informa (§4.38d › «Alcance del apagado»).
  if (cfg.estimatesEnabled !== true) return [];
  if (productType !== 'raw') return []; // 2. criterio 105: graded y sealed NUNCA.
  const out: T[] = [];
  for (const g of cfg.grades) {
    // 3. ausente / <= 0 / rancio / con slab publicado ⇒ se OMITE ESE grado (son INDEPENDIENTES).
    //    ⚠️ La FICHA **NO** aplica la cota de MAGNITUD (§4.38k.3): informa lo que hay. Si el dueño fijó
    //    a mano un estimado raro, la ficha se lo MUESTRA —es su dato, con su disclaimer— y solo la
    //    rejilla se niega a promoverlo. Suprimirlo también aquí convertiría un dato visible-y-corregible
    //    en una desaparición silenciosa.
    const e = usable(estimates, g, today, cfg, publishedSlabGrades);
    if (e != null) out.push(e);
  }
  return out.sort(byGradeDesc); // 4. orden desc (PSA 10 primero).
}

/**
 * TEJA / VITRINA (`gradingHighlight`) — CON gate de ROI sobre PSA 9 (§4.38c, decisión 41). Cada paso
 * produce un `reason` accionable; JAMÁS un default silencioso.
 *
 * ```
 * 1  !enabled            -> FEATURE_OFF     6  alguno rancio      -> STALE
 * 2  productType != raw  -> NOT_RAW         6b slab publicado     -> SLAB_PUBLISHED     (v1.50.2, INV-D)
 * 3  sin precio de venta -> NOT_PUBLISHED   6c psa10 <= raw       -> NOT_ABOVE_RAW      (unidades)
 * 4  psa10 ausente/<=0   -> NO_PSA10           psa10 > raw × mult -> ABOVE_MAX_MULTIPLE (cero de más)
 * 5  psa9 ausente/<=0    -> NO_PSA9            psa10 < psa9       -> GRADE_ORDER_INVERTED (cruzados)
 *                                           7  sin escalón        -> NO_COST_TIER  (jamás costo 0)
 *                                           8  psa9 < umbral      -> BELOW_MIN_UPSIDE
 * gate: psa9 × 100 >= (rawSalePriceCents + tier.costMxnCents) × (100 + minUpsidePct)   [entero]
 * ```
 *
 * - **Valor declarado = el estimado PSA 10** (§O.2.1): escenario más caro ⇒ escalón más alto ⇒ gate más
 *   estricto. Cambiarlo es UNA línea aquí y CERO cambio de contrato.
 * - **Aritmética ENTERA en el umbral** (MENOR-1): se compara `psa9 × 100 >= (rawSalePriceCents +
 *   tier.costMxnCents) × (100 + minUpsidePct)`. Nada de `× (1 + pct/100)`: esa forma se pasaba un centavo
 *   en ~157 000 combinaciones con umbral exacto entero (p. ej. `costBase=100000, pct=10`) y dejaba fuera
 *   a la carta que iguala EXACTAMENTE el umbral, contra el «si y solo si >=» del criterio 97. El
 *   `Math.ceil` sobrevive solo para el `thresholdMxnCents` que ve el DIAGNÓSTICO de admin.
 * - `highlight` = los `cfg.highlightGrades` con dato fresco y > 0 (hoy `['10']`). El gate SIEMPRE se
 *   evalúa con PSA 9 aunque PSA 9 no se pinte.
 */
export function evaluateGradingHighlight<T extends GradedEstimateInput>(input: {
  productType: 'raw' | 'graded' | 'sealed';
  rawSalePriceCents: number | null;
  estimates: T[];
  /** v1.50.2 (INV-D, §4.38l): grados con SLAB PUBLICADO ⇒ `SLAB_PUBLISHED`, no se promueve. */
  publishedSlabGrades?: readonly string[];
  today: string;
  cfg: GradedEstimateConfig;
}): GradingHighlightResult<T> {
  const { productType, rawSalePriceCents, estimates, today, cfg } = input;
  const publishedSlabGrades = input.publishedSlabGrades ?? [];
  const rawPsa10 = estimates.find((e) => e.gradeValue === '10');
  const rawPsa9 = estimates.find((e) => e.gradeValue === '9');
  const amountOf = (e: T | undefined): number | null =>
    e != null && isInt(e.mxnCents) && e.mxnCents > 0 ? e.mxnCents : null;
  const psa10MxnCents = amountOf(rawPsa10);
  const psa9MxnCents = amountOf(rawPsa9);
  // Diagnóstico: manda el capturedDate MÁS ANTIGUO de los grados presentes (el que decide la frescura).
  const dates = [rawPsa10, rawPsa9]
    .filter((e): e is T => e != null)
    .map((e) => e.capturedDate)
    .sort();
  const capturedDate = dates.length > 0 ? dates[0] : null;
  // v1.50.2: la frescura se evalúa POR FILA (asimétrica manual/automática, §4.38m), no por fecha suelta.
  const stale = [rawPsa10, rawPsa9]
    .filter((e): e is T => e != null)
    .some((e) => isStaleRef(e, today, cfg));
  // Cota SUPERIOR efectiva. Se trunca a ENTERO de centavos: `psa10 > floor(raw × mult)` es equivalente a
  // `psa10 > raw × mult` para `psa10` entero, y así el número que ve el operador en el `preview` es
  // exactamente el que se comparó (nada de un umbral flotante que no coincide con lo que se decidió).
  const maxAllowedPsa10MxnCents =
    rawSalePriceCents != null && isInt(rawSalePriceCents) && rawSalePriceCents > 0
      ? Math.floor(rawSalePriceCents * cfg.maxRawMultiple)
      : null;

  const no = (reason: HighlightReason): GradingHighlightResult<T> => ({
    eligible: false,
    reason,
    highlight: [],
    gradingCostTier: null,
    gradingCostMxnCents: null,
    thresholdMxnCents: null,
    netUpsidePsa9MxnCents: null,
    maxAllowedPsa10MxnCents,
    psa10MxnCents,
    psa9MxnCents,
    stale,
    capturedDate,
  });

  // GU-A8 (§4.38d): apagado por dial M10 `off` **o** por una clave PRESENTE-e-INVÁLIDA que gobierne la
  // promoción (`minUpsidePct`, `highlightGrades`) o la ficha (`grades`, `freshnessDays`). Un valor
  // corrupto es evidencia de que la intención del admin se perdió: **no se adivina**, se apaga.
  if (cfg.highlightEnabled !== true) return no('FEATURE_OFF');
  if (productType !== 'raw') return no('NOT_RAW');
  if (rawSalePriceCents == null || !isInt(rawSalePriceCents) || rawSalePriceCents <= 0) {
    return no('NOT_PUBLISHED'); // sin precio de venta no hay comparación posible.
  }
  // Orden de razones: primero AUSENCIA de dato (NO_PSA10/NO_PSA9), después FRESCURA (STALE) — así el
  // admin distingue «no lo he capturado» de «lo capturé hace mucho».
  if (psa10MxnCents == null) return no('NO_PSA10'); // se necesita para resolver el ESCALÓN.
  if (psa9MxnCents == null) return no('NO_PSA9'); // criterio 98: sin PSA 9 no se promueve.
  if (stale) return no('STALE'); // manda el MÁS ANTIGUO de los dos.

  // 6b. INV-D (§4.38l): con un SLAB PUBLICADO de un grado, esa fila es el precio de mercado REAL de una
  //     pieza física — no un estimado — y la pieza ya se lista con su propio precio.
  //
  //     El bloqueo se evalúa **POR GRADO** (criterio 112c), sobre los grados que ESTE gate consumió, en
  //     vez de contra los literales `'10'`/`'9'`. Hoy el resultado observable es el mismo, pero los
  //     literales acoplaban la guarda al VALOR del dial: el día que `grades`/`highlightGrades` admita
  //     otro grado, un `includes('10') || includes('9')` hardcodeado dejaría de mirarlo y la guarda de
  //     lectura se abriría en silencio sobre una fila que SÍ es dinero. Derivarlos de las filas que el
  //     gate ya resolvió hace que el conjunto vigilado y el conjunto usado no puedan divergir.
  //
  //     Sigue bloqueando el destacado ENTERO si cualquiera de los dos está tomado, y eso es correcto
  //     aquí: el gate de ROI necesita AMBOS grados (PSA 10 fija el escalón, PSA 9 decide). La parte
  //     «por grado» del criterio 112(c) —la carta sigue pudiendo mostrar el OTRO grado— la sostiene la
  //     FICHA, donde `usable()` filtra grado a grado; ésta es la superficie de PROMOCIÓN, no la de
  //     información.
  const slabTakenGrades = [rawPsa10, rawPsa9]
    .filter((e): e is T => e != null)
    .map((e) => e.gradeValue)
    .filter((g) => publishedSlabGrades.includes(g));
  if (slabTakenGrades.length > 0) return no('SLAB_PUBLISHED');

  // ============================ 6c. GATE DE MAGNITUD (§4.38k.2) ============================
  // ⚠️ LEER ANTES DE RELAJAR CUALQUIERA DE LAS TRES. **NO son redundantes**: cada una ataja un error
  // distinto, y quitar una no «simplifica» — abre exactamente su agujero.
  //
  //  (1) INFERIOR `psa10 > salePriceCents`  → caza el **ERROR DE UNIDADES** (USD escrito donde van MXN).
  //      La dirección es lo contraintuitivo y por eso queda escrito: uno espera que un error de moneda
  //      INFLE el número, pero USD→MXN mal aplicado lo **DEPRIME** (~19× MENOS). Un PSA 10 de USD 60
  //      guardado como MX$60 contra un raw de MX$400 queda BAJO, así que **el múltiplo máximo NO lo
  //      ve**: solo esta cota lo caza. (INV-FX lo previene en ORIGEN, §4.38a; ésta es la 2ª línea de
  //      defensa, para la captura manual y para cualquier ruta futura.)
  //  (2) SUPERIOR `psa10 <= salePriceCents × maxRawMultiple` → caza el **cero de más** / typo al alza.
  //  (3) DE ORDEN `psa10 >= psa9` → caza el **grado INTERCAMBIADO** (las dos filas capturadas cruzadas).
  //
  // Va ANTES de resolver el escalón (paso 7) A PROPÓSITO: si el número está en unidades equivocadas, el
  // escalón que elija es basura y el `threshold` que produzca también. Se descarta antes de contaminar
  // el resto del cálculo. La FICHA no aplica NADA de esto (§4.38k.3): informar ≠ promover.
  if (psa10MxnCents <= rawSalePriceCents) return no('NOT_ABOVE_RAW');
  if (maxAllowedPsa10MxnCents != null && psa10MxnCents > maxAllowedPsa10MxnCents) {
    return no('ABOVE_MAX_MULTIPLE');
  }
  if (psa10MxnCents < psa9MxnCents) return no('GRADE_ORDER_INVERTED');

  const tier = findGradingCostTier(cfg.gradingCostTiers, psa10MxnCents);
  if (tier == null) return no('NO_COST_TIER'); // SIN ESCALÓN, SIN DESTACADO — jamás costo 0.

  const costBase = rawSalePriceCents + tier.costMxnCents;
  // v1.44 MENOR-1 — ARITMÉTICA ENTERA. `costBase * (1 + pct/100)` introduce error de flotante: con
  // `costBase=100000` y `pct=10` el umbral exacto es 110000 y esa expresión da 110000.00000000001, que
  // `Math.ceil` sube a 110001 y deja FUERA a la carta cuyo PSA 9 iguala EXACTAMENTE el umbral — contra
  // el «si y solo si >=» del criterio 97. Se escala por 100 (`pct` es un porcentaje) y se compara en la
  // escala grande, donde con `pct` entero el producto es exacto (≤ 2.2e10 << 2^53).
  const thresholdScaled = costBase * (100 + cfg.minUpsidePct); // = umbral × 100
  const thresholdMxnCents = Math.ceil(thresholdScaled / 100); // solo para el DIAGNÓSTICO de admin
  const netUpsidePsa9MxnCents = psa9MxnCents - costBase;
  const base = {
    gradingCostTier: tier,
    gradingCostMxnCents: tier.costMxnCents,
    thresholdMxnCents,
    netUpsidePsa9MxnCents,
    maxAllowedPsa10MxnCents,
    psa10MxnCents,
    psa9MxnCents,
    stale,
    capturedDate,
  };
  // Insumo del diagnóstico: `netUpsidePsa9MxnCents` puede ser <= 0 aquí (por eso NO se usa como prueba
  // de elegibilidad — la prueba es el UMBRAL).
  // La DECISIÓN usa la escala entera, no el `thresholdMxnCents` redondeado: `psa9 × 100 >= umbral × 100`
  // ⟺ `psa9 >= ceil(umbral)` (psa9 es entero), así que el diagnóstico y el gate siguen coincidiendo.
  if (psa9MxnCents * 100 < thresholdScaled) {
    return { eligible: false, reason: 'BELOW_MIN_UPSIDE', highlight: [], ...base };
  }

  const highlight: T[] = [];
  for (const g of cfg.highlightGrades) {
    const e = usable(estimates, g, today, cfg, publishedSlabGrades);
    if (e != null) highlight.push(e);
  }
  // `netUpsidePsa9MxnCents > 0` garantizado aquí (psa9 >= threshold >= costBase, con minUpsidePct >= 0).
  return { eligible: true, highlight: highlight.sort(byGradeDesc), ...base };
}
