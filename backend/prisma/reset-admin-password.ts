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
 *
 * SESIONES (SEC-RESET-TV): el cambio de hash incrementa `tokenVersion` en la MISMA
 * escritura, así que TODA sesión abierta de esa cuenta (incluida la de un atacante
 * con un refresh token robado) queda revocada al terminar el script.
 */
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

// Mínimos de robustez (alineado con la validación de registro del backend).
export const MIN_PASSWORD_LENGTH = 12;

/** Lo mínimo de Prisma que usa el script (inyectable para la prueba unitaria). */
export interface ResetPrismaLike {
  user: {
    findUnique(args: { where: { email: string } }): Promise<{ email: string; role: string } | null>;
    update(args: { where: { email: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ResetEnv {
  ADMIN_EMAIL?: string;
  SEED_ADMIN_EMAIL?: string;
  NEW_ADMIN_PASSWORD?: string;
}

/**
 * Restablece la contraseña de una cuenta staff. Devuelve email y rol afectados.
 * ⛔ Nunca devuelve ni imprime la contraseña.
 */
export async function resetStaffPassword(
  prisma: ResetPrismaLike,
  env: ResetEnv,
  hash: (plain: string) => Promise<string> = (plain) => argon2.hash(plain),
): Promise<{ email: string; role: string }> {
  const email = env.ADMIN_EMAIL ?? env.SEED_ADMIN_EMAIL ?? 'admin@tcg.local';
  const newPassword = env.NEW_ADMIN_PASSWORD;

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

  const passwordHash = await hash(newPassword);
  // SEC-RESET-TV: UNA sola escritura. `tokenVersion +1` revoca access/refresh vivos (el guard y
  // /auth/refresh comparan la versión), igual que los caminos de la app (auth.service reset/cambio,
  // admin.service reset). Si el script se usa porque la cuenta está comprometida, un refresh robado
  // deja de valer en el acto. `mustChangePassword=false`: quien lo corre fija una contraseña conocida.
  await prisma.user.update({
    where: { email },
    data: {
      passwordHash,
      tokenVersion: { increment: 1 },
      emailVerified: true,
      mustChangePassword: false,
    },
  });

  return { email, role: user.role };
}

async function main() {
  const prisma = new PrismaClient();
  try {
    const { email, role } = await resetStaffPassword(prisma, process.env);
    // Nunca se imprime la contraseña.
    console.log(`[reset-admin-password] OK — contraseña restablecida para ${email} (rol ${role}).`);
  } finally {
    await prisma.$disconnect();
  }
}

// Importar el módulo (la prueba) NO ejecuta main(); `npx ts-node prisma/reset-admin-password.ts` sí.
if (require.main === module) {
  main().catch((err) => {
    console.error(`[reset-admin-password] ERROR — ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  });
}
