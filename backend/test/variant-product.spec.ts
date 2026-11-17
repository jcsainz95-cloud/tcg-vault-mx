import { classifyCardProductKind, deriveCardProductsFromTcgcsv } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { isVariantProductName, productPreferenceOf, VARIANT_PRODUCT_SUFFIX } from '../src/common/variant-product';
import { isBetterRef, isProductAmbiguous, RefRow } from '../src/modules/pricing/pricing.service';
import * as fixture from './fixtures/tcgcsv-variant-names.json';

/**
 * §PRICE-PATTERN (docs/DECISIONES.md) — candados de la clasificación y del desempate. Fixtures REALES de TCGCSV (medidos 2026-11-17).
 */
describe('clasificador de versiones alternas («(… Pattern/Ball/Energy Symbol)»)', () => {
  it.each([
    'Noctowl (Master Ball Pattern)',
    'Noctowl (Poke Ball Pattern)',
    'Pikachu (Friend Ball)',
    'Snorunt (Poke Ball)',
    'Charmander (Energy Symbol Pattern)',
    'Quick Ball (Poke Ball Pattern)',
    'Noctowl (master ball pattern)  ',
  ])('«%s» ⇒ variant', (name) => {
    expect(classifyCardProductKind(name)).toBe('variant');
  });

  it.each([
    'Ultra Ball',
    'Poké Ball',
    'Pikachu ex',
    'Charizard (Staff)',
    'Noctowl',
    'Air Balloon',
    'Great Ball (Secret)',
    'Pikachu (Ultra Ball League)', // `league` manda: es promo
    'Pikachu Deck Exclusives (Master Ball Pattern)', // `deck exclusive` manda
    'Master Ball Pattern Noctowl', // el sufijo ENTRE PARÉNTESIS al FINAL, no en medio
    '',
  ])('«%s» ⇒ NO variant', (name) => {
    expect(classifyCardProductKind(name)).not.toBe('variant');
  });

  it('promo y deck_exclusive mandan sobre variant', () => {
    expect(classifyCardProductKind('Pikachu (Ultra Ball League)')).toBe('promo');
    expect(classifyCardProductKind('Pikachu Deck Exclusives (Master Ball Pattern)')).toBe('deck_exclusive');
  });

  it('fixture REAL: los 747 nombres con sufijo ⇒ variant y los 334 con «ball/pattern» sin ese sufijo ⇒ nunca variant', () => {
    expect(fixture.variant.length).toBeGreaterThan(700);
    for (const n of fixture.variant) expect([n, isVariantProductName(n)]).toEqual([n, true]);
    for (const n of fixture.notVariant) expect([n, isVariantProductName(n)]).toEqual([n, false]);
  });

  it('⭐ GUARDIA DE CI: ningún producto que el provider clasifique `set_base` coincide con el patrón (ni uno de los 747 reales)', () => {
    const products = [...fixture.variant, ...fixture.notVariant].map((name, i) => ({ productId: 1000 + i, name, number: String(i) }));
    const prices = products.map((p) => ({ productId: p.productId, subTypeName: 'Holofoil', marketPrice: 1 }));
    const derived = deriveCardProductsFromTcgcsv(products as never, prices as never);
    expect(derived.length).toBe(products.length);
    const offenders = derived.filter((d) => d.kind === 'set_base' && VARIANT_PRODUCT_SUFFIX.test(d.name)).map((d) => d.name);
    expect(offenders).toEqual([]);
    expect(derived.filter((d) => d.kind === 'variant').length).toBeGreaterThanOrEqual(fixture.variant.length - 70); // los demás son promo/deck
  });
});

