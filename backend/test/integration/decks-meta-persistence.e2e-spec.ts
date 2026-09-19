import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../../src/modules/catalog/catalog.service';
import { DeckMatcherService } from '../../src/modules/decks-meta/deck-matcher.service';
import { DecksMetaService } from '../../src/modules/decks-meta/decks-meta.service';
import { parseDeckList } from '../../src/modules/decks-meta/deck-list.parser';

/**
 * DECKS-META §3.2/§3.4/§13 (Fase 1) — INTEGRACIÓN contra Postgres REAL: prueba las queries Prisma de
 * verdad (matcher por `ptcgoCode`+`número`, relaciones `currentList`/`cards`/`matchedCard`, lectura
 * de la ventana de legalidad, PERSISTENCIA de líneas no mapeadas). El eje de disponibilidad
 * (`CatalogService`, que reusa `getReferencesBatch`) se stubea aquí; su lógica de reuso está cubierta
 * en la suite unitaria y por typecheck. No arranca la app completa (sin Redis/S3).
 */
describe('DecksMeta persistence (integración, Postgres real)', () => {
  const prisma = new PrismaService();
  // Stub del catálogo: devuelve piezas RAW NM «desde» para la carta legal con stock.
  const unitsByCard = new Map<string, DeckMetaUnitDTO[]>();
  const catalog = {
    getSellableRawUnitsByCardIds: jest.fn(async (ids: string[]) => {
      const out = new Map<string, DeckMetaUnitDTO[]>();
      for (const id of ids) if (unitsByCard.has(id)) out.set(id, unitsByCard.get(id)!);
      return out;
    }),
  } as unknown as CatalogService;
  const matcher = new DeckMatcherService(prisma);
  const service = new DecksMetaService(prisma, catalog, matcher);

  const tag = randomUUID().slice(0, 8);
  const setId = `set-${tag}`;
  const legalCardId = `card-legal-${tag}`;
  const rotatedCardId = `card-rot-${tag}`;
  const slug = `dragapult-${tag}`;
  // ptcgoCode SÓLO-LETRAS (el parser exige 2–4 letras): mapea los dígitos del tag hex a letras a–j,
  // así el código de set es único por corrida y siempre parseable. 4 letras.
  const code = tag
    .replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)))
    .slice(0, 4)
    .toUpperCase();

  beforeAll(async () => {
    await prisma.$connect();
    // Ventana de legalidad vigente (por si el seed de la migración no está en esta BD).
    await prisma.configSetting.upsert({
      where: { key: 'standard.active_regulation_marks' },
      create: { key: 'standard.active_regulation_marks', valueJson: ['G', 'H', 'I'] },
      update: { valueJson: ['G', 'H', 'I'] },
    });
    await prisma.configSetting.upsert({
      where: { key: 'standard.banlist_card_ids' },
      create: { key: 'standard.banlist_card_ids', valueJson: [] },
      update: { valueJson: [] },
    });

    await prisma.cardSet.create({
      data: { id: setId, externalId: `ext-${tag}`, name: `Twilight ${tag}`, ptcgoCode: code },
    });
    await prisma.card.create({
      data: {
        id: legalCardId, externalId: `${tag}-130`, setId, name: 'Dragapult ex', number: '130',
        supertype: 'Pokémon', regulationMark: 'H', legalStandardRaw: 'Legal',
        imageLargeUrl: 'https://img/large.png',
      },
    });
    await prisma.card.create({
      data: {
        id: rotatedCardId, externalId: `${tag}-131`, setId, name: 'Old Card', number: '131',
        supertype: 'Pokémon', regulationMark: 'E', legalStandardRaw: 'Legal',
      },
    });
    // La carta legal tiene 2 piezas RAW NM «desde» 5000/6000.
    unitsByCard.set(legalCardId, [
      { inventoryItemId: `inv-a-${tag}`, priceMxnCents: 5000 },
      { inventoryItemId: `inv-b-${tag}`, priceMxnCents: 6000 },
    ]);
  });

  afterAll(async () => {
    await prisma.metaDeckCard.deleteMany({ where: { rawName: { contains: tag } } });
    // limpiar decks/listas creados
    const decks = await prisma.metaDeck.findMany({ where: { slug: { contains: tag } } });
    for (const d of decks) {
      await prisma.metaDeck.update({ where: { id: d.id }, data: { currentListId: null } });
      await prisma.metaDeckCard.deleteMany({ where: { list: { deckId: d.id } } });
      await prisma.metaDeckList.deleteMany({ where: { deckId: d.id } });
      await prisma.metaDeck.delete({ where: { id: d.id } });
    }
    await prisma.card.deleteMany({ where: { setId } });
    await prisma.cardSet.deleteMany({ where: { id: setId } });
    await prisma.metaFetchRun.deleteMany({ where: { note: { contains: tag } } });
    await prisma.$disconnect();
  });

  it('matcher: empareja por ptcgoCode+número contra la BD real (matched / unmatched_number / unmatched_set)', async () => {
    const { lines } = parseDeckList(
      `4 Dragapult ex ${code} 130\n2 Cualquiera ${code} 999\n1 Otra ZZZ 1`,
    );
    const out = await matcher.matchLines(lines);
    expect(out[0].matchStatus).toBe('matched');
    expect(out[0].matchedCard?.id).toBe(legalCardId);
    expect(out[1].matchStatus).toBe('unmatched_number');
    expect(out[2].matchStatus).toBe('unmatched_set');
  });

  it('adminCreateOrCurate persiste lista inmutable + líneas (incluidas las NO mapeadas) y fija currentList', async () => {
    const listText = [
      'Pokémon: 3',
      `4 Dragapult ex ${code} 130`, // matched + legal
      `2 Old Card ${code} 131`, // matched pero ROTADA (marca E)
      `1 Ghost ${code} 999`, // unmatched_number (persiste)
    ].join('\n');
    const { id } = await service.adminCreateOrCurate({
      slug, name: `Dragapult ${tag}`, listText, rank: 1, published: true,
      sourceUrl: 'https://limitlesstcg.com/x', formatLabel: 'Standard 2026-27',
    });
    const deck = await prisma.metaDeck.findUnique({ where: { id }, include: { currentList: { include: { cards: true } } } });
    expect(deck?.currentListId).toBeTruthy();
    expect(deck?.currentList?.cards).toHaveLength(3);
    // La línea no mapeada quedó PERSISTIDA con su matchStatus y sin matchedCardId.
    const ghost = deck!.currentList!.cards.find((c) => c.rawNumber === '999');
    expect(ghost?.matchStatus).toBe('unmatched_number');
    expect(ghost?.matchedCardId).toBeNull();
  });

  it('getBySlug: legal+stock⇒ofrecible, rotada⇒marcada (legal:false), no-mapeada⇒card null', async () => {
    const detail = await service.getBySlug(slug);
    const pk = detail.groups.pokemon;
    const legal = pk.find((l) => l.number === '130')!;
    const rotated = pk.find((l) => l.number === '131')!;
    const ghost = pk.find((l) => l.number === '999')!;

    // legal + stock ⇒ ofrecible con piezas cheapest-first y precio «desde»
    expect(legal.legal).toBe(true);
    expect(legal.availableQty).toBe(2);
    expect(legal.unitInventoryItemIds).toEqual([`inv-a-${tag}`, `inv-b-${tag}`]);
    expect(legal.unitPriceMxnCents).toBe(5000);

    // rotada (marca E fuera de la ventana) ⇒ marcada, sin piezas
    expect(rotated.legal).toBe(false);
    expect(rotated.availableQty).toBe(0);
    expect(rotated.unitInventoryItemIds).toEqual([]);
    expect(rotated.card).not.toBeNull();

    // no mapeada ⇒ card null, sin piezas
    expect(ghost.card).toBeNull();
    expect(ghost.unitInventoryItemIds).toEqual([]);

    expect(detail.legalityVerifiedAt).toBeTruthy();
    expect(detail.source).toContain('Curado');
  });

  it('adminUnmatched: reporta la línea no mapeada de la lista publicada', async () => {
    const report = await service.adminUnmatched();
    const found = report.data.find((r) => r.number === '999');
    expect(found).toBeTruthy();
    expect(found?.matchStatus).toBe('unmatched_number');
    expect(found?.totalQuantity).toBeGreaterThanOrEqual(1);
  });

  it('adminUpdateStandardLegality: editar la ventana recalcula la legalidad DERIVADA (rotación)', async () => {
    // Meter 'E' en la ventana ⇒ la carta antes rotada pasa a legal.
    await service.adminUpdateStandardLegality({ activeMarks: ['E', 'G', 'H', 'I'] }, 'test-actor');
    const detail = await service.getBySlug(slug);
    const rotated = detail.groups.pokemon.find((l) => l.number === '131')!;
    expect(rotated.legal).toBe(true);
    // restaurar la ventana para no contaminar otras corridas
    await service.adminUpdateStandardLegality({ activeMarks: ['G', 'H', 'I'] }, 'test-actor');
  });
});
