/**
 * pattern-quarantine.spec.ts — §PRICE-PATTERN 6.6 (2): la memoria de cuarentena (firma, vigencia de 7 días, lectura defensiva).
 */
import { PATTERN_QUARANTINE_DAYS, cardSig, isQuarantineActive, parseQuarantine } from '../src/modules/pricing/pattern-quarantine';

const NOW = new Date('2026-11-18T12:00:00Z');
const rows = [
  { cardProductId: 'a', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', cents: 1000, usdCents: 50 },
  { cardProductId: 'b', productType: 'raw', gradeKey: 'raw:NM', finish: 'holofoil', cents: 20000, usdCents: 1000 },
];
const dials = { freshnessDays: 7 };

describe('cardSig (6.6 (2))', () => {
  it('es estable (independiente del orden de las filas) y cambia con un precio USD o MXN, con el FX o con los diales', () => {
    const fx = { rate: 17, bufferPct: 2 };
    const s = cardSig(rows, fx, dials);
    expect(cardSig([...rows].reverse(), fx, dials)).toBe(s);
    expect(cardSig([{ ...rows[0], usdCents: 51 }, rows[1]], fx, dials)).not.toBe(s);
    expect(cardSig([{ ...rows[0], cents: 1001 }, rows[1]], fx, dials)).not.toBe(s);
    expect(cardSig(rows, { rate: 17.01, bufferPct: 2 }, dials)).not.toBe(s);
    expect(cardSig(rows, null, dials)).not.toBe(s);
    expect(cardSig(rows, fx, { freshnessDays: 8 })).not.toBe(s);
  });
});

describe('isQuarantineActive (6.6 (2))', () => {
  const at = NOW.toISOString();
  const e = { sig: 'x', at, reasons: [] };
  it('vigente solo con la MISMA firma y < 7 días', () => {
    expect(isQuarantineActive(e, 'x', NOW)).toBe(true);
    expect(isQuarantineActive(e, 'x', new Date(NOW.getTime() + (PATTERN_QUARANTINE_DAYS * 86_400_000 - 1)))).toBe(true);
    expect(isQuarantineActive(e, 'x', new Date(NOW.getTime() + PATTERN_QUARANTINE_DAYS * 86_400_000))).toBe(false);
    expect(isQuarantineActive(e, 'y', NOW)).toBe(false);
    expect(isQuarantineActive(undefined, 'x', NOW)).toBe(false);
  });
});

describe('parseQuarantine: lectura defensiva', () => {
  it('descarta lo que no tiene la forma exacta y recorta los motivos a 5', () => {
    const got = parseQuarantine({
      ok: { sig: 's', at: NOW.toISOString(), reasons: ['1', '2', '3', '4', '5', '6', 7] },
      sinSig: { at: NOW.toISOString(), reasons: [] },
      fechaMala: { sig: 's', at: 'ayer', reasons: [] },
      otro: 'texto',
    });
    expect(Object.keys(got)).toEqual(['ok']);
    expect(got.ok.reasons).toEqual(['1', '2', '3', '4', '5']);
    expect(parseQuarantine(null)).toEqual({});
    expect(parseQuarantine([1])).toEqual({});
    expect(parseQuarantine('x')).toEqual({});
  });
});
