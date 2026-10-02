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
 *
 * CANDADO C7 (v1.80.1, `SEC-C7-SCRIPT`, contrato «Script de rescate», `ARCHITECTURE §4.57.10.3`):
 * quien puede correr esto tiene la consola de Railway — ya es el dueño — y la contraseña que fija
 * prueba más que cualquier vía que hoy levanta el candado. DESPUÉS de la escritura, si hay
 * `REDIS_URL`, borra en Redis los seis cubos de la cuenta (`tcg:auth:{f,l}:` de `auth-pw` por HMAC
 * del correo normalizado, `auth-cp:v1:<id>` y `auth-pwdevagg:v1:<id>`) con las MISMAS funciones y
 * constantes del backend. Sin `REDIS_URL` o con Redis que no contesta: termina OK igual (la
 * contraseña YA cambió) y lo dice. ⛔ El candado NUNCA hace fallar el script. Límite escrito: si la
 * API está en modo memoria en ese instante, su memoria repone el candado al volver Redis (≤ 60 min);
 * el dueño tiene su `deviceToken`.
 */
import { PrismaClient } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';
import { passwordAttemptKeysForUser } from '../src/modules/auth/password-attempts.service';
import {
  createLoginAttemptRedisClient,
  loginAttemptRedisKeys,
  withTimeout,
} from '../src/modules/auth/login-attempt.store';

// Mínimos de robustez (alineado con la validación de registro del backend).
export const MIN_PASSWORD_LENGTH = 12;

/** Plazo total para conectar + borrar en Redis. El script no espera más por una cortesía. */
export const LOCK_CLEAR_TIMEOUT_MS = 2000;

/** Lo mínimo de Prisma que usa el script (inyectable para la prueba unitaria). */
export interface ResetPrismaLike {
  user: {
    findUnique(args: { where: { email: string } }): Promise<{ id?: string; email: string; role: string } | null>;
    update(args: { where: { email: string }; data: Record<string, unknown> }): Promise<unknown>;
  };
}

export interface ResetEnv {
  ADMIN_EMAIL?: string;
  SEED_ADMIN_EMAIL?: string;
  NEW_ADMIN_PASSWORD?: string;
  /** v1.80.1: los del servicio backend; opcionales aquí (sin ellos, el candado no se limpia y se avisa). */
  REDIS_URL?: string;
  REDIS_FAMILY?: string;
  PII_HMAC_KEY?: string;
  PII_ENCRYPTION_KEY?: string;
  NODE_ENV?: string;
  STRIPE_SECRET_KEY?: string;
}

/** Lo mínimo del cliente Redis que usa la limpieza (inyectable para la prueba unitaria). */
export interface RedisLike {
  connect(): Promise<void>;
  del(...keys: string[]): Promise<number>;
  quit(): Promise<unknown>;
  disconnect(): void;
}

export interface ResetOptions {
  /** Salida humana (por defecto `console.log`). ⛔ Nunca recibe la contraseña ni un HMAC completo. */
  log?: (line: string) => void;
  /** Fábrica del cliente Redis (por defecto `createLoginAttemptRedisClient`: mismo perfil que la API). */
  redisClient?: (url: string, family?: string) => RedisLike;
}

export type LockClearResult = { cleared: true } | { cleared: false; reason: string };

const LOCK_NOT_CLEARED_HINT = 'espera ≤ 60 min o entra con un dispositivo conocido';

/**
 * Borra en Redis los seis cubos C7 de la cuenta. Nunca lanza: devuelve `{ cleared:false, reason }`.
 * Exportada para la prueba; el formato de las claves y su derivación son los del backend
 * (`passwordAttemptKeysForUser` + `loginAttemptRedisKeys`), no una copia.
 */
export async function clearPasswordLock(
  user: { id?: string; email: string },
  env: ResetEnv,
  opts: ResetOptions = {},
): Promise<LockClearResult> {
  const url = (env.REDIS_URL ?? '').trim();
  if (!url) return { cleared: false, reason: 'sin REDIS_URL' };
  if (!user.id) return { cleared: false, reason: 'la cuenta no trae id' };
  let client: RedisLike | undefined;
  try {
    const pii = new PiiCryptoService(new ConfigService(env as Record<string, unknown>));
    const k = passwordAttemptKeysForUser(pii, { id: user.id, email: user.email });
    const keys = [k.account, k.changePassword, k.deviceAggregate].flatMap((x) => loginAttemptRedisKeys(x));
    client = (opts.redisClient ?? createLoginAttemptRedisClient)(url, env.REDIS_FAMILY);
    const c = client;
    await withTimeout(
      (async () => {
        await c.connect();
        await c.del(...keys);
      })(),
      LOCK_CLEAR_TIMEOUT_MS,
    );
    return { cleared: true };
  } catch (e) {
    return { cleared: false, reason: e instanceof Error ? e.message : String(e) };
  } finally {
    if (client) {
      try {
        await withTimeout(client.quit(), 500);
      } catch {
        client.disconnect();
      }
    }
  }
}

/**
 * Restablece la contraseña de una cuenta staff. Devuelve email y rol afectados.
 * ⛔ Nunca devuelve ni imprime la contraseña.
 */
export async function resetStaffPassword(
  prisma: ResetPrismaLike,
  env: ResetEnv,
  hash: (plain: string) => Promise<string> = (plain) => argon2.hash(plain),
  opts: ResetOptions = {},
): Promise<{ email: string; role: string }> {
  const log = opts.log ?? ((line: string) => console.log(line));
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

  // v1.80.1: DESPUÉS de la escritura, y sin que un fallo aquí haga fallar el script.
  const lock = await clearPasswordLock({ id: user.id, email: user.email }, env, opts);
  if (lock.cleared) {
    log(`[reset-admin-password] candado de intentos (C7) limpiado en Redis para ${email}.`);
  } else {
    log(
      `[reset-admin-password] candado de intentos NO limpiado (${lock.reason}): ${LOCK_NOT_CLEARED_HINT}. ` +
        'Si la API estaba en modo memoria, repondrá su candado al volver Redis (≤ 60 min).',
    );
  }

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
