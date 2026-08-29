/**
 * seed-e2e.ts — SEED SINTÉTICO para integración/E2E. Propiedad: backend.
 * =============================================================================
 * Puebla la base con datos FICTICIOS y DETERMINISTAS (usuarios de cada rol,
 * catálogo, referencias de precio, inventario de plataforma y de bóveda de
 * cliente) para poder correr la suite `test/integration/*.e2e-spec.ts` de forma
 * repetible. NADA de datos reales de clientes (ver scripts/seed-synthetic.sh).
 *
 * Uso:
 *   npm run seed:synthetic        # CLI (lo invoca scripts/seed-synthetic.sh y CI)
 *   import { seedE2E } from './seed-e2e'  // reutilizable desde las suites (beforeAll)
 *
 * Requiere: DATABASE_URL + migraciones aplicadas (`prisma migrate deploy`).
 * Idempotente (E2E-1): se puede correr N veces sobre la MISMA DB —el mismo día o en días
 * DISTINTOS, sobre una BD limpia o sobre una que dejó sucia una corrida fallida— sin romper y
 * dejando siempre el MISMO estado. Todos los fixtures con clave única usan `upsert`; además
 * resetea el estado transaccional por-usuario, el estado E2E que no cuelga de userId
 * (ProcessedStripeEvent + InventoryMovement de piezas de plataforma) y las `PriceReference` de
 * las cartas del fixture (borra-y-declara, §6: su clave única incluye `capturedDate`, así que
 * «actualizar la del día» NO basta para ser idempotente entre días). De modo que una 2ª corrida
 * de `test:integration` vuelve a partir de cero.
 */
import { Finish, Prisma, PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SETTING_DEFAULTS } from '../src/modules/settings/settings.constants';
import { deriveNumberParts } from '../src/common/card-order';
import {
  E2E_CARDS,
  E2E_ORDER_CARDS,
  E2E_ORDER_SET,
  E2E_FOLIOS,
  E2E_LIST_OVERRIDE_CENTS,
  E2E_LOCATIONS,
  E2E_SET,
  E2E_SETTINGS,
  E2E_STALE_ESTIMATES,
  E2E_USERS,
} from './e2e-fixtures';

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/**
 * v1.50.3-e — fecha de captura RETRODATADA, en la misma convención date-only UTC que `todayUtc()`.
 * Es lo único que la API del contrato no puede producir: `POST /admin/pricing/override` escribe
 * SIEMPRE con la fecha de hoy (a propósito: el manual se refresca recapturándolo, §4.38m), así que
 * sin esto el fixture no puede ofrecer una fila **vencida** de forma estable.
 */
function daysAgoUtc(days: number): Date {
  const d = todayUtc();
  d.setUTCDate(d.getUTCDate() - days);
  return d;
}

