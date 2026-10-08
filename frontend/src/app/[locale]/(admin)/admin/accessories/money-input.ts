/**
 * Pesos (texto que teclea el súper-admin) ⇄ centavos enteros (`§AC.11`: `priceCents` es «exactamente lo tecleado»).
 * ⛔ No es cálculo de precio: es cambio de unidad de lo que se escribió. Vacío ⇒ `null`; inválido ⇒ `NaN`.
 */
export function pesosInputToCents(value: string): number | null {
  const v = value.trim().replace(/,/g, '');
  if (v === '') return null;
  if (!/^\d+(\.\d{1,2})?$/.test(v)) return Number.NaN;
  const [int, dec = ''] = v.split('.');
  return Number(int) * 100 + Number(dec.padEnd(2, '0'));
}
export function centsToPesosInput(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  const int = Math.trunc(cents / 100);
  const dec = String(Math.abs(cents % 100)).padStart(2, '0');
  return `${int}.${dec}`;
}
