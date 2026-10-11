/**
 * 💰 AC-B24 (unitaria, tabla de casos) y AC-B45 (mitad de la caja) — `orders/box-fit.ts` (§AC.7, v1.86.1).
 *
 * La caja decide el envío SOLO con los accesorios que no son energía (P-AC-5): cartas, sellado, energías sueltas y
 * paquetes no entran a `units`. Tarifa al cliente = `max(E_base, customerFeeCents)` (P-AC-2, recomendación).
 */
import { BoxChoice, FitBox, FitUnit, boxSnapshotOf, chooseBox, fitUnitsOf, shippingFeeWithBox } from '../src/modules/orders/box-fit';

const box = (code: string, l: number, w: number, h: number, fee: number, sortOrder = 0): FitBox => ({
  code,
  label: code.toUpperCase(),
  lengthCm: l,
  widthCm: w,
  heightCm: h,
  customerFeeCents: fee,
  sortOrder,
});
const unit = (l: number, w: number, h: number, g = 100): FitUnit => ({ lengthMm: l, widthMm: w, heightMm: h, weightG: g });

const CHICA = box('chica', 25, 20, 10, 15000, 1);
const GRANDE = box('grande', 70, 40, 10, 30000, 2);
const PLAYMAT = unit(600, 350, 3, 400);
const FUNDA = unit(70, 95, 5, 20);
const E_BASE = 20300;

describe('AC-B24 chooseBox — tabla de casos (§AC.7)', () => {
  it('sin unidades ⇒ null (tarifa de hoy, bit a bit; criterio 725 y I-AC-5)', () => {
    expect(chooseBox([], [CHICA, GRANDE])).toBeNull();
  });

  it('sin cajas con tarifa ⇒ null (criterio 725 (a))', () => {
    expect(chooseBox([FUNDA], [])).toBeNull();
  });

  it('funda ⇒ la chica (la de menor volumen que sirve)', () => {
    expect(chooseBox([FUNDA], [GRANDE, CHICA])).toEqual({ box: CHICA, review: false });
  });

  it('playmat que no cabe en la chica ⇒ la grande (criterio 726)', () => {
    expect(chooseBox([PLAYMAT, FUNDA], [CHICA, GRANDE])).toEqual({ box: GRANDE, review: false });
  });

  it('quitar el playmat ⇒ vuelve a la chica (criterio 727)', () => {
    expect(chooseBox([FUNDA], [CHICA, GRANDE])).toEqual({ box: CHICA, review: false });
  });

  it('medidas ordenadas: una unidad girada cabe (no importa el orden de largo/ancho/alto)', () => {
    expect(chooseBox([unit(5, 95, 70)], [CHICA])).toEqual({ box: CHICA, review: false });
  });

  it('por volumen: cada unidad cabe sola pero Σ volumen no ⇒ la siguiente que sirve', () => {
    // 4 cubos de 100 mm = 4 000 000 mm³ > chica (250×200×100 = 5 000 000)? No: cabe. 6 cubos = 6 000 000 > 5 000 000.
    const cubos = Array.from({ length: 6 }, () => unit(100, 100, 100));
    expect(chooseBox(cubos, [CHICA, GRANDE])).toEqual({ box: GRANDE, review: false });
    expect(chooseBox(cubos.slice(0, 5), [CHICA, GRANDE])).toEqual({ box: CHICA, review: false });
  });

  it('nada cabe ⇒ la de MAYOR volumen con review = true (criterio 728, F3)', () => {
    const tres = [PLAYMAT, PLAYMAT, PLAYMAT].map(() => unit(800, 400, 30));
    expect(chooseBox(tres, [CHICA, GRANDE])).toEqual({ box: GRANDE, review: true });
  });

  it('desempate a igual volumen: tarifa, luego sortOrder, luego code', () => {
    const a = box('b-a', 30, 20, 10, 20000, 5);
    const b = box('b-b', 20, 30, 10, 18000, 9);
    const c = box('b-c', 10, 20, 30, 18000, 1);
    const d = box('b-d', 10, 30, 20, 18000, 1);
    expect(chooseBox([FUNDA], [a, b, c, d])!.box.code).toBe('b-c');
    expect(chooseBox([FUNDA], [a, b, d])!.box.code).toBe('b-d');
    expect(chooseBox([FUNDA], [a, b])!.box.code).toBe('b-b');
  });

  it('desempate en «nada cabe»: igual regla sobre la de mayor volumen', () => {
    const g1 = box('g1', 70, 40, 10, 31000, 1);
    const g2 = box('g2', 40, 70, 10, 30000, 3);
    expect(chooseBox([unit(900, 100, 100)], [CHICA, g1, g2])).toEqual({ box: g2, review: true });
  });
});

