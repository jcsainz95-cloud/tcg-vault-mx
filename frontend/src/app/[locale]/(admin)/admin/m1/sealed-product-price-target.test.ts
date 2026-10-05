import { describe, it, expect } from 'vitest';
import { productPriceTargetOf } from './sealed-product-price-target';

/**
 * Techlead D-6 — la línea «Ahora» del editor del producto sale de UN cálculo, el mismo en el bloque del panel y en
 * la fila de la cola. ⛔ Nunca «sin precio tuyo; se vende a {P de una pieza} (tuyo)»: sin precio del dueño, la cifra
 * solo es la de una pieza `automatic` (con su rótulo); si no hay, «sin precio».
 */
describe('productPriceTargetOf', () => {
  it('precio del dueño ⇒ esa cifra, origen product, y el expected', () => {
    expect(
      productPriceTargetOf([{ sealedProductDisplayPriceCents: 145000, sealedPriceOrigin: 'product', resolvedDisplayPriceCents: 145000 }]),
    ).toMatchObject({ hasExpected: true, ownerDisplayPriceCents: 145000, displayPriceCents: 145000, effectiveOrigin: 'product' });
  });

  it('sin dueño y una pieza automática ⇒ su P y «automatic»', () => {
    expect(
      productPriceTargetOf([
        { sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'piece', resolvedDisplayPriceCents: 127600 },
        { sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'automatic', resolvedDisplayPriceCents: 137251 },
      ]),
    ).toMatchObject({ ownerDisplayPriceCents: null, displayPriceCents: 137251, effectiveOrigin: 'automatic' });
  });

  it('⛔ sin dueño y la pieza con precio propio antiguo ⇒ «sin precio», nunca su P rotulado «tuyo»', () => {
    expect(
      productPriceTargetOf([{ sealedProductDisplayPriceCents: null, sealedPriceOrigin: 'piece', resolvedDisplayPriceCents: 127600 }]),
    ).toMatchObject({ ownerDisplayPriceCents: null, displayPriceCents: null, effectiveOrigin: 'pending' });
  });

  it('ninguna fila trae el expected ⇒ hasExpected false', () => {
    expect(productPriceTargetOf([{ sealedProductDisplayPriceCents: undefined }]).hasExpected).toBe(false);
  });

  it('N del agregado del producto, no de las filas', () => {
    expect(
      productPriceTargetOf([{ sealedProductPieces: undefined }, { sealedProductPieces: { inStock: 3, listed: 1, reserved: 1 } }]).pieces,
    ).toEqual({ inStock: 3, listed: 1, reserved: 1 });
  });
});
