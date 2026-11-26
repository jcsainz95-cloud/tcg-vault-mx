/**
 * Celular MX (§CELULAR, `docs/API_CONTRACT_CELULAR.md` §1). Copia del helper del servidor
 * (`backend/src/modules/users/phone-mx.ts`): misma tabla de pruebas. El servidor es el juez; esto solo evita ir y volver.
 */
export function normalizeMxPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let s = raw.replace(/[\s\-.()]/g, '');
  const plus = s.startsWith('+52');
  if (plus) s = s.slice(3);
  if (!/^\d+$/.test(s)) return null;
  if (!plus) {
    // Prefijos viejos de marcación nacional que el servidor también acepta: 044/045 (celular local) y 01 (larga distancia).
    if (/^04[45]\d{10}$/.test(s)) s = s.slice(3);
    else if (/^01\d{10}$/.test(s)) s = s.slice(2);
    else if (s.length === 12 && s.startsWith('52')) s = s.slice(2);
    else if (s.length === 13 && s.startsWith('521')) s = s.slice(3);
  } else if (s.length === 11 && s.startsWith('1')) {
    s = s.slice(1); // +52 1 55…: formato móvil antiguo
  }
  if (!/^\d{10}$/.test(s)) return null;
  if (/^(\d)\1{9}$/.test(s)) return null;
  if (s === '1234567890' || s === '0123456789') return null;
  if (s[0] === '0' || s[0] === '1') return null;
  return s;
}

export function isValidMxPhone(raw: unknown): boolean {
  return normalizeMxPhone(raw) !== null;
}

/**
 * Normaliza lo tecleado/pegado en un campo de celular ANTES de topar a 10 dígitos (`+52 55 1234 5678`, `52 …`,
 * `+52 1 55 …`, guiones, espacios): si ya es un celular válido, queda en sus 10 dígitos; mientras la lada de país va
 * incompleta se conserva para poder teclearla; letras y símbolos se descartan. El servidor es el juez.
 */
export function normalizePhoneInput(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  const plus = raw.trimStart().startsWith('+');
  const n = normalizeMxPhone((plus ? '+' : '') + digits);
  if (n) return n;
  if (plus) return '+' + digits.slice(0, 13);
  if (digits.length > 10 && /^52/.test(digits)) return digits.slice(0, 13);
  // Prefijos viejos que el servidor acepta: 044/045 + 10 dígitos (13) y 01 + 10 dígitos (12): no se recortan a ciegas.
  if (/^04[45]/.test(digits)) return digits.slice(0, 13);
  if (/^01/.test(digits)) return digits.slice(0, 12);
  return digits.slice(0, 10);
}

/**
 * ¿Mostrar el motivo del error? Con algo escrito que NO es un celular válido: ya con ≥ 10 dígitos (parece completo) o al
 * salir del campo. Nunca se deja el botón apagado sin decir por qué (qa I-2).
 */
export function shouldShowPhoneError(value: string, blurred: boolean): boolean {
  if (value.trim() === '' || normalizeMxPhone(value) !== null) return false;
  return blurred || value.replace(/\D/g, '').length >= 10;
}

/** `5548214739` → `+52 55 4821 4739` (solo para mostrar; el valor guardado son los 10 dígitos). */
export function formatMxPhone(raw: string | null | undefined): string {
  const n = normalizeMxPhone(raw ?? '');
  if (!n) return raw?.trim() ?? '';
  return `+52 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
}
