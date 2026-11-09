import * as fs from 'fs';
import * as path from 'path';
import { BLACK_STAR_GATE_PASSED, buildWindows, contentKeyOf, evaluateBlackStarGate, inferPromoLinks } from '../src/modules/catalog/promo-collection-link';

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
  it('B1 contenido en E y productId en la ventana de E ⇒ high', () => {
    const r = inferPromoLinks({ promos: [promo('p1', 'K1', 1500)], expansionCards: [{ setId: 'pe', contentKey: 'K1' }], minProductIdBySet: windows });
    expect(r).toEqual([expect.objectContaining({ promoCardId: 'p1', expansionSetId: 'pe', confidence: 'high' })]);
  });
  it('B1b candidato unico en E pero productId en la ventana de OTRA expansion ⇒ low (regresion Sylveon)', () => {
    const r = inferPromoLinks({ promos: [promo('p1', 'K1', 1500)], expansionCards: [{ setId: 'ssp', contentKey: 'K1' }], minProductIdBySet: windows });
    expect(r[0]).toMatchObject({ expansionSetId: 'ssp', confidence: 'low', evidence: { contentSets: ['ssp'], windowSets: ['pe'], windowOk: false } });
  });
  it('B4b contenido sin productId (o expansion sin ventana) ⇒ low', () => {
    expect(inferPromoLinks({ promos: [promo('p1', 'K1', null)], expansionCards: [{ setId: 'pe', contentKey: 'K1' }], minProductIdBySet: windows })[0].confidence).toBe('low');
    expect(inferPromoLinks({ promos: [promo('p1', 'K1', 1500)], expansionCards: [{ setId: 'pe', contentKey: 'K1' }], minProductIdBySet: new Map() })[0].confidence).toBe('low');
  });
  it('B4c ventana de E sin productId de la promo ⇒ low o sin fila, nunca high', () => {
    const r = inferPromoLinks({ promos: [promo('p1', null, null)], expansionCards: [], minProductIdBySet: windows });
    expect(r).toEqual([]);
  });
  it('compuerta Black Star: >=30 promos y >=2 expansiones al 100 %; hoy cerrada', () => {
    const m = (expansion: string, promos: number, highWrong = 0) => ({ expansion, promos, high: 5, highWrong });
    expect(evaluateBlackStarGate([m('pe', 7)])).toBe(false);
    expect(evaluateBlackStarGate([m('pe', 40)])).toBe(false);
    expect(evaluateBlackStarGate([m('pe', 20), m('ssp', 15, 1)])).toBe(false);
    expect(evaluateBlackStarGate([m('pe', 20), m('ssp', 15)])).toBe(true);
    expect(BLACK_STAR_GATE_PASSED).toBe(false);
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
    const input = { promos: [promo('b', 'K1', 1500), promo('a', 'K2', 2500)], expansionCards: [{ setId: 'pe', contentKey: 'K1' }, { setId: 'ssp', contentKey: 'K2' }], minProductIdBySet: windows };
    const rev = { ...input, promos: [...input.promos].reverse() };
    expect(inferPromoLinks(rev)).toEqual(inferPromoLinks(input));
  });
  it('B8 aparece la expansion que faltaba ⇒ un low sube a high sin intervencion', () => {
    const w = mins({ a: 1, b: 2, pe: 1000 });
    const before = inferPromoLinks({ promos: [promo('p1', 'K1', 1500)], expansionCards: [{ setId: 'a', contentKey: 'K1' }, { setId: 'b', contentKey: 'K1' }], minProductIdBySet: w });
    expect(before[0].confidence).toBe('low');
    const after = inferPromoLinks({ promos: [promo('p1', 'K1', 1500)], expansionCards: [{ setId: 'a', contentKey: 'K1' }, { setId: 'pe', contentKey: 'K1' }], minProductIdBySet: w });
    expect(after[0]).toMatchObject({ expansionSetId: 'pe', confidence: 'high' });
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
    const win = buildWindows(new Map(Object.entries(f.minProductIdBySet) as [string, number][])).get(f.expansion);
    const inWin = f.promos.filter((p: { productId: number }) => win && p.productId >= win.from && (win.to == null || p.productId < win.to)).length;
    // eslint-disable-next-line no-console
    console.log(`PE (${f.provenance ? 'parcial N=' + f.promos.length : 'completa'}): precision high=${high.length - wrong.length}/${high.length}, cobertura=${high.length - wrong.length}/${f.promos.length}, ventana productId=${inWin}/${f.promos.length}`);
    // Regla v2 (contenido Y ventana): svp-172 Sylveon (contenido sv6pt5, productId en ventana PE) pasa a low; 0 falsas `high`.
    expect(wrong).toEqual([]);
    expect(out.find((l) => l.promoCardId === 'svp-172')?.confidence).toBe('low');
  });
});
