/**
 * Coste en CRÉDITOS del gancho de grading — las dos constantes que el aviso de encendido de M10
 * interpola, declaradas **en un solo módulo** (DESIGN_SYSTEM §22.12 nº13.d).
 *
 * **Por qué viven aquí y no en el copy.** El aviso de §22.13(d) cifra el **techo nominal** que
 * autoriza encender `gradingHookEnabled`. Desde §DYN (v1.113) ese número es el tope diario de créditos PSA
 * de M10 (`gradedEstimateDailyCreditCap`); antes era un producto de tres factores con el tope de cartas por corrida
 * de M2, retirado. Repartidos por el copy o duplicados en dos componentes se desincronizan del día a la
 * mañana, y el aviso pasaría a mentir sobre dinero: exactamente el defecto que §4.38(r) existe para
 * cerrar. Con un solo módulo, corregir el hecho es corregir una línea.
 *
 * ⚠️ **No son diales.** Nada de la UI los edita: si cambian, cambian en el backend/devops primero y
 * aquí después. El presupuesto oficial en créditos lo publica devops en `DEVOPS_NOTES.md`
 * (ARCHITECTURE §4.38r.3.1.1); estas constantes son su reflejo en pantalla.
 *
 * ⚠️ **El tope no es el gasto.** Es lo máximo que el servidor deja cargar en un día CDMX; el gasto real lo dice el
 * presupuesto (`GET /admin/pricing/graded-estimates/budget`). El módulo publica también el selector `costBasis` para
 * que la pantalla no pueda confundir «tope» con «medido».
 */

/**
 * v1.113⟨portada⟩ (API_CONTRACT §DYN.4.3) — créditos ESTIMADOS por carta del set cuando el proveedor no reportó lo que
 * gastó la última vez: `est = creditsMeasured ?? 2 × (cartas del set)`. No es un dial: es la regla del servidor, y aquí
 * solo se usa para explicarla en pantalla.
 */
export const GRADING_INGEST_CREDITS_PER_CARD = 2;

/** Rango del dial `gradedEstimateDailyCreditCap` (§DYN.3): entero en `[0, 20000]`; 0 = no se pide nada. */
export const GRADED_DAILY_CREDIT_CAP_MIN = 0;
export const GRADED_DAILY_CREDIT_CAP_MAX = 20_000;

/**
 * v1.113⟨portada⟩ (§DYN.3/§DYN.4.3) — **el techo de gasto PSA es el tope diario de M10**, ya no un producto
 * `cartas × créditos × corridas`. El dial `ingestMaxCardsPerRun` (el único factor configurable del modelo anterior) se
 * RETIRÓ: lo sustituye `gradedEstimateDailyCreditCap`, que el servidor aplica sobre lo CARGADO (lo que el proveedor
 * reporta o, si no lo reporta, la estimación de arriba). Exceso posible por diseño: el error de estimación de UN set
 * (I-4). Por eso la cifra ya no depende del régimen de cobro del proveedor.
 *
 * Devuelve el tope VIVO del servidor (nunca un literal) o `null` si no es un entero utilizable — el aviso de M10 cae
 * entonces a su variante sin cifras (`onNoFigures`): **cede la cifra, nunca el aviso** (§22.13d).
 */
export function gradingDailyCreditCap(cap: number | undefined | null): number | null {
  if (typeof cap !== 'number' || !Number.isInteger(cap)) return null;
  if (cap < GRADED_DAILY_CREDIT_CAP_MIN || cap > GRADED_DAILY_CREDIT_CAP_MAX) return null;
  return cap;
}

/**
 * ── El selector de VARIANTE del aviso (DESIGN_SYSTEM §22.13d.1, §22.12 nº13g) ────────────────
 *
 * Distingue «tope» de «coste medido»: el tope dice cuánto PUEDE gastar como máximo; el coste medido, cuánto gastó.
 */
export type GradingCostBasis = 'estimated' | 'measured';

/** Una medición REAL del entorno: cuánto gastó de verdad, y qué día se midió. */
export interface GradingCostMeasurement {
  /** Créditos/día que la corrida medida gastó de verdad (no un producto de constantes). */
  readonly creditsPerDay: number;
  /** Fecha de la medición, ISO `YYYY-MM-DD`. El frontend la formatea (§22.13j). */
  readonly measuredOn: string;
}

/**
 * Coste MEDIDO del entorno — **hoy `null`, y no es un pendiente de este módulo**.
 *
 * Su única fuente honesta es la línea `[VEREDICTO-PSA] COSTE MEDIDO:` de la sonda, transcrita a
 * `DEVOPS_NOTES.md` (ARCHITECTURE §4.38r.3.1.1): **no viaja en ningún DTO**, así que la pantalla no
 * puede verificarla. §22.13(h) lo prohíbe expresamente: rellenar esto desde un `.env`, un literal o
 * una constante «temporal» sería volver a afirmar como **medido** algo que nadie midió — el mismo
 * defecto que la v2.4 corrige, con la palabra «medido» encima. Se enciende el día que el contrato
 * exponga coste medido/día + fecha (solicitud abierta al arquitecto, §22.12 nº14), y ese día es
 * **rellenar este valor**, no reabrir el copy: el tipo obliga a traer cifra **y** fecha.
 */
export const GRADING_COST_MEASUREMENT: GradingCostMeasurement | null = null;

/**
 * Qué variante del aviso de encendido toca (§22.13d.1):
 *
 *   'measured'  ⇒ `onMeasured`  — hay medición del entorno (cifra + fecha)
 *   'estimated' ⇒ `on`          — hay tope diario (M10), no hay medición  ← hoy, siempre
 *
 * Sin tope utilizable gana `onNoFigures`, y eso lo decide la vista: es ausencia de dato, no base de coste.
 */
export function gradingCostBasis(): GradingCostBasis {
  return GRADING_COST_MEASUREMENT === null ? 'estimated' : 'measured';
}
