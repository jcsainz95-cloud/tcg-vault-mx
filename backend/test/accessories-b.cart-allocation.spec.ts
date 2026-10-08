/**
 * 💰 AC-B56 (parte pura: el orden «paquetes primero» de `quote`, §AC.19.4 paso 4), AC-B12 (IVA informado de una línea,
 * §AC.2 (4), criterios 701/731/736) y la suma del apartado único por accesorio de `session` (§AC.19.4 paso 5).
 */
import { allocateQuoteStock, lineIvaCents, sameLooseCart, wantsOf } from '../src/modules/orders/accessory-cart';

const FIRE = 'acc-fire';
const PSY = 'acc-psy';
const SLEEVE = 'acc-sleeve';

describe('AC-B56 allocateQuoteStock — paquetes primero, luego sueltos con el remanente', () => {
  it('10 Fuego: paquete de 8 + 3 sueltas ⇒ entra el paquete; las sueltas se cotizan con 2 (insufficient)', () => {
    const r = allocateQuoteStock(
      [{ index: 0, components: [{ accessoryId: FIRE, quantity: 8 }] }],
      [{ accessoryId: FIRE, quantity: 3 }],
      new Map([[FIRE, 10]]),
    );
    expect(r.acceptedBundleIndexes).toEqual([0]);
    expect(r.rejectedBundleIndexes).toEqual([]);
    expect(r.loose).toEqual([{ accessoryId: FIRE, requested: 3, quoted: 2, remaining: 2 }]);
  });

  it('dos paquetes de 8 Fuego (decks distintos) con 10 ⇒ entra el de menor index; el otro se rechaza', () => {
    const r = allocateQuoteStock(
      [
        { index: 1, components: [{ accessoryId: FIRE, quantity: 8 }] },
        { index: 3, components: [{ accessoryId: FIRE, quantity: 8 }] },
      ],
      [],
      new Map([[FIRE, 10]]),
    );
    expect(r.acceptedBundleIndexes).toEqual([1]);
    expect(r.rejectedBundleIndexes).toEqual([3]);
  });

  it('el orden es el de la PETICIÓN (index), no el del arreglo recibido', () => {
    const r = allocateQuoteStock(
      [
        { index: 3, components: [{ accessoryId: FIRE, quantity: 8 }] },
        { index: 1, components: [{ accessoryId: FIRE, quantity: 8 }] },
      ],
      [],
      new Map([[FIRE, 10]]),
    );
    expect(r.acceptedBundleIndexes).toEqual([1]);
    expect(r.rejectedBundleIndexes).toEqual([3]);
  });

  it('un paquete es todo o nada: si un componente no cabe, no descuenta ninguno', () => {
    const r = allocateQuoteStock(
      [{ index: 0, components: [{ accessoryId: FIRE, quantity: 8 }, { accessoryId: PSY, quantity: 4 }] }],
      [{ accessoryId: FIRE, quantity: 5 }],
      new Map([
        [FIRE, 10],
        [PSY, 3],
      ]),
    );
    expect(r.acceptedBundleIndexes).toEqual([]);
    expect(r.rejectedBundleIndexes).toEqual([0]);
    expect(r.loose).toEqual([{ accessoryId: FIRE, requested: 5, quoted: 5, remaining: 10 }]);
  });

  it('remanente 0 ⇒ quoted 0 (sold_out lo decide quien llama)', () => {
    const r = allocateQuoteStock(
      [{ index: 0, components: [{ accessoryId: FIRE, quantity: 8 }] }],
      [{ accessoryId: FIRE, quantity: 1 }],
      new Map([[FIRE, 8]]),
    );
    expect(r.loose).toEqual([{ accessoryId: FIRE, requested: 1, quoted: 0, remaining: 0 }]);
  });

  it('sueltos de accesorios distintos no se pisan; sin entrada en el mapa ⇒ 0 disponible', () => {
    const r = allocateQuoteStock([], [{ accessoryId: SLEEVE, quantity: 2 }, { accessoryId: PSY, quantity: 1 }], new Map([[SLEEVE, 5]]));
    expect(r.loose).toEqual([
      { accessoryId: SLEEVE, requested: 2, quoted: 2, remaining: 5 },
      { accessoryId: PSY, requested: 1, quoted: 0, remaining: 0 },
    ]);
  });
});

describe('§AC.19.4 paso 5 — wantsOf: Σ sueltos + Σ componentes por accesorio', () => {
  it('suma la energía suelta con la del paquete del mismo tipo', () => {
    const w = wantsOf(
      [
        { accessoryId: FIRE, quantity: 3 },
        { accessoryId: SLEEVE, quantity: 1 },
      ],
      [
        { index: 0, components: [{ accessoryId: FIRE, quantity: 8 }, { accessoryId: PSY, quantity: 4 }] },
        { index: 2, components: [{ accessoryId: PSY, quantity: 2 }] },
      ],
    );
    expect(Object.fromEntries(w)).toEqual({ [FIRE]: 11, [SLEEVE]: 1, [PSY]: 6 });
  });
});

describe('AC-B12 IVA informado de una línea = lineTotal − taxBaseCentsOf(lineTotal, r)', () => {
  it.each([
    [8900, 1228],
    [4000, 552],
    [2000, 276],
  ])('%i ⇒ %i (r = 16)', (total, iva) => {
    expect(lineIvaCents(total, 16)).toBe(iva);
  });
});

describe('§AC.4 reuso — mismo multiconjunto (accessoryId, quantity)', () => {
  it('mismo contenido en otro orden ⇒ igual', () => {
    expect(sameLooseCart([{ accessoryId: 'a', quantity: 1 }, { accessoryId: 'b', quantity: 2 }], [{ accessoryId: 'b', quantity: 2 }, { accessoryId: 'a', quantity: 1 }])).toBe(true);
  });
  it('otra cantidad, otro accesorio o uno de más ⇒ distinto', () => {
    expect(sameLooseCart([{ accessoryId: 'a', quantity: 1 }], [{ accessoryId: 'a', quantity: 2 }])).toBe(false);
    expect(sameLooseCart([{ accessoryId: 'a', quantity: 1 }], [{ accessoryId: 'b', quantity: 1 }])).toBe(false);
    expect(sameLooseCart([{ accessoryId: 'a', quantity: 1 }], [])).toBe(false);
    expect(sameLooseCart([], [])).toBe(true);
  });
});
