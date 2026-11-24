/**
 * pnl-allocation.spec.ts — §REPORTES-CEO F2b, criterio M-2 (N ≥ 1 000): la regla de mayor residuo da Σ partidas == monto, es
 * idéntica entre dos corridas y con el orden de entrada barajado; casos con pesos 0, un solo renglón y 3 partidas con empate.
 */
import { allocateLargestRemainder, bpsOf } from '../src/modules/admin/pnl-allocation';

// PRNG determinista (mulberry32): el fallo se reproduce con la misma semilla.
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const byId = (parts: { id: string; weight: number }[], amount: number) => {
  const a = allocateLargestRemainder(amount, parts);
  return new Map(parts.map((p, i) => [p.id, a[i]]));
};

describe('allocateLargestRemainder (mayor residuo, BigInt)', () => {
  it('M-2: 2 000 casos aleatorios (montos con signo, pesos 0, un renglón, empates): Σ == monto, 2 corridas iguales y orden barajado idéntico', () => {
    const r = rng(20261124);
    let n = 0;
    for (let k = 0; k < 2000; k++) {
      const size = 1 + Math.floor(r() * 7);
      const parts = Array.from({ length: size }, (_, i) => ({
        id: `p-${String(Math.floor(r() * 1e6)).padStart(7, '0')}-${i}`,
        weight: r() < 0.25 ? 0 : r() < 0.3 ? 5000 : Math.floor(r() * 2_000_000),
      }));
      const amount = Math.floor((r() - 0.3) * 4_000_000);
      const first = allocateLargestRemainder(amount, parts);
      expect(first.reduce((a, b) => a + b, 0)).toBe(amount);
      expect(allocateLargestRemainder(amount, parts)).toEqual(first);
      const shuffled = [...parts].sort(() => r() - 0.5);
      const m1 = byId(parts, amount);
      const m2 = byId(shuffled, amount);
      for (const p of parts) expect(m2.get(p.id)).toBe(m1.get(p.id));
      // cada parte difiere de su cuota exacta por menos de 1 centavo (mayor residuo)
      const W = parts.reduce((a, p) => a + p.weight, 0);
      parts.forEach((p, i) => {
        const exact = W === 0 ? amount / size : (amount * p.weight) / W;
        expect(Math.abs(first[i] - exact)).toBeLessThan(1 + 1e-6);
      });
      n++;
    }
    expect(n).toBe(2000);
  });

  it('3 partidas con empate: el centavo sobrante va a los ids menores', () => {
    const parts = [
      { id: 'c', weight: 100 },
      { id: 'a', weight: 100 },
      { id: 'b', weight: 100 },
    ];
    expect(allocateLargestRemainder(100, parts)).toEqual([33, 34, 33]); // base 33 c/u, sobra 1 ⇒ 'a'
    expect(allocateLargestRemainder(101, parts)).toEqual([33, 34, 34]); // sobran 2 ⇒ 'a' y 'b'
    expect(allocateLargestRemainder(-101, parts)).toEqual([-33, -34, -34]); // el signo se reaplica
  });

  it('mayor residuo gana al empate de id; peso 0 sin cuota; todo 0 ⇒ pesos iguales; una partida se queda todo; vacío ⇒ []', () => {
    expect(allocateLargestRemainder(10, [{ id: 'a', weight: 1 }, { id: 'b', weight: 2 }])).toEqual([3, 7]); // 3.33→3, 6.67→7
    expect(allocateLargestRemainder(7, [{ id: 'a', weight: 0 }, { id: 'b', weight: 5 }])).toEqual([0, 7]);
    expect(allocateLargestRemainder(5, [{ id: 'b', weight: 0 }, { id: 'a', weight: 0 }])).toEqual([2, 3]); // iguales, sobra 1 ⇒ 'a'
    expect(allocateLargestRemainder(123, [{ id: 'x', weight: 999 }])).toEqual([123]);
    expect(allocateLargestRemainder(0, [{ id: 'x', weight: 1 }, { id: 'y', weight: 1 }])).toEqual([0, 0]);
    expect(allocateLargestRemainder(9, [])).toEqual([]);
  });

  it('montos y pesos grandes no pierden exactitud (|A·w| pasa de 2^53)', () => {
    const parts = [
      { id: 'a', weight: 2_147_483_647 },
      { id: 'b', weight: 2_147_483_646 },
      { id: 'c', weight: 1 },
    ];
    const out = allocateLargestRemainder(2_147_483_647, parts);
    expect(out.reduce((a, b) => a + b, 0)).toBe(2_147_483_647);
  });
});

