import type { Finish } from '@/types/contract';

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
