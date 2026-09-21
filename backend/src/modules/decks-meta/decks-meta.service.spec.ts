import { PrismaService } from '../../prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../catalog/catalog.service';
import { DeckMatcherService } from './deck-matcher.service';
import { DecksMetaService } from './decks-meta.service';

/**
 * DECKS-META §3.4/§13 (Fase 1) — la lógica MONEY-ADJACENT: la disponibilidad. FUENTE-CONFIABLE
 * (SUP-LEG): ya NO hay compuerta de legalidad — Limitless publica sólo listas Standard-legal, así
 * que NO re-filtramos por marca/banlist/`legalStandardRaw`. Regla: toda carta CASADA con stock se
 * ofrece; sin stock se marca; lo no casado no aporta piezas. Precio/disponibilidad se REUSAN.
 */
describe('DecksMetaService (DECKS-META §3.4/§13) — disponibilidad (sin gate de legalidad)', () => {
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
  } = {}) {
    const catalog = {
      getSellableRawUnitsByCardIds: jest.fn(async () => over.unitsByCard ?? new Map()),
    } as unknown as CatalogService;
    const prisma = {} as unknown as PrismaService;
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

  it('matched + stock ⇒ OFRECIBLE: availableQty=min(qty,stock), ids cheapest-first, precio "desde"', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000), unit('inv-b', 6000)]]]);
    const svc = makeService({ unitsByCard: units });
    const groups = await svc.buildGroups([matchedLine({ quantity: 4 })]);
    const line = groups.pokemon[0];
    expect(line).not.toHaveProperty('legal'); // ya no existe el campo `legal`
    expect(line.availableQty).toBe(2); // min(4, 2)
    expect(line.unitInventoryItemIds).toEqual(['inv-a', 'inv-b']);
    expect(line.unitPriceMxnCents).toBe(5000); // más barata
    expect(line.card).toMatchObject({ cardId: 'c1', name: 'Dragapult ex', imageUrl: 'https://img/large.png' });
  });

  it('availableQty topea en quantity: qty=1 con 3 en stock ⇒ 1 pieza ofrecida', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000), unit('inv-b', 6000), unit('inv-c', 7000)]]]);
    const svc = makeService({ unitsByCard: units });
    const groups = await svc.buildGroups([matchedLine({ quantity: 1 })]);
    expect(groups.pokemon[0].availableQty).toBe(1);
    expect(groups.pokemon[0].unitInventoryItemIds).toEqual(['inv-a']);
  });

  it('matched SIN stock ⇒ se MARCA: availableQty 0, sin piezas, precio null', async () => {
    const svc = makeService({ unitsByCard: new Map() });
    const groups = await svc.buildGroups([matchedLine()]);
    const line = groups.pokemon[0];
    expect(line.availableQty).toBe(0);
    expect(line.unitInventoryItemIds).toEqual([]);
    expect(line.unitPriceMxnCents).toBeNull();
    expect(line.card).not.toBeNull();
  });

  it('FUENTE-CONFIABLE: una marca de regulación cualquiera NO impide ofrecer (sin gate)', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000)]]]);
    const svc = makeService({ unitsByCard: units });
    // Antes esta carta (marca "F") caía como rotada; ahora, casada y con stock, se ofrece.
    const line = matchedLine({ matchedCard: card({ regulationMark: 'F' }) });
    const groups = await svc.buildGroups([line]);
    expect(groups.pokemon[0].availableQty).toBe(1);
    expect(groups.pokemon[0].unitInventoryItemIds).toEqual(['inv-a']);
    expect(groups.pokemon[0]).not.toHaveProperty('legal');
  });

  it('FUENTE-CONFIABLE: `legalStandardRaw==="Banned"` NO impide ofrecer (dato crudo inerte, sin check)', async () => {
    const units = new Map([['c1', [unit('inv-a', 5000)]]]);
    const svc = makeService({ unitsByCard: units });
    const line = matchedLine({ matchedCard: card({ legalStandardRaw: 'Banned' }) });
    const groups = await svc.buildGroups([line]);
    expect(groups.pokemon[0].availableQty).toBe(1);
    expect(groups.pokemon[0].unitInventoryItemIds).toEqual(['inv-a']);
  });

  it('NO casada (unmatched_set) ⇒ card null, sin piezas (NO se inventa)', async () => {
    const svc = makeService();
    const unmatched = matchedLine({ matchStatus: 'unmatched_set', matchedCard: null, group: 'pokemon' });
    const groups = await svc.buildGroups([unmatched]);
    const line = groups.pokemon[0];
    expect(line.card).toBeNull();
    expect(line).not.toHaveProperty('legal');
    expect(line.unitInventoryItemIds).toEqual([]);
    expect(line.matchStatus).toBe('unmatched_set');
  });

  it('las líneas se reparten por group (pokemon/trainer/energy)', async () => {
    const svc = makeService();
    const groups = await svc.buildGroups([
      matchedLine({ group: 'pokemon', matchStatus: 'unmatched_number', matchedCard: null }),
      matchedLine({ group: 'trainer', matchStatus: 'unmatched_number', matchedCard: null }),
      matchedLine({ group: 'energy', matchStatus: 'unmatched_basic_energy', matchedCard: null, rawSetCode: '', rawNumber: '' }),
    ]);
    expect(groups.pokemon).toHaveLength(1);
    expect(groups.trainer).toHaveLength(1);
    expect(groups.energy).toHaveLength(1);
    expect(groups.energy[0].setCode).toBeNull();
  });

  describe('paste', () => {
    function svcWithMatcher(matchReturn: any[]) {
      const catalog = {
        getSellableRawUnitsByCardIds: jest.fn(async () => new Map()),
      } as unknown as CatalogService;
      const prisma = {} as unknown as PrismaService;
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
      } as unknown as PrismaService;
      const svc = new DecksMetaService(prisma, catalog, {} as unknown as DeckMatcherService);
      await expect(svc.getBySlug('no-existe')).rejects.toMatchObject({ code: 'DECK_NOT_FOUND' });
    });

    it('detalle NO expone `legalityVerifiedAt` (SUP-LEG: campo retirado)', async () => {
      const catalog = { getSellableRawUnitsByCardIds: jest.fn(async () => new Map()) } as unknown as CatalogService;
      const prisma = {
        metaDeck: {
          findFirst: jest.fn(async () => ({
            slug: 'dragapult',
            name: 'Dragapult ex',
            rank: 1,
            sharePct: 10,
            trend: 0,
            source: 'limitless',
            currentList: { sourceUrl: null, sourceTournament: null, cards: [] },
          })),
        },
      } as unknown as PrismaService;
      const svc = new DecksMetaService(prisma, catalog, {} as unknown as DeckMatcherService);
      const detail = await svc.getBySlug('dragapult');
      expect(detail).not.toHaveProperty('legalityVerifiedAt');
      expect(detail).toHaveProperty('groups');
    });
  });

  /**
   * DECKS-META Fase 2 — dial de auto-fetch. Se lee fail-closed y se escribe validado/atómico. Encender
   * el dial causa egress real + publicación ⇒ money-adjacent. NO es legalidad: sigue INTACTO (SUP-LEG).
   */
  describe('loadDialState (fail-closed)', () => {
    function svcWithRows(rows: { key: string; valueJson: unknown }[]) {
      const prisma = { configSetting: { findMany: jest.fn(async () => rows) } } as unknown as PrismaService;
      return new DecksMetaService(
        prisma,
        { getSellableRawUnitsByCardIds: jest.fn() } as unknown as CatalogService,
        {} as unknown as DeckMatcherService,
      );
    }

    it('lee el estado actual normalizado', async () => {
      const svc = svcWithRows([
        { key: 'decks_meta_autofetch', valueJson: 'on' },
        { key: 'decks_meta_autofetch_autopublish', valueJson: true },
      ]);
      expect(await svc.loadDialState()).toEqual({ autofetch: 'on', autopublish: true });
    });

    it('keys ausentes ⇒ off/false (fail-closed)', async () => {
      const svc = svcWithRows([]);
      expect(await svc.loadDialState()).toEqual({ autofetch: 'off', autopublish: false });
    });

    it('basura en autofetch ⇒ off; autopublish no-boolean ⇒ false', async () => {
      const svc = svcWithRows([
        { key: 'decks_meta_autofetch', valueJson: 'garbage' },
        { key: 'decks_meta_autofetch_autopublish', valueJson: 'yes' },
      ]);
      expect(await svc.loadDialState()).toEqual({ autofetch: 'off', autopublish: false });
    });
  });

  describe('adminSetDial (validación + atómico + before/after)', () => {
    function makeDialService(currentRows: { key: string; valueJson: unknown }[] = []) {
      const upsert = jest.fn(async () => undefined);
      const tx = { configSetting: { upsert } };
      const $transaction = jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
      const findMany = jest
        .fn()
        .mockResolvedValueOnce(currentRows) // before
        .mockResolvedValue([
          { key: 'decks_meta_autofetch', valueJson: 'dryrun' },
          { key: 'decks_meta_autofetch_autopublish', valueJson: true },
        ]); // after
      const prisma = { $transaction, configSetting: { findMany, upsert: jest.fn() } } as unknown as PrismaService;
      const svc = new DecksMetaService(
        prisma,
        { getSellableRawUnitsByCardIds: jest.fn() } as unknown as CatalogService,
        {} as unknown as DeckMatcherService,
      );
      return { svc, $transaction, upsert, prisma };
    }

    it('autofetch inválido ⇒ 400 VALIDATION_ERROR (no escribe nada)', async () => {
      const { svc, $transaction } = makeDialService();
      await expect(svc.adminSetDial({ autofetch: 'maybe' }, 'op-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
      expect($transaction).not.toHaveBeenCalled();
    });

    it('autopublish no-boolean ⇒ 400 VALIDATION_ERROR (no escribe nada)', async () => {
      const { svc, $transaction } = makeDialService();
      await expect(svc.adminSetDial({ autopublish: 'true' as unknown as boolean }, 'op-1')).rejects.toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
      });
      expect($transaction).not.toHaveBeenCalled();
    });

    it('escribe ambas keys DENTRO de $transaction y devuelve { before, after }', async () => {
      const { svc, $transaction, upsert } = makeDialService([
        { key: 'decks_meta_autofetch', valueJson: 'off' },
        { key: 'decks_meta_autofetch_autopublish', valueJson: false },
      ]);
      const res = await svc.adminSetDial({ autofetch: 'dryrun', autopublish: true }, 'op-1');
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledTimes(2);
      const keys = upsert.mock.calls.map((c: any[]) => c[0].where.key).sort();
      expect(keys).toEqual(['decks_meta_autofetch', 'decks_meta_autofetch_autopublish']);
      expect(res.before).toEqual({ autofetch: 'off', autopublish: false });
      expect(res.after).toEqual({ autofetch: 'dryrun', autopublish: true });
    });

    it('parcial: sólo autofetch ⇒ un solo upsert', async () => {
      const { svc, upsert } = makeDialService();
      await svc.adminSetDial({ autofetch: 'on' }, 'op-1');
      expect(upsert).toHaveBeenCalledTimes(1);
      expect((upsert.mock.calls[0] as any[])[0].where.key).toBe('decks_meta_autofetch');
    });
  });
});
