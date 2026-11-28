import { ApiClientError } from '@/lib/api-client';
import { formatMoneyCents } from '@/lib/format';
import type { AppLocale } from '@/i18n/routing';

/**
 * §BUYLIST-ES F3 (§4.1.3/§4.1.4/§9.3) · los tres 422 nuevos de la recepción y el precio del operador, con texto claro en es/en
 * (`admin.m5.flow.f2.version.errors.*`). Devuelve `null` si el error no es uno de ellos (el llamador cae a su ruta de siempre).
 *  - `VERSION_PRICE_UNAVAILABLE`: no hay precio para lo recibido ⇒ la UI ofrece «Carta distinta» (`reject-items`, `wrong_card`).
 *  - `OVER_VERSION_CAP`: el monto revisado pasa de la oferta de la versión recibida.
 *  - `ES_OVER_CAP`: precio del staff en línea ES por encima de `min(oferta EN, referencia)`; tope duro (`details.capCents`).
 * El monto del tope lo manda el servidor (`details.capCents`); aquí solo se formatea. Admin-only: el cliente nunca lo ve.
 */
export type VersionErrorCode = 'VERSION_PRICE_UNAVAILABLE' | 'OVER_VERSION_CAP' | 'ES_OVER_CAP';

export function versionErrorCode(e: unknown): VersionErrorCode | null {
  if (!(e instanceof ApiClientError) || e.status !== 422) return null;
  return e.code === 'VERSION_PRICE_UNAVAILABLE' || e.code === 'OVER_VERSION_CAP' || e.code === 'ES_OVER_CAP' ? e.code : null;
}

export function versionErrorText(
  e: unknown,
  t: (key: string, values?: Record<string, string>) => string,
  locale: AppLocale,
): string | null {
  const code = versionErrorCode(e);
  if (!code) return null;
  if (code === 'VERSION_PRICE_UNAVAILABLE') return t('unavailable');
  const capCents = (e as ApiClientError).details?.capCents;
  const cap = typeof capCents === 'number' ? t('capOf', { amount: formatMoneyCents(capCents, locale) }) : '';
  return code === 'OVER_VERSION_CAP' ? t('overVersionCap', { cap }) : t('esOverCap', { cap });
}
