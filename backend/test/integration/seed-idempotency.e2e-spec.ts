/**
 * seed-idempotency.e2e-spec.ts — **EL ARNÉS SE PRUEBA A SÍ MISMO.** Propiedad: backend; la ejecuta QA.
 *
 * Verifica la propiedad que el `seed-e2e` PROMETE en su cabecera y que hasta v1.50.3-e no estaba
 * cubierta por ninguna prueba: **sembrar es repetible**. Concretamente, el escenario con el que QA
 * cazó BLOQ-A y con el que revalidará —correr la suite, sembrar en medio, correr la suite otra vez—
 * y el que sale de verificar en LOCAL dos días seguidos:
 *
 *   1. sembrar DOS veces el mismo día no duplica ni cambia nada;
 *   2. sembrar HOY sobre una BD sembrada AYER **no inserta una segunda fila** de la misma clave
 *      lógica (la `@@unique` de `PriceReference` incluye `capturedDate`, así que «actualizar la del
 *      día» NO es idempotente entre días: el fixture del slab acababa con DOS `graded:PSA:10` y el
 *      criterio 8 de `graded-estimate.e2e-spec` reventaba en la SEGUNDA corrida);
 *   3. una corrida FALLIDA de la suite —que deja estimados a medio recapturar, filas envejecidas por
 *      el caso `8d` y precios pisados por overrides— **no contamina la siguiente**: el seed vuelve a
 *      dejar el estado declarado;
 *   4. y el borra-y-declara del seed está ACOTADO a las cartas del fixture: no toca las referencias
 *      de ninguna otra carta de la BD.
 *
 * Por qué es un bloqueante y no una curiosidad: en CI la BD es efímera y esto sale verde SIEMPRE. El
 * defecto solo muerde a quien verifica en local contra un stack que ya vivió un día — el modo de
 * fallo que menos se ve y peor enseña ("vuelve a correrlo y ya").
 *
 * No levanta la app (no hace falta HTTP): habla con Postgres REAL por Prisma, que es donde vive la
 * propiedad bajo prueba.
 */
import { PrismaClient } from '@prisma/client';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_CARDS, E2E_ORDER_CARDS } from '../../prisma/e2e-fixtures';

const FIXTURE_EXTERNAL_IDS = [
  ...Object.values(E2E_CARDS).map((c) => c.externalId),
  ...Object.values(E2E_ORDER_CARDS).map((c) => c.externalId),
];

const isoDay = (d: Date) => d.toISOString().slice(0, 10);

