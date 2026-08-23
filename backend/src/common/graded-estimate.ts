/**
 * graded-estimate.ts (v1.44, ARCHITECTURE §4.35, PROJECT §N v2.0) — «gancho de grading»: lógica PURA
 * del estimado por grado y del gate de CURADURÍA. Zona compartida (`common/`), sin dependencias de
 * infra (importable desde tests, seeds y `settings.constants`), hermana de `money.ts` /
 * `pricing-tiers.ts`.
 *
 * LA PARTICIÓN QUE GOBIERNA TODO (§4.35-0): INFORMAR ≠ PROMOVER.
 *   - FICHA  (`gradedEstimates`)  → `selectGradedEstimates`  → SIN gate: basta dato FRESCO y > 0.
 *   - TEJA/VITRINA (`gradingHighlight`) → `evaluateGradingHighlight` → CON gate de ROI sobre PSA 9.
 * Una carta puede mostrar sus estimados en la ficha y NO estar destacada. Es deliberado.
 *
 * SEC-A1 (reforzado): de `evaluateGradingHighlight` SOLO `eligible` + `highlight` llegan al cliente
 * (y `highlight` lo hace como PRESENCIA del campo). `netUpsidePsa9MxnCents`, `thresholdMxnCents`,
 * `gradingCostTier` y `reason` alimentan el ORDEN de la vitrina y el diagnóstico de admin; JAMÁS el DTO
 * público. Por eso las puras reciben `{ gradeValue, mxnCents, capturedDate }` y NUNCA `source` /
 * `isManualOverride`: ninguna rama puede bifurcar por ORIGEN del número (indistinguibilidad fase 1 ⇄ 2,
 * §4.35g).
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
 * **v1.44.1 (GU-A8, §4.35d) — TRES interruptores, no uno.** El fail-closed distingue *AUSENTE* de
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
   * el `warn`, §4.35d › Observabilidad), porque el contrato lo define como espejo del dial.
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
  /** Ventana de frescura en días (seed 30) — aplica a las DOS superficies. */
  freshnessDays: number;
  /** Umbral de ROI del gate de CURADURÍA (seed 30). NO afecta la ficha. */
  minUpsidePct: number;
  /** Tabla de escalones del gate de CURADURÍA. Vacía ⇒ nada se destaca. NO afecta la ficha. */
  gradingCostTiers: GradingCostTier[];
}

/** El `GradedEstimateConfigDTO` del contrato (§M2). Los flags internos de GU-A8 NO forman parte de él. */
export type GradedEstimateConfigDTO = Omit<
  GradedEstimateConfig,
  'estimatesEnabled' | 'highlightEnabled'
>;

/**
 * Proyección al DTO del contrato. **Existe para que añadir estado interno al resolver NO cambie la forma
 * de `GET/PUT /admin/pricing/graded-estimates` ni del `config` del preview** (antes se devolvía el objeto
 * interno tal cual, así que cualquier campo nuevo se filtraba al contrato sin querer).
 */
export function toGradedEstimateConfigDTO(cfg: GradedEstimateConfig): GradedEstimateConfigDTO {
  return {
    enabled: cfg.enabled,
    grades: cfg.grades,
    highlightGrades: cfg.highlightGrades,
    freshnessDays: cfg.freshnessDays,
    minUpsidePct: cfg.minUpsidePct,
    gradingCostTiers: cfg.gradingCostTiers,
  };
}

/** Un estimado por grado, ya resuelto a MXN. Deliberadamente SIN `source`/`isManualOverride` (§4.35g). */
export interface GradedEstimateInput {
  /** `"10"` | `"9"` (string abierto en el TIPO: añadir un grado no es cambio de contrato). */
  gradeValue: string;
  mxnCents: number;
  /** `YYYY-MM-DD` (date-only, misma convención que `PriceReference.capturedDate @db.Date`). */
  capturedDate: string;
}

/** Razón accionable por la que un grupo NO quedó destacado (solo admin/diagnóstico, §4.35d). */
export type HighlightReason =
  | 'FEATURE_OFF'
  | 'NOT_RAW'
  | 'NOT_PUBLISHED'
  | 'NO_PSA10'
  | 'NO_PSA9'
  | 'STALE'
  | 'NO_COST_TIER'
  | 'BELOW_MIN_UPSIDE';

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

