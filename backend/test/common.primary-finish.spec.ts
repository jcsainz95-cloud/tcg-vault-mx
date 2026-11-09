import { Finish } from '@prisma/client';
import { FINISH_ORDER, PRIMARY_FINISH_ORDER, primaryFinishOf } from '../src/common/card-order';

/** PSA_ACABADO: acabado principal = `normal › holofoil › first_edition_holofoil › reverse_holo` (NO FINISH_ORDER); `normal` sin datos. */
describe('primaryFinishOf', () => {
  it('es una permutacion COMPLETA del enum Finish (un acabado nuevo no compila a medias)', () => {
    expect([...PRIMARY_FINISH_ORDER].sort()).toEqual([...Object.values(Finish)].sort());
    expect([...PRIMARY_FINISH_ORDER].sort()).toEqual([...FINISH_ORDER].sort());
  });
  it('holo + reverse ⇒ holofoil (FINISH_ORDER daria reverse_holo)', () => {
    expect(primaryFinishOf(['reverse_holo', 'holofoil'])).toBe('holofoil');
    expect(FINISH_ORDER.indexOf('reverse_holo')).toBeLessThan(FINISH_ORDER.indexOf('holofoil'));
  });
  it('normal gana a todos; 1st edition antes que reverse; solo reverse ⇒ reverse', () => {
    expect(primaryFinishOf(['reverse_holo', 'normal', 'holofoil'])).toBe('normal');
    expect(primaryFinishOf(['reverse_holo', 'first_edition_holofoil'])).toBe('first_edition_holofoil');
    expect(primaryFinishOf(['reverse_holo'])).toBe('reverse_holo');
  });
  it('sin datos (null, undefined, vacio) ⇒ normal', () => {
    expect(primaryFinishOf(null)).toBe('normal');
    expect(primaryFinishOf(undefined)).toBe('normal');
    expect(primaryFinishOf([])).toBe('normal');
  });
});
