import * as fs from 'fs';
import * as path from 'path';
import { backtestBlackStarGate, buildWindows, contentKeyOf, GateStamp, inferPromoLinks } from '../src/modules/catalog/promo-collection-link';

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
  // Compuerta Black Star AUTOMATICA (spec AUTO_CATALOGO §B): backtest ciego contra sellos (ver `describe` al final).
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

/** Compuerta Black Star automatica: sellos colgados de una carta lisa conocen su expansion; se infiere IGNORANDO esa relacion. */
describe('compuerta Black Star - backtest ciego', () => {
  const W = mins({ pe: 1000, ssp: 2000, tef: 3000 });
  const REAL = ['pe', 'ssp', 'tef'] as const;
  /** n sellos repartidos en `sets` expansiones; cada uno con su carta lisa de contenido unico y productId dentro de SU ventana. */
  const mk = (n: number, sets: readonly string[] = REAL, productFor?: (i: number, set: string) => number) => {
    const stamps: GateStamp[] = [];
    const expansionCards: { setId: string; contentKey: string | null }[] = [];
    for (let i = 0; i < n; i++) {
      const set = sets[i % sets.length];
      const ck = `K${i}`;
      expansionCards.push({ setId: set, contentKey: ck });
      stamps.push({ id: `s${i}`, contentKey: ck, productId: productFor ? productFor(i, set) : (W.get(set) as number) + 10 + i, realSetId: set });
    }
    return { stamps, expansionCards, minProductIdBySet: W };
  };
  it('N>=30, >=2 expansiones y 0 falsos high => ABIERTA (y reporta n/k/expansiones)', () => {
    const g = backtestBlackStarGate(mk(30));
    expect(g).toMatchObject({ open: true, n: 30, k: 30, expansions: 3, falseHigh: 0 });
  });
  it('N=29 => CERRADA (umbral de evaluables)', () => {
    expect(backtestBlackStarGate(mk(29))).toMatchObject({ open: false, n: 29 });
  });
  it('una sola expansion => CERRADA aunque N sea grande', () => {
    expect(backtestBlackStarGate(mk(40, ['pe']))).toMatchObject({ open: false, n: 40, expansions: 1 });
  });
  it('UN falso high (productId en la ventana de OTRA expansion que tambien tiene el contenido) => CERRADA', () => {
    const base = mk(40);
    // el sello s0 (real pe) tambien existe en ssp por contenido y su productId cae en la ventana de ssp => high en ssp (falso).
    base.expansionCards.push({ setId: 'ssp', contentKey: 'K0' });
    base.expansionCards = base.expansionCards.filter((c) => !(c.setId === 'pe' && c.contentKey === 'K0'));
    const g = backtestBlackStarGate({ ...base, stamps: base.stamps.map((st) => (st.id === 's0' ? { ...st, productId: 2500 } : st)) });
    expect(g.falseHigh).toBeGreaterThan(0);
    expect(g.open).toBe(false);
  });
  it('sellos sin contenido o sin productId no son evaluables (no cuentan en N)', () => {
    const base = mk(30);
    const stamps = [...base.stamps, { id: 'x1', contentKey: null, productId: 1010, realSetId: 'pe' }, { id: 'x2', contentKey: 'K1', productId: null, realSetId: 'pe' }];
    expect(backtestBlackStarGate({ ...base, stamps }).n).toBe(30);
  });
  it('sin sellos => CERRADA (sin intervencion)', () => {
    expect(backtestBlackStarGate({ stamps: [], expansionCards: [], minProductIdBySet: W })).toMatchObject({ open: false, n: 0, k: 0, expansions: 0 });
  });
  it('el contenido por si solo no abre: ventana fuera de la expansion real => low, no suma a k', () => {
    const g = backtestBlackStarGate(mk(40, REAL, () => 999_999));
    expect(g.k).toBeLessThan(g.n);
    expect(g.falseHigh).toBe(0); // low no es un falso high: la compuerta mide precision de `high`, no cobertura
  });
});
