/**
 * pnl-allocation.ts — §REPORTES-CEO F2b (API_CONTRACT_REPORTES §3 «Reparto»): la regla ÚNICA de reparto del P&L por línea.
 * Cuerpo PURO (sin Prisma), enteros en centavos, BigInt en el reparto.
 *
 * ### Mayor residuo
 * Monto entero `A` (con signo) y pesos `w`: `base_i = trunc(|A|·w_i / W)`; el residuo `|A| − Σ base_i` se reparte de a 1 centavo a
 * las partidas de mayor `(|A|·w_i mod W)`, desempate por `id` ascendente (comparación de cadenas, no de locale); el signo de `A` se
 * reaplica. `W = 0` ⇒ pesos iguales. Un peso negativo (no debería existir) cuenta 0. Determinista: no depende del orden de entrada.
 * ⇒ `Σ partes == A` SIEMPRE, y por tanto la suma por línea y por periodo es exacta.
 */
import { ProductType } from '@prisma/client';

export type LineKey = 'sealed' | 'raw' | 'graded' | 'accessory' | 'unassigned';
/** Orden del contrato: las tres líneas de pieza (de `ProductType`, sin lista a mano), accesorios y «Sin línea». */
export const PNL_LINES: readonly LineKey[] = [ProductType.sealed, ProductType.raw, ProductType.graded, 'accessory', 'unassigned'];

export interface Weighted {
  id: string;
  weight: number;
}

/** Reparte `amount` entre `parts`; devuelve las partes ALINEADAS con `parts` (mismo índice). `parts` vacío ⇒ `[]` (el llamador decide). */
export function allocateLargestRemainder(amount: number, parts: readonly Weighted[]): number[] {
  const n = parts.length;
  if (n === 0) return [];
  if (!Number.isSafeInteger(amount)) throw new Error('allocate: amount must be a safe integer');
  const abs = BigInt(Math.abs(amount));
  const w = parts.map((p) => BigInt(Number.isFinite(p.weight) && p.weight > 0 ? Math.trunc(p.weight) : 0));
  let total = w.reduce((a, b) => a + b, 0n);
  if (total === 0n) {
    for (let i = 0; i < n; i++) w[i] = 1n;
    total = BigInt(n);
  }
  const base: bigint[] = [];
  const rem: bigint[] = [];
  let used = 0n;
  for (let i = 0; i < n; i++) {
    const num = abs * w[i];
    base.push(num / total);
    rem.push(num % total);
    used += base[i];
  }
  let left = Number(abs - used); // < n
  const order = parts.map((_, i) => i).sort((a, b) => {
    if (rem[a] !== rem[b]) return rem[a] > rem[b] ? -1 : 1;
    const ia = parts[a].id;
    const ib = parts[b].id;
    return ia < ib ? -1 : ia > ib ? 1 : a - b;
  });
  for (let k = 0; k < order.length && left > 0; k++, left--) base[order[k]] += 1n;
  const sign = amount < 0 ? -1 : 1;
  return base.map((b) => sign * Number(b));
}

/** `round_half_away(a·10000/b)` en BigInt (b > 0). Para `marginBps` y similares. */
export function bpsOf(a: number, b: number): number {
  const num = BigInt(a) * 10000n;
  const den = BigInt(b);
  const abs = num < 0n ? -num : num;
  const q = (2n * abs + den) / (2n * den);
  return Number(num < 0n ? -q : q);
}
