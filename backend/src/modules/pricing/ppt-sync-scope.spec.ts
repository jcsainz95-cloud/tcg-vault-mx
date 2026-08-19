import { CardSet } from '@prisma/client';
import { classifySet, isModernSet, isPremiumRarity, releaseYear, SCOPE_YEAR_THRESHOLD } from './ppt-sync-scope';

/**
 * WS-A fix-ppt (causa #2) — SCOPE del PO: sets modernos (año ≥ 2020) → full; viejos → partial
 * (inventario ∪ PREMIUM/chase) o skip. Umbral de rareza premium documentado (refinamiento PO).
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

describe('isPremiumRarity — refinamiento PO: SOLO chase/premium (no bulk, no rare normal)', () => {
  it('EXCLUYE bulk y rare normal (no-holo)', () => {
    for (const r of ['Common', 'common', 'Uncommon', 'UNCOMMON', 'Rare', 'rare']) {
      expect(isPremiumRarity(r)).toBe(false);
    }
  });

  it('reverse holo NUNCA cuenta como rareza (es un acabado, guard defensivo)', () => {
    expect(isPremiumRarity('Reverse Holo')).toBe(false);
    expect(isPremiumRarity('reverse_holo')).toBe(false);
  });

  it('INCLUYE Illustration Rare para arriba (illustration/hyper/rainbow/gold/secret)', () => {
    for (const r of [
      'Illustration Rare',
      'Special Illustration Rare',
      'Hyper Rare',
      'Rare Rainbow',
      'Rare Secret',
      'Gold Rare',
    ]) {
      expect(isPremiumRarity(r)).toBe(true);
    }
  });

  it('INCLUYE ex/EX/GX/V/VMAX/VSTAR y equivalentes chase (Full Art/Ultra/Lv.X/Prime/Amazing/Radiant/Shiny)', () => {
    for (const r of [
      'Rare Holo EX',
      'Rare Holo GX',
      'Rare Holo V',
      'Rare Holo VMAX',
      'Rare Holo VSTAR',
      'Rare Ultra', // Full Art
      'Rare Holo LV.X',
      'Rare Prime',
      'Amazing Rare',
      'Radiant Rare',
      'Rare Shiny',
      'Rare BREAK',
      'LEGEND',
    ]) {
      expect(isPremiumRarity(r)).toBe(true);
    }
  });

  it('CAVEAT cross-era: "Rare Holo" (Charizard Base) SÍ es premium', () => {
    expect(isPremiumRarity('Rare Holo')).toBe(true);
  });

  it('null/desconocida → NO premium (el inventario es la red de seguridad)', () => {
    expect(isPremiumRarity(null)).toBe(false);
    expect(isPremiumRarity(undefined)).toBe(false);
    expect(isPremiumRarity('')).toBe(false);
    expect(isPremiumRarity('Amazing Holo Rare Nueva 2019')).toBe(true); // contiene holo/amazing
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
