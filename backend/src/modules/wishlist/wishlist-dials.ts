/**
 * wishlist-dials.ts — rev v1.87⟨wishlist⟩ (§WSH.2). Lectura de los ocho diales en UNA consulta (`getRawMany` + seed), con
 * el mismo fallback que `SettingsService.get()`. Un valor fuera de dominio en la fila (escrito a mano) cae al seed: el
 * validador de `PUT /admin/settings` ya impide escribirlo por la API.
 */
import { SettingsService } from '../settings/settings.service';
import { SETTING_DEFAULTS, SETTING_VALIDATORS, SettingKey, SettingKeyType } from '../settings/settings.constants';
import { WISHLIST_DIAL_KEYS, WishlistDials } from './wishlist.constants';
import type { WishlistIvaMode, WishlistMarginBasis } from '../../common/wishlist-math';

export async function readWishlistDials(settings: SettingsService): Promise<WishlistDials> {
  const rows = await settings.getRawMany(WISHLIST_DIAL_KEYS);
  const get = <T>(k: SettingKeyType): T => {
    const v = rows.has(k) ? rows.get(k) : SETTING_DEFAULTS[k];
    return (SETTING_VALIDATORS[k](v) === null ? v : SETTING_DEFAULTS[k]) as T;
  };
  return {
    enabled: get<string>(SettingKey.WISHLIST_ENABLED) === 'on',
    maxPerAccount: get<number>(SettingKey.WISHLIST_MAX_PER_ACCOUNT),
    ivaMode: get<WishlistIvaMode>(SettingKey.WISHLIST_MAX_IVA_MODE),
    dailyMailCap: get<number>(SettingKey.WISHLIST_DAILY_MAIL_CAP),
    mailWindowMin: get<number>(SettingKey.WISHLIST_MAIL_WINDOW_MIN),
    targetMarginPct: get<number>(SettingKey.WISHLIST_TARGET_MARGIN_PCT),
    marginBasis: get<WishlistMarginBasis>(SettingKey.WISHLIST_MARGIN_BASIS),
    sealedMaxPendingPerEmail: get<number>(SettingKey.SEALED_RESTOCK_MAX_PENDING_PER_EMAIL),
  };
}
