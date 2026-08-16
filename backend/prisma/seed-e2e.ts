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
 * Idempotente: se puede correr N veces; resetea el estado transaccional E2E.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SETTING_DEFAULTS } from '../src/modules/settings/settings.constants';
import {
  E2E_CARDS,
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
  const cardIds: Record<string, string> = {};
  for (const c of Object.values(E2E_CARDS)) {
    const card = await prisma.card.upsert({
      where: { externalId: c.externalId },
      create: {
        externalId: c.externalId,
        setId: set.id,
        name: c.name,
        number: c.number,
        rarity: c.rarity,
        supertype: 'Pokémon',
        subtypes: [],
        imageSmallUrl: `https://img.e2e.local/${c.externalId}.png`,
        imageLargeUrl: `https://img.e2e.local/${c.externalId}_hires.png`,
      },
      update: { rarity: c.rarity },
    });
    cardIds[c.externalId] = card.id;
  }

  // Limpia colas de precio pendiente de las cartas E2E (se regeneran en los flujos).
  await prisma.pendingPriceEntry.deleteMany({ where: { cardId: { in: Object.values(cardIds) } } });

  // 6. Referencias de precio del día (valor de mercado). `nopref` queda SIN referencia.
  const day = todayUtc();
  const priceRef = async (cardExt: string, productType: 'raw' | 'graded' | 'sealed', gradeKey: string, priceMxnCents: number) => {
    await prisma.priceReference.upsert({
      where: {
        cardId_productType_gradeKey_capturedDate: {
          cardId: cardIds[cardExt],
          productType,
          gradeKey,
          capturedDate: day,
        },
      },
      create: {
        cardId: cardIds[cardExt],
        productType,
        gradeKey,
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
