/**
 * demand.constants.ts — §DEMANDA (API_CONTRACT_DEMANDA §1-§2, §5). Constantes y lectura de los tres diales.
 */
import { SettingsService } from '../settings/settings.service';
import { SETTING_DEFAULTS, SETTING_VALIDATORS, SettingKey, SettingKeyType } from '../settings/settings.constants';

export const DEMAND_SORTS = ['score', 'wishlist', 'search', 'market'] as const;
export type DemandSort = (typeof DEMAND_SORTS)[number];
export const DEMAND_DIRS = ['asc', 'desc'] as const;
export const DEMAND_LIMIT_DEFAULT = 100;
export const DEMAND_LIMIT_MAX = 200;
export const DEMAND_CSV_MAX_ROWS = 1000;
/** Clave de `ConfigSetting` con la última corrida BUENA de `demand-match` (ISO). No es un dial: no pasa por `SettingKey`. */
export const DEMAND_MATCH_LAST_OK_KEY = 'demand_match_last_ok';
/** Un término ya `matched` se re-evalúa pasados estos días. */
export const DEMAND_MATCH_REEVAL_DAYS = 30;
export const DEMAND_MATCH_MAX_RESULTS = 5;

export interface DemandDials {
  wWishlist: number;
  wSearch: number;
  searchWindowDays: number;
}

export const DEMAND_DIAL_KEYS = [SettingKey.DEMAND_W_WISHLIST, SettingKey.DEMAND_W_SEARCH, SettingKey.DEMAND_SEARCH_WINDOW_DAYS] as const;

/** Una consulta; un valor fuera de dominio escrito a mano cae al seed (el validador de `PUT /admin/settings` ya lo impide por la API). */
export async function readDemandDials(settings: SettingsService): Promise<DemandDials> {
  const rows = await settings.getRawMany(DEMAND_DIAL_KEYS);
  const get = (k: SettingKeyType): number => {
    const v = rows.has(k) ? rows.get(k) : SETTING_DEFAULTS[k];
    return (SETTING_VALIDATORS[k](v) === null ? v : SETTING_DEFAULTS[k]) as number;
  };
  return {
    wWishlist: get(SettingKey.DEMAND_W_WISHLIST),
    wSearch: get(SettingKey.DEMAND_W_SEARCH),
    searchWindowDays: get(SettingKey.DEMAND_SEARCH_WINDOW_DAYS),
  };
}
