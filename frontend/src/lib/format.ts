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

/**
 * **Fecha Y HORA explícitas, en `America/Mexico_City`** (DESIGN_SYSTEM §23.4.2 decisión 6,
 * criterio 154). Se usa en los plazos del ciclo de compra del buylist.
 *
 * ⚠️ **Tres decisiones, y las tres son de negocio, no de estilo:**
 *
 * 1. **La zona horaria es FIJA, no la del navegador.** El plazo llega del servidor **ya
 *    resuelto** en días hábiles de `America/Mexico_City`, y el correo lo imprime en esa zona.
 *    Si la pantalla lo pintara en la zona local, un vendedor de vacaciones en Madrid leería una
 *    hora distinta a la de su correo sobre **la misma fecha límite** — y §23.5a exige que la
 *    pantalla diga *exactamente* lo mismo que el correo.
 * 2. **`dateStyle:'full'` + `timeStyle:'short'`**, idénticos a `formatDateTime` de
 *    `backend/src/modules/buylist/buylist-mail.templates.ts`. Trae el día de la semana, que es
 *    lo que §23.4.2 pide y lo que evita el «en 2 días» que el criterio 154 prohíbe.
 * 3. **El front NO recalcula el plazo**, solo lo formatea: no hay aritmética de días hábiles
 *    aquí, ni cuenta atrás, ni «te quedan N horas».
 *
 * Entrada inválida ⇒ `''` (nunca una fecha inventada ni un `Invalid Date` en pantalla).
 */
export function formatDateTimeMx(iso: string | null | undefined, locale: AppLocale = 'es'): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(localeTag[locale], {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: 'America/Mexico_City',
  }).format(date);
}