export async function seedE2E(prisma: PrismaClient): Promise<void> {
  // 1. Diales M10: defaults + fija los deterministas que usa la matemática de la suite.
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: value as object, updatedBy: 'seed-e2e' },
      update: {},
    });
  }
  for (const [key, value] of Object.entries(E2E_SETTINGS)) {
    await prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: value as unknown as object, updatedBy: 'seed-e2e' },
      update: { valueJson: value as unknown as object, updatedBy: 'seed-e2e' },
    });
  }

  // 2. Usuarios (uno por rol) con password determinista.
  const userIds: Record<string, string> = {};
  for (const u of Object.values(E2E_USERS)) {
    const created = await prisma.user.upsert({
      where: { email: u.email },
      create: {
        email: u.email,
        passwordHash: await argon2.hash(u.password),
        name: u.name,
        role: u.role,
        locale: 'es',
        // v1.5: fixtures deterministas verificados (staff v1.5-6; y el customer E2E para que el
        // EmailVerifiedGuard no bloquee los flujos de comprar/retirar/vender de la suite).
        emailVerified: true,
      },
      update: { status: 'active', role: u.role, emailVerified: true },
    });
    userIds[u.email] = created.id;
  }
  const customerId = userIds[E2E_USERS.customer.email];
  const ids = Object.values(userIds);

  // 3. Reset del estado TRANSACCIONAL de E2E (para determinismo entre corridas/archivos).
  //
  // 3-pre. Pedidos de INVITADO (v1.21/M-25). No cuelgan de `userId` —por definición— así que las
  // reglas por-usuario de abajo NUNCA los alcanzaban y se ACUMULABAN corrida tras corrida. No es
  // cosmético: `GET /admin/shipments` pagina con un tope DURO de 100 (el contrato lo capa), y al
  // pasar de 100 envíos `picking` históricos el envío recién creado dejó de caber en la página y
  // el caso «el envío de invitado aparece en la cola de M4» empezó a fallar SOLO en las máquinas
  // con historial — el mismo modo de fallo que BLOQ-A (el arnés se rompe por su propia operación,
  // y en CI —BD efímera— nunca se ve). Se acota al dominio RESERVADO `@example.com` (RFC 2606), que
  // es el que usan TODOS los fixtures de invitado de la suite y que ningún cliente real puede tener.
  // Primero los envíos (FK `orderId` es `Restrict`), luego los pedidos (cascada a OrderItem y a
  // OrderAccessToken). Los pedidos de invitado ya RECLAMADOS también entran: nacieron invitados
  // (`guestEmail` es inmutable) y su envío tiene `userId = null`, así que sin esto bloquearían por
  // Restrict el borrado por-usuario de más abajo.
  const guestOrders = await prisma.order.findMany({
    where: { guestEmail: { endsWith: '@example.com' } },
    select: { id: true },
  });
  const guestOrderIds = guestOrders.map((o) => o.id);
  if (guestOrderIds.length > 0) {
    await prisma.shipmentRequest.deleteMany({ where: { orderId: { in: guestOrderIds } } });
    await prisma.order.deleteMany({ where: { id: { in: guestOrderIds } } });
  }

  await prisma.dispute.deleteMany({ where: { userId: { in: ids } } });
  await prisma.shipmentRequest.deleteMany({ where: { userId: { in: ids } } }); // cascada a ShipmentItem
  await prisma.sellRequest.deleteMany({ where: { userId: { in: ids } } }); // cascada a SellRequestItem
  await prisma.order.deleteMany({ where: { userId: { in: ids } } }); // cascada a OrderItem
  await prisma.kycProfile.deleteMany({ where: { userId: { in: ids } } });

  // 3b. Idempotencia CROSS-RUN (E2E-1). Hay estado E2E que NO cuelga de userId y que las
  // suites de webhook mutan; si no se resetea, una 2ª corrida de `test:integration` sobre la
  // MISMA DB rompe:
  //   - ProcessedStripeEvent(id=evt_e2e_succeeded_fixed): persistiría de la corrida anterior;
  //     el guard de idempotencia de PaymentsService haría no-op → la orden NO liquidaría y el
  //     test "el webhook FIRMADO liquida la orden" fallaría.
  //   - InventoryMovement de piezas de PLATAFORMA (settle/chargeback_return): se acumularían y
  //     el assert "settleMovements === 1" contaría 2+.
  // Se limpian aquí (idempotencia real, no solo dentro de una corrida).
  const e2eItems = await prisma.inventoryItem.findMany({
    where: { folio: { in: Object.values(E2E_FOLIOS) } },
    select: { id: true },
  });
  await prisma.inventoryMovement.deleteMany({ where: { itemId: { in: e2eItems.map((i) => i.id) } } });
  await prisma.processedStripeEvent.deleteMany({
    where: { OR: [{ id: 'evt_e2e_succeeded_fixed' }, { id: { startsWith: 'evt_e2e' } }] },
  });

  // 4. Ubicaciones (una por zona).
  const platformLoc = await prisma.vaultLocation.upsert({
    where: {
      zone_box_row_slot: {
        zone: E2E_LOCATIONS.platform.zone,
        box: E2E_LOCATIONS.platform.box,
        row: E2E_LOCATIONS.platform.row,
        slot: E2E_LOCATIONS.platform.slot,
      },
    },
    create: { ...E2E_LOCATIONS.platform },
    update: {},
  });
  const custodyLoc = await prisma.vaultLocation.upsert({
    where: {
      zone_box_row_slot: {
        zone: E2E_LOCATIONS.custody.zone,
        box: E2E_LOCATIONS.custody.box,
        row: E2E_LOCATIONS.custody.row,
        slot: E2E_LOCATIONS.custody.slot,
      },
    },
    create: { ...E2E_LOCATIONS.custody },
    update: {},
  });

  // 5. Set + cartas del catálogo sintético (datos en inglés, como pokemontcg.io).
  const set = await prisma.cardSet.upsert({
    where: { externalId: E2E_SET.externalId },
    create: { ...E2E_SET },
    update: {},
  });
  // v1.22-variantes-orden (§4.22e): SEGUNDO set, dedicado al orden natural ("2" < "10" < "TG01").
  const orderSet = await prisma.cardSet.upsert({
    where: { externalId: E2E_ORDER_SET.externalId },
    create: { ...E2E_ORDER_SET },
    update: { printedTotal: E2E_ORDER_SET.printedTotal },
  });
  const cardIds: Record<string, string> = {};
  const seedCards = async (
    setId: string,
    cards: readonly {
      externalId: string;
      name: string;
      number: string;
      rarity: string;
      availableFinishes: readonly Finish[];
      // v1.22-1 (§4.22g/§4.22h): columnas de ENTRADA. Si no se declaran, ruta CATÁLOGO
      // (`catalogFinishes = availableFinishes`, snapshot vacío).
      catalogFinishes?: readonly Finish[];
      // v1.26 (§4.24a): entrada ESTRUCTURAL. Sin declarar ⇒ = catalogFinishes.
      structuralFinishes?: readonly Finish[];
      pricedFinishesSnapshot?: readonly Finish[];
    }[],
  ) => {
    for (const c of cards) {
      // §4.22e — `availableFinishes` EXPLÍCITO (nunca el @default del schema) y en orden canónico
      // FINISH_ORDER; `numberSort`/`numberPrefix` (M-26) con la MISMA función que usa el sync.
      const parts = deriveNumberParts(c.number);
      // Columnas de entrada COHERENTES con `availableFinishes`. Sin declarar ⇒ catalog = available,
      // snapshot = []. v1.27: `catalogFinishes` es señal DÉBIL write-only (nadie la lee en
      // producción); se siembra solo por realismo del dato persistido.
      const catalogFinishes = [...(c.catalogFinishes ?? c.availableFinishes)];
      const pricedFinishesSnapshot = [...(c.pricedFinishesSnapshot ?? [])];
      // v1.27.1 (P-13-fix, §4.25e): el reconciliador compone la UNIÓN structural ∪ snapshot menos
      // `normal` si la rareza es premium (`availableFinishes = composeAvailableFinishes(
      // structuralFinishes, pricedFinishesSnapshot, rarity)`). Sin declarar structural ⇒ =
      // catalogFinishes; `reverse` (Reverse Holo, no premium) declara AMBAS impresiones y el snapshot
      // aporta/confirma el reverse — un reconcile sobre los fixtures es NO-OP, no colapsa casillas.
      const structuralFinishes = [...(c.structuralFinishes ?? catalogFinishes)];
      const card = await prisma.card.upsert({
        where: { externalId: c.externalId },
        create: {
          externalId: c.externalId,
          setId,
          name: c.name,
          number: c.number,
          numberSort: parts.numberSort,
          numberPrefix: parts.prefix,
          rarity: c.rarity,
          supertype: 'Pokémon',
          subtypes: [],
          imageSmallUrl: `https://img.e2e.local/${c.externalId}.png`,
          imageLargeUrl: `https://img.e2e.local/${c.externalId}_hires.png`,
          availableFinishes: [...c.availableFinishes],
          catalogFinishes,
          structuralFinishes,
          pricedFinishesSnapshot,
        },
        // Idempotencia (E2E-1): una 2ª corrida sobre una BD vieja debe CORREGIR las variantes y las
        // claves de orden, no dejarlas como estaban (si no, el bug del PO sobreviviría al re-seed).
        update: {
          rarity: c.rarity,
          numberSort: parts.numberSort,
          numberPrefix: parts.prefix,
          availableFinishes: [...c.availableFinishes],
          catalogFinishes,
          structuralFinishes,
          pricedFinishesSnapshot,
        },
      });
      cardIds[c.externalId] = card.id;
    }
  };
  await seedCards(set.id, Object.values(E2E_CARDS));
  await seedCards(orderSet.id, Object.values(E2E_ORDER_CARDS));

  // Limpia colas de precio pendiente de las cartas E2E (se regeneran en los flujos).
  await prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: Object.values(cardIds) } } });

  // 6. Referencias de precio del día (valor de mercado). `nopref` queda SIN referencia.
  //
  // IDEMPOTENCIA ENTRE DÍAS Y ENTRE CORRIDAS (E2E-1 · BLOQ-A de QA). La `@@unique` de
  // `PriceReference` incluye `capturedDate`, y la versión anterior de este helper buscaba la fila
  // existente FILTRANDO por `capturedDate: day`: sembrar HOY sobre una BD sembrada AYER no
  // actualizaba nada — INSERTABA una segunda fila de la misma clave lógica. El fixture del slab
  // acababa con dos `graded:PSA:10` y el criterio 8 de `graded-estimate.e2e-spec` reventaba en la
  // SEGUNDA corrida. El mismo agujero dejaba pasar la basura de una corrida FALLIDA (estimados a
  // medio recapturar, y las filas que el caso `8d` ENVEJECE a 40 días para probar la caducidad):
  // el arnés dejaba de ser repetible por su propia operación, y en CI —BD efímera— siempre verde.
  //
  // Ahora el seed DECLARA el estado completo de esta tabla para las cartas del fixture: borra TODAS
  // sus referencias (cualquier día, cualquier acabado, cualquier `cardProductId`) y escribe
  // exactamente las de abajo. Sembrar N veces, el mismo día o en días distintos, sobre una BD
  // limpia o sobre una sucia, deja SIEMPRE el mismo estado. Va en UNA transacción para que un
  // stack vivo (`up --seed`) nunca observe la ventana intermedia sin precio, que despublicaría
  // piezas por PRICE_PENDING.
  const day = todayUtc();
  const priceRefs: Prisma.PriceReferenceCreateManyInput[] = [];
  const priceRef = (
    cardExt: string,
    productType: 'raw' | 'graded' | 'sealed',
    gradeKey: string,
    priceMxnCents: number,
    finish: 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil' = 'normal',
  ) => {
    // v1.29 (M-31): la clave gana `cardProductId`; el seed usa el fallback null.
    priceRefs.push({
      cardId: cardIds[cardExt],
      productType,
      gradeKey,
      finish,
      source: 'manual',
      priceMxnCents,
      capturedDate: day,
      isManualOverride: true,
      cardProductId: null,
    });
  };
  priceRef(E2E_CARDS.charizard.externalId, 'raw', 'raw:NM', E2E_CARDS.charizard.refNmCents);
  priceRef(E2E_CARDS.common.externalId, 'raw', 'raw:NM', E2E_CARDS.common.refNmCents);
  priceRef(E2E_CARDS.reverse.externalId, 'raw', 'raw:NM', E2E_CARDS.reverse.refNmCents);
  priceRef(E2E_CARDS.graded.externalId, 'graded', 'graded:PSA:10', E2E_CARDS.graded.refPsa10Cents);
  priceRef(E2E_CARDS.highvalue.externalId, 'raw', 'raw:NM', E2E_CARDS.highvalue.refNmCents);
  // v2.1.7: mercado ABSURDO para una premium ⇒ la venta aterriza en el PISO (guardarraíl §4.36.5).
  priceRef(E2E_CARDS.floorpremium.externalId, 'raw', 'raw:NM', E2E_CARDS.floorpremium.refNmCents!);
  // v1.50.3-d (§4.38i.9) — la carta con raw publicado Y slab PSA 10 publicado. Las DOS filas son de la
  // MISMA carta y NO significan lo mismo: `raw:NM` es el mercado del single, y `graded:PSA:10` es la
  // referencia de mercado REAL del slab publicado — **no** un estimado del gancho, aunque sea la misma
  // clave que usaría un estimado (eso ES INV-D, §4.38l). El `DELETE` de §4.38(q) responde `409` sobre
  // ella y este seed es lo que lo vuelve verificable de punta a punta.
  priceRef(E2E_CARDS.slabbed.externalId, 'raw', 'raw:NM', E2E_CARDS.slabbed.refNmCents);
  priceRef(E2E_CARDS.slabbed.externalId, 'graded', 'graded:PSA:10', E2E_CARDS.slabbed.refPsa10Cents);
  // v1.50.3-d — la TERCERA carta raw publicada (§4.38i.9).
  priceRef(E2E_CARDS.thirdraw.externalId, 'raw', 'raw:NM', E2E_CARDS.thirdraw.refNmCents);
  // v1.50.3-e — la CUARTA raw publicada y LIBRE: SOLO su referencia raw. **Ninguna fila de estimado a
  // propósito**: nace limpia para que el caso que la use no herede el estado de otro (§4.38i.9).
  priceRef(E2E_CARDS.fourthraw.externalId, 'raw', 'raw:NM', E2E_CARDS.fourthraw.refNmCents);
  // v1.50.3-e (petición de QA) — la carta de los estimados que la API NO puede fabricar: su raw, más
  // las DOS filas `graded:PSA:*` con `capturedDate` VIEJA, una de ellas **automática**
  // (`isManualOverride: false`, `source` de proveedor). Sin ellas, `?reason=STALE` con origen
  // automático y el `isManual: false` del diagnóstico solo existían en unitarios con dobles: el
  // override manual escribe siempre manual y siempre con fecha de hoy.
  priceRef(E2E_CARDS.staleest.externalId, 'raw', 'raw:NM', E2E_CARDS.staleest.refNmCents);
  for (const e of E2E_STALE_ESTIMATES) {
    priceRefs.push({
      cardId: cardIds[E2E_CARDS.staleest.externalId],
      productType: 'graded',
      gradeKey: e.gradeKey,
      finish: 'normal',
      // Las DOS señales de origen se siembran COHERENTES entre sí: el resolver considera manual una
      // fila con `isManualOverride` **o** con `source: 'manual'` (§4.38m), así que una fila «automática»
      // con `source: 'manual'` sería un dato imposible que volvería verde una prueba por el motivo
      // equivocado.
      source: e.isManual ? 'manual' : 'pokemonpricetracker',
      priceMxnCents: e.priceMxnCents,
      // Sin `priceUsdCents`: el monto es MXN nativo y NINGUNA FX puede reinterpretarlo (`liveMxnCents`
      // solo recalcula cuando hay USD). El fixture promete un número, no una conversión del día.
      capturedDate: daysAgoUtc(e.daysAgo),
      isManualOverride: e.isManual,
      cardProductId: null,
    });
  }
  // El BORRA-Y-DECLARA atómico. `deleteMany` acotado a las cartas del fixture: el seed sintético no
  // gobierna —ni toca— referencias de ninguna otra carta que hubiera en la BD.
  await prisma.$transaction([
    prisma.priceReference.deleteMany({ where: { cardId: { in: Object.values(cardIds) } } }),
    prisma.priceReference.createMany({ data: priceRefs }),
  ]);

  // 6-bis. COLA DE PRECIO PENDIENTE (v2.1.7) — la cola de triage de P-48 no tenía NINGÚN dato real:
  // sus `counts` estaban verificados en forma pero no en número. Se siembran las DOS razones, y las
  // dos son ESTADOS VERDADEROS de estas cartas, no filas decorativas:
  //
  //   · `no_market`        → `nopref` NO tiene `PriceReference` (ningún flujo se la da).
  //   · `premium_at_floor` → `floorpremium` es premium con mercado de MX$10: la venta cae al piso.
  //
  // Estables durante la suite: el eje de COMPRA sí resuelve para `floorpremium`, pero desde v2.1.6
  // un cierre del eje de compra NO puede cerrar un `premium_at_floor` abierto por `inventory`
  // (S48-M1) — así que una cotización de buylist no vacía esta cola por accidente. Eso es
  // precisamente lo que protege esa corrección, y aquí queda ejercitado con datos reales.
  const seedPending = async (
    cardExt: string,
    reason: 'no_market' | 'premium_at_floor',
    gradeKey = 'raw:NM',
  ) => {
    const cardId = cardIds[cardExt];
    const existing = await prisma.pendingPriceEntry.findFirst({
      where: { cardId, productType: 'raw', gradeKey, finish: 'normal', status: 'open' },
    });
    if (existing) {
      await prisma.pendingPriceEntry.update({ where: { id: existing.id }, data: { reason } });
      return;
    }
    await prisma.pendingPriceEntry.create({
      data: {
        cardId,
        productType: 'raw',
        gradeKey,
        finish: 'normal',
        // El eje de VENTA es quien escala en `inventory` (§4.36.5b).
        context: 'inventory',
        status: 'open',
        reason,
      },
    });
  };
  await seedPending(E2E_CARDS.nopref.externalId, 'no_market');
  await seedPending(E2E_CARDS.floorpremium.externalId, 'premium_at_floor');

  // 7. Inventario. Los E2E-LST-* se RESETEAN a plataforma/listed en cada corrida.
  const upsertItem = async (
    folio: string,
    create: Record<string, unknown>,
    reset: Record<string, unknown>,
  ) => {
    await prisma.inventoryItem.upsert({
      where: { folio },
      create: { folio, ...(create as object) } as never,
      update: reset as never,
    });
  };

  // Plataforma, vendibles.
  await upsertItem(
    E2E_FOLIOS.listedCharizard,
    {
      cardId: cardIds[E2E_CARDS.charizard.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 70000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );
  await upsertItem(
    E2E_FOLIOS.listedCommonOverride,
    {
      cardId: cardIds[E2E_CARDS.common.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      listPriceCents: E2E_LIST_OVERRIDE_CENTS,
      acquisitionType: 'compra',
      acquisitionCostCents: 3000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: E2E_LIST_OVERRIDE_CENTS },
  );
  await upsertItem(
    E2E_FOLIOS.listedGraded,
    {
      cardId: cardIds[E2E_CARDS.graded.externalId],
      productType: 'graded',
      gradingCompany: 'PSA',
      gradeValue: '10',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 350000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );
  // Precio pendiente (nopref) → sellable=false.
  await upsertItem(
    E2E_FOLIOS.listedPending,
    {
      cardId: cardIds[E2E_CARDS.nopref.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );

  // v1.50.3-d (§4.38i.9) — las DOS piezas de la carta de INV-D, sobre la MISMA carta: el grupo raw
  // publicado y el slab PSA 10 publicado. Con las dos a la vez, `getPublishedSlabGradesBatch` devuelve
  // `['10']` para esa carta y por fin se puede ejercitar contra el stack vivo lo que hasta ahora solo
  // existía en pruebas unitarias: el pre-vuelo del back-office, el `SLAB_PUBLISHED` de la lista de
  // revisión y el `409` del `DELETE` de §4.38(q).
  await upsertItem(
    E2E_FOLIOS.listedSlabRaw,
    {
      cardId: cardIds[E2E_CARDS.slabbed.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 20000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );
  await upsertItem(
    E2E_FOLIOS.listedSlab,
    {
      cardId: cardIds[E2E_CARDS.slabbed.externalId],
      productType: 'graded',
      gradingCompany: 'PSA',
      gradeValue: '10',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 500000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );
  // v1.50.3-d — la TERCERA raw publicada (§4.38i.9): permite cubrir «un solo grado» y «dos grados sin
  // destacar» a la vez, sin que un caso pise al otro sobre la misma carta.
  await upsertItem(
    E2E_FOLIOS.listedThirdRaw,
    {
      cardId: cardIds[E2E_CARDS.thirdraw.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 25000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );

  // v1.50.3-e (§4.38i.9) — la CUARTA raw publicada y LIBRE. Existe para que los escenarios dejen de
  // reciclarse entre casos: un fixture que obliga a reutilizar la misma carta crea ACOPLAMIENTO entre
  // pruebas (la segunda hereda el estado de la primera), que es justo lo que un fixture sintético
  // existe para evitar. No lleva NINGUNA fila de estimado: quien la use la captura y la retira.
  await upsertItem(
    E2E_FOLIOS.listedFourthRaw,
    {
      cardId: cardIds[E2E_CARDS.fourthraw.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 22000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );
  // v1.50.3-e (QA) — la pieza raw de la carta de los estimados RANCIOS. Tiene que estar PUBLICADA:
  // la lista de revisión (y el `preview`) solo producen filas para cartas con **grupo raw publicado**,
  // así que sin esta pieza las dos filas de estimado no serían observables por ninguna superficie.
  await upsertItem(
    E2E_FOLIOS.listedStaleEst,
    {
      cardId: cardIds[E2E_CARDS.staleest.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 15000,
      locationId: platformLoc.id,
    },
    { ownerType: 'platform', ownerUserId: null, ownershipStatus: null, status: 'listed', listPriceCents: null },
  );

  // Bóveda del cliente: un settled (retirable) y un pending (NO retirable).
  await upsertItem(
    E2E_FOLIOS.custSettled,
    {
      cardId: cardIds[E2E_CARDS.charizard.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'customer',
      ownerUserId: customerId,
      ownershipStatus: 'settled',
      status: 'in_custody',
      acquisitionType: 'compra',
      locationId: custodyLoc.id,
    },
    { ownerType: 'customer', ownerUserId: customerId, ownershipStatus: 'settled', status: 'in_custody', locationId: custodyLoc.id },
  );
  await upsertItem(
    E2E_FOLIOS.custPending,
    {
      cardId: cardIds[E2E_CARDS.common.externalId],
      productType: 'raw',
      rawCondition: 'NM',
      ownerType: 'customer',
      ownerUserId: customerId,
      ownershipStatus: 'pending',
      status: 'in_custody',
      acquisitionType: 'compra',
      locationId: custodyLoc.id,
    },
    { ownerType: 'customer', ownerUserId: customerId, ownershipStatus: 'pending', status: 'in_custody', locationId: custodyLoc.id },
  );

  // 8. Dirección MX por defecto del customer (para retiros).
  const existingAddr = await prisma.address.findFirst({ where: { userId: customerId } });
  if (!existingAddr) {
    await prisma.address.create({
      data: {
        userId: customerId,
        line1: 'Av. E2E 123',
        neighborhood: 'Centro',
        city: 'CDMX',
        state: 'CDMX',
        postalCode: '01000',
        country: 'MX',
        phone: '5555555555',
        isDefault: true,
      },
    });
  }
}

// --------- CLI runner (npm run seed:synthetic / prisma db seed en modo synthetic) ---------
if (require.main === module) {
  const prisma = new PrismaClient();
  seedE2E(prisma)
    .then(() => console.log('✓ seed-e2e: dataset sintético cargado (determinista).'))
    .catch((e) => {
      console.error('✗ seed-e2e falló:', e);
      process.exitCode = 1;
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
