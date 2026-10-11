/**
 * promo-plan.ts — ⭐ v1.80.12 (API_CONTRACT §M4-SHIP.19.20.4, A-4): ¿la tarifa es una PROMOCIÓN? Función pura; fichero
 * propio (⛔ no toca el adaptador ni el cliente de D1).
 *
 * `true` ⇔ `planType` casa con `/^PROMO_/` o `/^\d+PESOS?_/`. Medidos (`SKYDROPX_API_PROD_RESULTADOS.md:192-193`):
 * `50PESOS_30042026`, `50PESOS_20052026`, `PROMO_1_PESO_19082026` ⇒ promo; `ACQ_2026` ⇒ tarifa normal. `null` o cualquier
 * otro ⇒ `false` (⛔ no se afirma una promo que no se reconoce). ⛔ El sufijo NO se interpreta como fecha (NO MEDIDO).
 * Un patrón nuevo se añade aquí con su fila en PS-111.
 */
const PROMO_PATTERNS: readonly RegExp[] = [/^PROMO_/, /^\d+PESOS?_/];

export function isPromoPlan(planType: string | null | undefined): boolean {
  if (typeof planType !== 'string' || planType === '') return false;
  return PROMO_PATTERNS.some((re) => re.test(planType));
}
