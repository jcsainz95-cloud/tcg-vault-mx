import { randomUUID } from 'crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CatalogService, DeckMetaUnitDTO } from '../../src/modules/catalog/catalog.service';
import { DeckMatcherService } from '../../src/modules/decks-meta/deck-matcher.service';
import { DecksMetaService } from '../../src/modules/decks-meta/decks-meta.service';
import { ConfigService } from '@nestjs/config';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';
import { parseDeckList } from '../../src/modules/decks-meta/deck-list.parser';

/**
 * DECKS-META §3.2/§3.4/§13 (Fase 1) — INTEGRACIÓN contra Postgres REAL: prueba las queries Prisma de
 * verdad (matcher por `ptcgoCode`+`número`, relaciones `currentList`/`cards`/`matchedCard`,
 * PERSISTENCIA de líneas no mapeadas). FUENTE-CONFIABLE (SUP-LEG): ya NO hay ventana de legalidad ni
 * gate — toda carta CASADA con stock se ofrece; `regulationMark`/`legalStandardRaw` quedan como datos
 * crudos inertes. El eje de disponibilidad (`CatalogService`, que reusa `getReferencesBatch`) se
 * stubea aquí; su lógica de reuso está cubierta en la suite unitaria. No arranca la app (sin Redis/S3).
 */
