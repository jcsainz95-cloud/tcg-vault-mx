import { planCardLinks, LinkCard, LinkProduct } from '../src/modules/catalog/card-link-plan';
import { normalizeCardNumber, CardProductResolverService } from '../src/modules/catalog/card-product-resolver.service';
import { deriveAvailableFinishesFromProducts } from '../src/common/card-order';
import { deriveCardProductsFromTcgcsv } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { parseTcgcsvCardName, linkNameKey } from '../src/modules/catalog/tcgcsv-card-name';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import fixture from './fixtures/tcgcsv/group-24837-classic-collection.json';
import { AutoLinkPriceGate } from '../src/modules/catalog/auto-link-price-gate.service';
import { resolveRobustMarket, DEFAULT_PRICE_ARBITER_SOURCES } from '../src/common/robust-market';
import { variantKey } from '../src/common/variant-key';

/**
 * §PRECIO-SIN-ENLACE (fase 1) — CA-1, CA-2, CA-5, CA-8 con el grupo REAL 24837 («ME: 30th Celebration Classic
 * Collection», medido 2026-11-25: 30 productos, 30 precios, un único subtipo Holofoil).
 */
const prod = (productId: number, name: string, number: string | null, kind: LinkProduct['kind'] = 'set_base'): LinkProduct => ({ productId, name, number, kind });
const card = (id: string, number: string, name: string, productCount = 0, tcgplayerId: string | null = null): LinkCard => ({ id, number, name, tcgplayerId, productCount });
const plan = (p: LinkProduct[], c: LinkCard[], owners: [number, string][] = [], opts = {}) =>
  planCardLinks(p, c, new Map(owners), normalizeCardNumber, opts);

