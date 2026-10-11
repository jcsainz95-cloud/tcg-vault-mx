import { PricingService, PriceInfo } from '../src/modules/pricing/pricing.service';
import { tryBuildGradeKey } from '../src/modules/pricing/pricing.types';

/**
 * v1.80.1 (API_CONTRACT §M2-SK **SK-5** · ARCHITECTURE §4.50.1-bis) — **UNA función de valuación por
 * pieza.** Candados **VK-1** (`valuationKeyFor`: qué fila se busca) y **VK-2** (`valuationCentsOf`:
 * cuánto cuenta esa fila).
 *
 * El defecto que cierran (BACKEND_NOTES P-83, «Discrepancia»; sonda HTTP, N=1, backend): los lectores de
 * patrimonio llamaban `tryGradeKeyFor`, que para TODO sellado devuelve `'sealed'` — la llave de COLA —, así
 * que una caja sin mapeo se valuaba con la fila legada de otra caja anclada a la misma `Card`, y una caja
 * mapeada se buscaba bajo `'sealed'` y no bajo su `sealed:tcg:<id>`.
 *
 * Mutaciones que deben poner esto rojo (contrato, tabla de candados):
 *  - VK-1: devolver `'sealed'` en la rama sin mapeo; usar `item.finish` en la mapeada.
 *  - VK-2: cambiar el gate del sellado por `status==='priced'`.
 */

// Las dos funciones son PURAS respecto de sus dependencias: no tocan prisma/settings/fx.
const pricing = new PricingService({} as never, {} as never, {} as never, {} as never, {} as never, {} as never);

describe('SK-5 · VK-1 — valuationKeyFor: qué fila de precio valúa esta pieza', () => {
  it('sellado SIN mapeo ⇒ null (⛔ jamás la llave de cola `sealed`)', () => {
    const k = pricing.valuationKeyFor({
      cardId: 'c1',
      productType: 'sealed',
      finish: 'normal',
      tcgplayerProductId: null,
    });
    expect(k).toBeNull();
  });

  it('sellado MAPEADO ⇒ `sealed:tcg:<id>` con finish `normal`, aunque la pieza traiga otro finish', () => {
    const k = pricing.valuationKeyFor({
      cardId: 'c1',
      productType: 'sealed',
      finish: 'holofoil',
      tcgplayerProductId: 4242,
    });
    expect(k).toEqual({ cardId: 'c1', productType: 'sealed', gradeKey: 'sealed:tcg:4242', finish: 'normal' });
  });

  it('sellado MAPEADO con finish ya `normal` ⇒ misma clave (la rama no depende del finish)', () => {
    expect(
      pricing.valuationKeyFor({ cardId: 'c9', productType: 'sealed', finish: 'normal', tcgplayerProductId: 7 }),
    ).toEqual({ cardId: 'c9', productType: 'sealed', gradeKey: 'sealed:tcg:7', finish: 'normal' });
  });

  describe('CONTROL — raw/graduada: idéntico a `tryBuildGradeKey` (esta rev no cambia su llave)', () => {
    const cases = [
      { productType: 'raw' as const, rawCondition: 'NM', finish: 'reverse_holo' as const },
      { productType: 'raw' as const, rawCondition: null, finish: 'normal' as const },
      { productType: 'raw' as const, rawCondition: 'LP', finish: 'holofoil' as const },
      { productType: 'graded' as const, gradingCompany: 'PSA', gradeValue: '10', finish: 'normal' as const },
      { productType: 'graded' as const, gradingCompany: 'CGC', gradeValue: '9.5', finish: 'holofoil' as const },
    ];
    it.each(cases)('%o', (c) => {
      const item = { cardId: 'c2', tcgplayerProductId: 555, ...c };
      const gk = tryBuildGradeKey(item);
      expect(gk).not.toBeNull();
      // `tcgplayerProductId` presente NO desvía una pieza no sellada hacia la clave de mercado.
      expect(pricing.valuationKeyFor(item)).toEqual({
        cardId: 'c2',
        productType: c.productType,
        gradeKey: gk,
        finish: c.finish,
      });
    });

    it('graduada SIN identidad de slab ⇒ null (sigue `pending`, §4.40.4b)', () => {
      for (const id of [
        { gradingCompany: null, gradeValue: '10' },
        { gradingCompany: 'PSA', gradeValue: null },
        { gradingCompany: '', gradeValue: '' },
      ]) {
        expect(
          pricing.valuationKeyFor({
            cardId: 'c3',
            productType: 'graded',
            finish: 'normal',
            tcgplayerProductId: null,
            ...id,
          }),
        ).toBeNull();
      }
    });
  });
});

describe('SK-5 · VK-2 — valuationCentsOf: cuánto cuenta la fila (el gate de `/vault/sealed`)', () => {
  const sealed = { productType: 'sealed' as const };
  const raw = { productType: 'raw' as const };
  const graded = { productType: 'graded' as const };
  const tcgcsv: PriceInfo = { status: 'priced', referenceMxnCents: 120_000, source: 'tcgcsv' };
  const manual: PriceInfo = { status: 'priced', referenceMxnCents: 120_000, source: 'manual' };

  it("sellado `source:'tcgcsv'` + dial apagado ⇒ null (la fuente automática es INERTE con el dial off)", () => {
    expect(pricing.valuationCentsOf(sealed, tcgcsv, false)).toBeNull();
  });

  it("sellado `source:'tcgcsv'` + dial encendido ⇒ cents", () => {
    expect(pricing.valuationCentsOf(sealed, tcgcsv, true)).toBe(120_000);
  });

  it("sellado `source:'manual'` + dial apagado ⇒ cents (el override humano sobrevive al dial)", () => {
    expect(pricing.valuationCentsOf(sealed, manual, false)).toBe(120_000);
  });

  it('sellado `referenceMxnCents: 0` ⇒ null (≤ 0 es «sin mercado», también manual y con dial on)', () => {
    expect(pricing.valuationCentsOf(sealed, { ...manual, referenceMxnCents: 0 }, true)).toBeNull();
    expect(pricing.valuationCentsOf(sealed, { ...tcgcsv, referenceMxnCents: 0 }, true)).toBeNull();
  });

  it('sellado sin fila / pending ⇒ null', () => {
    expect(pricing.valuationCentsOf(sealed, undefined, true)).toBeNull();
    expect(pricing.valuationCentsOf(sealed, { status: 'pending' }, true)).toBeNull();
  });

  describe('CONTROL — raw/graduada: la condición de hoy (`priced ∧ != null`), el dial NO se mira', () => {
    it.each([raw, graded])('%o ignora sourceOn', (item) => {
      expect(pricing.valuationCentsOf(item, tcgcsv, false)).toBe(120_000);
      expect(pricing.valuationCentsOf(item, tcgcsv, true)).toBe(120_000);
      expect(pricing.valuationCentsOf(item, manual, false)).toBe(120_000);
    });

    it.each([raw, graded])('%o sin fila / pending / sin cents ⇒ null', (item) => {
      expect(pricing.valuationCentsOf(item, undefined, true)).toBeNull();
      expect(pricing.valuationCentsOf(item, { status: 'pending' }, true)).toBeNull();
      expect(pricing.valuationCentsOf(item, { status: 'priced' }, true)).toBeNull();
    });

    it.each([raw, graded])('%o con `referenceMxnCents: 0` ⇒ 0 (hoy suma 0; esta rev NO lo unifica con el gate)', (item) => {
      expect(pricing.valuationCentsOf(item, { status: 'priced', referenceMxnCents: 0, source: 'tcgcsv' }, false)).toBe(0);
    });
  });
});
