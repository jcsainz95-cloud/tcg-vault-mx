/**
 * promo-viejas.spec.ts — P-PROMOS-VIEJAS (ARCHITECTURE §5.13; API_CONTRACT PV-B1..B8), parte unitaria (sin BD ni red).
 * Los nombres y números de producto son los REALES de TCGCSV medidos el 2026-11-07 (grupos 22872, 2545, 1861, 1451, 1407, 1421).
 * PV-B7 (2.ª corrida ⇒ 0 duplicados) y el precio propio del sello (PV-B5) viven en test/integration/promo-viejas.e2e-spec.ts.
 */
import { CardProductResolverService } from '../src/modules/catalog/card-product-resolver.service';
import { TcgcsvSinglesBulkPriceProvider } from '../src/modules/pricing/providers/tcgcsv-singles-bulk.provider';
import { resolveTcgcsvGroupForSet } from '../src/modules/pricing/providers/tcgcsv-group-match';
import { PTCG_PROMO_GROUPS, promoGroupFor, promoNumberKey } from '../src/modules/catalog/promo-set-groups';
import { planPromoSet } from '../src/modules/catalog/promo-set-plan';
import { parseTcgcsvCardName } from '../src/modules/catalog/tcgcsv-card-name';

const prod = (productId: number, name: string, number: string | null) => ({ productId, name, number, rarity: 'Promo', imageUrl: null });
const card = (id: string, number: string) => ({ id, number });

describe('PV-B1 — la tabla manda sobre pptSetId y sobre el nombre (una sola función para estructura y precio)', () => {
  const noList = jest.fn(async () => {
    throw new Error('listGroups no debe consultarse: la tabla manda');
  });
  it('tabla fija: svp→22872, swshp→2545, smp→1861, xyp→1451, bwp→1407, dpp→1421', () => {
    expect(PTCG_PROMO_GROUPS.map((g) => [g.ptcgSetId, g.groupId])).toEqual([
      ['svp', 22872], ['swshp', 2545], ['smp', 1861], ['xyp', 1451], ['bwp', 1407], ['dpp', 1421],
    ]);
    expect(promoGroupFor('xyp')?.groupId).toBe(1451);
    expect(promoGroupFor('sv1')).toBeUndefined();
    expect(promoGroupFor(undefined)).toBeUndefined();
  });
  it.each(['sv-promos', '1400', '22872', null])('xyp con pptSetId=%s ⇒ grupo 1451, sin consultar nombres', async (ppt) => {
    const r = await resolveTcgcsvGroupForSet({ name: 'XY Black Star Promos', pptSetId: ppt, externalId: 'xyp' }, noList);
    expect(r).toMatchObject({ groupId: 1451, via: 'promo_table' });
  });
  it('fuera de la tabla: pptSetId numérico > nombre (sin cambio)', async () => {
    expect(await resolveTcgcsvGroupForSet({ name: 'X', pptSetId: '999', externalId: 'sv1' }, noList)).toMatchObject({ groupId: 999, via: 'ppt_set_id' });
    const groups = [{ groupId: 77, name: 'SV01: Scarlet & Violet', publishedOn: null }];
    expect(await resolveTcgcsvGroupForSet({ name: 'Scarlet & Violet', pptSetId: 'abc', externalId: 'sv1' }, async () => groups as never)).toMatchObject({ groupId: 77, via: 'name' });
  });
  it('la ruta de ESTRUCTURA (resolver) y la de PRECIO (barrido) usan el grupo de la tabla aunque pptSetId diga otro', async () => {
    const run = jest.fn(async (_s: string, groupId: number) => ({ groupId, joined: 0, products: 0, pricesWritten: 0, pricesPending: 0, unjoined: 0, cardsTouched: 0, promoSkipped: [] }));
    const prisma = { cardSet: { findUnique: jest.fn(async () => ({ id: 's1', name: 'XY Black Star Promos', pptSetId: 'sv-promos', externalId: 'xyp' })) } };
    const tcgcsv = { listGroups: noList };
    const resolver = new CardProductResolverService(prisma as never, tcgcsv as never, {} as never, {} as never, { run } as never);
    await resolver.resolveCardProductsForSet('s1');
    expect(run).toHaveBeenCalledWith('s1', 1451, 'XY');

    const tc = { listGroups: noList, getProducts: jest.fn(async () => []), getPrices: jest.fn(async () => []) };
    const bulk = new TcgcsvSinglesBulkPriceProvider(tc as never, { cardProduct: { findMany: jest.fn(async () => []) } } as never);
    const res = await bulk.fetchPricesForSet({ set: { id: 's1', name: 'XY Black Star Promos', pptSetId: '1400', externalId: 'xyp' } as never });
    expect(res.requestOk).toBe(true);
    expect(tc.getProducts).toHaveBeenCalledWith(1451);
    expect(tc.getPrices).toHaveBeenCalledWith(1451);
  });
});