describe('planCardLinks — reglas de enlace (CA-5)', () => {
  it('mismo número, nombres distintos en ambos lados ⇒ enlaza por (número, nombre), cada uno a la suya', () => {
    const r = plan(
      [prod(1, 'Metagross (Delta Species)', '11/113'), prod(2, 'Genesect EX (Team Plasma)', '11/101')],
      [card('cM', '11', 'Metagross'), card('cG', '11', 'Genesect EX')],
    );
    expect(r.links.get(1)).toEqual({ cardId: 'cM', rule: 'number_name' });
    expect(r.links.get(2)).toEqual({ cardId: 'cG', rule: 'number_name' });
    expect(r.collisions).toBe(0);
  });

  it('mismo número y MISMO nombre en ambos lados ⇒ 0 enlaces y reporte de colisión', () => {
    const r = plan(
      [prod(1, 'Pikachu', '58/102'), prod(2, 'Pikachu', '58/110')],
      [card('c1', '58', 'Pikachu'), card('c2', '58', 'Pikachu')],
    );
    expect(r.links.size).toBe(0);
    expect(r.collisions).toBe(2);
  });

  it('mismo número y nombre repetido solo del lado de la FUENTE (1 carta ↔ 2 productos) ⇒ 0 enlaces', () => {
    const r = plan([prod(1, 'Pikachu', '58/102'), prod(2, 'Pikachu', '58/110')], [card('c1', '58', 'Pikachu')]);
    expect(r.links.size).toBe(0);
    expect(r.collisions).toBe(2);
  });

  it('número repetido solo en un lado ⇒ tampoco se adivina (no enlaza por número)', () => {
    const r = plan([prod(1, 'Foo', '5'), prod(2, 'Bar', '5')], [card('c1', '5', 'Otro')]);
    expect(r.links.size).toBe(0);
    // I-3: ningún producto tiene carta local con SU llave ⇒ sobrantes `no_local_card`, no colisión.
    expect(r.collisions).toBe(0);
    expect(r.unlinked.map((u) => u.reason)).toEqual(['no_local_card', 'no_local_card']);
  });

  it('§7.8: número único a ambos lados y llave de nombre IGUAL ⇒ enlaza por número (nombre con sufijo de TCGCSV)', () => {
    const r = plan([prod(1, 'Charizard ex - 7/100', '7/100')], [card('c1', '7', 'Charizard ex')]);
    expect(r.links.get(1)?.cardId).toBe('c1');
  });

  it('§7.8: contención de palabras NO liga (en ambos sentidos) ⇒ name_mismatch', () => {
    const casos: [string, string][] = [
      ['Pikachu VMAX', 'Pikachu'],
      ['Pikachu', 'Pikachu VMAX'],
      ['Charizard ex', 'Charizard'],
      ['Charizard', 'Charizard ex'],
      ['Charizard', 'Dark Charizard'],
      ['Dark Charizard', 'Charizard'],
    ];
    for (const [prodName, cardName] of casos) {
      const r = plan([prod(1, prodName, '7/100')], [card('c1', '7', cardName)]);
      expect([prodName, cardName, r.links.size, r.unlinked]).toEqual([prodName, cardName, 0, [{ productId: 1, reason: 'name_mismatch' }]]);
      expect(r.omitted).toBe(1);
    }
  });

  it('§7.8: «Pikachu VMAX» #58 local NO liga al producto 716194 «Pikachu» (sonda qa)', () => {
    const r = plan([prod(716194, 'Pikachu', '58/102')], [card('c58', '58', 'Pikachu VMAX')]);
    expect(r.links.size).toBe(0);
    expect(r.unlinked).toEqual([{ productId: 716194, reason: 'name_mismatch' }]);
  });

  it('§7.8: wouldTake también exige llave igual (dueño ajeno + carta homónima por contención ⇒ sin owner_conflict)', () => {
    const r = plan([prod(1, 'Pikachu', '58/102')], [card('c1', '58', 'Pikachu VMAX')], [[1, 'otra']], { onlyUnlinked: true });
    expect(r.unlinked).toEqual([{ productId: 1, reason: 'skipped_linked' }]);
  });

  it('§7.8b: símbolos y Unown ligan por llave igual; lo distinto NO (♂≠F, (J)≠[K], Pikachu≠Pikachu Star)', () => {
    const ok: [string, string, string][] = [
      ['Nidoran M', '83', 'Nidoran ♂'],
      ['Nidoran F', '82', 'Nidoran ♀'],
      ['Latias Star', '105', 'Latias ★'],
      ['Gyarados Star (Delta Species)', '102', 'Gyarados ★ δ'],
      ['Azumarill (Delta Species)', '19', 'Azumarill δ'],
      ['Delta Rainbow Energy', '98', 'δ Rainbow Energy'],
      ['Giratina Prism Star', '58', 'Giratina ◇'],
      ['Miracle Sphere Alpha', '129', 'Miracle Sphere α'],
      ['Unown (J)', '76', 'Unown [J]'],
      ['Unown (A)', '1', 'Unown'],
      ['Nidoran (F)', '66', 'Nidoran ♀'],
    ];
    for (const [pn, num, cn] of ok) {
      const r = plan([prod(1, pn, `${num}/100`)], [card('c1', num, cn)]);
      expect([pn, cn, r.links.get(1)?.cardId]).toEqual([pn, cn, 'c1']);
    }
    const no: [string, string][] = [['Nidoran M', 'Nidoran ♀'], ['Unown (J)', 'Unown [K]'], ['Pikachu', 'Pikachu ★'], ['Pikachu Star', 'Pikachu']];
    for (const [pn, cn] of no) {
      const r = plan([prod(1, pn, '9/100')], [card('c1', '9', cn)]);
      expect([pn, cn, r.links.size]).toEqual([pn, cn, 0]);
    }
    // Los textuales siguen siendo excepción.
    expect(plan([prod(1, "Boss's Orders - 172/193", '172/193')], [card('c1', '172', "Boss's Orders (Ghetsis)")]).unlinked).toEqual([{ productId: 1, reason: 'name_mismatch' }]);
  });

  it('§7.8b(e2): Unown asimétrico: letras distintas (incl. ! y ?) nunca ligan; una sola letra se quita en ese lado', () => {
    for (const [pn, cn] of [['Unown (J)', 'Unown (K)'], ['Unown [!]', 'Unown [?]'], ['Unown (!)', 'Unown (?)']] as const) {
      const r = plan([prod(1, pn, '9/100')], [card('c1', '9', cn)]);
      expect([pn, cn, r.links.size]).toEqual([pn, cn, 0]);
    }
    // Iguales ligan; el local con letra y el proveedor sin ella (y al revés) ligan si el número es único en ambos lados.
    for (const [pn, cn] of [['Unown (!)', 'Unown [!]'], ['Unown', 'Unown (J)'], ['Unown (A)', 'Unown']] as const) {
      const r = plan([prod(1, pn, '9/100')], [card('c1', '9', cn)]);
      expect([pn, cn, r.links.get(1)?.cardId]).toEqual([pn, cn, 'c1']);
    }
    // «Unown» local vs dos «Unown (X)» con el mismo número ⇒ collision.
    const c = plan([prod(1, 'Unown (A)', '9/100'), prod(2, 'Unown (B)', '9/100')], [card('c1', '9', 'Unown')]);
    expect(c.links.size).toBe(0);
    expect(c.unlinked.map((u) => u.reason)).toEqual(['collision', 'collision']);
  });

  it('§7.8 respaldo: parseo fallido + «[...]», « - NNN/NNN» y paréntesis finales ⇒ llave igual a la local; nunca una tercera', () => {
    const casos: [string, string][] = [
      ['Pikachu - 058/102 (Secret) (Full Art)', 'Pikachu'],
      ['Pikachu [Foo Bar] (Full Art)', 'Pikachu'],
      ['Pikachu - SV001 (Alternate Art)', 'Pikachu'],
      ['Mewtwo - TG05/TG30 (Cosmos Holo) (Reverse Holo)', 'Mewtwo'],
      ['Metagross (Delta Species) (Secret)', 'Metagross (Delta Species)'], // 2.ª llave solo si hace falta; aquí la 1.ª ya es igual a la local con NAME_PARENS
      ['Metagross (Delta Species) (Secret)', 'Metagross'], // 2.ª llave: sin NAME_PARENS
    ];
    for (const [prodName, cardName] of casos) {
      const r = plan([prod(1, prodName, '9/100')], [card('c1', '9', cardName)]);
      expect([prodName, r.links.get(1)?.cardId]).toEqual([prodName, 'c1']);
    }
    // Nombre local con corchetes (segunda y última llave): «Unown [E]» sigue ligando a su carta.
    const u = plan([prod(1, 'Unown [E]', '65/130')], [card('cu', '65', 'Unown [E]')]);
    expect(u.links.get(1)?.cardId).toBe('cu');
    // Nunca una tercera: «Pikachu VMAX» no se reduce a «Pikachu».
    const r = plan([prod(1, 'Pikachu VMAX (Secret)', '9/100')], [card('c1', '9', 'Pikachu')]);
    expect(r.links.size).toBe(0);
  });

  it('G3-4: número único pero nombre INCOMPATIBLE ⇒ `name_mismatch`, no enlaza (un homónimo por número no cuelga precio ajeno)', () => {
    const r = plan([prod(1, 'Pikachu', '7/100')], [card('c1', '7', 'Mewtwo')]);
    expect(r.links.size).toBe(0);
    expect(r.unlinked).toEqual([{ productId: 1, reason: 'name_mismatch' }]);
    expect(r.omitted).toBe(1);
  });


  it('regla a: tcgplayerId manda aunque el número se repita', () => {
    const r = plan([prod(1, 'Foo', '5'), prod(2, 'Foo', '5')], [card('c1', '5', 'Foo', 0, '2'), card('c2', '5', 'Foo')]);
    expect(r.links.get(2)).toEqual({ cardId: 'c1', rule: 'tcgplayer_id' });
  });

  it('un producto con OTRO dueño no se pisa; una carta ya enlazada no recibe un base por número', () => {
    const r1 = plan([prod(1, 'Foo', '5')], [card('c1', '5', 'Foo', 0, '1'), card('c2', '9', 'X')], [[1, 'c2']]);
    expect(r1.links.has(1)).toBe(false);
    expect(r1.conflicts).toBe(1);
    expect(r1.omitted).toBe(0);
    const r2 = plan([prod(1, 'Foo', '5')], [card('c1', '5', 'Foo', 1)], [], { onlyUnlinked: true });
    expect(r2.links.has(1)).toBe(false);
  });

  it('I-9: unicidad del lado CARTA — dos cartas locales con el mismo (número, nombre) ⇒ no se adivina cuál; mismo número y nombres distintos ⇒ la regla b enlaza a la correcta', () => {
    const dup = plan([prod(1, 'Foo', '5')], [card('c1', '5', 'Foo'), card('c2', '5', 'Foo')]);
    expect(dup.links.size).toBe(0);
    expect(dup.collisions).toBe(1);
    const ok = plan([prod(1, 'Foo', '5'), prod(2, 'Bar', '5')], [card('c1', '5', 'Foo'), card('c2', '5', 'Bar')]);
    expect(ok.links.get(1)).toEqual({ cardId: 'c1', rule: 'number_name' });
    expect(ok.links.get(2)).toEqual({ cardId: 'c2', rule: 'number_name' });
  });

  it('I-9: una carta con DOS productos base (mismo número, nombres distintos, una sola carta) ⇒ ninguno se enlaza por número', () => {
    const r = plan([prod(1, 'Foo', '5'), prod(2, 'Foo Special', '5')], [card('c1', '5', 'Foo')]);
    expect(r.links.get(1)).toEqual({ cardId: 'c1', rule: 'number_name' }); // el exacto sí
    expect(r.links.has(2)).toBe(false); // el otro no se cuelga de la misma carta por número
  });

  it('I-9: enrutado de promos/variantes por número ÚNICO local; con número repetido ⇒ colisión; en reparación no pisa una carta enlazada', () => {
    const ok = plan([prod(1, 'Foo (Prerelease)', '5', 'promo')], [card('c1', '5', 'Foo', 1)]);
    expect(ok.links.get(1)).toEqual({ cardId: 'c1', rule: 'number_unique_local' });
    const dup = plan([prod(1, 'Foo (Prerelease)', '5', 'promo')], [card('c1', '5', 'Foo'), card('c2', '5', 'Bar')]);
    expect(dup.links.size).toBe(0);
    expect(dup.collisions).toBe(1);
    const rep = plan([prod(1, 'Foo (Prerelease)', '5', 'promo')], [card('c1', '5', 'Foo', 1)], [], { onlyUnlinked: true });
    expect(rep.links.size).toBe(0);
  });

  it('I-14: una carta NO recibe dos productos base (reglas a y b apuntan a la misma carta, en cualquier orden)', () => {
    const c = [card('c1', '5', 'Foo', 0, '2')];
    const ab = plan([prod(1, 'Foo', '5'), prod(2, 'Otro nombre', '9')], c);
    expect([...ab.links.values()].filter((l) => l.cardId === 'c1')).toHaveLength(1);
    const ba = plan([prod(2, 'Otro nombre', '9'), prod(1, 'Foo', '5')], c);
    expect([...ba.links.values()].filter((l) => l.cardId === 'c1')).toHaveLength(1);
    expect(ab.unlinked).toContainEqual({ productId: 2, reason: 'card_already_linked' });
  });

  it('I-4: en modo reparación un producto con OTRO dueño que una carta SIN enlace habría tomado ⇒ conflicto contado (no silencio)', () => {
    const r = plan([prod(1, 'Foo', '5')], [card('c1', '5', 'Foo', 0), card('c2', '9', 'X', 1)], [[1, 'c2']], { onlyUnlinked: true });
    expect(r.links.size).toBe(0);
    expect(r.unlinked).toEqual([{ productId: 1, reason: 'owner_conflict' }]);
    expect(r.conflicts).toBe(1);
  });

  it('modo reparación: cartas/productos ya enlazados ⇒ 0 enlaces nuevos (idempotencia)', () => {
    const r = plan([prod(1, 'Foo', '5')], [card('c1', '5', 'Foo', 1)], [[1, 'c1']], { onlyUnlinked: true });
    expect(r.links.size).toBe(0);
    expect(r.omitted).toBe(0);
  });
});

