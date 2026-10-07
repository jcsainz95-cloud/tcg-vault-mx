/**
 * wishlist.constants.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH). Tokens, claves y dominios de la lista de deseos.
 */
import { SettingKey } from '../settings/settings.constants';
import type { WishlistIvaMode, WishlistMarginBasis } from '../../common/wishlist-math';

/**
 * Reloj del módulo (y del «avísame» de sellados, que lo pide por el MISMO token desde `catalog`). Por NOMBRE para que las
 * pruebas lo sustituyan sin importar este fichero. `detectedAt`, `sentAt`, la ventana y el «día de México» del tope salen de
 * aquí, nunca de `now()` de la BD.
 */
export const WISHLIST_CLOCK = 'WISHLIST_CLOCK';
export interface WishlistClock {
  now(): Date;
}
export const systemWishlistClock: WishlistClock = { now: () => new Date() };

/** Prefijo de dominio del HMAC de los enlaces del correo (`pii-crypto.service.ts` `domainHmac`; ⛔ ningún secreto nuevo). */
export const WISHLIST_MAIL_DOMAIN = 'wsh-mail:v1:';

/**
 * D-WSH-7 — candados consultivos de Postgres (single-flight entre instancias; ⛔ no la bandera en memoria). Rango propio
 * 87_740_100…109 (censo de claves: spend 65_310_7xx, Skydropx 65_310_70x, IVA 64_440_950, FX 63_120_863).
 */
export const WISHLIST_NOTIFY_LOCK_KEY = 87_740_101;
export const SEALED_RESTOCK_NOTIFY_LOCK_KEY = 87_740_102;

/** Motivos de `skipped` (CHECK `wishlist_notice_skip_reason` de M-74). */
export type WishlistSkipReason = 'paused' | 'unverified' | 'inactive' | 'unavailable';

export interface WishlistDials {
  enabled: boolean;
  maxPerAccount: number;
  ivaMode: WishlistIvaMode;
  dailyMailCap: number;
  mailWindowMin: number;
  targetMarginPct: number;
  marginBasis: WishlistMarginBasis;
  sealedMaxPendingPerEmail: number;
}

export const WISHLIST_DIAL_KEYS = [
  SettingKey.WISHLIST_ENABLED,
  SettingKey.WISHLIST_MAX_PER_ACCOUNT,
  SettingKey.WISHLIST_MAX_IVA_MODE,
  SettingKey.WISHLIST_DAILY_MAIL_CAP,
  SettingKey.WISHLIST_MAIL_WINDOW_MIN,
  SettingKey.WISHLIST_TARGET_MARGIN_PCT,
  SettingKey.WISHLIST_MARGIN_BASIS,
  SettingKey.SEALED_RESTOCK_MAX_PENDING_PER_EMAIL,
] as const;