describe('DecksMeta persistence (integración, Postgres real)', () => {
  const prisma = new PrismaService();
  // Stub del catálogo: devuelve piezas RAW NM «desde» para las cartas con stock.
  const unitsByCard = new Map<string, DeckMetaUnitDTO[]>();
  const catalog = {
    getSellableRawUnitsByCardIds: jest.fn(async (ids: string[]) => {
      const out = new Map<string, DeckMetaUnitDTO[]>();
      for (const id of ids) if (unitsByCard.has(id)) out.set(id, unitsByCard.get(id)!);
      return out;
    }),
  } as unknown as CatalogService;
  const matcher = new DeckMatcherService(prisma);
  // §AC.8: el servicio firma el `pullToken` (llave efímera de prueba).
  const service = new DecksMetaService(prisma, catalog, matcher, new PiiCryptoService(new ConfigService({})));

  const tag = randomUUID().slice(0, 8);
  const setId = `set-${tag}`;
  const legalCardId = `card-legal-${tag}`;
  // Antes esta carta caía como "rotada" (marca E, fuera de la ventana). Bajo SUP-LEG ya no hay gate:
  // si está casada y con stock, se ofrece. Se conserva la marca cruda 'E' para probar justamente eso.
  const markECardId = `card-marke-${tag}`;
  const slug = `dragapult-${tag}`;
  // ptcgoCode SÓLO-LETRAS (el parser exige 2–4 letras): mapea los dígitos del tag hex a letras a–j,
  // así el código de set es único por corrida y siempre parseable. 4 letras.
  const code = tag
    .replace(/[0-9]/g, (d) => String.fromCharCode(97 + Number(d)))
    .slice(0, 4)
    .toUpperCase();

  beforeAll(async () => {
    await prisma.$connect();

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
        id: markECardId, externalId: `${tag}-131`, setId, name: 'Old Card', number: '131',
        supertype: 'Pokémon', regulationMark: 'E', legalStandardRaw: 'Legal',
      },
    });
    // Ambas cartas casadas tienen 2 piezas RAW NM «desde» 5000/6000: bajo SUP-LEG ambas se ofrecen.
    unitsByCard.set(legalCardId, [
      { inventoryItemId: `inv-a-${tag}`, priceMxnCents: 5000 },
      { inventoryItemId: `inv-b-${tag}`, priceMxnCents: 6000 },
    ]);
    unitsByCard.set(markECardId, [
      { inventoryItemId: `inv-e-${tag}`, priceMxnCents: 3000 },
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

  it('adminCreateOrCurate persiste lista inmutable + líneas (incluidas las NO mapeadas), fija currentList y guarda activeMarksSnapshot vacío', async () => {
    const listText = [
      'Pokémon: 3',
      `4 Dragapult ex ${code} 130`, // matched (marca H)
      `2 Old Card ${code} 131`, // matched (marca E) — bajo SUP-LEG igual se ofrece
      `1 Ghost ${code} 999`, // unmatched_number (persiste)
    ].join('\n');
    const { id } = await service.adminCreateOrCurate({
      slug, name: `Dragapult ${tag}`, listText, rank: 1, published: true,
      sourceUrl: 'https://limitlesstcg.com/x', formatLabel: 'Standard 2026-27',
    });
    const deck = await prisma.metaDeck.findUnique({ where: { id }, include: { currentList: { include: { cards: true } } } });
    expect(deck?.currentListId).toBeTruthy();
    expect(deck?.currentList?.cards).toHaveLength(3);
    // SUP-LEG: la instantánea de marcas se persiste VACÍA (columna inerte, ya no hay ventana).
    expect(deck?.currentList?.activeMarksSnapshot).toEqual([]);
    // La línea no mapeada quedó PERSISTIDA con su matchStatus y sin matchedCardId.
    const ghost = deck!.currentList!.cards.find((c) => c.rawNumber === '999');
    expect(ghost?.matchStatus).toBe('unmatched_number');
    expect(ghost?.matchedCardId).toBeNull();
  });

  it('getBySlug: toda carta casada con stock se ofrece (sin gate de legalidad); no-mapeada⇒card null', async () => {
    const detail = await service.getBySlug(slug);
    const pk = detail.groups.pokemon;
    const legal = pk.find((l) => l.number === '130')!;
    const markE = pk.find((l) => l.number === '131')!;
    const ghost = pk.find((l) => l.number === '999')!;

    // matched (marca H) + stock ⇒ ofrecible con piezas cheapest-first y precio «desde»
    expect(legal).not.toHaveProperty('legal');
    expect(legal.availableQty).toBe(2);
    expect(legal.unitInventoryItemIds).toEqual([`inv-a-${tag}`, `inv-b-${tag}`]);
    expect(legal.unitPriceMxnCents).toBe(5000);

    // marca 'E' (antes "rotada") + stock ⇒ AHORA se ofrece igual (SUP-LEG: sin gate)
    expect(markE).not.toHaveProperty('legal');
    expect(markE.availableQty).toBe(1);
    expect(markE.unitInventoryItemIds).toEqual([`inv-e-${tag}`]);
    expect(markE.card).not.toBeNull();

    // no mapeada ⇒ card null, sin piezas
    expect(ghost.card).toBeNull();
    expect(ghost.unitInventoryItemIds).toEqual([]);

    // El detalle YA no expone `legalityVerifiedAt` (SUP-LEG).
    expect(detail).not.toHaveProperty('legalityVerifiedAt');
    expect(detail.source).toContain('Curado');
  });

  it('adminUnmatched: reporta la línea no mapeada de la lista publicada', async () => {
    const report = await service.adminUnmatched();
    const found = report.data.find((r) => r.number === '999');
    expect(found).toBeTruthy();
    expect(found?.matchStatus).toBe('unmatched_number');
    expect(found?.totalQuantity).toBeGreaterThanOrEqual(1);
  });

  /**
   * rev `decks-portada` (M-60, ARCHITECTURE §12.4.2/§12.4.3) — contra Postgres REAL: la portada casa con
   * el mismo motor (número con ceros en BD), `listPublished` la lee vía `include`, y `ON DELETE SET NULL`
   * suelta la portada si la carta sale del catálogo sin bloquear el borrado.
   */
  describe('portada del deck (M-60)', () => {
    const coverCardId = `card-cover-${tag}`;
    const coverSlug = `basic-box-${tag}`;

    beforeAll(async () => {
      await prisma.card.create({
        data: {
          id: coverCardId, externalId: `${tag}-025`, setId, name: 'Portada Sintética', number: '025',
          supertype: 'Pokémon', imageLargeUrl: 'https://img/cover-large.png',
        },
      });
    });

    it('curaduría manual (P7) ⇒ la lista curada tiene las 4 columnas de portada en null', async () => {
      const deck = await prisma.metaDeck.findUnique({ where: { slug }, include: { currentList: true } });
      expect(deck?.currentList).toMatchObject({ coverSetCode: null, coverNumber: null, coverMatchStatus: null, coverCardId: null });
    });

    it('matchCover: «25» casa contra «025» en BD (mismo normalizeNumber que las 60)', async () => {
      const out = await matcher.matchCover({ setCode: code, number: '25' });
      expect(out.matchStatus).toBe('matched');
      expect(out.card?.id).toBe(coverCardId);
      const miss = await matcher.matchCover({ setCode: 'ZZZ', number: '25' });
      expect(miss).toEqual({ matchStatus: 'unmatched_set', card: null });
    });

    it('listPublished: deck cuyo nombre no casa ⇒ imageUrl = portada; borrar la carta ⇒ coverCardId null (SET NULL)', async () => {
      const deck = await prisma.metaDeck.create({
        data: { slug: coverSlug, name: `Basic Box ${tag}`, source: 'limitless', rank: 99, published: true },
      });
      const list = await prisma.metaDeckList.create({
        data: {
          deckId: deck.id, formatLabel: 'Standard', activeMarksSnapshot: [],
          coverSetCode: code, coverNumber: '25', coverMatchStatus: 'matched', coverCardId,
          cards: {
            create: [{ rawName: `Dragapult ex ${tag}`, rawSetCode: code, rawNumber: '130', quantity: 4, group: 'pokemon', matchStatus: 'matched', matchedCardId: legalCardId }],
          },
        },
      });
      await prisma.metaDeck.update({ where: { id: deck.id }, data: { currentListId: list.id } });

      const tile = (await service.listPublished()).data.find((d) => d.slug === coverSlug);
      expect(tile?.imageUrl).toBe('https://img/cover-large.png');

      await prisma.card.delete({ where: { id: coverCardId } });
      const after = await prisma.metaDeckList.findUnique({ where: { id: list.id } });
      expect(after).toMatchObject({ coverSetCode: code, coverNumber: '25', coverMatchStatus: 'matched', coverCardId: null });
      // Sin portada casada, la teja cae a la regla por nombre/copias (Dragapult ex, la única Pokémon).
      const tile2 = (await service.listPublished()).data.find((d) => d.slug === coverSlug);
      expect(tile2?.imageUrl).toBe('https://img/large.png');
    });
  });
});
