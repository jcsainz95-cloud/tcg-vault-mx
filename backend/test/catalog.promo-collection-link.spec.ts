import * as fs from 'fs';
import * as path from 'path';
import { buildWindows, contentKeyOf, inferPromoLinks } from '../src/modules/catalog/promo-collection-link';

/** AUTO-B (docs/specs/AUTO_CATALOGO.md §B): B1-B5, B8 y el criterio medible contra la lista humana (si existe el fixture). */
const mins = (o: Record<string, number>) => new Map(Object.entries(o));
const promo = (cardId: string, contentKey: string | null, productId: number | null = null) => ({ cardId, contentKey, productId });

describe('contentKeyOf', () => {
  it('pokemon: nombre+HP+ataques (orden y acentos no importan)', () => {
    const a = contentKeyOf({ name: 'Pikachu ex', supertype: 'Pokémon', hp: '190', attacks: [{ name: 'Topaz Bolt' }, { name: 'Circle Circuit' }] });
    const b = contentKeyOf({ name: 'pikachu EX', supertype: 'Pokémon', hp: 190, attacks: [{ name: 'circle circuit' }, { name: 'topaz bolt' }] });
    expect(a).toBe(b);
    expect(a).not.toBeNull();
  });
  it('HP distinto o ataques distintos ⇒ clave distinta (sin fuzzy)', () => {
    const base = { name: 'Eevee', supertype: 'Pokémon', hp: '60', attacks: [{ name: 'Tackle' }] };
    expect(contentKeyOf(base)).not.toBe(contentKeyOf({ ...base, hp: '70' }));
    expect(contentKeyOf(base)).not.toBe(contentKeyOf({ ...base, attacks: [{ name: 'Bite' }] }));
  });
  it('pokemon sin ataques ni habilidades, o sin HP ⇒ null (demasiado ambiguo)', () => {
    expect(contentKeyOf({ name: 'X', supertype: 'Pokémon', hp: '60', attacks: [] })).toBeNull();
    expect(contentKeyOf({ name: 'X', supertype: 'Pokémon', attacks: [{ name: 'a' }] })).toBeNull();
  });
  it('entrenador: nombre + hash del texto; sin texto ⇒ null', () => {
    const t = contentKeyOf({ name: 'Boss', supertype: 'Trainer', rules: ['Switch in 1 of your opponent'] });
    expect(t).toMatch(/^trainer\|boss\|[0-9a-f]{16}$/);
    expect(contentKeyOf({ name: 'Boss', supertype: 'Trainer', rules: [] })).toBeNull();
  });
});

describe('inferPromoLinks', () => {
  const windows = mins({ pe: 1000, ssp: 2000 }); // pe: [1000,2000), ssp: [2000,∞)
  it('B1 coincidencia unica ⇒ high', () => {
    const r = inferPromoLinks({ promos: [promo('p1', 'K1')], expansionCards: [{ setId: 'pe', contentKey: 'K1' }], minProductIdBySet: windows });
    expect(r).toEqual([expect.objectContaining({ promoCardId: 'p1', expansionSetId: 'pe', confidence: 'high' })]);
  });
  it('B2 coincidencia en 2 expansiones y la ventana desempata ⇒ high', () => {
    const r = inferPromoLinks({
      promos: [promo('p1', 'K1', 1500)],
      expansionCards: [{ setId: 'pe', contentKey: 'K1' }, { setId: 'ssp', contentKey: 'K1' }],
      minProductIdBySet: windows,
    });
    expect(r[0]).toMatchObject({ expansionSetId: 'pe', confidence: 'high' });
  });
  it('B3 coincidencia en 2 expansiones SIN desempate ⇒ low (no se publica)', () => {
    const r = inferPromoLinks({
      promos: [promo('p1', 'K1', 9)],
      expansionCards: [{ setId: 'pe', contentKey: 'K1' }, { setId: 'ssp', contentKey: 'K1' }],
      minProductIdBySet: windows,
    });
    expect(r[0].confidence).toBe('low');
  });
  it('B4 solo ventana (sin carta igual) ⇒ low, NUNCA high', () => {
    const r = inferPromoLinks({ promos: [promo('p1', null, 1500)], expansionCards: [], minProductIdBySet: windows });
    expect(r).toEqual([expect.objectContaining({ expansionSetId: 'pe', confidence: 'low' })]);
  });
  it('B5 sin senal ⇒ sin fila', () => {
    expect(inferPromoLinks({ promos: [promo('p1', 'KX')], expansionCards: [{ setId: 'pe', contentKey: 'K1' }], minProductIdBySet: windows })).toEqual([]);
  });
  it('B6 determinista: mismo input, mismo resultado, sin importar el orden', () => {
    const input = { promos: [promo('b', 'K1'), promo('a', 'K2')], expansionCards: [{ setId: 'pe', contentKey: 'K1' }, { setId: 'ssp', contentKey: 'K2' }], minProductIdBySet: windows };
    const rev = { ...input, promos: [...input.promos].reverse() };
    expect(inferPromoLinks(rev)).toEqual(inferPromoLinks(input));
  });
  it('B8 aparece la expansion que faltaba ⇒ un low sube a high sin intervencion', () => {
    const before = inferPromoLinks({ promos: [promo('p1', 'K1', 5)], expansionCards: [{ setId: 'a', contentKey: 'K1' }, { setId: 'b', contentKey: 'K1' }], minProductIdBySet: windows });
    expect(before[0].confidence).toBe('low');
    const after = inferPromoLinks({ promos: [promo('p1', 'K1', 5)], expansionCards: [{ setId: 'a', contentKey: 'K1' }], minProductIdBySet: windows });
    expect(after[0].confidence).toBe('high');
  });
  it('buildWindows: [min X, min siguiente)', () => {
    expect(buildWindows(mins({ b: 20, a: 10 }))).toEqual(new Map([['a', { from: 10, to: 20 }], ['b', { from: 20, to: null }]]));
  });
});

/**
 * Criterio medible (spec §B): lista humana PokéCottage de Prismatic Evolutions (SVP 447→511, N=65). La lista la entrega el
 * orquestador/dueño; backend NO la inventa. Sin el fixture esta prueba se SALTA y queda NO MEDIDO.
 * Formato: test/fixtures/promo-links/prismatic-evolutions.json = { source, expansion: 'pe', promos: [{ cardId, contentKey, productId, humanExpansion }], expansionCards, minProductIdBySet }
 */
const FIX = path.join(__dirname, 'fixtures', 'promo-links', 'prismatic-evolutions.json');
(fs.existsSync(FIX) ? describe : describe.skip)('criterio medible PE (fixture humano)', () => {
  it('precision de las `high` = k/k y se reporta la cobertura', () => {
    const f = JSON.parse(fs.readFileSync(FIX, 'utf8'));
    const out = inferPromoLinks({ promos: f.promos, expansionCards: f.expansionCards, minProductIdBySet: new Map(Object.entries(f.minProductIdBySet)) });
    const high = out.filter((l) => l.confidence === 'high');
    const wrong = high.filter((l) => l.expansionSetId !== f.expansion);
    // eslint-disable-next-line no-console
    console.log(`PE: high=${high.length}, correctas=${high.length - wrong.length}/${high.length}, cobertura=${high.length - wrong.length}/${f.promos.length}`);
    expect(wrong).toHaveLength(0);
  });
});