describe('E2E — el SEED sintético es REPETIBLE (idempotente entre corridas y entre días)', () => {
  const prisma = new PrismaClient();

  beforeAll(async () => {
    await prisma.$connect();
    await seedE2E(prisma);
  });

  afterAll(async () => {
    // Deja la BD como la suite espera encontrarla (esta prueba ensucia a propósito).
    await seedE2E(prisma);
    await prisma.$disconnect();
  });

  /** ids de las cartas del fixture, por externalId. */
  const fixtureCards = async () => {
    const cards = await prisma.card.findMany({
      where: { externalId: { in: FIXTURE_EXTERNAL_IDS } },
      select: { id: true, externalId: true },
    });
    expect(cards.length).toBe(FIXTURE_EXTERNAL_IDS.length); // el seed sembró todas
    return cards;
  };

  /**
   * Foto COMPARABLE del estado de precios del fixture: la clave lógica + el valor + el día, SIN `id`
   * ni `createdAt` (que cambian por construcción en un borra-y-declara y no son el estado observable).
   */
  const snapshot = async (): Promise<string[]> => {
    const cards = await fixtureCards();
    const ext = new Map(cards.map((c) => [c.id, c.externalId]));
    const rows = await prisma.priceReference.findMany({ where: { cardId: { in: [...ext.keys()] } } });
    return rows
      .map((r) =>
        [
          ext.get(r.cardId),
          r.productType,
          r.gradeKey,
          r.finish,
          r.priceMxnCents,
          isoDay(r.capturedDate),
          r.cardProductId ?? 'null',
          r.source,
          r.isManualOverride,
        ].join('|'),
      )
      .sort();
  };

  /** La clave lógica SIN el día: dos filas que la compartan son el duplicado que BLOQ-A describía. */
  const claveSinDia = (fila: string) => fila.split('|').slice(0, 4).join('|');

  /**
   * Mueve `n` días el campo de fecha de una fila del `snapshot()` (posición 5), dejando el resto
   * intacto. Sirve para expresar «la BD se sembró ayer» **sin** asumir que todas las filas del fixture
   * tienen la fecha de hoy: desde v1.50.3-e algunas son RETRODATADAS por diseño (los estimados rancios
   * de `e2e-stale-est`, que existen porque el `POST /admin/pricing/override` escribe SIEMPRE con la
   * fecha de hoy y sin ellas el sabor «automático» de `?reason=STALE` no es ejercitable contra el
   * stack vivo).
   */
  const desplazaUnDia = (fila: string, n: number): string => {
    const campos = fila.split('|');
    const d = new Date(`${campos[5]}T00:00:00.000Z`);
    d.setUTCDate(d.getUTCDate() + n);
    campos[5] = isoDay(d);
    return campos.join('|');
  };

  it('1) sembrar DOS veces el mismo día deja EXACTAMENTE el mismo estado y una sola fila por clave', async () => {
    const primera = await snapshot();
    expect(primera.length).toBeGreaterThan(0);
    await seedE2E(prisma);
    const segunda = await snapshot();
    expect(segunda).toEqual(primera);
    // Una fila por clave lógica: sin esto, «igual» podría significar «igual de duplicado».
    expect(new Set(segunda.map(claveSinDia)).size).toBe(segunda.length);
  });

  it('2) BLOQ-A — sembrar HOY sobre una BD sembrada AYER no DUPLICA: actualiza el fixture al día', async () => {
    const esperado = await snapshot();
    const cards = await fixtureCards();
    const ids = cards.map((c) => c.id);

    // Se simula «la BD se sembró ayer»: se retrasa un día TODO lo que el seed escribió. Es
    // indistinguible de haber corrido `--seed` ayer y volver hoy, que es como QA lo encontró.
    const ayer = new Date();
    ayer.setUTCHours(0, 0, 0, 0);
    ayer.setUTCDate(ayer.getUTCDate() - 1);
    for (const fila of await prisma.priceReference.findMany({ where: { cardId: { in: ids } } })) {
      await prisma.priceReference.update({
        where: { id: fila.id },
        data: { capturedDate: new Date(fila.capturedDate.getTime() - 24 * 60 * 60 * 1000) },
      });
    }
    const deAyer = await snapshot();
    // ⚠️ v1.50.3-e — el oráculo NO puede ser «todas las filas son de ayer»: desde esta versión el
    // fixture incluye a propósito filas RETRODATADAS (los estimados rancios de `e2e-stale-est`, que
    // son lo único que la API del contrato no puede fabricar). Lo que se afirma es lo que de verdad
    // se simuló: **cada fila retrocedió exactamente un día**, conserve la antigüedad que conserve.
    expect(deAyer).toEqual(esperado.map((f) => desplazaUnDia(f, -1)).sort());
    // …y al menos una es de ayer (si no, el escenario «se sembró ayer» no se estaría simulando).
    expect(deAyer.some((f) => f.includes(`|${isoDay(ayer)}|`))).toBe(true);

    await seedE2E(prisma);

    const hoy = await snapshot();
    // (a) NADA duplicado: la fila de ayer no sobrevive junto a la de hoy.
    expect(new Set(hoy.map(claveSinDia)).size).toBe(hoy.length);
    // (b) el estado es IDÉNTICO al de una siembra sobre BD limpia (mismo día, mismos precios).
    expect(hoy).toEqual(esperado);

    // (c) El síntoma EXACTO que QA midió, nombrado: el slab del fixture tiene UNA fila
    //     `graded:PSA:10` con su precio de mercado — el `409` del criterio 8 se apoya en eso.
    const slab = cards.find((c) => c.externalId === E2E_CARDS.slabbed.externalId)!;
    const filasSlab = await prisma.priceReference.findMany({
      where: { cardId: slab.id, productType: 'graded', gradeKey: 'graded:PSA:10' },
    });
    expect(filasSlab).toHaveLength(1);
    expect(filasSlab[0].priceMxnCents).toBe(E2E_CARDS.slabbed.refPsa10Cents);
    expect(isoDay(filasSlab[0].capturedDate)).toBe(isoDay(new Date()));
  });

  it('3) una corrida FALLIDA no contamina la siguiente: estimados, filas envejecidas y overrides se limpian', async () => {
    const esperado = await snapshot();
    const cards = await fixtureCards();
    const common = cards.find((c) => c.externalId === E2E_CARDS.common.externalId)!;
    const charizard = cards.find((c) => c.externalId === E2E_CARDS.charizard.externalId)!;

    const hace40Dias = new Date();
    hace40Dias.setUTCHours(0, 0, 0, 0);
    hace40Dias.setUTCDate(hace40Dias.getUTCDate() - 40);
    const hoy = new Date();
    hoy.setUTCHours(0, 0, 0, 0);

    // Basura REAL de una corrida a medias de `graded-estimate.e2e-spec`:
    //  · el estimado PSA 10 que el caso `8d` ENVEJECE a 40 días para probar la caducidad,
    //  · el estimado PSA 9 recapturado hoy que el caso `8e` no llegó a retirar,
    //  · y un precio de venta PISADO por el override del §M2 (`123400`).
    await prisma.priceReference.createMany({
      data: [
        {
          cardId: common.id,
          productType: 'graded',
          gradeKey: 'graded:PSA:10',
          finish: 'normal',
          source: 'manual',
          priceMxnCents: 900_000,
          capturedDate: hace40Dias,
          isManualOverride: true,
        },
        {
          cardId: common.id,
          productType: 'graded',
          gradeKey: 'graded:PSA:9',
          finish: 'normal',
          source: 'manual',
          priceMxnCents: 500_000,
          capturedDate: hoy,
          isManualOverride: true,
        },
      ],
    });
    await prisma.priceReference.updateMany({
      where: { cardId: charizard.id, productType: 'raw', gradeKey: 'raw:NM' },
      data: { priceMxnCents: 123_400 },
    });
    expect(await snapshot()).not.toEqual(esperado); // la BD ESTÁ sucia

    await seedE2E(prisma);

    expect(await snapshot()).toEqual(esperado);
    expect(
      await prisma.priceReference.count({ where: { cardId: common.id, productType: 'graded' } }),
    ).toBe(0);
  });

  it('4) el borra-y-declara está ACOTADO al fixture: no toca referencias de otras cartas', async () => {
    const set = await prisma.cardSet.create({
      data: { externalId: 'e2e-idem-set', name: 'E2E Idem Set', series: 'E2E', printedTotal: 1 },
    });
    const ajena = await prisma.card.create({
      data: {
        externalId: 'e2e-idem-foreign',
        setId: set.id,
        name: 'E2E Not A Fixture',
        number: '1',
        numberSort: 1,
        rarity: 'Common',
        supertype: 'Pokémon',
        subtypes: [],
        availableFinishes: ['normal'],
      },
    });
    try {
      const dia = new Date();
      dia.setUTCHours(0, 0, 0, 0);
      await prisma.priceReference.create({
        data: {
          cardId: ajena.id,
          productType: 'raw',
          gradeKey: 'raw:NM',
          finish: 'normal',
          source: 'manual',
          priceMxnCents: 4242,
          capturedDate: dia,
          isManualOverride: true,
        },
      });

      await seedE2E(prisma);

      const sobrevive = await prisma.priceReference.findMany({ where: { cardId: ajena.id } });
      expect(sobrevive).toHaveLength(1);
      expect(sobrevive[0].priceMxnCents).toBe(4242);
    } finally {
      await prisma.priceReference.deleteMany({ where: { cardId: ajena.id } });
      await prisma.card.delete({ where: { id: ajena.id } });
      await prisma.cardSet.delete({ where: { id: set.id } });
    }
  });

  it('5) los pedidos y envíos de INVITADO del fixture no se ACUMULAN entre corridas', async () => {
    // Los pedidos de invitado no cuelgan de `userId`, así que el reset por-usuario del seed nunca los
    // alcanzaba: se apilaban corrida tras corrida hasta que `GET /admin/shipments` —con su tope duro
    // de 100 por página— dejó de mostrar el envío recién creado y el caso de la cola de M4 de
    // `guest-checkout.e2e-spec` empezó a fallar SOLO en máquinas con historial. Mismo modo de fallo
    // que BLOQ-A, otra tabla.
    await seedE2E(prisma);
    const restantes = await prisma.order.findMany({
      where: { guestEmail: { endsWith: '@example.com' } },
      select: { id: true },
    });
    expect(restantes).toHaveLength(0);
    expect(
      await prisma.shipmentRequest.count({
        where: { orderId: { in: restantes.map((o) => o.id) } },
      }),
    ).toBe(0);
    // Y el seed NO barre pedidos de invitado que no sean del fixture sintético.
    expect(
      await prisma.order.count({ where: { guestEmail: { not: null }, NOT: { guestEmail: { endsWith: '@example.com' } } } }),
    ).toBe(await prisma.order.count({ where: { guestEmail: { not: null } } }));
  });
});
