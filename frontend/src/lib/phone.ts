/**
 * Celular MX (§CELULAR, `docs/API_CONTRACT_CELULAR.md` §1). Copia del helper del servidor
 * (`backend/src/modules/users/phone-mx.ts`): misma tabla de pruebas. El servidor es el juez; esto solo evita ir y volver.
 */
export function normalizeMxPhone(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let d = raw.replace(/[\s\-.()]/g, '');
  if (d.startsWith('+52')) d = d.slice(3);
  d = d.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  else if (d.length === 13 && d.startsWith('521')) d = d.slice(3);
  if (!/^\d{10}$/.test(d)) return null;
  if (/^(\d)\1{9}$/.test(d)) return null;
  if (d === '1234567890' || d === '0123456789') return null;
  if (d[0] === '0' || d[0] === '1') return null;
  return d;
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
