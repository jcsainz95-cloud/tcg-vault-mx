import { PHONE_PATTERN } from './address-rules';
import { BusinessException } from '../../common/business.exception';

/**
 * §CELULAR (docs/API_CONTRACT_CELULAR.md §1) — ÚNICA fuente del formato de celular MX.
 * Quita espacios, `-`, `.`, `(`, `)`; quita `+52`; quita los prefijos viejos `044`/`045` (13 dígitos) y `01` (12 dígitos); quita `52` solo si quedan 12 dígitos (un número de 10 que empieza
 * en 52 es válido) y `521` si quedan 13. Devuelve los 10 dígitos o `null`. Rechaza falsos obvios: dígitos iguales,
 * `1234567890`, `0123456789` y primer dígito 0 o 1. Solo strings.
 */
export function normalizeMxPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s\-.()]/g, '');
  const plus = s.startsWith('+52');
  if (plus) s = s.slice(3);
  if (!/^\d+$/.test(s)) return null;
  if (!plus) {
    if (s.length === 12 && s.startsWith('52')) s = s.slice(2);
    else if (s.length === 13 && s.startsWith('521')) s = s.slice(3);
    // Prefijos viejos de marcación (decidido, qa I-2): «044»/«045» (celular local/foráneo) y «01» (larga distancia).
    else if (s.length === 13 && (s.startsWith('044') || s.startsWith('045'))) s = s.slice(3);
    else if (s.length === 12 && s.startsWith('01')) s = s.slice(2);
  } else if (s.length === 11 && s.startsWith('1')) {
    s = s.slice(1); // +52 1 55…: formato móvil antiguo
  }
  if (!PHONE_PATTERN.test(s)) return null;
  if (/^(\d)\1{9}$/.test(s)) return null;
  if (s === '1234567890' || s === '0123456789') return null;
  if (s[0] === '0' || s[0] === '1') return null;
  return s;
}

export function isValidMxPhone(raw: unknown): boolean {
  return normalizeMxPhone(raw) !== null;
}

/** `******1234` para logs y auditoría (nunca el número completo). */
export function maskPhone(raw: unknown): string {
  const d = typeof raw === 'string' ? raw.replace(/\D/g, '') : '';
  return d.length >= 4 ? `******${d.slice(-4)}` : '******';
}

/** Normaliza o lanza 422 PHONE_INVALID `details:{field:'phone'}` (vacío, null, no-string o inválido). */
export function assertValidPhone(raw: unknown): string {
  const n = normalizeMxPhone(raw);
  if (n === null) {
    throw BusinessException.validation('PHONE_INVALID', 'Phone must be a valid 10-digit Mexican mobile number', {
      field: 'phone',
    });
  }
  return n;
}
