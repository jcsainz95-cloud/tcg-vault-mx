/**
 * seed.ts — Datos iniciales. Diales M10 con defaults, usuario super_admin, y datos
 * mínimos de catálogo/ubicaciones para arrancar. ARCHITECTURE §3.2.
 * Ejecuta: npm run seed  (requiere DATABASE_URL y migraciones aplicadas).
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { SETTING_DEFAULTS } from '../src/modules/settings/settings.constants';
import { deriveNumberParts } from '../src/common/card-order';

const prisma = new PrismaClient();

/**
 * SEC-C1: sin contraseñas hardcodeadas. Se exigen por env
 * (`SEED_ADMIN_PASSWORD`, `SEED_OPERATOR_PASSWORD`). En entornos NO-locales el seed
 * FALLA si faltan (nunca se usan defaults débiles). En local (NODE_ENV `development`,
 * `test`, o sin definir) se permite un fallback SOLO para arrancar el entorno de
 * desarrollo; nunca debe usarse ese fallback en staging/producción.
 */
export function isLocalEnv(): boolean {
  const env = process.env.NODE_ENV ?? 'development';
  return env === 'development' || env === 'test' || env === 'local';
}

export function requiredSeedPassword(envVar: string, localFallback: string): string {
  const value = process.env[envVar];
  if (value && value.length > 0) return value;
  if (!isLocalEnv()) {
    throw new Error(
      `${envVar} is required to seed a non-local environment (NODE_ENV=${process.env.NODE_ENV}). ` +
        'Refusing to seed with a weak/default password. Set a strong value and re-run.',
    );
  }
  console.warn(
    `[seed] ${envVar} not set — using a LOCAL-ONLY dev fallback. ` +
      'Do NOT rely on this outside local development.',
  );
  return localFallback;
}

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
  const adminPassword = requiredSeedPassword('SEED_ADMIN_PASSWORD', 'LocalDevAdmin!' + Date.now());
  await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      passwordHash: await argon2.hash(adminPassword),
      name: 'Super Admin',
      role: 'super_admin',
      locale: 'es',
      // v1.5-6: el staff nace verificado (no pasa por el flujo público de verificación).
      emailVerified: true,
    },
    update: {},
  });
  console.log(`super_admin: ${adminEmail} (password por env SEED_ADMIN_PASSWORD).`);

  // 3. Operador de bóveda (rol limitado). SEC-C1: password por env obligatoria en
  //    entornos no-locales; se eliminó la credencial de operador hardcodeada previa.
  const opEmail = process.env.SEED_OPERATOR_EMAIL ?? 'operador@tcg.local';
  const opPassword = requiredSeedPassword('SEED_OPERATOR_PASSWORD', 'LocalDevOperator!' + Date.now());
  await prisma.user.upsert({
    where: { email: opEmail },
    create: {
      email: opEmail,
      passwordHash: await argon2.hash(opPassword),
      name: 'Operador Bóveda',
      role: 'vault_operator',
      locale: 'es',
      // v1.5-6: el staff nace verificado.
      emailVerified: true,
    },
    update: {},
  });
  console.log(`vault_operator: ${opEmail} (password por env SEED_OPERATOR_PASSWORD).`);

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
  // v1.22-variantes-orden (§4.22e) — `availableFinishes` EXPLÍCITO (nunca el `@default` del
  // schema) y `numberSort`/`numberPrefix` (M-26) con la MISMA función que usa el sync de catálogo.
  // Charizard base1-4 es Rare Holo pura del Base Set original (sin reverse holo/normal real para
  // esta rareza en esa impresión): UNA sola casilla, nunca relleno.
  // v1.22-1 (§4.22g): se siembran también las DOS columnas de ENTRADA coherentes. Charizard es RUTA
  // CATÁLOGO puro (catalogFinishes=['holofoil'], snapshot vacío ⇒ availableFinishes=['holofoil']).
  const charizardParts = deriveNumberParts('4');
  await prisma.card.upsert({
    where: { externalId: 'base1-4' },
    create: {
      externalId: 'base1-4',
      setId: set.id,
      name: 'Charizard',
      number: '4',
      numberSort: charizardParts.numberSort,
      numberPrefix: charizardParts.prefix,
      rarity: 'Rare Holo',
      supertype: 'Pokémon',
      subtypes: ['Stage 2'],
      imageSmallUrl: 'https://images.pokemontcg.io/base1/4.png',
      imageLargeUrl: 'https://images.pokemontcg.io/base1/4_hires.png',
      availableFinishes: ['holofoil'],
      catalogFinishes: ['holofoil'],
      // v1.26 (§4.24a/§4.22e): entrada ESTRUCTURAL (ancla/reemplaza catalogFinishes en la unión).
      // Charizard es holofoil puro ⇒ una sola casilla, sin normal fantasma.
      structuralFinishes: ['holofoil'],
      pricedFinishesSnapshot: [],
    },
    update: {
      numberSort: charizardParts.numberSort,
      numberPrefix: charizardParts.prefix,
      availableFinishes: ['holofoil'],
      catalogFinishes: ['holofoil'],
      structuralFinishes: ['holofoil'],
      pricedFinishesSnapshot: [],
    },
  });

  // v1.22-1 (§4.22g/§4.22h) — carta de demostración del RESCATE por PPT (el caso del PO con
  // pokemontcg.io caído): el catálogo solo conoce `normal` (`catalogFinishes=['normal']`) pero PPT
  // reportó reverse holo con market>0 y alias VERIFICADO (`pricedFinishesSnapshot=['reverse_holo']`)
  // ⇒ la unión DERIVADA da `availableFinishes=['normal','reverse_holo']` (DOS casillas), sostenida
  // SOLO por la Señal C. Prueba en el seed de desarrollo que la ruta de la unión funciona.
  const pidgeyParts = deriveNumberParts('16');
  await prisma.card.upsert({
    where: { externalId: 'base1-16' },
    create: {
      externalId: 'base1-16',
      setId: set.id,
      name: 'Pidgey',
      number: '16',
      numberSort: pidgeyParts.numberSort,
      numberPrefix: pidgeyParts.prefix,
      rarity: 'Common',
      supertype: 'Pokémon',
      subtypes: ['Basic'],
      imageSmallUrl: 'https://images.pokemontcg.io/base1/16.png',
      imageLargeUrl: 'https://images.pokemontcg.io/base1/16_hires.png',
      availableFinishes: ['normal', 'reverse_holo'],
      catalogFinishes: ['normal'],
      // v1.26 (§4.24a): la ESTRUCTURA solo conoce `normal`; PPT aporta el reverse_holo vía el
      // snapshot ⇒ la unión da DOS casillas SIN que el precio añada estructura (reverse pendiente).
      structuralFinishes: ['normal'],
      pricedFinishesSnapshot: ['reverse_holo'],
    },
    update: {
      numberSort: pidgeyParts.numberSort,
      numberPrefix: pidgeyParts.prefix,
      availableFinishes: ['normal', 'reverse_holo'],
      catalogFinishes: ['normal'],
      structuralFinishes: ['normal'],
      pricedFinishesSnapshot: ['reverse_holo'],
    },
  });

  console.log('Seed completo.');
}

// CLI runner: solo ejecuta el seed cuando se invoca directamente (permite importar los
// helpers desde tests sin abrir conexión a la base).
if (require.main === module) {
  main()
    .catch((e) => {
      console.error(e);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
