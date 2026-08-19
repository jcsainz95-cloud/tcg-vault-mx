import type { Finish, MasterSetCardCellDTO, MasterSetVariantDTO } from '@/types/contract';

/**
 * Orden canónico de acabados (`Finish`) para mostrar en UI (selects, chips, filtros).
 * Fuente ÚNICA: antes estaba triplicada en M1View / MasterSetBinder / CellDrawer (y también
 * en ShopFilters / BuylistView). Las etiquetas legibles viven en i18n (`finish.*`); esto solo
 * fija el ORDEN de presentación (normal → reverse → holo → 1st-ed holo).
 */
export const FINISH_ORDER: Finish[] = [
  'normal',
  'reverse_holo',
  'holofoil',
  'first_edition_holofoil',
];

/**
 * v1.22-2-finish-display (N-15/N-16). Acabados que el FRONT debe PINTAR de una fuente que trae
 * `displayFinishes` (⊆ `availableFinishes`, orden FINISH_ORDER, nunca vacío) — CardDTO o
 * MasterSetCardCellDTO. RESILIENCIA: si el backend aún no emite `displayFinishes` en ese endpoint
 * se usa `availableFinishes` como fallback (contrato v1.22-2, ARCHITECTURE §4.22c). Siempre se
 * re-ordena por FINISH_ORDER y se garantiza no-vacío (último recurso: availableFinishes).
 *
 * Fuente ÚNICA de la regla de DISPLAY: la usan el binder plano (4 vistas) y el cotizador para no
 * duplicar la lógica `displayFinishes ?? availableFinishes` en cada consumidor.
 */
export function displayFinishesOf(source: {
  displayFinishes?: Finish[] | null;
  availableFinishes: Finish[];
}): Finish[] {
  const preferred = source.displayFinishes ?? source.availableFinishes;
  const ordered = FINISH_ORDER.filter((f) => preferred.includes(f));
  if (ordered.length > 0) return ordered;
  // `displayFinishes` nunca debería ser vacío (garantía del contrato); si por drift llegara vacío,
  // se degrada a availableFinishes para NO dejar una carta sin ninguna tarjeta que pintar.
  return FINISH_ORDER.filter((f) => source.availableFinishes.includes(f));
}

/**
 * N-16: ¿esta variante se PINTA? Espejo de `variant.displayed`; si el backend aún no lo emite,
 * se deriva `finish ∈ displayFinishesOf(cell)`. Las NO mostradas cuentan en completitud pero no
 * se renderizan (contrato v1.22-2).
 */
export function isVariantDisplayed(
  cell: MasterSetCardCellDTO,
  variant: MasterSetVariantDTO,
): boolean {
  if (typeof variant.displayed === 'boolean') return variant.displayed;
  return displayFinishesOf(cell).includes(variant.finish);
}

/**
 * N-16: expande una celda de Master Set en sus VARIANTES A PINTAR (una por acabado de
 * `displayFinishes`), en orden canónico FINISH_ORDER. Es la base del render PLANO: cada variante
 * devuelta es una tarjeta independiente (carta+acabado) con su propio precio/acción. Reusado por
 * las 4 vistas del binder (cotizador, M1, Mi bóveda, bóvedas de cliente admin).
 *
 * Nunca inventa una variante: si `variants[]` no trae una entrada para un displayFinish (drift),
 * ese acabado se OMITE (no se pinta una tarjeta sin datos). Los contadores de completitud NO se
 * tocan aquí: siguen sobre `expected/coveredVariantCount` (availableFinishes).
 */
export function displayedVariants(cell: MasterSetCardCellDTO): MasterSetVariantDTO[] {
  const display = displayFinishesOf(cell);
  return display
    .map((f) => cell.variants.find((v) => v.finish === f))
    .filter((v): v is MasterSetVariantDTO => v != null && isVariantDisplayed(cell, v));
}
