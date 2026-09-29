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

  describe('listPublished — arte de la teja (QA IMPORTANTE 1, gate sobre 3806fec)', () => {
    /**
     * `listPublished` debe pasar `deck.name` a `pickDeckImage`. QA midió que la mutación
     * `pickDeckImage('', deck.imageCardId, cards)` sobrevivía la suite entera (5266/5266): las pruebas
     * de `deck-image.spec.ts` llaman a la función pura, ninguna al servicio. Aquí el nombre del deck es
     * lo ÚNICO que separa a Alakazam (casa por nombre, regla 2b) de Dudunsparce ex (la ex con más
     * copias, regla 3): sin el nombre, la teja muestra la ex de apoyo.
     */
    const pk = (name: string, qty: number, id: string): any => ({
      quantity: qty,
      group: 'pokemon',
      matchStatus: 'matched',
      matchedCard: card({ id, externalId: id, name, imageLargeUrl: `https://img/${id}.png` }),
    });

    it('deck «Alakazam» con ex de apoyo ⇒ la teja exige Alakazam (el nombre del deck llega a pickDeckImage)', async () => {
      const catalog = { getSellableRawUnitsByCardIds: jest.fn(async () => new Map()) } as unknown as CatalogService;
      const prisma = {
        metaDeck: {
          findMany: jest.fn(async () => [
            {
              slug: 'alakazam',
              name: 'Alakazam',
              rank: 1,
              sharePct: null,
              trend: null,
              imageCardId: null,
              currentList: {
                fetchedAt: new Date('2026-09-20T00:00:00Z'),
                cards: [
                  pk('Abra', 4, 'abra'),
                  pk('Kadabra', 3, 'kad'),
                  pk('Alakazam', 3, 'ala'),
                  pk('Fezandipiti ex', 1, 'fez'),
                  pk('Dudunsparce ex', 2, 'dud'),
                ],
              },
            },
          ]),
        },
      } as unknown as PrismaService;
      const svc = new DecksMetaService(prisma, catalog, {} as unknown as DeckMatcherService);
      const res = await svc.listPublished();
      expect(res.data).toHaveLength(1);
      expect(res.data[0].imageUrl).toBe('https://img/ala.png');
    });
  });

  /**
   * rev `decks-portada` (API_CONTRACT §13 «Portada del deck», ARCHITECTURE §12.4.6 S1/P7).
   */
  describe('portada del deck (§12.4) — S1 listPublished lee coverCard · P7 curaduría no escribe portada', () => {
    const coverCard = card({ id: 'twm-25', externalId: 'sv6-25', name: 'Portada', imageLargeUrl: 'https://img/twm-25.png' });

    it('S1 · deck cuyo nombre no casa nada + lista con coverCard casada ⇒ imageUrl = la portada', async () => {
      const catalog = { getSellableRawUnitsByCardIds: jest.fn(async () => new Map()) } as unknown as CatalogService;
      const findMany = jest.fn(async (args: any) => {
        // El mock HONRA el include: la portada sólo llega si el servicio la pide.
        const wantsCover = Boolean(args?.include?.currentList?.include?.coverCard);
        return [
          {
            slug: 'basic-box',
            name: 'Basic Box',
            rank: 1,
            sharePct: null,
            trend: null,
            imageCardId: null,
            currentList: {
              fetchedAt: new Date('2026-09-20T00:00:00Z'),
              ...(wantsCover ? { coverCard } : {}),
              cards: [
                { quantity: 1, group: 'pokemon', matchStatus: 'matched', matchedCard: card({ id: 'fez', externalId: 'fez', name: 'Fezandipiti ex', imageLargeUrl: 'https://img/fez.png' }) },
                { quantity: 2, group: 'pokemon', matchStatus: 'matched', matchedCard: card({ id: 'tera', externalId: 'tera', name: 'Terapagos ex', imageLargeUrl: 'https://img/tera.png' }) },
              ],
            },
          },
        ];
      });
      const prisma = { metaDeck: { findMany } } as unknown as PrismaService;
      const svc = new DecksMetaService(prisma, catalog, {} as unknown as DeckMatcherService);
      const res = await svc.listPublished();
      expect(res.data[0].imageUrl).toBe('https://img/twm-25.png');
      // Forma del DTO SIN cambio: la teja no gana campos por la portada.
      expect(Object.keys(res.data[0]).sort()).toEqual(['availableCount', 'imageUrl', 'name', 'rank', 'slug', 'totalCount']);
    });

    it('P7 · curaduría manual ⇒ la lista nueva nace con las 4 columnas de portada en null (no copia la anterior)', async () => {
      const oldList = { id: 'old-list', coverSetCode: 'TWM', coverNumber: '25', coverMatchStatus: 'matched', coverCardId: 'twm-25' };
      const created: any[] = [];
      const tx = {
        metaDeck: {
          upsert: jest.fn(async () => ({ id: 'deck-1', currentListId: 'old-list' })),
          update: jest.fn(async () => ({})),
          findUnique: jest.fn(async () => ({ id: 'deck-1', currentListId: 'old-list', currentList: oldList })),
        },
        metaDeckList: {
          findUnique: jest.fn(async () => oldList),
          findFirst: jest.fn(async () => oldList),
          create: jest.fn(async ({ data }: any) => { created.push(data); return { id: 'new-list' }; }),
          update: jest.fn(async () => ({})),
        },
        metaFetchRun: { create: jest.fn(async () => ({})) },
      };
      const prisma = { $transaction: jest.fn(async (cb: any) => cb(tx)), metaDeckList: tx.metaDeckList } as unknown as PrismaService;
      const matcher = { matchLines: jest.fn(async () => [{ ...matchedLine(), matchedCard: card() }]) } as unknown as DeckMatcherService;
      const svc = new DecksMetaService(prisma, { getSellableRawUnitsByCardIds: jest.fn() } as unknown as CatalogService, matcher);
      await svc.adminCreateOrCurate({ slug: 'dragapult', name: 'Dragapult', listText: '4 Dragapult ex TWM 130' });
      expect(created).toHaveLength(1);
      const d = created[0];
      expect({
        coverSetCode: d.coverSetCode ?? null,
        coverNumber: d.coverNumber ?? null,
        coverMatchStatus: d.coverMatchStatus ?? null,
        coverCardId: d.coverCardId ?? null,
        coverCard: d.coverCard ?? null,
      }).toEqual({ coverSetCode: null, coverNumber: null, coverMatchStatus: null, coverCardId: null, coverCard: null });
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
