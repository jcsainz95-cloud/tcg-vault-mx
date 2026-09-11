import type { AppLocale } from '@/i18n/routing';

/**
 * Reloj de la RESERVA (contrato v1.68, §4-R): el servidor manda `reservedUntil` (ISO) y el front
 * **solo lo formatea y lo resta del reloj local**. No hay TTL propio, ni «60 minutos» escritos aquí,
 * ni prórroga inventada: si el instante no es parseable, no se pinta nada (nunca una cuenta atrás
 * sobre un dato que no existe — es dinero y es una promesa al cliente).
 *
 * La hora absoluta se pinta en `America/Mexico_City`, igual que el resto de plazos del sistema
 * (`formatDateTimeMx`): la tienda es MX y el correo del pedido usa esa zona.
 */

const LOCALE_TAG: Record<AppLocale, string> = { es: 'es-MX', en: 'en-US' };

/** Instante de vencimiento en ms epoch, o `null` si el dato no es un instante válido. */
export function reservationDeadline(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/** `HH:MM` (24 h en es-MX; `hh:mm AM/PM` en en-US) en hora de la Ciudad de México. `''` si inválido. */
export function formatReservationTime(iso: string | null | undefined, locale: AppLocale): string {
  const ms = reservationDeadline(iso);
  if (ms === null) return '';
  return new Intl.DateTimeFormat(LOCALE_TAG[locale], {
    hour: '2-digit',
    minute: '2-digit',
    // 24 h explícitas en español (la ICU de Node pinta «7:05 a.m.» con `timeStyle`), 12 h en inglés.
    hourCycle: locale === 'es' ? 'h23' : 'h12',
    timeZone: 'America/Mexico_City',
  }).format(new Date(ms));
}

/** Milisegundos que faltan (nunca negativos). */
export function remainingMs(iso: string | null | undefined, now = Date.now()): number | null {
  const ms = reservationDeadline(iso);
  if (ms === null) return null;
  return Math.max(0, ms - now);
}

/** `mm:ss` (o `h:mm:ss` si supera la hora), redondeando hacia abajo: nunca promete un segundo de más. */
export function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