describe('allocateLargestRemainder: casos de I-1 (qa)', () => {
  it('un peso NEGATIVO cuenta 0 (no su valor absoluto): todo a la otra partida', () => {
    expect(allocateLargestRemainder(300, [{ id: 'a', weight: -100 }, { id: 'b', weight: 100 }])).toEqual([0, 300]);
    expect(allocateLargestRemainder(-300, [{ id: 'a', weight: -100 }, { id: 'b', weight: 100 }]).map((x) => x + 0)).toEqual([0, -300]); // (−0 + 0 ⇒ 0: el signo del cero no importa en JSON)
    expect(allocateLargestRemainder(5, [{ id: 'a', weight: NaN }, { id: 'b', weight: 3 }])).toEqual([0, 5]);
  });

  it('el reparto es ENTERO exacto (BigInt), no de coma flotante: cifras calculadas con aritmética exacta cuando |A·w| pasa de 2^53', () => {
    // A = 2^31−1, pesos 2^31−1, 2^31−2 y 1: cuotas exactas 1073741823.5, 1073741823.0 y 0.99999… ; residuos a=c ⇒ el centavo va al id menor
    expect(allocateLargestRemainder(2_147_483_647, [{ id: 'a', weight: 2_147_483_647 }, { id: 'b', weight: 2_147_483_646 }, { id: 'c', weight: 1 }])).toEqual([1_073_741_824, 1_073_741_823, 0]);
    // A·w ≈ 9·10^21: una división en doble pierde el residuo (que decide a quién va el centavo)
    expect(allocateLargestRemainder(9_007_199_254_740_000, [{ id: 'a', weight: 1_000_001 }, { id: 'b', weight: 1_000_003 }])).toEqual([4_503_595_123_779_380, 4_503_604_130_960_620]);
    // 3 partes con residuos casi iguales: el orden lo decide el residuo EXACTO
    expect(allocateLargestRemainder(1_000_000_000_000_000, [{ id: 'a', weight: 999_999_937 }, { id: 'b', weight: 999_999_929 }, { id: 'c', weight: 999_999_893 }])).toEqual(
      exactAllocation(1_000_000_000_000_000n, [999_999_937n, 999_999_929n, 999_999_893n]),
    );
  });
});

/** Oráculo exacto e independiente (BigInt, ids ya en orden ascendente): cuota entera + 1 a los mayores residuos. */
function exactAllocation(a: bigint, w: bigint[]): number[] {
  const W = w.reduce((x, y) => x + y, 0n);
  const base = w.map((x) => (a * x) / W);
  const rem = w.map((x) => (a * x) % W);
  let left = a - base.reduce((x, y) => x + y, 0n);
  const order = w.map((_, i) => i).sort((i, j) => (rem[i] === rem[j] ? i - j : rem[i] > rem[j] ? -1 : 1));
  for (const i of order) if (left-- > 0n) base[i] += 1n;
  return base.map(Number);
}

describe('bpsOf (mitad hacia afuera de cero)', () => {
  it('redondea mitad lejos de cero y respeta el signo', () => {
    expect(bpsOf(1, 8)).toBe(1250);
    expect(bpsOf(5, 20000)).toBe(3); // 2.5 ⇒ 3
    expect(bpsOf(-5, 20000)).toBe(-3); // −2.5 ⇒ −3
    expect(bpsOf(0, 7)).toBe(0);
    expect(bpsOf(2_147_483_647, 2_147_483_647)).toBe(10000);
  });
});