/** MVP: única graduadora soportada (§N.1; CGC/BGS/TAG fuera de alcance). */
export const GRADED_ESTIMATE_COMPANY = 'PSA' as const;

/**
 * Conjunto CERRADO de grados soportados (I7 del `PUT`). El gate SIEMPRE necesita PSA 9 aunque el badge
 * no lo pinte, por eso el batch lee siempre los dos. Grados PSA <= 8 quedan fuera de alcance (§N.1).
 */
export const GRADED_ESTIMATE_GRADE_VALUES: readonly string[] = ['10', '9'];

/** `gradeKey` canónico del estimado (§4.35a). Empata con `buildGradeKey({productType:'graded'})`. */
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
 * Seed de `grading_cost_tiers` (§4.35d / PROJECT §N.2.1), intervalos SEMIABIERTOS `[min, max)` en
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

/** Seeds de los diales NO-dinero (umbrales/listas). Su ausencia SÍ puede caer aquí (§4.35d). */
export const DEFAULT_GRADED_ESTIMATE_GRADES: string[] = ['10', '9'];
export const DEFAULT_GRADED_ESTIMATE_HIGHLIGHT_GRADES: string[] = ['10'];
export const DEFAULT_GRADED_ESTIMATE_FRESHNESS_DAYS = 30;
export const DEFAULT_GRADING_MIN_UPSIDE_PCT = 30;

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
 * Lectura FAIL-CLOSED de la tabla (§4.35d): clave ausente, corrupta o que no cumple I1–I5 ⇒ tabla
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

/** ¿El estimado de `gradeValue` sirve? (existe, > 0 y fresco). */
function usable<T extends GradedEstimateInput>(
  estimates: T[],
  gradeValue: string,
  today: string,
  freshnessDays: number,
): T | null {
  const e = estimates.find((x) => x.gradeValue === gradeValue);
  if (e == null) return null;
  if (!isInt(e.mxnCents) || e.mxnCents <= 0) return null; // un 0 NO es un estimado (money-safe).
  if (isStaleEstimate(e.capturedDate, today, freshnessDays)) return null;
  return e;
}

/**
 * FICHA (`gradedEstimates`) — SIN gate de ROI (§4.35c). Devuelve los grados de `cfg.grades` con dato
 * FRESCO y > 0, en orden descendente. Los grados son INDEPENDIENTES: tener PSA 10 y no PSA 9 emite un
 * arreglo de UN elemento.
 *
 * `[]` ⇒ el caller **OMITE** el campo (jamás emite `[]`: un arreglo vacío es un contenedor renderizable
 * y, peor, filtraría la decisión del gate).
 */
export function selectGradedEstimates<T extends GradedEstimateInput>(input: {
  productType: 'raw' | 'graded' | 'sealed';
  estimates: T[];
  today: string;
  cfg: GradedEstimateConfig;
}): T[] {
  const { productType, estimates, today, cfg } = input;
  // 1. fail-closed: dial M10 `off` (seed) **o** GU-A8 — `grades`/`freshnessDays` PRESENTE-e-INVÁLIDA.
  //    Sin un umbral de frescura confiable no se puede afirmar que una cifra esté vigente, así que la
  //    ficha tampoco informa (§4.35d › «Alcance del apagado»).
  if (cfg.estimatesEnabled !== true) return [];
  if (productType !== 'raw') return []; // 2. criterio 87: graded y sealed NUNCA.
  const out: T[] = [];
  for (const g of cfg.grades) {
    const e = usable(estimates, g, today, cfg.freshnessDays); // 3. ausente / <= 0 / rancio ⇒ se OMITE ESE grado.
    if (e != null) out.push(e);
  }
  return out.sort(byGradeDesc); // 4. orden desc (PSA 10 primero).
}