describe('AC-B24 tarifa = max(E_base, caja) (P-AC-2, criterio 725 (c))', () => {
  it('sin caja ⇒ E_base exacto', () => {
    expect(shippingFeeWithBox(E_BASE, null)).toBe(E_BASE);
  });
  it('caja más barata que E_base ⇒ E_base', () => {
    expect(shippingFeeWithBox(E_BASE, { box: CHICA, review: false })).toBe(E_BASE);
  });
  it('caja más cara que E_base ⇒ la de la caja', () => {
    expect(shippingFeeWithBox(E_BASE, { box: GRANDE, review: false })).toBe(30000);
  });
  it('review = true ⇒ misma regla con la mayor (no cobra nada extra)', () => {
    const c: BoxChoice = { box: GRANDE, review: true };
    expect(shippingFeeWithBox(E_BASE, c)).toBe(30000);
  });
});

describe('AC-B45 / AC-B24 fitUnitsOf — qué entra a la caja (P-AC-5)', () => {
  const dims = { lengthMm: 70, widthMm: 95, heightMm: 5, weightG: 20 };
  it('una unidad por cada unidad del renglón', () => {
    expect(fitUnitsOf([{ quantity: 3, accessory: { category: 'sleeves', ...dims } }])).toEqual([
      { lengthMm: 70, widthMm: 95, heightMm: 5, weightG: 20 },
      { lengthMm: 70, widthMm: 95, heightMm: 5, weightG: 20 },
      { lengthMm: 70, widthMm: 95, heightMm: 5, weightG: 20 },
    ]);
  });
  it('energía CON medidas capturadas ⇒ no entra (AC-B45; mutación: quitar el filtro category ≠ energy)', () => {
    expect(fitUnitsOf([{ quantity: 8, accessory: { category: 'energy', ...dims } }])).toEqual([]);
    const mix = fitUnitsOf([
      { quantity: 1, accessory: { category: 'sleeves', ...dims } },
      { quantity: 8, accessory: { category: 'energy', lengthMm: 900, widthMm: 900, heightMm: 900, weightG: 9000 } },
    ]);
    expect(mix).toHaveLength(1);
    expect(chooseBox(mix, [CHICA, GRANDE])).toEqual({ box: CHICA, review: false });
  });
  it('sin medidas completas ⇒ no entra (⛔ medidas inventadas)', () => {
    expect(fitUnitsOf([{ quantity: 2, accessory: { category: 'other', lengthMm: 10, widthMm: null, heightMm: 10, weightG: 5 } }])).toEqual([]);
  });
});

describe('AC-B25 boxSnapshotOf — lo que se congela en Order.shippingBoxSnapshot', () => {
  it('con caja ⇒ { code, label, medidas, customerFeeCents, baseFeeCents = E_base, contentWeightG = Σ weightG }', () => {
    const units = [unit(70, 95, 5, 20), unit(600, 350, 3, 400)];
    expect(boxSnapshotOf({ box: GRANDE, review: false }, E_BASE, units)).toEqual({
      code: 'grande',
      label: 'GRANDE',
      lengthCm: 70,
      widthCm: 40,
      heightCm: 10,
      customerFeeCents: 30000,
      baseFeeCents: E_BASE,
      contentWeightG: 420,
    });
  });
  it('sin caja ⇒ null', () => {
    expect(boxSnapshotOf(null, E_BASE, [])).toBeNull();
  });
});
