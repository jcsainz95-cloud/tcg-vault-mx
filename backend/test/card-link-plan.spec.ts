import { planCardLinks, namesCompatible, LinkCard, LinkProduct } from '../src/modules/catalog/card-link-plan';
import { normalizeCardNumber, CardProductResolverService } from '../src/modules/catalog/card-product-resolver.service';
import { deriveAvailableFinishesFromProducts } from '../src/common/card-order';
import { deriveCardProductsFromTcgcsv } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import { parseTcgcsvCardName, linkNameKey } from '../src/modules/catalog/tcgcsv-card-name';
import { PrismaService } from '../src/prisma/prisma.service';
import { FinishReconciler } from '../src/modules/catalog/finish-reconciler.service';
import { FxService } from '../src/modules/pricing/fx.service';
import { TcgcsvCatalogClient } from '../src/modules/pricing/providers/tcgcsv-singles.provider';
import fixture from './fixtures/tcgcsv/group-24837-classic-collection.json';

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
    expect(r.collisions).toBe(2);
  });

  it('número único en ambos lados y nombre COMPATIBLE (uno contenido en el otro por palabras) ⇒ enlaza por número', () => {
    const r = plan([prod(1, 'Charizard ex', '7/100')], [card('c1', '7', 'Charizard')]);
    expect(r.links.get(1)).toEqual({ cardId: 'c1', rule: 'number' });
  });

  it('G3-4: número único pero nombre INCOMPATIBLE ⇒ `name_mismatch`, no enlaza (un homónimo por número no cuelga precio ajeno)', () => {
    const r = plan([prod(1, 'Pikachu', '7/100')], [card('c1', '7', 'Mewtwo')]);
    expect(r.links.size).toBe(0);
    expect(r.unlinked).toEqual([{ productId: 1, reason: 'name_mismatch' }]);
    expect(r.omitted).toBe(1);
  });

  it('namesCompatible: palabras completas, no subcadenas', () => {
    expect(namesCompatible('mew', 'mewtwo')).toBe(false);
    expect(namesCompatible('charizard', 'charizard ex')).toBe(true);
    expect(namesCompatible('', 'x')).toBe(false);
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
    // Nombre local ≠ llave del producto (palabras de más/menos) pero compatible: la regla b no aplica y el número se repite en TCGCSV.
    const only = localCards().filter((c) => c.id === 'card-716158').map((c) => ({ ...c, name: 'Genesect' }));
    const d = derived().map((x) => ({ productId: x.productId, name: x.name, number: x.number, kind: x.kind }));
    for (const order of [d, [...d].reverse()]) {
      const r = planCardLinks(order, only, new Map(), normalizeCardNumber);
      expect(r.links.get(716158)?.cardId).toBe('card-716158');
      expect(r.links.get(716157)).toBeUndefined();
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
        findMany: jest.fn(async () => products.map((p) => ({ id: `cp-${p.productId}`, tcgplayerProductId: p.productId, cardId: `card-${p.productId}`, kind: 'set_base' }))),
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

  it('los 5 omitidos de antes eran exactamente los paréntesis de nombre (y ya no se omiten)', () => {
    const skipped = products.filter((p) => !parseTcgcsvCardName(p.name, p.number).ok);
    expect(skipped).toEqual([]);
    expect(linkNameKey('Gengar (Prime)')).toBe('gengar');
  });
});