describe('preferencia de producto', () => {
  const card = { tcgplayerId: '610433', name: 'Noctowl' };
  it('0 = el ancla de la carta; 1 = nombre exacto; 2 = el resto', () => {
    expect(productPreferenceOf({ tcgplayerProductId: 610433, name: 'Noctowl' }, card)).toBe(0);
    expect(productPreferenceOf({ tcgplayerProductId: 999, name: 'Noctowl' }, card)).toBe(1);
    expect(productPreferenceOf({ tcgplayerProductId: 610693, name: 'Noctowl (Master Ball Pattern)' }, card)).toBe(2);
    expect(productPreferenceOf({ tcgplayerProductId: 5, name: 'noctowl' }, { tcgplayerId: null, name: 'Noctowl' })).toBe(1);
  });
});

const D = new Date('2026-11-17T00:00:00Z');
function row(over: Partial<RefRow> & { cents: number }): RefRow {
  const { cents, ...rest } = over;
  return { priceMxnCents: cents, priceUsdCents: null, isManualOverride: false, source: 'tcgcsv_singles', capturedDate: D, evidenceDate: D, cardProductId: null, ...rest };
}
function pickBest(rows: RefRow[]): RefRow {
  let best = rows[0];
  for (const r of rows) if (isBetterRef(r, best)) best = r;
  return best;
}
const uuid = (n: number) => `${n.toString(16).padStart(8, '0')}-0000-4000-8000-000000000000`;
const noctowl = (u: [string, string, string]) => {
  const card = { tcgplayerId: '610433', name: 'Noctowl' };
  const mk = (cardProductId: string, ext: number, name: string, cents: number, fresher = false) =>
    row({ cardProductId, cents, productExtId: ext, productPref: productPreferenceOf({ tcgplayerProductId: ext, name }, card), evidenceDate: fresher ? new Date('2026-11-18T00:00:00Z') : D });
  return [mk(u[0], 610433, 'Noctowl', 305), mk(u[1], 610592, 'Noctowl (Poke Ball Pattern)', 839), mk(u[2], 610693, 'Noctowl (Master Ball Pattern)', 15663, true)];
};

