import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../catalog/catalog.service';
import { DeckMatcherService } from './deck-matcher.service';
import { DecksMetaService } from './decks-meta.service';

/**
 * DECKS-META §3.4/§13 (Fase 1) — la lógica MONEY-ADJACENT: la compuerta de legalidad y la
 * disponibilidad. Regla dura del dueño: sólo lo LEGAL + en stock se ofrece; lo rotado se MARCA; sin
 * stock se marca; lo no casado no aporta piezas. Precio/disponibilidad se REUSAN (nunca se inventan).
 */
describe('DecksMetaService (DECKS-META §3.4/§13) — legalidad + disponibilidad', () => {
  const cfg = { activeMarks: ['G', 'H', 'I'], banlistCardIds: ['ban-me'] };

  function card(over: Partial<any> = {}) {
    return {
      id: 'c1',
      externalId: 'twm-130',
      name: 'Dragapult ex',
      number: '130',
      imageLargeUrl: 'https://img/large.png',
      imageSmallUrl: 'https://img/small.png',
      regulationMark: 'H',
      legalStandardRaw: 'Legal',
      supertype: 'Pokémon',
      set: { id: 's1', ptcgoCode: 'TWM' },
      ...over,
    };
  }

  function unit(id: string, price: number): DeckMetaUnitDTO {
    return { inventoryItemId: id, priceMxnCents: price };
  }

  function makeService(over: {
    unitsByCard?: Map<string, DeckMetaUnitDTO[]>;
    configRows?: { key: string; valueJson: unknown }[];
  } = {}) {
    const catalog = {
      getSellableRawUnitsByCardIds: jest.fn(async () => over.unitsByCard ?? new Map()),
    } as unknown as CatalogService;
    const prisma = {
      configSetting: {
        findMany: jest.fn(async () =>
          over.configRows ?? [
            { key: 'standard.active_regulation_marks', valueJson: ['G', 'H', 'I'] },
            { key: 'standard.banlist_card_ids', valueJson: ['ban-me'] },
          ],
        ),
      },
    } as unknown as PrismaService;
    const matcher = {} as unknown as DeckMatcherService;
    return new DecksMetaService(prisma, catalog, matcher);
  }

  const matchedLine = (over: Partial<any> = {}): any => ({
    rawName: 'Dragapult ex',
    rawSetCode: 'TWM',
    rawNumber: '130',
    quantity: 4,
    group: 'pokemon' as const,
    matchStatus: 'matched' as const,
    matchedCard: card(),
    ...over,
  });

  it('matched + legal + stock ⇒ OFRECIBLE: availableQty=min(qty,stock), ids cheapest-first, precio "desde"', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000), unit('inv-b', 6000)]]]);
    const svc = makeService({ unitsByCard: units });
    const groups = await svc.buildGroups([matchedLine({ quantity: 4 })], cfg);
    const line = groups.pokemon[0];
    expect(line.legal).toBe(true);
    expect(line.availableQty).toBe(2); // min(4, 2)
    expect(line.unitInventoryItemIds).toEqual(['inv-a', 'inv-b']);
    expect(line.unitPriceMxnCents).toBe(5000); // más barata
    expect(line.card).toMatchObject({ cardId: 'c1', name: 'Dragapult ex', imageUrl: 'https://img/large.png' });
  });

  it('availableQty topea en quantity: qty=1 con 3 en stock ⇒ 1 pieza ofrecida', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000), unit('inv-b', 6000), unit('inv-c', 7000)]]]);
    const svc = makeService({ unitsByCard: units });
    const groups = await svc.buildGroups([matchedLine({ quantity: 1 })], cfg);
    expect(groups.pokemon[0].availableQty).toBe(1);
    expect(groups.pokemon[0].unitInventoryItemIds).toEqual(['inv-a']);
  });

  it('matched + legal SIN stock ⇒ se MARCA: availableQty 0, sin piezas, precio null', async () => {
    const svc = makeService({ unitsByCard: new Map() });
    const groups = await svc.buildGroups([matchedLine()], cfg);
    const line = groups.pokemon[0];
    expect(line.legal).toBe(true);
    expect(line.availableQty).toBe(0);
    expect(line.unitInventoryItemIds).toEqual([]);
    expect(line.unitPriceMxnCents).toBeNull();
  });

  it('matched pero ROTADA (marca fuera de la ventana) ⇒ legal:false, NO se ofrece aunque haya stock', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000)]]]);
    const svc = makeService({ unitsByCard: units });
    const rotated = matchedLine({ matchedCard: card({ regulationMark: 'F' }) });
    const groups = await svc.buildGroups([rotated], cfg);
    const line = groups.pokemon[0];
    expect(line.legal).toBe(false);
    expect(line.availableQty).toBe(0);
    expect(line.unitInventoryItemIds).toEqual([]);
    expect(line.card).not.toBeNull(); // la carta SÍ se muestra, sólo que marcada como no jugable
  });

  it('matched pero en BANLIST de operación ⇒ legal:false aunque marca activa y con stock', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000)]]]);
    const svc = makeService({ unitsByCard: units });
    const banned = matchedLine({ matchedCard: card({ externalId: 'ban-me' }) });
    const groups = await svc.buildGroups([banned], cfg);
    expect(groups.pokemon[0].legal).toBe(false);
    expect(groups.pokemon[0].unitInventoryItemIds).toEqual([]);
  });

  it('NO casada (unmatched_set) ⇒ card null, legal false, sin piezas (NO se inventa)', async () => {
    const svc = makeService();
    const unmatched = matchedLine({ matchStatus: 'unmatched_set', matchedCard: null, group: 'pokemon' });
    const groups = await svc.buildGroups([unmatched], cfg);
    const line = groups.pokemon[0];
    expect(line.card).toBeNull();
    expect(line.legal).toBe(false);
    expect(line.unitInventoryItemIds).toEqual([]);
    expect(line.matchStatus).toBe('unmatched_set');
  });

  it('las líneas se reparten por group (pokemon/trainer/energy)', async () => {
    const svc = makeService();
    const groups = await svc.buildGroups(
      [
        matchedLine({ group: 'pokemon', matchStatus: 'unmatched_number', matchedCard: null }),
        matchedLine({ group: 'trainer', matchStatus: 'unmatched_number', matchedCard: null }),
        matchedLine({ group: 'energy', matchStatus: 'unmatched_basic_energy', matchedCard: null, rawSetCode: '', rawNumber: '' }),
      ],
      cfg,
    );
    expect(groups.pokemon).toHaveLength(1);
    expect(groups.trainer).toHaveLength(1);
    expect(groups.energy).toHaveLength(1);
    expect(groups.energy[0].setCode).toBeNull();
  });

  it('loadLegalityConfig lee la ventana de ConfigSetting; ausente ⇒ arrays vacíos (nada legal)', async () => {
    const svc = makeService({ configRows: [] });
    const loaded = await svc.loadLegalityConfig();
    expect(loaded).toEqual({ activeMarks: [], banlistCardIds: [] });
  });

  describe('paste', () => {
    function svcWithMatcher(matchReturn: any[]) {
      const catalog = {
        getSellableRawUnitsByCardIds: jest.fn(async () => new Map()),
      } as unknown as CatalogService;
      const prisma = {
        configSetting: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService;
      const matcher = { matchLines: jest.fn(async () => matchReturn) } as unknown as DeckMatcherService;
      return new DecksMetaService(prisma, catalog, matcher);
    }

    it('texto vacío ⇒ 422 DECK_LIST_UNPARSEABLE', async () => {
      const svc = svcWithMatcher([]);
      await expect(svc.paste('')).rejects.toMatchObject({ code: 'DECK_LIST_UNPARSEABLE' });
    });

    it('texto sin líneas de carta ⇒ 422 DECK_LIST_UNPARSEABLE', async () => {
      const svc = svcWithMatcher([]);
      await expect(svc.paste('hola mundo\nlorem ipsum')).rejects.toMatchObject({ code: 'DECK_LIST_UNPARSEABLE' });
    });

    it('texto válido ⇒ devuelve { groups } con la misma forma que el detalle', async () => {
      const svc = svcWithMatcher([matchedLine({ matchStatus: 'unmatched_set', matchedCard: null })]);
      const res = await svc.paste('4 Dragapult ex TWM 130');
      expect(res).toHaveProperty('groups');
      expect(res.groups).toHaveProperty('pokemon');
      expect(res.groups).toHaveProperty('trainer');
      expect(res.groups).toHaveProperty('energy');
    });
  });

  describe('getBySlug', () => {
    it('slug desconocido ⇒ 404 DECK_NOT_FOUND', async () => {
      const catalog = { getSellableRawUnitsByCardIds: jest.fn(async () => new Map()) } as unknown as CatalogService;
      const prisma = {
        metaDeck: { findFirst: jest.fn(async () => null) },
        configSetting: { findMany: jest.fn(async () => []) },
      } as unknown as PrismaService;
      const svc = new DecksMetaService(prisma, catalog, {} as unknown as DeckMatcherService);
      await expect(svc.getBySlug('no-existe')).rejects.toMatchObject({ code: 'DECK_NOT_FOUND' });
    });
  });
});
