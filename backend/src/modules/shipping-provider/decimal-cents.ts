/**
 * decimal-cents.ts — 💰 importes del proveedor a centavos EXACTOS (API_CONTRACT §M4-SHIP.19.19.4, PS-94).
 *
 * Skydropx manda los importes como cadena (`"51.25"`) salvo `protection_value_total` y `extra_fees[].value`, que son
 * números de 4–5 decimales (`0.7315`) — PROD §4.2. ⛔ Nunca `parseFloat(x) * 100`: `"52.11"` daría 5210.999… y un
 * `Math.round` posterior esconde el error en unos casos y no en otros. Aquí se parte entero y decimal y se opera en
 * `bigint` a la escala común; se redondea **una** vez, half-up (lejos de cero en negativos).
 */

interface Scaled {
  /** valor × 10^scale */
  units: bigint;
  scale: number;
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?$/;

function toDecimalString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    // `String(0.7315)` = "0.7315"; con exponente (1e-7) se pasa por toFixed para no perder la forma decimal.
    const s = String(value);
    return /e/i.test(s) ? value.toFixed(12) : s;
  }
  return null;
}

function parseScaled(value: unknown): Scaled | null {
  const s = toDecimalString(value);
  if (s === null) return null;
  const m = DECIMAL_RE.exec(s);
  if (!m) return null;
  const frac = m[3] ?? '';
  const units = BigInt(m[2] + frac) * (m[1] ? -1n : 1n);
  return { units, scale: frac.length };
}

function rescale(v: Scaled, scale: number): bigint {
  return v.units * 10n ** BigInt(scale - v.scale);
}

/** Redondeo half-up (lejos de cero) de `units` a escala `from` → centavos (escala 2). */
function roundToCents(units: bigint, from: number): bigint {
  if (from <= 2) return units * 10n ** BigInt(2 - from);
  const div = 10n ** BigInt(from - 2);
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const q = abs / div;
  const r = abs % div;
  const rounded = r * 2n >= div ? q + 1n : q;
  return neg ? -rounded : rounded;
}

function toSafeNumber(v: bigint): number | null {
  if (v > BigInt(Number.MAX_SAFE_INTEGER) || v < BigInt(Number.MIN_SAFE_INTEGER)) return null;
  return Number(v);
}

/**
 * Un importe decimal (cadena o número) ⇒ centavos enteros, redondeado UNA vez half-up. Entrada ilegible, vacía,
 * `null` o no finita ⇒ `null` (parser tolerante: el llamador decide; ⛔ nunca un `500`).
 */
export function decimalToCents(value: unknown): number | null {
  const v = parseScaled(value);
  if (!v) return null;
  return toSafeNumber(roundToCents(v.units, v.scale));
}

/**
 * Suma EXACTA de varios importes decimales y redondeo **una** vez al centavo (PS-94: `extra_fees[]` se suman en
 * decimal; redondear cada uno y luego sumar es la mutación que la prueba caza). Cualquier término ilegible ⇒ `null`.
 */
export function sumDecimalsToCents(values: readonly unknown[]): number | null {
  const parsed: Scaled[] = [];
  for (const raw of values) {
    const v = parseScaled(raw);
    if (!v) return null;
    parsed.push(v);
  }
  if (parsed.length === 0) return 0;
  const scale = Math.max(...parsed.map((p) => p.scale));
  const total = parsed.reduce((acc, p) => acc + rescale(p, scale), 0n);
  return toSafeNumber(roundToCents(total, scale));
}
