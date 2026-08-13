import type { AppLocale } from '@/i18n/routing';

const localeTag: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };

/** Convierte centavos MXN a texto localizado: `MX$ 1,250.00` (DESIGN_SYSTEM §9.3). */
export function formatMoneyCents(cents: number, locale: AppLocale = 'es'): string {
  const value = cents / 100;
  const formatted = new Intl.NumberFormat(localeTag[locale], {
    style: 'currency',
    currency: 'MXN',
    currencyDisplay: 'symbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
  // Intl uses "$" for MXN in es-MX; normalise to "MX$" per DESIGN_SYSTEM.
  return formatted.replace(/^MX\$/, 'MX$').replace(/^\$/, 'MX$');
}

/** Fecha localizada corta: ES "13 ago 2026", EN "Aug 13, 2026". */
export function formatDate(iso: string | undefined, locale: AppLocale = 'es'): string {
  if (!iso) return '';
  const date = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag[locale], {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
