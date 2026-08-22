/**
 * price-reference-variant-unique.e2e-spec.ts — REGRESIÓN M-33 contra Postgres REAL.
 * Propiedad: backend.
 *
 * Cierra la BRECHA que los tests unitarios (Prisma mockeado) NO pudieron cachar: la COLISIÓN DE
 * CONSTRAINT de BD. En prod (log Railway me5/Pitch Black) el upsert del resolver estallaba con
 *   Unique constraint failed on the fields: (`cardId`,`productType`,`gradeKey`,`finish`,`capturedDate`)
 * porque el índice único VIEJO de 5 campos (creado en M-18) SOBREVIVIÓ: la migración M-31 intentó
 * dropearlo con un NOMBRE MAL TRUNCADO (`...capturedDa_key` en vez del real `...capturedD_key`), así que
 * el `DROP INDEX IF EXISTS` fue un no-op silencioso. M-33 dropea el índice real por su nombre exacto.
 *
 * Este test EXIGE Postgres real (migraciones aplicadas): inserta DOS PriceReference de la MISMA carta
 * con el MISMO (cardId, productType, gradeKey, finish, capturedDate) pero distinto `cardProductId` y
 * verifica que AMBAS persisten (con el índice viejo vivo, la segunda reventaría con P2002). También
 * verifica el NULLS NOT DISTINCT del índice de 6 campos (dos upserts con cardProductId=NULL colapsan).
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';

describe('E2E — PriceReference unicidad de 6 campos (M-33, Postgres real)', () => {
  let h: E2EHarness;

  // IDs propios (aislados del seed) para poder limpiar sin tocar datos de otras suites.
  const setId = `m33-set-${randomUUID()}`;
  const cardId = `m33-card-${randomUUID()}`;
  const cpBaseId = `m33-cp-base-${randomUUID()}`;
  const cpDeckId = `m33-cp-deck-${randomUUID()}`;
  const capturedDate = new Date('2026-08-22T00:00:00.000Z');
  // tcgplayerProductId es @unique global: usar valores altos aleatorios para no chocar con el seed.
  const pidBase = 990000000 + Math.floor(Math.random() * 9000000);
  const pidDeck = pidBase + 1;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await h.prisma.cardSet.create({
      data: { id: setId, externalId: `m33-ext-${randomUUID()}`, name: 'M33 Pitch Black' },
    });
    await h.prisma.card.create({
      data: {
        id: cardId,
        externalId: `m33-card-ext-${randomUUID()}`,
        setId,
        name: 'Voltaic Lightning Energy',
        number: '084/084',
        tcgplayerId: String(pidBase),
      },
    });
    await h.prisma.cardProduct.createMany({
      data: [
        { id: cpBaseId, cardId, tcgplayerProductId: pidBase, kind: 'set_base', name: 'set_base' },
        { id: cpDeckId, cardId, tcgplayerProductId: pidDeck, kind: 'deck_exclusive', name: 'deck' },
      ],
    });
  });

  afterAll(async () => {
    // Limpieza en orden FK-safe (PriceReference → CardProduct → Card → CardSet).
    await h.prisma.priceReference.deleteMany({ where: { cardId } });
    await h.prisma.cardProduct.deleteMany({ where: { cardId } });
    await h.prisma.card.deleteMany({ where: { id: cardId } });
    await h.prisma.cardSet.deleteMany({ where: { id: setId } });
    await h?.close();
  });

  const base = {
    cardId,
    productType: 'raw' as const,
    gradeKey: 'raw:NM',
    finish: 'holofoil' as const,
    capturedDate,
    source: 'tcgcsv_singles' as const,
    priceMxnCents: 100,
  };

  function keyFor(cardProductId: string) {
    return {
      cardId_productType_gradeKey_finish_capturedDate_cardProductId: {
        cardId,
        productType: 'raw' as const,
        gradeKey: 'raw:NM',
        finish: 'holofoil' as const,
        capturedDate,
        cardProductId,
      },
    };
  }

  it('DOS productos de la misma carta con el MISMO finish coexisten (el índice viejo de 5 campos ya NO bloquea)', async () => {
    // set_base holofoil
    await h.prisma.priceReference.upsert({
      where: keyFor(cpBaseId),
      create: { ...base, cardProductId: cpBaseId, priceMxnCents: 927 },
      update: { priceMxnCents: 927 },
    });
    // deck_exclusive holofoil — MISMO (cardId, productType, gradeKey, finish, capturedDate), otro producto.
    // Con el índice viejo VIVO esto reventaría con P2002; con M-33 aplicado, persiste como fila propia.
    await h.prisma.priceReference.upsert({
      where: keyFor(cpDeckId),
      create: { ...base, cardProductId: cpDeckId, priceMxnCents: 2318 },
      update: { priceMxnCents: 2318 },
    });

    const rows = await h.prisma.priceReference.findMany({
      where: { cardId, finish: 'holofoil', capturedDate },
      orderBy: { priceMxnCents: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.cardProductId).sort()).toEqual([cpBaseId, cpDeckId].sort());
    expect(rows.map((r) => r.priceMxnCents).sort((a, b) => a - b)).toEqual([927, 2318]);
  });

  it('idempotencia: re-upsert por la clave de 6 campos ACTUALIZA la misma fila (no duplica)', async () => {
    await h.prisma.priceReference.upsert({
      where: keyFor(cpBaseId),
      create: { ...base, cardProductId: cpBaseId, priceMxnCents: 999 },
      update: { priceMxnCents: 1500 },
    });
    const rows = await h.prisma.priceReference.findMany({
      where: { cardId, cardProductId: cpBaseId, finish: 'holofoil', capturedDate },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].priceMxnCents).toBe(1500);
  });

  it('NULLS NOT DISTINCT (índice de 6 campos): dos filas con cardProductId=NULL y el mismo 5-tuple colapsan — comportamiento pre-M31 para graded/sealed/fallback', async () => {
    // El cliente TIPADO de Prisma NO permite apuntar cardProductId=NULL en la clave compuesta (el tipo
    // del compound-unique exige string), así que se ejercita el índice con SQL crudo, que es justo lo
    // que hace el motor en prod. Con NULLS NOT DISTINCT (PG15+) dos NULL se tratan como iguales ⇒ el
    // segundo INSERT choca (comportamiento «como hoy» para el fallback sin producto). Se comprueba que
    // el índice de 6 campos SIGUE vigente tras el DROP del viejo (M-33 no lo tocó).
    const insert = (mxn: number) =>
      h.prisma.$executeRawUnsafe(
        `INSERT INTO "PriceReference"
           ("id","cardId","productType","gradeKey","finish","source","priceMxnCents","capturedDate","cardProductId")
         VALUES ($1,$2,'raw','raw:NM','normal','tcgcsv',$3,$4,NULL)`,
        randomUUID(),
        cardId,
        mxn,
        capturedDate,
      );
    await insert(10);
    await expect(insert(20)).rejects.toThrow(); // segundo NULL colisiona (NULLS NOT DISTINCT)
    const rows = await h.prisma.priceReference.findMany({
      where: { cardId, cardProductId: null, finish: 'normal', capturedDate },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].priceMxnCents).toBe(10);
  });
});