describe('PV-B2 — BW004 = BW04 (ceros colapsados, un solo producto por carta)', () => {
  it('promoNumberKey', () => {
    expect(promoNumberKey('BW004', 'BW')).toBe(promoNumberKey('BW04', 'BW'));
    expect(promoNumberKey('BW004', 'BW')).toBe('4');
    expect(promoNumberKey('002', 'SVP')).toBe(promoNumberKey('2', 'SVP'));
    expect(promoNumberKey('SWSH001', 'SWSH')).toBe('1');
    expect(promoNumberKey('SM100', 'SM')).toBe('100');
  });
  it('el producto «BW04» cuelga de la carta «BW004» (una carta, un set_base)', () => {
    const plan = planPromoSet([card('c4', 'BW004'), card('c5', 'BW05')], [prod(1, 'Reshiram - BW04', 'BW04')], 'BW');
    expect(plan.items).toEqual([expect.objectContaining({ cardId: 'c4', kind: 'set_base' })]);
    expect(plan.items).toHaveLength(1);
  });
  it('número repetido en el set local (BW004 y BW04) ⇒ ambiguous_number, nada se cuelga', () => {
    const plan = planPromoSet([card('a', 'BW004'), card('b', 'BW04')], [prod(1, 'Reshiram - BW04', 'BW04')], 'BW');
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toEqual([{ number: 'BW04', reason: 'ambiguous_number' }]);
  });
  it('un número con «/» jamás casa: «134/142», «12/99» (otro set) ni «226/S-P»/«37/SM-P» (promo japonesa, otra carta que SWSH226/SM37)', () => {
    expect(promoNumberKey('134/142', 'SVP')).toBeNull();
    expect(promoNumberKey('12/99', 'BW')).toBeNull();
    expect(promoNumberKey('226/S-P', 'SWSH')).toBeNull();
    expect(promoNumberKey('37/SM-P', 'SM')).toBeNull();
    const plan = planPromoSet([card('c', 'BW12')], [prod(1, 'Arcanine - 12/99 (Prerelease)', '12/99')], 'BW');
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toEqual([{ number: '12/99', reason: 'no_card' }]);
  });
});

describe('PV-B3 — XY67a ≠ XY67', () => {
  it('promoNumberKey conserva la letra final', () => {
    expect(promoNumberKey('XY67a', 'XY')).toBe('67A');
    expect(promoNumberKey('XY67a', 'XY')).not.toBe(promoNumberKey('XY67', 'XY'));
  });
  it('el producto XY67 cuelga solo de XY67; XY67a queda sin producto (Precio pendiente)', () => {
    const plan = planPromoSet([card('x67', 'XY67'), card('x67a', 'XY67a')], [prod(108596, 'Jirachi - XY67', 'XY67')], 'XY');
    expect(plan.items.map((i) => i.cardId)).toEqual(['x67']);
  });
});