describe('grupo REAL 24837 (CA-1, CA-2)', () => {
  const products = fixture.products.map((p) => ({ productId: p.productId, name: p.name, number: p.number }));
  const prices = fixture.prices;
  // Catálogo tipo pokemontcg.io: nombre simple (sin paréntesis de nombre ni sello), número sin «/total» ni ceros.
  const localCards = (): LinkCard[] =>
    products.map((p) => {
      const parsed = parseTcgcsvCardName(p.name, p.number);
      const base = parsed.ok ? parsed.name : p.name;
      return card(`card-${p.productId}`, normalizeCardNumber(p.number!), base.replace(/\s*\((Delta Species|Prime|Top|Bottom|Supporter)\)/i, ''));
    });
  const derived = () => deriveCardProductsFromTcgcsv(products, prices as never);

  it('CA-1: 30/30 productos enlazados, 0 colisiones, #11 y #106 repetidos sin cruzarse', () => {
    const d = derived();
    expect(d).toHaveLength(30);
    const r = planCardLinks(d.map((x) => ({ productId: x.productId, name: x.name, number: x.number, kind: x.kind })), localCards(), new Map(), normalizeCardNumber);
    expect(r.links.size).toBe(30);
    expect(r.collisions).toBe(0);
    expect(new Set([...r.links.values()].map((l) => l.cardId)).size).toBe(30);
    // Cada producto cuelga de SU carta (nunca la del número vecino).
    for (const [pid, l] of r.links) expect(l.cardId).toBe(`card-${pid}`);
    expect(r.links.get(716157)).toEqual({ cardId: 'card-716157', rule: 'number_name' }); // Metagross 11
    expect(r.links.get(716158)).toEqual({ cardId: 'card-716158', rule: 'number_name' }); // Genesect 11
    for (const pid of [716203, 716204, 716205]) expect(r.links.get(pid)?.rule).toBe('number_name'); // #106 ×3
  });

  it('B2 me55c #11: solo la carta local Genesect-EX + ambos productos (716157/716158) ⇒ liga 716158 y NO el Metagross', () => {
    // «Genesect-EX» local = «Genesect EX (Team Plasma)» del producto tras normalizar y quitar el paréntesis de variante (AE-1).
    const only = localCards().filter((c) => c.id === 'card-716158').map((c) => ({ ...c, name: 'Genesect-EX' }));
    const d = derived().map((x) => ({ productId: x.productId, name: x.name, number: x.number, kind: x.kind }));
    for (const order of [d, [...d].reverse()]) {
      const r = planCardLinks(order, only, new Map(), normalizeCardNumber);
      expect(r.links.get(716158)?.cardId).toBe('card-716158');
      expect(r.links.get(716157)).toBeUndefined();
      // I-3: el Metagross sobrante no es colisión, es «sin carta local».
      expect(r.unlinked.find((u) => u.productId === 716157)?.reason).toBe('no_local_card');
      expect(r.collisions).toBe(0);
    }
  });

  it('AE-1: B2 NO liga por contención de palabras («Pikachu» ≠ «Pikachu VMAX»), en ambos órdenes', () => {
    const ps = [prod(1, 'Pikachu VMAX', '25/100'), prod(2, 'Bulbasaur', '25/101')];
    for (const order of [ps, [...ps].reverse()]) {
      const r = plan(order, [card('c1', '25', 'Pikachu')]);
      expect(r.links.size).toBe(0);
      expect(r.unlinked.map((u) => u.reason)).toEqual(['no_local_card', 'no_local_card']);
    }
    // Y con el producto verdadero presente liga ese, no el VMAX.
    const r2 = plan([prod(1, 'Pikachu VMAX', '25/100'), prod(2, 'Pikachu', '25/101')], [card('c1', '25', 'Pikachu')]);
    expect([...r2.links.entries()]).toEqual([[2, { cardId: 'c1', rule: 'number_name' }]]);
  });

  it('I-2: sentido inverso (2 locales + 1 producto) ⇒ liga la ÚNICA local de llave igual, en ambos órdenes de cartas', () => {
    const cs = [card('cA', '11', 'Metagross'), card('cG', '11', 'Genesect-EX')];
    for (const order of [cs, [...cs].reverse()]) {
      const r = plan([prod(1, 'Genesect EX (Team Plasma)', '11/101')], order);
      expect([...r.links.entries()].map(([k, v]) => [k, v.cardId])).toEqual([[1, 'cG']]);
    }
  });

  it('B2 me55c #106 triple: una carta local por número + 3 productos ⇒ liga solo el de nombre compatible; 2 compatibles ⇒ colisión', () => {
    const d = derived().map((x) => ({ productId: x.productId, name: x.name, number: x.number, kind: x.kind }));
    const trip = d.filter((x) => [716203, 716204, 716205].includes(x.productId));
    const loc = { ...localCards().find((c) => c.id === 'card-716204')! };
    const r = planCardLinks(trip, [loc], new Map(), normalizeCardNumber);
    expect([...r.links.entries()]).toEqual([[716204, expect.objectContaining({ cardId: 'card-716204' })]]);
    const dup = planCardLinks([trip[0], { ...trip[1], productId: 999, name: trip[0].name }, trip[2]], [{ ...loc, name: trip[0].name }], new Map(), normalizeCardNumber);
    expect(dup.links.size).toBe(0);
  });

  it('CA-8: si falta la carta de Genesect, su producto (#11) NO cuelga de la de Metagross (el enrutado solo-local sí lo haría)', () => {
    const only11 = localCards().filter((c) => c.id !== 'card-716158');
    const d = derived().map((x) => ({ productId: x.productId, name: x.name, number: x.number, kind: x.kind }));
    const r = planCardLinks([...d].reverse(), only11, new Map(), normalizeCardNumber); // Genesect primero
    expect(r.links.get(716158)).toBeUndefined();
    expect(r.links.get(716157)?.cardId).toBe('card-716157');
  });

  it('CA-1/CA-2 de punta a punta con el resolver: 30 CardProduct, 30 precios, Metagross 11 Holofoil ≈ USD 3.97', async () => {
    const cps: any[] = [];
    const prs: any[] = [];
    const prisma = {
      $executeRaw: jest.fn(async () => 0),
      cardSet: { findUnique: jest.fn(async () => ({ id: 'set-cc', name: '30th Celebration Classic Collection', pptSetId: '24837', externalId: 'me-cc' })) },
      card: { findMany: jest.fn(async () => localCards().map((c) => ({ id: c.id, number: c.number, name: c.name, tcgplayerId: null, _count: { cardProducts: 0 } }))) },
      cardProduct: {
        findMany: jest.fn(async () => []),
        upsert: jest.fn(async (a: any) => (cps.push(a), { id: `cp-${a.where.tcgplayerProductId}` })),
      },
      priceReference: { findUnique: jest.fn(async () => null), upsert: jest.fn(async (a: any) => (prs.push(a), { id: 'x' })) },
    } as unknown as PrismaService;
    const client = {
      getProducts: jest.fn(async () => products),
      getPrices: jest.fn(async () => prices),
      listGroups: jest.fn(async () => []),
    } as unknown as TcgcsvCatalogClient;
    const reconcile = jest.fn(async () => 0);
    const fx = { getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' })) } as unknown as FxService;
    const svc = new CardProductResolverService(prisma, client, { reconcile } as unknown as FinishReconciler, fx);
    const res = await svc.resolveCardProductsForSet('set-cc');
    expect(res).toMatchObject({ joined: 30, unjoined: 0, collisions: 0, omittedProducts: 0, cardsTouched: 30 });
    expect(cps).toHaveLength(30);
    expect(prs).toHaveLength(30);
    const metaCp = cps.find((c) => c.where.tcgplayerProductId === 716157).create;
    expect(metaCp).toMatchObject({ cardId: 'card-716157', kind: 'set_base', finishes: ['holofoil'] });
    const metaPr = prs.find((p) => p.create.cardProductId === 'cp-716157').create;
    expect(metaPr).toMatchObject({ cardId: 'card-716157', finish: 'holofoil', priceUsdCents: 397, source: 'tcgcsv_singles' });
    // CA-2: el acabado de la carta sale del producto (único subtipo) y reemplaza la semilla ['normal'].
    expect(deriveAvailableFinishesFromProducts([{ kind: 'set_base', finishes: metaCp.finishes }], [])).toEqual(['holofoil']);
  });

  it('B4: modo reparación con TODO ya enlazado ⇒ 0 CardProduct escritos y los 30 precios en la misma corrida (pricesWritten=30, groupName)', async () => {
    const prs: any[] = [];
    const cardsL = localCards();
    const prisma = {
      $executeRaw: jest.fn(async () => 0),
      cardSet: { findUnique: jest.fn(async () => ({ id: 'set-cc', name: '30th Celebration Classic Collection', pptSetId: '24837', externalId: 'me-cc' })) },
      card: { findMany: jest.fn(async () => cardsL.map((c) => ({ id: c.id, number: c.number, name: c.name, tcgplayerId: null, _count: { cardProducts: 1 } }))) },
      cardProduct: {
        findMany: jest.fn(async () => products.map((p) => ({ id: `cp-${p.productId}`, tcgplayerProductId: p.productId, cardId: `card-${p.productId}`, kind: 'set_base', finishes: derived().find((d) => d.productId === p.productId)!.finishes }))),
        upsert: jest.fn(),
      },
      priceReference: { findUnique: jest.fn(async () => null), upsert: jest.fn(async (a: any) => (prs.push(a), { id: 'x' })) },
    } as unknown as PrismaService;
    const client = {
      getProducts: jest.fn(async () => products),
      getPrices: jest.fn(async () => prices),
      listGroups: jest.fn(async () => [{ groupId: 24837, name: 'ME: 30th Celebration Classic Collection' }]),
    } as unknown as TcgcsvCatalogClient;
    const fx = { getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' })) } as unknown as FxService;
    const svc = new CardProductResolverService(prisma, client, { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fx);
    const res = await svc.resolveCardProductsForSet('set-cc', { onlyUnlinked: true });
    expect(prisma.cardProduct.upsert).not.toHaveBeenCalled();
    expect(res).toMatchObject({ joined: 0, pricesWritten: 30, groupName: 'ME: 30th Celebration Classic Collection', groupVia: 'auto' });
    expect(prs).toHaveLength(30);
  });

  describe('B-1 / AE-2: B4 (reparación) solo precia acabados presentes en CardProduct.finishes y respeta override', () => {
    const fp = fixture.prices[0] as Record<string, unknown>;
    const mk = (
      existingFinishes: string[],
      existingPrice: { isManualOverride: boolean } | null,
      priceOver: Record<string, unknown> = {},
      shape: { cards?: number; addsOn?: number; manualOverride?: boolean; gate?: unknown } = {},
    ) => {
      const prs: any[] = [];
      const n = shape.cards ?? 1;
      const addsOn = shape.addsOn ?? n;
      const prods = Array.from({ length: n }, (_, i) => ({ ...fixture.products[0], productId: 9001 + i, name: `Charizard ${i}`, number: `${4 + i}/102` }));
      const priceRows = prods.flatMap((p, i) => {
        const base = { ...fp, productId: p.productId, lowPrice: 1800, midPrice: 1850, highPrice: 2000, directLowPrice: null };
        const holo = { ...base, subTypeName: 'Holofoil', marketPrice: 1877.4, ...priceOver };
        // Las tarjetas sin «adición» solo traen el acabado que el producto ya tiene.
        return i < addsOn ? [holo] : [{ ...base, subTypeName: 'Normal', marketPrice: 10 }];
      });
      const cps = prods.map((p, i) => ({ id: `cp${i}`, tcgplayerProductId: p.productId, cardId: `c${i}`, kind: 'set_base', finishes: existingFinishes }));
      const prisma = {
        $executeRaw: jest.fn(async () => 0),
        cardSet: { findUnique: jest.fn(async () => ({ id: 's', name: 'Base', pptSetId: '24837', externalId: 'base1' })) },
        card: {
          findMany: jest.fn(async () => prods.map((p, i) => ({ id: `c${i}`, number: String(4 + i), name: `Charizard ${i}`, tcgplayerId: null, _count: { cardProducts: 1 } }))),
          findUnique: jest.fn(async (a: any) => ({ availableFinishes: ['normal'], id: a.where.id })),
          update: jest.fn(async () => ({})),
        },
        cardProduct: {
          findMany: jest.fn(async () => cps),
          findUnique: jest.fn(async (a: any) => ({ finishes: existingFinishes, id: a.where.id })),
          update: jest.fn(async () => ({})),
          upsert: jest.fn(),
        },
        priceReference: {
          findUnique: jest.fn(async () => existingPrice),
          findMany: jest.fn(async () => (shape.manualOverride ? prods.map((_p, i) => ({ cardId: `c${i}`, finish: 'holofoil' })) : [])),
          upsert: jest.fn(async (a: any) => (prs.push(a), { id: 'x' })),
        },
      } as unknown as PrismaService;
      const client = { getProducts: jest.fn(async () => prods), getPrices: jest.fn(async () => priceRows), listGroups: jest.fn(async () => [{ groupId: 24837, name: 'Grupo de prueba' }]) } as unknown as TcgcsvCatalogClient;
      const fx = { getCurrent: jest.fn(async () => ({ rate: 18, bufferPct: 0, source: 'banxico', effectiveDate: '2026-11-25' })) } as unknown as FxService;
      const svc = new CardProductResolverService(prisma, client, { reconcile: jest.fn(async () => 0) } as unknown as FinishReconciler, fx, undefined, undefined, shape.gate as never);
      return { svc, prs, prisma };
    };
    it('§9.5 (supersede B-1): Charizard producto [normal] + fuente Holofoil 187 740 ¢ ⇒ finishes=[normal,holofoil] en CardProduct y carta, con su precio; 0 piezas tocadas', async () => {
      const { svc, prs, prisma } = mk(['normal'], null);
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(res).toMatchObject({ finishesAdded: 1, pricesWritten: 1 });
      expect(prs).toHaveLength(1);
      expect(prs[0].create).toMatchObject({ finish: 'holofoil', cardId: 'c0', priceUsdCents: 187740 });
      expect(prisma.cardProduct.update).toHaveBeenCalledWith({ where: { id: 'cp0' }, data: { finishes: ['normal', 'holofoil'] } });
      expect(prisma.card.update).toHaveBeenCalledWith({ where: { id: 'c0' }, data: { availableFinishes: ['normal', 'holofoil'] } });
      expect(prisma.cardProduct.upsert).not.toHaveBeenCalled(); // el enlace NO se rehace
    });
    it('§9.5 (i): subtipo DESCONOCIDO ⇒ 0 escrituras y se cuenta unknown_subtype', async () => {
      const { svc, prs, prisma } = mk(['normal'], null, { subTypeName: 'Cosmos Foil Etched' });
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(prs).toHaveLength(0);
      expect(prisma.cardProduct.update).not.toHaveBeenCalled();
      expect(prisma.card.update).not.toHaveBeenCalled();
      expect(res).toMatchObject({ finishesAdded: 0, reasonCounts: { unknown_subtype: 1 } });
    });
    it('§9.5 (v): set con 30 % de adiciones (N ≥ 8) ⇒ 0 escrituras de acabados y finishSurge; con 20 % sí se añaden', async () => {
      for (const [adds, expectSurge] of [[3, true], [2, false]] as const) {
        const { svc, prs, prisma } = mk(['normal'], null, {}, { cards: 10, addsOn: adds });
        const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
        expect(res?.finishSurge ?? false).toBe(expectSurge);
        expect(res?.finishesAdded).toBe(expectSurge ? 0 : adds);
        if (expectSurge) {
          expect(prs.filter((r) => r.create.finish === 'holofoil')).toHaveLength(0);
          expect(prisma.cardProduct.update).not.toHaveBeenCalled();
          expect(prisma.card.update).not.toHaveBeenCalled();
          expect(res?.reasonCounts).toMatchObject({ finish_not_in_product: 3 });
        }
      }
    });
    it('§9.5 (iii): override manual de mercado de ese acabado ⇒ no se añade ni se escribe', async () => {
      const { svc, prs, prisma } = mk(['normal'], null, {}, { manualOverride: true });
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(prs).toHaveLength(0);
      expect(prisma.cardProduct.update).not.toHaveBeenCalled();
      expect(res?.finishesAdded).toBe(0);
    });
    it('§9.5 (vi): tope por corrida — con finishBudget agotado no se añade nada', async () => {
      const { svc, prisma } = mk(['normal'], null);
      const budget = { remaining: 0 };
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true, finishBudget: budget });
      expect(res?.finishesAdded).toBe(0);
      expect(prisma.cardProduct.update).not.toHaveBeenCalled();
    });
    // §9.6 — el candado de `price-ingest` (decideLock ×5) ANTES de escribir. `baselineOf(cardId)` = referencia previa (null ⇒ carta sin referencia).
    const gateWith = (baselineOf: (cardId: string) => number | null) => {
      const recorded: any[] = [];
      const pricing = {
        arbiterPreviewWithCandidates: jest.fn(async (items: any[]) => {
          const out = new Map<string, any>();
          const today = new Date().toISOString().slice(0, 10);
          for (const it of items) {
            out.set(variantKey(it.key), {
              result: resolveRobustMarket([it.candidate], { freshnessDays: 7, admittedSources: DEFAULT_PRICE_ARBITER_SOURCES, consensusTolerancePct: 25 }, today),
              baselineMxnCents: baselineOf(it.key.cardId),
            });
          }
          return out;
        }),
        arbiterDetailForKeys: jest.fn(async () => new Map()),
      };
      const review = { recordArbiterDecision: jest.fn(async (...a: any[]) => (recorded.push(a), 'case')) };
      const settings = { getRaw: jest.fn(async () => 5) };
      return { gate: new AutoLinkPriceGate(pricing as never, review as never, settings as never), recorded, review, pricing };
    };
    const PRICE_MXN = 187_740 * 18; // 1877.40 USD × 18 en centavos MXN
    it('§9.6 (i): salto ≥ ×5 contra la referencia vigente sin consenso ⇒ NO se escribe PriceReference y se abre el caso (eje sell); el resto sí se escribe', async () => {
      const { gate, recorded } = gateWith((id) => (id === 'c0' ? PRICE_MXN / 10 : PRICE_MXN)); // c0: base 10× menor ⇒ salto ×10
      const { svc, prs } = mk(['holofoil'], null, {}, { cards: 8, gate });
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(res).toMatchObject({ held: 1, pricesWritten: 7, reasonCounts: { price_jump: 1 }, sanity: { checked: 8, held: 1 } });
      expect(prs.map((r) => r.create.cardId)).not.toContain('c0');
      expect(prs).toHaveLength(7);
      expect(recorded).toHaveLength(1 + 0);
      expect(recorded[0][0]).toMatchObject({ cardId: 'c0', finish: 'holofoil', productType: 'raw', gradeKey: 'raw:NM' });
      expect(recorded[0][1]).toBe('sell');
      expect(recorded[0][3]).toMatchObject({ outcome: 'review', publishMxnCents: null, conservedMxnCents: PRICE_MXN / 10, openCase: true });
    });
    it('§9.6 (ii): grupo EQUIVOCADO simulado (todas las cartas con referencia previa saltan ×20) ⇒ 0 precios publicados, 0 enlaces, set frenado price_sanity', async () => {
      const { gate, recorded } = gateWith(() => PRICE_MXN / 20);
      const { svc, prs, prisma } = mk(['holofoil'], null, {}, { cards: 6, gate });
      const res = await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(res).toMatchObject({ sanityAborted: true, joined: 0, pricesWritten: 0, sanity: { checked: 6, held: 6 }, touchedCardIds: [] });
      expect(prs).toHaveLength(0);
      expect(prisma.cardProduct.upsert).not.toHaveBeenCalled();
      expect(prisma.cardProduct.update).not.toHaveBeenCalled();
      expect(recorded).toHaveLength(0); // ni siquiera casos: el set entero no se publica
    });
    it('§9.6 (ii): con N < 5 variantes con referencia previa no hay freno por set (cada una se retiene sola); 1/5 = 20 % sí frena', async () => {
      const four = gateWith(() => PRICE_MXN / 20);
      const a = mk(['holofoil'], null, {}, { cards: 4, gate: four.gate });
      const ra = await a.svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(ra).toMatchObject({ held: 4, pricesWritten: 0 });
      expect(ra?.sanityAborted).toBeUndefined();
      const five = gateWith((id) => (id === 'c0' ? PRICE_MXN / 20 : PRICE_MXN));
      const b = mk(['holofoil'], null, {}, { cards: 5, gate: five.gate });
      const rb = await b.svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(rb).toMatchObject({ sanityAborted: true, pricesWritten: 0 });
      expect(b.prs).toHaveLength(0);
    });
    it('§9.6: sin referencia previa rige lo de price-ingest (se escribe y luego se registra la decisión); confirmado por el dueño no lo frena el freno por set', async () => {
      const g1 = gateWith(() => null);
      const a = mk(['holofoil'], null, {}, { cards: 6, gate: g1.gate });
      const ra = await a.svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(ra).toMatchObject({ held: 0, pricesWritten: 6 });
      expect(g1.pricing.arbiterDetailForKeys).toHaveBeenCalledTimes(1); // runPriceCandado posterior, como price-ingest
      const g2 = gateWith(() => PRICE_MXN / 20);
      const b = mk(['holofoil'], null, {}, { cards: 6, gate: g2.gate });
      // grupo confirmado por el dueño: mismo candado por variante, sin el freno del set entero
      (b.prisma.cardSet.findUnique as jest.Mock).mockResolvedValue({ id: 's', name: 'Base', pptSetId: '24837', externalId: 'base1', cardGroupId: 24837, cardGroupVia: 'confirmed' });
      const rb = await b.svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(rb?.sanityAborted).toBeUndefined();
      expect(rb).toMatchObject({ held: 6, pricesWritten: 0 });
    });
    it('B-1 (control): si el CardProduct ya tiene holofoil ⇒ sí se precia', async () => {
      const { svc, prs } = mk(['holofoil'], null);
      await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(prs).toHaveLength(1);
      expect(prs[0].create.finish).toBe('holofoil');
    });
    it('AE-2: fila del día con isManualOverride ⇒ B4 no escribe (0 upserts)', async () => {
      const { svc, prs } = mk(['holofoil'], { isManualOverride: true });
      await svc.resolveCardProductsForSet('s', { onlyUnlinked: true });
      expect(prs).toHaveLength(0);
    });
  });

  it('los 5 omitidos de antes eran exactamente los paréntesis de nombre (y ya no se omiten)', () => {
    const skipped = products.filter((p) => !parseTcgcsvCardName(p.name, p.number).ok);
    expect(skipped).toEqual([]);
    expect(linkNameKey('Gengar (Prime)')).toBe('gengar');
  });
});
