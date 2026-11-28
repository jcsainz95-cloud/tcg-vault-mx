import fixture from './fixtures/tcgcsv/group-1441-gym-heroes-sample.json';
import { tcgcsvSubTypeToFinish, TCGCSV_SUBTYPE_TO_FINISH, deriveStructuralFinishes } from '../src/modules/pricing/pricing.types';
import { deriveCardProductsFromTcgcsv } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { orderFinishes, primaryFinishOf } from '../src/common/card-order';
import { finishLabelOf } from '../src/common/card-version';

/** §AUTO-ENLACE fase 4 (Q1 = A) — «Unlimited»→normal, «Unlimited Holofoil»→holofoil, «1st Edition»→first_edition; cada edición con SU precio. Datos REALES de TCGCSV (Gym Heroes, 2026-11-27). */
describe('subtipos WotC de TCGCSV → acabados', () => {
  it('los cuatro subtipos de WotC se traducen; los desconocidos siguen OMITIDOS (anti-invención)', () => {
    expect(tcgcsvSubTypeToFinish('Unlimited')).toBe('normal');
    expect(tcgcsvSubTypeToFinish('Unlimited Holofoil')).toBe('holofoil');
    expect(tcgcsvSubTypeToFinish('1st Edition')).toBe('first_edition');
    expect(tcgcsvSubTypeToFinish('1st Edition Holofoil')).toBe('first_edition_holofoil'); // ya existía
    expect(tcgcsvSubTypeToFinish('Normal')).toBe('normal');
    expect(tcgcsvSubTypeToFinish('Reverse Holofoil')).toBe('reverse_holo');
    expect(tcgcsvSubTypeToFinish('Shadowless')).toBeNull();
    expect(tcgcsvSubTypeToFinish('1st Edition Normal Extra')).toBeNull();
    expect(Object.keys(TCGCSV_SUBTYPE_TO_FINISH).sort()).toEqual(['1stedition', '1steditionholofoil', 'holofoil', 'normal', 'reverseholofoil', 'unlimited', 'unlimitedholofoil']);
  });

  it('un producto con «1st Edition» + «Unlimited» da [normal, first_edition]; con las holo, [holofoil, first_edition_holofoil]; orden canónico', () => {
    expect(deriveStructuralFinishes(['1st Edition', 'Unlimited'])).toEqual(['normal', 'first_edition']);
    expect(deriveStructuralFinishes(['1st Edition Holofoil', 'Unlimited Holofoil'])).toEqual(['holofoil', 'first_edition_holofoil']);
    expect(orderFinishes(['first_edition_holofoil', 'first_edition', 'holofoil', 'normal', 'reverse_holo'])).toEqual(['normal', 'reverse_holo', 'holofoil', 'first_edition', 'first_edition_holofoil']);
    expect(primaryFinishOf(['first_edition', 'first_edition_holofoil'])).toBe('first_edition');
    expect(finishLabelOf('first_edition', null)).toBe('first_edition');
  });

  it('Gym Heroes real: los 8 productos de muestra quedan con acabado (antes solo los que traían Normal/Holofoil/1st Edition Holofoil) y cada edición con su precio', () => {
    const products = fixture.products;
    const prices = fixture.prices;
    const derived = deriveCardProductsFromTcgcsv(products, prices as never);
    expect(derived).toHaveLength(8);
    for (const d of derived) {
      expect(d.finishes.length).toBeGreaterThanOrEqual(2);
      expect(d.finishes.some((f) => f === 'first_edition' || f === 'first_edition_holofoil')).toBe(true);
      // un precio por acabado, el de SU subtipo (no el de la otra edición)
      for (const pf of d.pricesByFinish) {
        const src = prices.filter((r) => r.productId === d.productId && tcgcsvSubTypeToFinish(r.subTypeName) === pf.finish).map((r) => r.marketPrice);
        expect(src).toContain(pf.marketPrice);
      }
    }
    const withBoth = derived.filter((d) => d.finishes.includes('first_edition') && d.finishes.includes('normal'));
    expect(withBoth.length).toBeGreaterThan(0);
  });

  it('si un producto trae «Normal» Y «Unlimited», manda el precio de «Normal» (canónico antes que alias), sea cual sea el orden de las filas', () => {
    const products = [{ productId: 1, name: 'X', number: '1' }];
    const mk = (rows: { subTypeName: string; marketPrice: number }[]) => deriveCardProductsFromTcgcsv(products, rows.map((r) => ({ productId: 1, ...r })) as never)[0].pricesByFinish;
    expect(mk([{ subTypeName: 'Unlimited', marketPrice: 9 }, { subTypeName: 'Normal', marketPrice: 3 }])).toEqual([{ finish: 'normal', marketPrice: 3 }]);
    expect(mk([{ subTypeName: 'Normal', marketPrice: 3 }, { subTypeName: 'Unlimited', marketPrice: 9 }])).toEqual([{ finish: 'normal', marketPrice: 3 }]);
  });
});
