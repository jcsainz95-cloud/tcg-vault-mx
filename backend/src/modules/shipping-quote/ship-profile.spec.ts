import { ShipDials, ShipCartInput, coverageOf, profileHashOf, shipProfileOf } from './ship-profile';

const dials: ShipDials = {
  envelopeMaxCards: 200,
  sealedWeightsG: { etb: 800, bundle: 400, box: 1200, tin: 450, blister: 150, upc: 3000, collection: 1500 },
  insuranceCoverages: [250000, 1000000],
};
const cart = (o: Partial<ShipCartInput>): ShipCartInput => ({ cards: 0, sealedSubtypes: [], accessoryGrams: [], valueCents: 100000, ...o });

describe('§ENV3 perfil derivado del carrito (nunca capturado)', () => {
  it('solo cartas ⇒ sobre 1 kg, una caja, seguro del escalón', () => {
    const p = shipProfileOf(cart({ cards: 3 }), dials);
    expect(p).toMatchObject({ package: 'envelope', boxes: 1, perBoxKg: 1, perBoxCoverageCents: 250000 });
  });
  it('más de 200 cartas ⇒ caja (no sobre)', () => {
    expect(shipProfileOf(cart({ cards: 201 }), dials).package).toBe('box');
    expect(shipProfileOf(cart({ cards: 200 }), dials).package).toBe('envelope');
  });
  it('cartas + 1 ETB (mixto) ⇒ caja de 5 kg declarados', () => {
    const p = shipProfileOf(cart({ cards: 2, sealedSubtypes: ['etb'] }), dials);
    expect(p).toMatchObject({ package: 'box', boxes: 1, perBoxKg: 5, weightG: 1000 });
  });
  it('6 ETB + 200 g de cartas = 5.0 kg ⇒ 1 caja; 7 ETB ⇒ 2 cajas (el peso se reparte)', () => {
    expect(shipProfileOf(cart({ cards: 1, sealedSubtypes: Array(6).fill('etb') }), dials).boxes).toBe(1);
    expect(shipProfileOf(cart({ sealedSubtypes: Array(7).fill('etb') }), dials).boxes).toBe(2);
  });
  it('sin peso de la ficha ⇒ el mayor del dial; accesorio suma sus gramos', () => {
    expect(shipProfileOf(cart({ sealedSubtypes: [null] }), dials).weightG).toBe(3000);
    expect(shipProfileOf(cart({ accessoryGrams: [120, 80] }), dials)).toMatchObject({ package: 'box', weightG: 200 });
  });
  it('valor sobre el último escalón ⇒ banda de MX$500 hacia arriba; el valor se reparte entre cajas', () => {
    expect(coverageOf(1200001, [250000, 1000000])).toBe(1250000);
    expect(shipProfileOf(cart({ sealedSubtypes: Array(7).fill('etb'), valueCents: 2000000 }), dials).perBoxCoverageCents).toBe(1000000);
  });
  it('hashPerfil cambia con paquete, cajas y banda (insumo del 409)', () => {
    const a = profileHashOf(shipProfileOf(cart({ cards: 1 }), dials));
    expect(a).toBe(profileHashOf(shipProfileOf(cart({ cards: 5 }), dials)));
    expect(a).not.toBe(profileHashOf(shipProfileOf(cart({ cards: 1, sealedSubtypes: ['etb'] }), dials)));
    expect(a).not.toBe(profileHashOf(shipProfileOf(cart({ cards: 1, valueCents: 400000 }), dials)));
  });
});
