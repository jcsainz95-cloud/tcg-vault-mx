import { sanitizeRank } from '../src/modules/decks-meta/decks-meta-refresh.service';

describe('F4-7 · puesto de Limitless validado (entero 1..topN, si no null)', () => {
  it.each([[1, 1], [10, 10], [0, null], [-3, null], [11, null], [2.5, null], [NaN, null], [null, null], ['2', null], [Number.MAX_SAFE_INTEGER, null]])('%p ⇒ %p', (r, exp) => {
    expect(sanitizeRank(r, 10)).toBe(exp);
  });
});
