import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Role, UserStatus } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { PiiCryptoService } from '../../common/crypto/pii-crypto.service';
import { normalizeEmail } from '../../common/validation/credentials';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { NameSourceLike } from '../mail/greeting-name';
import { LOGIN_ATTEMPT_STORE, LoginAttemptStore } from './login-attempt.store';
import {
  ACCOUNT_KEY_DOMAIN,
  CHANGE_PASSWORD_KEY_PREFIX,
  DEVICE_KEY_PREFIX,
  LOCK_MAIL_KEY_PREFIX,
  PASSWORD_LOCK_MAIL_EVERY_MS,
} from './password-attempts.constants';

/** Por dónde entró el intento que puso el candado (`AuditLog.after.via`, contrato §1). */
export type PasswordLockVia = 'account' | 'device' | 'change_password';

/** Lo que necesita el aviso sobre la cuenta (si existe). Nunca se vuelca a la bitácora entero. */
export interface LockedAccount {
  id: string;
  email: string;
  name: string;
  nameSource?: NameSourceLike | null;
  locale?: string | null;
  role: Role;
  status: UserStatus;
}

export interface Reservation {
  failures: number;
  lockedNow: boolean;
  lockSeconds: number;
}

/** Roles que reciben el correo de aviso (§4.57.2 #10; decisión revisable por el dueño, §4.57.9). */
const STAFF_ROLES: ReadonlySet<Role> = new Set([Role.super_admin, Role.vault_operator]);

/**
 * PasswordAttemptsService — C7 (v1.80), la POLÍTICA del límite de intentos de contraseña.
 * `API_CONTRACT §1` «Límite de intentos por cuenta»; `ARCHITECTURE §4.57`.
 *
 *  - **Claves**: la del login es `blindIndex("auth-pw:v1:" + normalizeEmail(email))` — la MISMA
 *    `normalizeEmail` que usa la búsqueda del usuario (si difirieran, `Owner@X.com` y `owner@x.com`
 *    abrirían dos cubos contra la misma cuenta). HMAC y no el correo: las claves de Redis las lee
 *    quien lea Redis, y un correo es PII.
 *  - **`reserve`**: mira el candado y reserva el intento en UNA operación del almacén; con candado
 *    ⇒ `429 TOO_MANY_PASSWORD_ATTEMPTS` (el mismo para todos: exista o no la cuenta, cualquier rol).
 *  - **`notifyLock`**: efectos del candado nuevo, ⛔ **sin `await`** — anti-enumeración por tiempo:
 *    la bitácora solo se escribe para cuentas que existen, y esperarla sumaría milisegundos SOLO a
 *    ésas. Es detectiva y de mejor esfuerzo: la compuerta es el contador, no la bitácora.
 */
@Injectable()
export class PasswordAttemptsService {
  private readonly logger = new Logger('PasswordAttempts');

  constructor(
    @Inject(LOGIN_ATTEMPT_STORE) private readonly store: LoginAttemptStore,
    private readonly pii: PiiCryptoService,
    private readonly audit: AuditService,
    private readonly mail: MailService,
  ) {}

  accountKey(email: string): string {
    return this.pii.blindIndex(ACCOUNT_KEY_DOMAIN + normalizeEmail(email));
  }

  changePasswordKey(userId: string): string {
    return CHANGE_PASSWORD_KEY_PREFIX + userId;
  }

  deviceKey(jti: string): string {
    return DEVICE_KEY_PREFIX + jti;
  }

  /** Reserva un intento en `key`, o lanza `429 TOO_MANY_PASSWORD_ATTEMPTS` sin contar nada. */
  async reserve(key: string): Promise<Reservation> {
    const r = await this.store.acquire(key);
    if (!r.allowed) {
      throw new BusinessException(
        'TOO_MANY_PASSWORD_ATTEMPTS',
        HttpStatus.TOO_MANY_REQUESTS,
        'Too many password attempts; try again later or reset your password',
        { retryAfterSeconds: r.retryAfterSeconds },
      );
    }
    return { failures: r.failures, lockedNow: r.lockedNow, lockSeconds: r.lockSeconds };
  }

  async clear(...keys: string[]): Promise<void> {
    for (const k of keys) await this.store.reset(k);
  }

  /**
   * Levanta el candado de una cuenta por una vía que PRUEBA algo (reset por correo, reset por admin):
   * limpia el cubo del login de su correo y el de `change-password` de su id. Los cubos de
   * dispositivo no se pueden enumerar (van por `jti`) y no hace falta: son del dueño.
   */
  async clearForUser(user: { id: string; email: string }): Promise<void> {
    await this.clear(this.accountKey(user.email), this.changePasswordKey(user.id));
  }

  /**
   * Efectos laterales del candado NUEVO (transición «sin candado → con candado»). Programados con
   * `setImmediate` y ⛔ sin `await` en ningún punto del camino de la respuesta.
   */
  notifyLock(
    reservation: Reservation,
    ctx: { via: PasswordLockVia; accountKey: string; user: LockedAccount | null; actorUserId?: string },
  ): void {
    if (!reservation.lockedNow) return;
    setImmediate(() => {
      this.logger.warn(
        `C7 candado de contraseña: acct=${ctx.accountKey.slice(0, 12)} via=${ctx.via} ` +
          `failures=${reservation.failures} lockSeconds=${reservation.lockSeconds}`,
      );
      const user = ctx.user;
      if (!user) return; // cuenta inexistente: ni bitácora ni correo (un atacante llenaría la tabla)
      this.audit
        .log({
          actorUserId: ctx.actorUserId ?? null,
          actorRole: ctx.actorUserId ? user.role : null,
          action: 'auth.password_lock',
          entityType: 'User',
          entityId: user.id,
          after: { failures: reservation.failures, lockSeconds: reservation.lockSeconds, via: ctx.via },
        })
        .catch((e: unknown) => this.logger.error(`auth.password_lock: bitácora falló (${String(e)})`));
      if (!STAFF_ROLES.has(user.role) || user.status !== UserStatus.active) return;
      this.store
        .claimOnce(LOCK_MAIL_KEY_PREFIX + user.id, PASSWORD_LOCK_MAIL_EVERY_MS)
        .then((first) => (first ? this.mail.sendPasswordLockAlert(user) : undefined))
        .catch((e: unknown) => this.logger.error(`auth.password_lock: correo falló (${String(e)})`));
    });
  }
}
