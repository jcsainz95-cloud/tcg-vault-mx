import type { AppLocale } from '@/i18n/routing';
import { formatMoneyCents } from '@/lib/format';
import type { DiscountCodeBatchDTO, DiscountCodeDTO } from '@/types/contract';

/**
 * §DSC.6 «Vigencia» (909): el panel captura «vence el día D a las HH:MM» en hora del centro de México y envía
 * `endsAt` = ese minuto **+ 60 s**: vale a las 23:59:59 y no a las 00:00:00 del día siguiente. México no tiene
 * horario de verano desde 2022 (`America/Mexico_City` = UTC−06:00 fijo; mismo supuesto que `yesterdayMx` de
 * avisos de gasto).
 */
const MX_OFFSET = '-06:00';

/** `YYYY-MM-DDTHH:MM` (hora de México, lo que da `<input type="datetime-local">`) ⇒ ISO. `end` suma los 60 s. */
export function mxInputToIso(value: string, end = false): string | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return undefined;
  const ms = Date.parse(`${value}:00${MX_OFFSET}`);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms + (end ? 60_000 : 0)).toISOString();
}

/** ISO ⇒ `YYYY-MM-DDTHH:MM` en hora de México. `end` resta los 60 s que sumó `mxInputToIso` (el dueño ve su minuto). */
export function isoToMxInput(iso: string | null | undefined, end = false): string {
  if (!iso) return '';
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return '';
  const local = new Date(ms - (end ? 60_000 : 0) - 6 * 3_600_000);
  return local.toISOString().slice(0, 16);
}

/** Fecha corta de la vigencia («1 sep 2026»), en hora de México; el fin muestra el minuto que capturó el dueño. */
export function formatMxDay(iso: string, locale: AppLocale, end = false): string {
  const ms = Date.parse(iso) - (end ? 60_000 : 0);
  return new Intl.DateTimeFormat(locale === 'en' ? 'en-US' : 'es-MX', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'America/Mexico_City',
  }).format(new Date(ms));
}

type T = (key: string, values?: Record<string, string | number>) => string;

/** Columna «Descuento» (§DSC-UX.5): «10 % · tope MX$500.00», «MX$150.00 fijos», «Envío gratis», + mínimo. */
export function describeDiscount(
  c: Pick<DiscountCodeDTO, 'kind' | 'percentPct' | 'amountCents' | 'maxDiscountCents' | 'minSubtotalCents'>,
  t: T,
  locale: AppLocale,
): string {
  const money = (x: number) => formatMoneyCents(x, locale);
  const base =
    c.kind === 'percent'
      ? c.maxDiscountCents != null
        ? t('describe.percentCap', { pct: c.percentPct ?? 0, amount: money(c.maxDiscountCents) })
        : t('describe.percent', { pct: c.percentPct ?? 0 })
      : c.kind === 'fixed_amount'
        ? t('describe.fixed', { amount: money(c.amountCents ?? 0) })
        : t('kind.free_shipping');
  return c.minSubtotalCents != null ? t('describe.min', { base, amount: money(c.minSubtotalCents) }) : base;
}

export function describeValidity(c: Pick<DiscountCodeDTO | DiscountCodeBatchDTO, 'startsAt' | 'endsAt'>, t: T, locale: AppLocale): string {
  return t('validity', { from: formatMxDay(c.startsAt, locale), to: c.endsAt ? formatMxDay(c.endsAt, locale, true) : t('noEnd') });
}

/** «usados · apartados · límite» (los tres del servidor). */
export function describeUsage(c: Pick<DiscountCodeDTO, 'usage'>, t: T): string {
  return t('usage', {
    consumed: c.usage.consumed,
    reserved: c.usage.reservedNow,
    limit: c.usage.limit == null ? t('noLimit') : c.usage.limit,
  });
}

// TL-ENV-F2: pesos ⇒ centavos es el conversor único de `@/lib/money-input` (`''` ⇒ `null` = sin límite; inválido ⇒ `NaN`).

export function centsToPesos(c: number | null | undefined): string {
  if (c == null) return '';
  return (c / 100).toFixed(2);
}

/** §DSC.7: código suelto 4-20 de `A-Z0-9-`. «Generar uno al azar» usa el alfabeto de los lotes (sin 0/O/1/I). */
export const CODE_RE = /^[A-Z0-9-]{4,20}$/;
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomCode(len = 8): string {
  const buf = new Uint32Array(len);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(buf);
  else for (let i = 0; i < len; i++) buf[i] = Math.floor(Math.random() * 2 ** 32);
  return Array.from(buf, (n) => ALPHABET[n % ALPHABET.length]).join('');
}