describe('PV-B4 — sellos de campeonato nuevos', () => {
  it('«Victory Cup - BW29 (Battle Road Autumn 2011) [3rd Place]» ⇒ UN sello championship con etiqueta combinada', () => {
    const r = parseTcgcsvCardName('Victory Cup - BW29 (Battle Road Autumn 2011) [3rd Place]', 'BW29', { staffOverPrerelease: true });
    expect(r).toEqual({ ok: true, name: 'Victory Cup', number: 'BW29', stamp: { type: 'championship', label: 'Battle Road Autumn 2011 · 3rd Place' } });
  });
  it.each([
    ['Reshiram - BW04 (Worlds 11)', 'BW04', 'Worlds 11'],
    ['Reshiram - BW04 (Worlds 2011)', 'BW04', 'Worlds 2011'],
    ['Foo - BW01 (Battle Road Spring 2013)', 'BW01', 'Battle Road Spring 2013'],
    ['Foo - BW01 [1st Place]', 'BW01', '1st Place'],
    ['Foo - BW01 [4th Place]', 'BW01', '4th Place'],
    ['Foo - BW01 [Participation]', 'BW01', 'Participation'],
    ['Foo - BW01 [Winner]', 'BW01', 'Winner'],
  ])('«%s» ⇒ championship', (name, num, label) => {
    expect(parseTcgcsvCardName(name, num)).toMatchObject({ ok: true, stamp: { type: 'championship', label } });
  });
  it('con [Staff] gana staff (también sobre (Prerelease) en las promos viejas); sin la opción sigue siendo desconocido (§5.12)', () => {
    expect(parseTcgcsvCardName('Foo - BW01 (Battle Road Spring 2013) [Staff]', 'BW01')).toMatchObject({ ok: true, stamp: { type: 'staff' } });
    expect(parseTcgcsvCardName('Quaquaval - 005 (Prerelease) [Staff]', '005', { staffOverPrerelease: true })).toMatchObject({ ok: true, stamp: { type: 'staff' } });
    expect(parseTcgcsvCardName('Quaquaval - 005 (Prerelease) [Staff]', '005')).toEqual({ ok: false, reason: 'unknown_stamp' });
  });
  it('puestos fuera de la lista cerrada siguen siendo desconocidos', () => {
    for (const n of ['Foo - BW01 [Top 8]', 'Foo - BW01 [Finalist]', 'Foo - BW01 (Worlds)', 'Foo - BW01 (Battle Road 2011)']) {
      expect(parseTcgcsvCardName(n, 'BW01')).toEqual({ ok: false, reason: 'unknown_stamp' });
    }
  });
});

describe('PV-B4b — sellos ampliados por el orquestador («sello = versión aparte»)', () => {
  it.each([
    ['Foo - BW01 (Staff)', 'staff', 'Staff'],
    ['Foo - BW01 (Cosmo Holo)', 'event_promo', 'Cosmo Holo'],
    ['Foo - BW01 (Shiny)', 'event_promo', 'Shiny'],
    ['Foo - BW01 (Team Plasma)', 'event_promo', 'Team Plasma'],
    ['Foo - BW01 [Top 16]', 'championship', 'Top 16'],
    ['Foo - BW01 [Champion]', 'championship', 'Champion'],
  ])('«%s» ⇒ %s', (name, type, label) => {
    expect(parseTcgcsvCardName(name, 'BW01', { staffOverPrerelease: true })).toMatchObject({ ok: true, name: 'Foo', stamp: { type, label } });
  });
  it('«(Team Plasma)» junto a otro sello solo suma su etiqueta (no es el sello)', () => {
    expect(parseTcgcsvCardName('Crobat - BW51 (Team Plasma) (Prerelease) [Staff]', 'BW51', { staffOverPrerelease: true })).toMatchObject({
      ok: true, name: 'Crobat', stamp: { type: 'staff', label: 'Staff · Team Plasma' },
    });
    expect(parseTcgcsvCardName('Metagross - BW75 (Team Plasma) (Prerelease)', 'BW75')).toMatchObject({
      ok: true, stamp: { type: 'prerelease', label: 'Prerelease · Team Plasma' },
    });
  });
  it('«(Shiny)» como ÚNICA impresión del número ⇒ set_base de la carta de pokemontcg.io (solo con sello)', () => {
    const plan = planPromoSet([card('x150', 'XY150')], [prod(121953, 'Yveltal EX - XY150 (Shiny)', 'XY150')], 'XY');
    expect(plan.items).toEqual([expect.objectContaining({ cardId: 'x150', kind: 'set_base', stamp: null })]);
  });
});

