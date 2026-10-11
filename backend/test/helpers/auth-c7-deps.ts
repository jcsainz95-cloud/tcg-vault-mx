/**
 * auth-c7-deps.ts — v1.80 (C7): las dos dependencias nuevas de `AuthService` para las specs que lo
 * construyen A MANO (`new AuthService(...)`). Propiedad: backend.
 *
 * ⛔ No es un doble que apague el candado: es el `PasswordAttemptsService` REAL sobre un almacén en
 * MEMORIA nuevo (el mismo que usa la suite bajo `AppModule`, §4.57.6) y el `DeviceTokenService` REAL.
 * Cada llamada devuelve un almacén nuevo ⇒ los contadores no se filtran entre specs.
 */
import { randomBytes } from 'crypto';
import { PrismaService } from '../../src/prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PiiCryptoService } from '../../src/common/crypto/pii-crypto.service';
import { AuditService } from '../../src/modules/audit/audit.service';
import { MailService } from '../../src/modules/mail/mail.service';
import { DeviceTokenService } from '../../src/modules/auth/device-token.service';
import { MemoryLoginAttemptStore, LoginAttemptStore } from '../../src/modules/auth/login-attempt.store';
import { PasswordAttemptsService } from '../../src/modules/auth/password-attempts.service';

export interface C7Deps {
  attempts: PasswordAttemptsService;
  devices: DeviceTokenService;
  store: LoginAttemptStore;
  audit: { log: jest.Mock };
  mail: { sendPasswordLockAlert: jest.Mock };
}

export function makeC7Deps(
  opts: {
    config?: ConfigService;
    store?: LoginAttemptStore;
    audit?: { log: jest.Mock };
    mail?: { sendPasswordLockAlert: jest.Mock };
    prisma?: { user: { updateMany: jest.Mock } };
  } = {},
): C7Deps {
  const config =
    opts.config ??
    new ConfigService({
      JWT_ACCESS_SECRET: 'a-secret',
      JWT_REFRESH_SECRET: 'r-secret',
      // Clave HMAC aleatoria por llamada: el blind index es determinista dentro de la spec.
      PII_HMAC_KEY: randomBytes(32).toString('base64'),
      PII_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    });
  const store = opts.store ?? new MemoryLoginAttemptStore();
  const audit = opts.audit ?? { log: jest.fn(async () => undefined) };
  const mail = opts.mail ?? { sendPasswordLockAlert: jest.fn(async () => undefined) };
  const attempts = new PasswordAttemptsService(
    store,
    new PiiCryptoService(config),
    audit as unknown as AuditService,
    mail as unknown as MailService,
    // v1.80.9 (§M6-U.4): el aviso de candado SIN correo escribe `lockNoticeAt`. Doble con `updateMany` contado.
    (opts.prisma ?? { user: { updateMany: jest.fn(async () => ({ count: 1 })) } }) as unknown as PrismaService,
  );
  const devices = new DeviceTokenService(new JwtService({}), config);
  return { attempts, devices, store, audit, mail };
}

/** Los dos argumentos finales del constructor de `AuthService`, en orden. */
export function c7Args(opts?: Parameters<typeof makeC7Deps>[0]): [PasswordAttemptsService, DeviceTokenService] {
  const d = makeC7Deps(opts);
  return [d.attempts, d.devices];
}
