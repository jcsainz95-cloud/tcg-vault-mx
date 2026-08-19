import { CardSet } from '@prisma/client';
import { classifySet, isModernSet, isRareRarity, releaseYear, SCOPE_YEAR_THRESHOLD } from './ppt-sync-scope';

/**
 * WS-A fix-ppt (causa #2) — SCOPE del PO: sets modernos (año ≥ 2020) → full; viejos → partial
 * (inventario ∪ rares) o skip. Umbral de rareza documentado (bulk = common/uncommon).
 */

function set(releaseDate: string | null): Pick<CardSet, 'releaseDate'> {
  return { releaseDate } as Pick<CardSet, 'releaseDate'>;
}

describe('releaseYear / isModernSet', () => {
  it('parsea yyyy/MM/dd y yyyy-MM-dd', () => {
    expect(releaseYear(set('2024/11/08'))).toBe(2024);
    expect(releaseYear(set('2016-02-01'))).toBe(2016);
    expect(releaseYear(set(null))).toBeNull();
    expect(releaseYear(set('sin-fecha'))).toBeNull();
  });

  it('moderno = año ≥ umbral; año desconocido = NO moderno (conservador)', () => {
    expect(SCOPE_YEAR_THRESHOLD).toBe(2020);
    expect(isModernSet(set('2020/01/01'))).toBe(true);
    expect(isModernSet(set('2025/06/01'))).toBe(true);
    expect(isModernSet(set('2019/12/31'))).toBe(false);
    expect(isModernSet(set('1999/01/09'))).toBe(false);
    expect(isModernSet(set(null))).toBe(false);
  });
});

describe('isRareRarity — umbral de rareza (bulk excluido)', () => {
  it('common/uncommon (y variantes) = BULK → no raro', () => {
    for (const r of ['Common', 'common', 'Uncommon', 'UNCOMMON']) {
      expect(isRareRarity(r)).toBe(false);
    }
  });

  it('todo lo demás cuenta como raro (holo/ultra/secret/illustration/promo…)', () => {
    for (const r of [
      'Rare Holo',
      'Rare Ultra',
      'Rare Secret',
      'Illustration Rare',
      'Special Illustration Rare',
      'Hyper Rare',
      'Double Rare',
      'Amazing Rare',
      'Radiant Rare',
      'Promo',
      'Rare Holo LV.X',
      'Rare',
    ]) {
      expect(isRareRarity(r)).toBe(true);
    }
  });

  it('rareza null/desconocida = raro (money-safe: ante duda se INCLUYE)', () => {
    expect(isRareRarity(null)).toBe(true);
    expect(isRareRarity(undefined)).toBe(true);
    expect(isRareRarity('')).toBe(true);
  });
});

describe('classifySet', () => {
  it('moderno → full sin importar el conteo', () => {
    expect(classifySet(set('2024/01/01'), 0)).toBe('full');
  });
  it('viejo con cartas en scope → partial; sin cartas → skip', () => {
    expect(classifySet(set('2016/01/01'), 3)).toBe('partial');
    expect(classifySet(set('2016/01/01'), 0)).toBe('skip');
  });
});