describe('PV-B5 — solo con sello ⇒ set_base; con plana ⇒ stamped', () => {
  it('SM10 (solo Prerelease) ⇒ el producto con sello es set_base de la carta', () => {
    const plan = planPromoSet([card('sm10', 'SM10')], [prod(1, 'Grubbin - SM10 (Prerelease)', 'SM10')], 'SM');
    expect(plan.items).toEqual([expect.objectContaining({ cardId: 'sm10', kind: 'set_base', stamp: null })]);
  });
  it('solo con sello + [Staff]: la Prerelease es base y su Staff cuelga stamped', () => {
    const plan = planPromoSet(
      [card('sm10', 'SM10')],
      [prod(1, 'Grubbin - SM10 (Prerelease)', 'SM10'), prod(2, 'Grubbin - SM10 (Prerelease) [Staff]', 'SM10')],
      'SM',
    );
    expect(plan.items.map((i) => [i.product.productId, i.kind, i.stamp?.type ?? null])).toEqual([[1, 'set_base', null], [2, 'stamped', 'staff']]);
  });
  it('con plana ⇒ la plana es la base y Prerelease/Staff cuelgan stamped', () => {
    const plan = planPromoSet(
      [card('c', 'SM05')],
      [prod(1, 'Rockruff - SM05', 'SM05'), prod(2, 'Rockruff - SM05 (Prerelease)', 'SM05'), prod(3, 'Rockruff - SM05 [Staff]', 'SM05')],
      'SM',
    );
    expect(plan.items.map((i) => [i.product.productId, i.kind])).toEqual([[1, 'set_base'], [2, 'stamped'], [3, 'stamped']]);
  });
  it('solo [Staff] ⇒ nunca se promueve a base: cuelga stamped y la carta queda pendiente', () => {
    const plan = planPromoSet([card('c', 'SM05')], [prod(3, 'Rockruff - SM05 [Staff]', 'SM05')], 'SM');
    expect(plan.items.map((i) => i.kind)).toEqual(['stamped']);
  });
});

describe('PV-B6 — 2+ candidatos a base', () => {
  it('Victory Cup BW29 (1st/2nd/3rd Place) sin plana ⇒ todos stamped, ambiguous_base y la carta sin set_base', () => {
    const plan = planPromoSet(
      [card('bw29', 'BW29')],
      [
        prod(1, 'Victory Cup - BW29 (Battle Road Autumn 2011) [1st Place]', 'BW29'),
        prod(2, 'Victory Cup - BW29 (Battle Road Autumn 2011) [2nd Place]', 'BW29'),
        prod(3, 'Victory Cup - BW29 (Battle Road Autumn 2011) [3rd Place]', 'BW29'),
      ],
      'BW',
    );
    expect(plan.items.map((i) => i.kind)).toEqual(['stamped', 'stamped', 'stamped']);
    expect(plan.items.every((i) => i.stamp?.type === 'championship')).toBe(true);
    expect(plan.skipped).toEqual([{ number: 'BW29', reason: 'ambiguous_base' }]);
  });
  it('2 planas con el mismo número ⇒ ninguna es base (ambiguous_base)', () => {
    const plan = planPromoSet([card('c', 'SM05')], [prod(1, 'Rockruff - SM05', 'SM05'), prod(2, 'Rockruff - SM05', 'SM05')], 'SM');
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toEqual([{ number: 'SM05', reason: 'ambiguous_base' }]);
  });
});

describe('PV-B8 — sello desconocido y producto sin carta', () => {
  it('«(Nintendo Power Magazine)» ⇒ unknown_stamp, jamás se mezcla con la plana', () => {
    const plan = planPromoSet(
      [card('c', 'XY05')],
      [prod(1, 'Xerneas - XY05', 'XY05'), prod(2, 'Xerneas - XY05 (Nintendo Power Magazine)', 'XY05')],
      'XY',
    );
    expect(plan.items.map((i) => i.product.productId)).toEqual([1]);
    expect(plan.skipped).toEqual([{ number: 'XY05', reason: 'unknown_stamp' }]);
  });
  it('sin carta local ⇒ no_card (nunca se crea carta); sin Number (sellado) ⇒ ni se reporta', () => {
    const plan = planPromoSet([card('c', 'XY05')], [prod(1, 'Foo - XY99', 'XY99'), prod(2, 'XY Promo Box', null)], 'XY');
    expect(plan.items).toHaveLength(0);
    expect(plan.skipped).toEqual([{ number: 'XY99', reason: 'no_card' }]);
  });
});
