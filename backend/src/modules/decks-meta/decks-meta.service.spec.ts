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

  /**
   * SEG-DMF1-1 — la rotación de legalidad (`adminUpdateStandardLegality`) es money-adjacent: gobierna
   * qué se ofrece como jugable. DEBE ser ATÓMICA: los dos upserts (ventana + banlist) van en UNA
   * transacción para que una falla parcial no deje marcas nuevas con banlist vieja (o viceversa).
   */
  describe('adminUpdateStandardLegality (SEG-DMF1-1: atómico)', () => {
    function makeTxService() {
      const upsert = jest.fn(async () => undefined);
      const tx = { configSetting: { upsert } };
      const $transaction = jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
      const findMany = jest.fn(async () => [
        { key: 'standard.active_regulation_marks', valueJson: ['H', 'I'] },
        { key: 'standard.banlist_card_ids', valueJson: [] },
      ]);
      const prisma = {
        $transaction,
        configSetting: { findMany, upsert: jest.fn() },
      } as unknown as PrismaService;
      const svc = new DecksMetaService(
        prisma,
        { getSellableRawUnitsByCardIds: jest.fn() } as unknown as CatalogService,
        {} as unknown as DeckMatcherService,
      );
      return { svc, $transaction, upsert, prisma };
    }

    it('los dos upserts corren DENTRO de $transaction (mismo tx), no con el cliente base', async () => {
      const { svc, $transaction, upsert, prisma } = makeTxService();
      await svc.adminUpdateStandardLegality({ activeMarks: ['H', 'I'], banlistCardIds: ['ban-x'] }, 'op-1');
      expect($transaction).toHaveBeenCalledTimes(1);
      expect(upsert).toHaveBeenCalledTimes(2); // ventana + banlist, ambos por el tx
      // El cliente base NUNCA escribe directo (todo pasa por el tx).
      expect((prisma.configSetting.upsert as jest.Mock)).not.toHaveBeenCalled();
      const keys = upsert.mock.calls.map((c: any[]) => c[0].where.key).sort();
      expect(keys).toEqual(['standard.active_regulation_marks', 'standard.banlist_card_ids']);
    });

    it('sólo escribe las keys presentes en el patch (parcial)', async () => {
      const { svc, upsert } = makeTxService();
      await svc.adminUpdateStandardLegality({ activeMarks: ['H'] }, 'op-1');
      expect(upsert).toHaveBeenCalledTimes(1);
      expect((upsert.mock.calls[0] as any[])[0].where.key).toBe('standard.active_regulation_marks');
    });

    it('devuelve loadLegalityConfig() tras el commit', async () => {
      const { svc } = makeTxService();
      const res = await svc.adminUpdateStandardLegality({ activeMarks: ['H', 'I'] }, 'op-1');
      expect(res).toEqual({ activeMarks: ['H', 'I'], banlistCardIds: [] });
    });

    it('falla parcial ⇒ NO hay medio-write: el error propaga y NO se llega a loadLegalityConfig (rollback)', async () => {
      const upsert = jest
        .fn()
        .mockResolvedValueOnce(undefined) // ventana OK
        .mockRejectedValueOnce(new Error('db down')); // banlist falla ⇒ aborta la tx
      const tx = { configSetting: { upsert } };
      const $transaction = jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx));
      const findMany = jest.fn(async () => []);
      const prisma = { $transaction, configSetting: { findMany } } as unknown as PrismaService;
      const svc = new DecksMetaService(
        prisma,
        { getSellableRawUnitsByCardIds: jest.fn() } as unknown as CatalogService,
        {} as unknown as DeckMatcherService,
      );
      await expect(
        svc.adminUpdateStandardLegality({ activeMarks: ['H'], banlistCardIds: ['ban-x'] }, 'op-1'),
      ).rejects.toThrow('db down');
      // El read post-commit (loadLegalityConfig) jamás corre: no se devolvió un estado "a medias".
      expect(findMany).not.toHaveBeenCalled();
    });
  });

  /**
   * DECKS-META Fase 2 — dial de auto-fetch. Se lee fail-closed y se escribe validado/atómico. Encender
   * el dial causa egress real + publicación ⇒ money-adjacent.
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
