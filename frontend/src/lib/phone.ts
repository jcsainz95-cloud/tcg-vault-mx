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
    if (s.length === 12 && s.startsWith('52')) s = s.slice(2);
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

/** `5548214739` → `+52 55 4821 4739` (solo para mostrar; el valor guardado son los 10 dígitos). */
export function formatMxPhone(raw: string | null | undefined): string {
  const n = normalizeMxPhone(raw ?? '');
  if (!n) return raw?.trim() ?? '';
  return `+52 ${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
}
