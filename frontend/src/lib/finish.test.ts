import { describe, it, expect } from 'vitest';
import { primaryFinishOf, displayedVariants, normalizePromoCell } from './finish';
import type { MasterSetCardCellDTO } from '@/types/contract';

describe('primaryFinishOf', () => {
  it('normal › holofoil › first_edition_holofoil › reverse_holo; normal sin datos', () => {
    expect(primaryFinishOf(['reverse_holo', 'holofoil', 'normal'])).toBe('normal');
    expect(primaryFinishOf(['reverse_holo', 'holofoil'])).toBe('holofoil');
    expect(primaryFinishOf(['reverse_holo', 'first_edition_holofoil'])).toBe('first_edition_holofoil');
    expect(primaryFinishOf(['reverse_holo'])).toBe('reverse_holo');
    expect(primaryFinishOf([])).toBe('normal');
    expect(primaryFinishOf(undefined)).toBe('normal');
  });
});

describe('celda mínima (collectionPromos.items del backend)', () => {
  const minimal = { cardId: 'svp-1', number: '1', name: 'X' } as unknown as MasterSetCardCellDTO;
  it('displayedVariants no lanza con campos ausentes', () => {
    expect(() => displayedVariants(minimal)).not.toThrow();
    expect(displayedVariants(minimal)).toEqual([]);
  });
  it('normalizePromoCell la completa con una variante normal sin cubrir', () => {
    const c = normalizePromoCell(minimal);
    expect(c.totalCount).toBe(0);
    expect(c.countsByFinish).toEqual([]);
    expect(displayedVariants(c).map((v) => v.finish)).toEqual(['normal']);
  });
});
