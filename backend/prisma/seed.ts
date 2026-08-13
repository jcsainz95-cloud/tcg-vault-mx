/**
 * seed.ts — Datos iniciales. Diales M10 con defaults, usuario super_admin, y datos
 * mínimos de catálogo/ubicaciones para arrancar. ARCHITECTURE §3.2.
 * Ejecuta: npm run seed  (requiere DATABASE_URL y migraciones aplicadas).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SETTING_DEFAULTS } from '../src/modules/settings/settings.constants';

const prisma = new PrismaClient();

async function main() {
  // 1. Diales M10 (ConfigSetting) con sus defaults.
  for (const [key, value] of Object.entries(SETTING_DEFAULTS)) {
    await prisma.configSetting.upsert({
      where: { key },
      create: { key, valueJson: value as object, updatedBy: 'seed' },
      update: {}, // no sobreescribe si ya existe (respeta cambios del admin).
    });
  }
  console.log(`ConfigSetting: ${Object.keys(SETTING_DEFAULTS).length} diales sembrados.`);

  // 2. Usuario super_admin (el negocio ES el admin en el MVP).
  const adminEmail = process.env.SEED_ADMIN_EMAIL ?? 'admin@tcg.local';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword),
      name: 'Super Admin',
      role: 'super_admin',
      locale: 'es',
    },
    update: {},
  });
  console.log(`super_admin: ${adminEmail} (password por env SEED_ADMIN_PASSWORD).`);

  // 3. Operador de bóveda (rol limitado).
  const opEmail = 'operador@tcg.local';
  await prisma.user.upsert({
    where: { email: opEmail },
    create: {
      email: opEmail,
      passwordHash: await argon2.hash('Operador123!'),
      name: 'Operador Bóveda',
      role: 'vault_operator',
      locale: 'es',
    },
    update: {},
  });
  console.log(`vault_operator: ${opEmail}`);

  // 4. FxRate inicial (colchón por defecto). Override manual hasta que corra Banxico.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  await prisma.fxRate.upsert({
    where: { id: `seed-${today.toISOString().slice(0, 10)}` },
    create: {
      id: `seed-${today.toISOString().slice(0, 10)}`,
      rate: 18.5,
      bufferPct: 3,
      effectiveDate: today,
      source: 'manual',
    },
    update: {},
  });

  // 5. Ubicaciones de ejemplo (una por zona).
  await prisma.vaultLocation.upsert({
    where: { zone_box_row_slot: { zone: 'platform_stock', box: 'C01', row: 'F01', slot: 'S01' } },
    create: { zone: 'platform_stock', box: 'C01', row: 'F01', slot: 'S01', label: 'C01-F01-S01' },
    update: {},
  });
  await prisma.vaultLocation.upsert({
    where: { zone_box_row_slot: { zone: 'customer_custody', box: 'C01', row: 'F01', slot: 'S01' } },
    create: { zone: 'customer_custody', box: 'C01', row: 'F01', slot: 'S01', label: 'C01-F01-S01' },
    update: {},
  });

  // 6. Set + carta de ejemplo (datos en inglés, como llegan de pokemontcg.io).
  const set = await prisma.cardSet.upsert({
    where: { externalId: 'base1' },
    create: {
      externalId: 'base1',
      name: 'Base',
      series: 'Base',
      releaseDate: '1999/01/09',
      printedTotal: 102,
      ptcgoCode: 'BS',
    },
    update: {},
  });
  await prisma.card.upsert({
    where: { externalId: 'base1-4' },
    create: {
      externalId: 'base1-4',
      setId: set.id,
      name: 'Charizard',
      number: '4',
      rarity: 'Rare Holo',
      supertype: 'Pokémon',
      subtypes: ['Stage 2'],
      imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
      imageLargeUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
    },
    update: {},
  });

  console.log('Seed completo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
