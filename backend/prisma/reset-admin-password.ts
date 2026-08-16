/**
 * reset-admin-password.ts — Restablece la contraseña de una cuenta staff (por
 * defecto el super_admin) a un valor NUEVO que tú provees por variable de entorno.
 *
 * Por qué existe: la contraseña original solo vivió en `SEED_ADMIN_PASSWORD` al
 * sembrar; en la base solo hay un hash argon2 (irreversible). Este script NO
 * recupera la vieja: fija una nueva conocida.
 *
 * SEGURIDAD: no hay ningún secreto hardcodeado. La contraseña nueva se lee de
 * `NEW_ADMIN_PASSWORD` (obligatoria); si falta, el script se niega a correr.
 * Nunca imprime la contraseña, solo el email afectado.
 *
 * Uso (en Railway, contra la BD real):
 *   railway run --service backend \
 *     -e NEW_ADMIN_PASSWORD='UnaPasswordFuerte!' \
 *     npx ts-node prisma/reset-admin-password.ts
 *
 * Opcional: ADMIN_EMAIL para apuntar a otro correo (default: SEED_ADMIN_EMAIL o
 * admin@tcg.local). Solo restablece cuentas con rol super_admin o vault_operator.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// Mínimos de robustez (alineado con la validación de registro del backend).
const MIN_PASSWORD_LENGTH = 12;

async function main() {
  const email = process.env.ADMIN_EMAIL ?? process.env.SEED_ADMIN_EMAIL ?? 'admin@tcg.local';
  const newPassword = process.env.NEW_ADMIN_PASSWORD;

  if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `NEW_ADMIN_PASSWORD is required and must be at least ${MIN_PASSWORD_LENGTH} characters. ` +
        'Set it in the environment (never hardcode) and re-run.',
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) {
    throw new Error(`No user found with email "${email}". Set ADMIN_EMAIL to the correct address.`);
  }
  if (user.role !== 'super_admin' && user.role !== 'vault_operator') {
    throw new Error(
      `Refusing to reset "${email}": role is "${user.role}", not staff (super_admin/vault_operator).`,
    );
  }

  const passwordHash = await argon2.hash(newPassword);
  await prisma.user.update({
    where: { email },
    data: { passwordHash, emailVerified: true },
  });

  // Nunca se imprime la contraseña.
  console.log(`[reset-admin-password] OK — contraseña restablecida para ${email} (rol ${user.role}).`);
}

main()
  .catch((err) => {
    console.error(`[reset-admin-password] ERROR — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
