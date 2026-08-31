/**
 * Coste en CRÉDITOS del gancho de grading — las dos constantes que el aviso de encendido de M10
 * interpola, declaradas **en un solo módulo** (DESIGN_SYSTEM §22.12 nº13.d).
 *
 * **Por qué viven aquí y no en el copy.** El aviso de §22.13(d) cifra el **techo nominal** que
 * autoriza encender `gradingHookEnabled`. Ese número es el producto de tres factores y solo **uno**
 * es configurable desde el producto (`ingestMaxCardsPerRun`, M2). Los otros dos —cuánto cuesta cada
 * carta en el proveedor de paga y cuántas veces al día corre el barrido— son hechos del backend y
 * del cron. Repartidos por el copy o duplicados en dos componentes se desincronizan del día a la
 * mañana, y el aviso pasaría a mentir sobre dinero: exactamente el defecto que §4.38(r) existe para
 * cerrar. Con un solo módulo, corregir el hecho es corregir una línea.
 *
 * ⚠️ **No son diales.** Nada de la UI los edita: si cambian, cambian en el backend/devops primero y
 * aquí después. El presupuesto oficial en créditos lo publica devops en `DEVOPS_NOTES.md`
 * (ARCHITECTURE §4.38r.3.1.1); estas constantes son su reflejo en pantalla.
 *
 * ⚠️ **Y no son un presupuesto.** Su producto es un techo **condicionado** al régimen de cobro del
 * proveedor, que nadie ha observado todavía (§22.13d.1). El módulo publica también el selector
 * `costBasis` para que la pantalla no pueda confundir «calculado» con «medido».
 */

/**
 * Créditos que el proveedor de paga cobra **por carta** en el ingest de fase 2
 * (ARCHITECTURE §4.38h.3: `includeEbay=true` ⇒ **2 créditos/carta**).
 */
export const GRADING_INGEST_CREDITS_PER_CARD = 2;

/**
 * Corridas del barrido al día (cron `price-ingest`, **2×/día**, ARCHITECTURE §4.38r.3.1.1).
 * El «≤ 12 h» de §4.38(r.5) es la otra cara de este mismo número; no se pinta en pantalla.
 */
export const GRADING_INGEST_RUNS_PER_DAY = 2;

/**
 * Techo de gasto diario `cartas × créditos/carta × corridas` **BAJO EL SUPUESTO de que el proveedor
 * cobra por petición**. Con los topes de hoy (250 × 2 × 2) da 1 000 créditos/día — un techo bajo un
 * supuesto, **no un presupuesto**: nadie lo ha medido.
 *
 * ⚠️ **No es el gasto.** Si el proveedor cobra por carta **devuelta**, la petición pide el set
 * entero y el gasto real es este número × `A` (≥ 1, sin dial que lo acote). Quien pinte este valor
 * está obligado a pintar el supuesto en la misma frase (§22.13d.1): la clave `…gradingHook.on` ya
 * lo hace, y por eso no existe ninguna cadena que interpole `{credits}` a secas.
 *
 * Devuelve `null` cuando el tope de cartas no es un entero positivo utilizable — el aviso entonces
 * cae a su variante sin cifras (`onNoFigures`): **cede la cifra, nunca el aviso** (§22.13d).
 */
export function gradingIngestDailyCreditCeiling(maxCardsPerRun: number | undefined | null): number | null {
  if (typeof maxCardsPerRun !== 'number' || !Number.isFinite(maxCardsPerRun) || maxCardsPerRun <= 0) {
    return null;
  }
  return Math.round(maxCardsPerRun) * GRADING_INGEST_CREDITS_PER_CARD * GRADING_INGEST_RUNS_PER_DAY;
}

/**
 * ── El selector de VARIANTE del aviso (DESIGN_SYSTEM §22.13d.1, §22.12 nº13g) ────────────────
 *
 * El techo de arriba **solo vale si el proveedor cobra por petición**. La petición manda
 * `fetchAllInSet=true` —pide el **set entero**—, así que `ingestMaxCardsPerRun` acota las cartas
 * **en alcance**, no las **devueltas**: si se cobra por carta devuelta, el gasto real es
 * `techo × A`, con `A = devueltas / en alcance ≥ 1` y **ningún dial que lo acote** (250 cartas en
 * 20 sets de 200 dan `A = 16`). Por eso el copy publica la cifra **con su supuesto pegado** y este
 * selector existe: distingue «techo calculado» de «coste medido».
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
 *   'estimated' ⇒ `on`          — hay tope de M2, no hay medición  ← hoy, siempre
 *
 * Sin tope de M2 gana `onNoFigures`, y eso lo decide la vista: es ausencia de dato, no base de coste.
 */
export function gradingCostBasis(): GradingCostBasis {
  return GRADING_COST_MEASUREMENT === null ? 'estimated' : 'measured';
}