describe('desempate de productos: la base gana SIEMPRE (US$0.16 vs US$8.22), con uuids permutados', () => {
  it('⭐ 20 permutaciones de uuid (k/N = 20/20) y el patrón MÁS FRESCO que la base: gana la base', () => {
    const perms = [[0, 1, 2], [0, 2, 1], [1, 0, 2], [1, 2, 0], [2, 0, 1], [2, 1, 0]];
    let ok = 0;
    let n = 0;
    for (let i = 0; i < 20; i++) {
      const p = perms[i % 6];
      const ids = [uuid(1 + i * 3 + p[0]), uuid(1 + i * 3 + p[1]), uuid(1 + i * 3 + p[2])] as [string, string, string];
      const rows = noctowl(ids);
      n += 1;
      if (pickBest(rows).priceMxnCents === 305) ok += 1;
      // y en cualquier orden de lectura
      expect(pickBest([...rows].reverse()).priceMxnCents).toBe(305);
    }
    expect(`${ok}/${n}`).toBe('20/20');
  });

  it('SIN la preferencia (comportamiento anterior) el uuid más chico ganaba: 6 de 6 órdenes dependían del azar', () => {
    const rows = noctowl([uuid(3), uuid(2), uuid(1)]).map((r) => ({ ...r, productPref: undefined, productExtId: undefined })); // uuid(1) = la Master Ball
    expect(pickBest(rows).priceMxnCents).toBe(15663); // el defecto que se midió: gana el uuid, no el producto
  });

  it('entre productos del montón (pref 2 todos) el último criterio es tcgplayerProductId ASC, no el uuid', () => {
    const mk = (cp: string, ext: number, cents: number) => row({ cardProductId: cp, cents, productExtId: ext, productPref: 2 });
    for (const [x, y] of [[uuid(1), uuid(2)], [uuid(2), uuid(1)]]) {
      expect(pickBest([mk(x, 20, 111), mk(y, 10, 222)]).priceMxnCents).toBe(222); // ext 10 < 20 ⇒ gana el 10 sea cual sea su uuid
    }
  });

  it('el tier MANUAL sigue mandando sobre la preferencia; y filas sin producto (cardProductId nulo) no se comparan por preferencia', () => {
    const rows = noctowl([uuid(1), uuid(2), uuid(3)]);
    const manual = row({ cents: 99_999, isManualOverride: true, source: 'manual', cardProductId: uuid(9), productExtId: 7, productPref: 2 });
    expect(pickBest([...rows, manual]).priceMxnCents).toBe(99_999);
    const generic = row({ cents: 4_000, cardProductId: null }); // PPT/pokemontcg.io sin producto: NULLS LAST ⇒ la variante resuelta gana
    expect(pickBest([generic, ...rows]).priceMxnCents).toBe(305);
  });

  it('NO-REGRESIÓN: sin los campos nuevos isBetterRef decide EXACTAMENTE como antes (propiedad sobre 2 000 pares aleatorios)', () => {
    const old = (a: RefRow, b: RefRow): boolean => {
      const am = a.isManualOverride || a.source === 'manual';
      const bm = b.isManualOverride || b.source === 'manual';
      if (am !== bm) return am;
      const at = (a.evidenceDate ?? a.capturedDate).getTime();
      const bt = (b.evidenceDate ?? b.capturedDate).getTime();
      if (at !== bt) return at > bt;
      const rank = (s: string) => (s === 'manual' ? 0 : s === 'tcgcsv_singles' ? 0 : s === 'tcgcsv' ? 1 : s === 'pokemonpricetracker' || s === 'poketrace' ? 2 : s === 'pokemontcg_io' ? 3 : 4);
      if (rank(a.source) !== rank(b.source)) return rank(a.source) < rank(b.source);
      const acp = a.cardProductId;
      const bcp = b.cardProductId;
      if ((acp == null) !== (bcp == null)) return acp != null;
      if (acp != null && bcp != null && acp !== bcp) return acp < bcp;
      return false;
    };
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) % n);
    const sources = ['tcgcsv_singles', 'pokemontcg_io', 'pokemonpricetracker', 'tcgdex'];
    const mk = (): RefRow => row({ cents: 100, source: sources[rnd(4)], cardProductId: rnd(3) === 0 ? null : uuid(rnd(5) + 1), evidenceDate: new Date(Date.UTC(2026, 10, 10 + rnd(3))), isManualOverride: rnd(6) === 0 });
    for (let i = 0; i < 2000; i++) {
      const a = mk();
      const b = mk();
      if (a.source === 'tcgdex' || b.source === 'tcgdex') continue; // el rank de tcgdex no es parte de la copia
      expect([i, isBetterRef(a, b)]).toEqual([i, old(a, b)]);
    }
  });
});

describe('ambigüedad real de producto', () => {
  const live = (r: RefRow) => r.priceMxnCents;
  const mk = (cp: string, ext: number, cents: number, pref: 0 | 1 | 2) => row({ cardProductId: cp, cents, productExtId: ext, productPref: pref });
  it('≥2 productos pref 2 con precios que difieren > 25 % ⇒ ambigua; ≤ 25 % o con ancla/nombre exacto ⇒ no', () => {
    const a = mk(uuid(1), 1, 1000, 2);
    const b = mk(uuid(2), 2, 1300, 2);
    expect(isProductAmbiguous(a, [a, b], live)).toBe(true);
    expect(isProductAmbiguous(a, [a, mk(uuid(2), 2, 1200, 2)], live)).toBe(false); // 20 %
    const anchor = mk(uuid(3), 3, 50, 0);
    expect(isProductAmbiguous(anchor, [anchor, a, b], live)).toBe(false); // ya hay ancla
    expect(isProductAmbiguous(a, [a], live)).toBe(false); // un solo producto
    const manual = row({ cents: 9, isManualOverride: true, source: 'manual', cardProductId: uuid(4), productPref: 2 });
    expect(isProductAmbiguous(manual, [manual, a, b], live)).toBe(false); // el manual nunca es ambiguo
  });
});
