/**
 * Coste en CRÉDITOS del gancho de grading — las dos constantes que el aviso de encendido de M10
 * interpola, declaradas **en un solo módulo** (DESIGN_SYSTEM §22.12 nº13.d).
 *
 * **Por qué viven aquí y no en el copy.** El aviso de §22.13(d) cifra el gasto diario máximo que
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
 * Techo de gasto diario: `cartas × créditos/carta × corridas`. Con los topes de hoy
 * (250 × 2 × 2) son **1 000 créditos al día**.
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
