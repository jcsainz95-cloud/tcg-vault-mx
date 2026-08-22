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
 * Idempotente (E2E-1): se puede correr N veces sobre la MISMA DB sin romper. Todos los
 * fixtures con clave única usan `upsert`; además resetea el estado transaccional por-usuario
 * Y el estado E2E que no cuelga de userId (ProcessedStripeEvent + InventoryMovement de piezas
 * de plataforma), de modo que una 2ª corrida de `test:integration` vuelve a partir de cero.
 */
import { Finish, PrismaClient } from '@prisma/client';
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
  E2E_USERS,
} from './e2e-fixtures';

function todayUtc(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
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
  const day = todayUtc();
  const priceRef = async (
    cardExt: string,
    productType: 'raw' | 'graded' | 'sealed',
    gradeKey: string,
    priceMxnCents: number,
    finish: 'normal' | 'reverse_holo' | 'holofoil' | 'first_edition_holofoil' = 'normal',
  ) => {
    await prisma.priceReference.upsert({
      where: {
        // v1.6-finish (M-18): la clave única incluye `finish`.
        cardId_productType_gradeKey_finish_capturedDate: {
          cardId: cardIds[cardExt],
          productType,
          gradeKey,
          finish,
          capturedDate: day,
        },
      },
      create: {
        cardId: cardIds[cardExt],
        productType,
        gradeKey,
        finish,
        source: 'manual',
        priceMxnCents,
        capturedDate: day,
        isManualOverride: true,
      },
      update: { priceMxnCents },
    });
  };
  await priceRef(E2E_CARDS.charizard.externalId, 'raw', 'raw:NM', E2E_CARDS.charizard.refNmCents);
  await priceRef(E2E_CARDS.common.externalId, 'raw', 'raw:NM', E2E_CARDS.common.refNmCents);
  await priceRef(E2E_CARDS.reverse.externalId, 'raw', 'raw:NM', E2E_CARDS.reverse.refNmCents);
  await priceRef(E2E_CARDS.graded.externalId, 'graded', 'graded:PSA:10', E2E_CARDS.graded.refPsa10Cents);
  await priceRef(E2E_CARDS.highvalue.externalId, 'raw', 'raw:NM', E2E_CARDS.highvalue.refNmCents);

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
