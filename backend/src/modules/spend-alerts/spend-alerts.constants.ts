/**
 * spend-alerts.constants.ts — 💰 constantes de MECANISMO del despacho de avisos (API_CONTRACT §M4-SHIP.19.29.8 «⛔ no diales:
 * mecanismo», §19.30.7). Ninguna es política del dueño: si el dueño quiere otro número, es una errata, no un ajuste.
 *
 * Candados consultivos (censo de claves de §19.28.8, PS-132 (b) / PS-165): `SPEND_MAIL_LOCK_KEY = 65_310_702` (§19.29.5) y
 * el rango propio de D2g `65_310_710…719` (§19.32.9). ⛔ Ningún otro módulo usa estos valores.
 */

/** §19.29.5 — serializa el «¿cabe en la hora?» + `pending → sending` del correo inmediato y el lote. */
export const SPEND_MAIL_LOCK_KEY = 65_310_702;
/** D2g — un solo `spend-watch` a la vez (single-flight del paso (0) y de los barridos AG-8 (b) / AG-10). */
export const SPEND_WATCH_LOCK_KEY = 65_310_710;
/** D2g — un solo `spend-digest` a la vez (el `INSERT … ON CONFLICT` ya da «una vez por día»; esto evita dos envíos en carrera tras un `failed`). */
export const SPEND_DIGEST_LOCK_KEY = 65_310_711;

/** §19.29.5 — correos inmediatos por HORA DE RELOJ (el de lote no cuenta). */
export const SPEND_MAIL_HOURLY_MAX = 5;
/** §19.30.7 (C-24) — correos inmediatos por PERSONA (`subjectUserId`) y hora; lo demás de esa persona va al lote. */
export const SPEND_MAIL_PER_SUBJECT_HOURLY_MAX = 2;
/** §19.29.5 — `failed` se reintenta hasta 3 veces (`mailAttempts < 3`). */
export const SPEND_MAIL_MAX_ATTEMPTS = 3;
/** §19.29.5 — un `sending` de más de 10 min ⇒ `failed_unknown` (⛔ no se reintenta: puede haber salido). */
export const SPEND_MAIL_SENDING_STALE_MS = 10 * 60 * 1000;
/** §19.13 / §19.29.7 — la lectura de saldo del proveedor se cachea 5 min (una llamada, no una por carga). */
export const PROVIDER_BALANCE_CACHE_MS = 5 * 60 * 1000;
/** §19.29.9 — paginación del panel. */
export const SPEND_ALERTS_DEFAULT_PAGE_SIZE = 25;
export const SPEND_ALERTS_MAX_PAGE_SIZE = 100;
/** §19.29.9 — `POST …/seen`: 1..200 ids. */
export const SPEND_ALERTS_SEEN_MAX_IDS = 200;

/** Reloj del módulo (token DI). Las pruebas lo sustituyen por uno manual (PS-149 «reloj inyectado», PS-154 «08:00 MX»). */
export const SPEND_ALERTS_CLOCK = 'SPEND_ALERTS_CLOCK';
export interface SpendClock {
  now(): Date;
}
export const systemSpendClock: SpendClock = { now: () => new Date() };

/**
 * Avisos que la tarjeta y el badge NO cuentan en `unseen*` (criterio 331, sin doble conteo): AG-7, AG-11 y AG-12 ya los cuenta
 * `workQueue.shipping` (§19.29.9 «Tablero»). Siguen en la lista.
 */
export const UNSEEN_EXCLUDED_KINDS = ['provider_balance_low', 'parcel_returned', 'parcel_problem'] as const;