/**
 * TEJA / VITRINA (`gradingHighlight`) — CON gate de ROI sobre PSA 9 (§4.35c, decisión 41). Cada paso
 * produce un `reason` accionable; JAMÁS un default silencioso.
 *
 * ```
 * 1 !enabled            -> FEATURE_OFF      5 psa9 ausente/<=0  -> NO_PSA9
 * 2 productType != raw  -> NOT_RAW          6 alguno rancio     -> STALE
 * 3 sin precio de venta -> NOT_PUBLISHED    7 sin escalón       -> NO_COST_TIER   (jamás costo 0)
 * 4 psa10 ausente/<=0   -> NO_PSA10         8 psa9 < umbral     -> BELOW_MIN_UPSIDE
 * gate: psa9 × 100 >= (rawSalePriceCents + tier.costMxnCents) × (100 + minUpsidePct)   [entero]
 * ```
 *
 * - **Valor declarado = el estimado PSA 10** (§N.2.1): escenario más caro ⇒ escalón más alto ⇒ gate más
 *   estricto. Cambiarlo es UNA línea aquí y CERO cambio de contrato.
 * - **Aritmética ENTERA en el umbral** (MENOR-1): se compara `psa9 × 100 >= (rawSalePriceCents +
 *   tier.costMxnCents) × (100 + minUpsidePct)`. Nada de `× (1 + pct/100)`: esa forma se pasaba un centavo
 *   en ~157 000 combinaciones con umbral exacto entero (p. ej. `costBase=100000, pct=10`) y dejaba fuera
 *   a la carta que iguala EXACTAMENTE el umbral, contra el «si y solo si >=» del criterio 79. El
 *   `Math.ceil` sobrevive solo para el `thresholdMxnCents` que ve el DIAGNÓSTICO de admin.
 * - `highlight` = los `cfg.highlightGrades` con dato fresco y > 0 (hoy `['10']`). El gate SIEMPRE se
 *   evalúa con PSA 9 aunque PSA 9 no se pinte.
 */
export function evaluateGradingHighlight<T extends GradedEstimateInput>(input: {
  productType: 'raw' | 'graded' | 'sealed';
  rawSalePriceCents: number | null;
  estimates: T[];
  today: string;
  cfg: GradedEstimateConfig;
}): GradingHighlightResult<T> {
  const { productType, rawSalePriceCents, estimates, today, cfg } = input;
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
  const stale = dates.some((d) => isStaleEstimate(d, today, cfg.freshnessDays));

  const no = (reason: HighlightReason): GradingHighlightResult<T> => ({
    eligible: false,
    reason,
    highlight: [],
    gradingCostTier: null,
    gradingCostMxnCents: null,
    thresholdMxnCents: null,
    netUpsidePsa9MxnCents: null,
    psa10MxnCents,
    psa9MxnCents,
    stale,
    capturedDate,
  });

  // GU-A8 (§4.35d): apagado por dial M10 `off` **o** por una clave PRESENTE-e-INVÁLIDA que gobierne la
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
  if (psa9MxnCents == null) return no('NO_PSA9'); // criterio 80: sin PSA 9 no se promueve.
  if (stale) return no('STALE'); // manda el MÁS ANTIGUO de los dos.

  const tier = findGradingCostTier(cfg.gradingCostTiers, psa10MxnCents);
  if (tier == null) return no('NO_COST_TIER'); // SIN ESCALÓN, SIN DESTACADO — jamás costo 0.

  const costBase = rawSalePriceCents + tier.costMxnCents;
  // v1.44 MENOR-1 — ARITMÉTICA ENTERA. `costBase * (1 + pct/100)` introduce error de flotante: con
  // `costBase=100000` y `pct=10` el umbral exacto es 110000 y esa expresión da 110000.00000000001, que
  // `Math.ceil` sube a 110001 y deja FUERA a la carta cuyo PSA 9 iguala EXACTAMENTE el umbral — contra
  // el «si y solo si >=» del criterio 79. Se escala por 100 (`pct` es un porcentaje) y se compara en la
  // escala grande, donde con `pct` entero el producto es exacto (≤ 2.2e10 << 2^53).
  const thresholdScaled = costBase * (100 + cfg.minUpsidePct); // = umbral × 100
  const thresholdMxnCents = Math.ceil(thresholdScaled / 100); // solo para el DIAGNÓSTICO de admin
  const netUpsidePsa9MxnCents = psa9MxnCents - costBase;
  const base = {
    gradingCostTier: tier,
    gradingCostMxnCents: tier.costMxnCents,
    thresholdMxnCents,
    netUpsidePsa9MxnCents,
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
    const e = usable(estimates, g, today, cfg.freshnessDays);
    if (e != null) highlight.push(e);
  }
  // `netUpsidePsa9MxnCents > 0` garantizado aquí (psa9 >= threshold >= costBase, con minUpsidePct >= 0).
  return { eligible: true, highlight: highlight.sort(byGradeDesc), ...base };
}
