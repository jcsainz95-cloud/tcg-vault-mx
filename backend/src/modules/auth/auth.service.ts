import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthProvider, AuthTokenType, NameSource, Prisma, Role, User, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { BusinessException } from '../../common/business.exception';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../mail/mail.service';
import { ChangePasswordDto, RegisterDto, LoginDto } from './dto/auth.dto';
import { GoogleTokenVerifier } from './google-token-verifier';
import { AuthTokenService } from './auth-token.service';
import { normalizeIdentifier } from '../../common/validation/credentials';
import { DeviceTokenService } from './device-token.service';
import { PasswordAttemptsService } from './password-attempts.service';
import { SESSION_MAX_AGE_REASON, sessionMaxAgeSeconds, ttlSeconds } from './session-max-age';

/** Máx. de correos por hora y por usuario (reenvío de verificación / olvido de contraseña). */
const MAX_EMAILS_PER_HOUR = 3;

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/**
 * Hash argon2id FIJO precomputado usado como "verificación dummy" en el login cuando NO
 * existe el usuario o su `passwordHash` es null (cuenta solo-Google). Verificar SIEMPRE
 * contra un hash real iguala el tiempo de respuesta (argon2 es intencionadamente costoso),
 * cerrando el canal de ENUMERACIÓN DE USUARIOS POR TEMPORIZACIÓN: un atacante no puede
 * distinguir "email inexistente" de "email existente, contraseña incorrecta" por la latencia.
 * No corresponde a ninguna contraseña real; su único propósito es consumir el mismo trabajo.
 */
const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$IUuYDslaChUS0mrzV74+WQ$Q8BNcs3QrO7nyLYG3ZAMbE+f87icx9X+oRBRlyP0RrE';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly googleVerifier: GoogleTokenVerifier,
    private readonly audit: AuditService,
    private readonly tokens: AuthTokenService,
    private readonly mail: MailService,
    // v1.80 (C7, §4.57): límite de intentos por cuenta y «dispositivo conocido». ⛔ NO opcionales:
    // un AuthService sin contador sería un login sin candado que arranca en silencio.
    private readonly attempts: PasswordAttemptsService,
    private readonly devices: DeviceTokenService,
  ) {}

  private publicUser(u: User) {
    // v1.5: el `user` de register|login|google incluye `emailVerified` (para el banner del front).
    // v1.67 (D-CTA-1, contrato §1): gana `mustChangePassword` y NADA más. Con `true`, login/google
    // responden 200 igual (sin sesión no hay forma de cambiarla) y el front navega a la pantalla de
    // cambio; toda otra ruta autenticada responde 403 PASSWORD_CHANGE_REQUIRED (guard).
    // v1.80.9 (§M6-U.2): `email: string | null` y gana `username` (staff sin correo). Nada más.
    return {
      id: u.id,
      email: u.email,
      username: u.username,
      name: u.name,
      role: u.role,
      locale: u.locale,
      emailVerified: u.emailVerified,
      mustChangePassword: u.mustChangePassword,
    };
  }

  /**
   * Construye el link del correo apuntando al FRONTEND: `${origin}/<locale>/<path>?token=<claro>`.
   * `origin` = primer origen de APP_BASE_URL (lista separada por comas) o localhost en dev.
   */
  private buildFrontendLink(
    user: Pick<User, 'locale'>,
    path: 'verify-email' | 'reset-password',
    clearToken: string,
  ): string {
    const raw = this.config.get<string>('APP_BASE_URL') ?? '';
    const origin = raw.split(',')[0].trim() || 'http://localhost:3000';
    const locale = user.locale ?? this.config.get<string>('DEFAULT_LOCALE') ?? 'es';
    return `${origin}/${locale}/${path}?token=${encodeURIComponent(clearToken)}`;
  }

  /**
   * v1.80.1 (`SEC-C7-MINT`, `ARCHITECTURE §4.57.4`): `sid` es la identidad de la SESIÓN (uuid). Viaja
   * en el refresh token (claim `sid`, opaco para el front) y es el `jti` del `deviceToken`. Sin
   * `sid` se crea uno nuevo (login, google, register, change-password); `refresh` pasa el heredado.
   * ⛔ No se devuelve en el par: el `...tokens` de las respuestas no debe ganar campos (shape intacto).
   */
  async issueTokens(
    user: Pick<User, 'id' | 'email' | 'role' | 'tokenVersion'>,
    sid: string = randomUUID(),
    sat?: number,
  ): Promise<TokenPair> {
    // v1.84 (LIVE-2, §14.2): `sat` = segundos epoch del NACIMIENTO de la sesión. Sin él (login, Google,
    // registro, cambio de contraseña ⇒ sesión nueva) es `now`; `refresh` pasa el heredado. ⛔ Interno como
    // `sid`: viaja solo en el refresh token, nunca en un cuerpo.
    const sessionStart = sat ?? Math.floor(Date.now() / 1000);
    // v1.3.1: el JWT lleva `tv` (tokenVersion). El guard/refresh lo comparan contra el valor
    // vigente en BD y rechazan los tokens con versión previa → revocación de sesiones tras
    // reset de contraseña / soft-delete (que incrementan User.tokenVersion).
    const payload = { sub: user.id, email: user.email, role: user.role, tv: user.tokenVersion };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.get<string>('JWT_ACCESS_SECRET'),
      // S-B4: algoritmo fijo (evita algorithm-confusion). HMAC simétrico HS256.
      algorithm: 'HS256',
      expiresIn: this.config.get<string>('JWT_ACCESS_TTL') ?? '15m',
    });
    // `exp = min(now + JWT_REFRESH_TTL, sat + tope(rol))` (§14.2 paso 4). El rol es el que trae `user`: en el
    // refresh, el leído de BD (SES-5). `exp` va explícito (⛔ `expiresIn` no se combina con `exp`); el TTL se
    // interpreta con el mismo formato que `jsonwebtoken` (`ttlSeconds`).
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = Math.min(
      nowSec + ttlSeconds(this.config.get<string>('JWT_REFRESH_TTL') ?? '30d'),
      sessionStart + sessionMaxAgeSeconds(user.role),
    );
    const refreshToken = await this.jwt.signAsync(
      { ...payload, typ: 'refresh', sid, sat: sessionStart, exp },
      { secret: this.config.get<string>('JWT_REFRESH_SECRET'), algorithm: 'HS256' },
    );
    return { accessToken, refreshToken };
  }

  /**
   * POST /auth/logout (autenticado; en la allowlist de PASSWORD_CHANGE_REQUIRED) — v1.71 (SEC-CR-1).
   * Cerrar sesión **revoca TODAS las sesiones de la cuenta** (todos los dispositivos), decisión de
   * producto del dueño (2026-09-14). Único mecanismo: `tokenVersion +1`, la MISMA palanca por-persona
   * que ya usan el reset del admin (admin.service.ts:1331) y change-password (§5). Al incrementarla,
   * todo access con el `tv` previo cae en su siguiente petición (guard: jwt-auth.guard.ts:70) y todo
   * refresh con el `tv` previo cae en `/auth/refresh` (auth.service.ts:456). NO emite tokens nuevos:
   * cerrar sesión no re-loguea; el usuario vuelve a entrar por /login (su par nuevo llevará el `tv` ya
   * incrementado). Antes (SEC-CR-1) el cuerpo era `return;`: el navegador tiraba su copia pero un
   * testigo copiado antes seguía vivo hasta caducar. NO hay mecanismo por-dispositivo (no hay tabla de
   * sesiones y el dueño no lo pidió). Auditoría `auth.logout` sin secretos, hermana de las de contraseña.
   */
  async logout(userId: string): Promise<void> {
    const user = await this.prisma.user.update({
      where: { id: userId },
      data: { tokenVersion: { increment: 1 } },
    });
    await this.audit.log({
      actorUserId: userId,
      actorRole: user.role,
      action: 'auth.logout',
      entityType: 'User',
      entityId: userId,
    });
  }

  async register(dto: RegisterDto) {
    const passwordHash = await argon2.hash(dto.password);
    let user: User;
    try {
      user = await this.prisma.user.create({
        data: {
          email: dto.email.toLowerCase(),
          passwordHash,
          name: dto.name,
          phone: dto.phone,
          locale: dto.locale ?? 'es',
          role: Role.customer,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw BusinessException.conflict('EMAIL_TAKEN', 'Email already registered');
      }
      throw e;
    }
    // v1.5: emite el token de verificación (24h) y envía el correo. El fallo de envío NO aborta
    // el registro (se registra; el usuario puede pedir reenvío). Nace con emailVerified=false.
    await this.sendVerificationEmail(user);
    const tokens = await this.issueTokens(user);
    return { user: this.publicUser(user), ...tokens };
  }

  /** Emite el token de verificación y envía el correo (best-effort). */
  private async sendVerificationEmail(user: User, requestIp?: string | null): Promise<void> {
    // v1.80.9 (§M6-U.3): los llamadores ya filtran la cuenta sin correo (`register` siempre trae correo;
    // `resendVerification` sale antes con `{ok:true}`). Llegar aquí sin correo es invariante rota: se FALLA en alto
    // (⛔ un `return` silencioso taparía que el paso de `resendVerification` desapareció — mutación de STF-26).
    const email = user.email;
    if (email === null) throw new Error(`sendVerificationEmail: la cuenta ${user.id} no tiene correo`);
    const clear = await this.tokens.issue(user.id, AuthTokenType.email_verification, requestIp);
    const link = this.buildFrontendLink(user, 'verify-email', clear);
    try {
      await this.mail.sendEmailVerification({ ...user, email }, link);
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'auth.email_verification_sent',
        entityType: 'User',
        entityId: user.id,
      });
    } catch (e) {
      // No filtra el token al log; solo el fallo del proveedor.
      this.logger.error(`No se pudo enviar el correo de verificación a ${user.id}: ${String(e)}`);
    }
  }

  /**
   * POST /auth/verify-email/resend (customer+, autenticado). Reenvía la verificación al email de
   * la sesión (sin body → cero enumeración). No-op si ya está verificado. Rate-limit 3/h/usuario.
   */
  async resendVerification(userId: string, requestIp?: string | null): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw BusinessException.notFound();
    // v1.80.9 (§M6-U.3, E-3): cuenta SIN correo ⇒ `200 {ok:true}` sin emitir token ni correo (antes del «ya verificado»).
    if (user.email === null) return { ok: true };
    if (user.emailVerified) return { ok: true }; // ya verificado → no reenvía
    const recent = await this.tokens.countIssuedLastHour(userId, AuthTokenType.email_verification);
    if (recent >= MAX_EMAILS_PER_HOUR) {
      throw new BusinessException('RATE_LIMITED', 429, 'Too many verification emails; try later');
    }
    await this.sendVerificationEmail(user, requestIp);
    return { ok: true };
  }

  /**
   * POST /auth/verify-email (public). Consume el token; marca emailVerified=true y el token usado.
   * NO altera tokenVersion (verificar no revoca sesiones). Idempotente: si el usuario del token ya
   * está verificado, responde ok aunque el token esté usado (tolera doble clic).
   */
  async verifyEmail(token: string): Promise<{ verified: true }> {
    const userId = await this.tokens.consume(token, AuthTokenType.email_verification);
    if (userId) {
      await this.prisma.user.update({ where: { id: userId }, data: { emailVerified: true } });
      await this.audit.log({
        actorUserId: userId,
        action: 'auth.email_verified',
        entityType: 'User',
        entityId: userId,
      });
      return { verified: true };
    }
    // Idempotencia: token ya usado/expirado pero el usuario ya quedó verificado → ok.
    const ownerId = await this.tokens.ownerOf(token);
    if (ownerId) {
      const owner = await this.prisma.user.findUnique({
        where: { id: ownerId },
        select: { emailVerified: true },
      });
      if (owner?.emailVerified) return { verified: true };
    }
    throw BusinessException.validation(
      'EMAIL_VERIFY_TOKEN_INVALID',
      'Verification token is invalid, expired or already used',
    );
  }

  /**
   * POST /auth/forgot-password (public). SIEMPRE responde 200 (anti-enumeración). Si el email
   * existe (cuenta no bloqueada/eliminada), emite token de reset (1h), rota previos y envía el
   * correo. Tope por email 3/h en servicio (best-effort; no revela existencia). Rate-limit IP en ctrl.
   */
  async forgotPassword(email: string, requestIp?: string | null): Promise<{ ok: true }> {
    const user = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Solo procesa cuentas activas (una cuenta blocked/deleted no debe re-habilitarse por reset).
    // v1.80.9 (§M6-U.3): se busca SOLO por `email` (⛔ nunca por `username`): un usuario nunca casa y sale por el
    // mismo `{ ok: true }` que un correo inexistente. `user.email` no es null aquí (se encontró por él).
    if (user && user.email && user.status === UserStatus.active) {
      const email = user.email;
      const recent = await this.tokens.countIssuedLastHour(user.id, AuthTokenType.password_reset);
      if (recent < MAX_EMAILS_PER_HOUR) {
        const clear = await this.tokens.issue(user.id, AuthTokenType.password_reset, requestIp);
        const link = this.buildFrontendLink(user, 'reset-password', clear);
        try {
          await this.mail.sendPasswordReset({ ...user, email }, link);
          await this.audit.log({
            actorUserId: user.id,
            action: 'auth.password_reset_requested',
            entityType: 'User',
            entityId: user.id,
          });
        } catch (e) {
          this.logger.error(`No se pudo enviar el correo de reset a ${user.id}: ${String(e)}`);
        }
      }
    }
    // Respuesta genérica SIEMPRE (exista o no el email).
    return { ok: true };
  }

  /**
   * POST /auth/reset-password (public). Consume el token de reset; fija passwordHash (argon2id),
   * incrementa tokenVersion (revoca sesiones), setea emailVerified=true (v1.5-3), limpia
   * mustChangePassword. No devuelve tokens: el usuario re-inicia sesión. 422 si el token es inválido.
   */
  async resetPassword(token: string, password: string): Promise<{ ok: true; deviceToken: string }> {
    const userId = await this.tokens.consume(token, AuthTokenType.password_reset);
    if (!userId) {
      throw BusinessException.validation(
        'RESET_TOKEN_INVALID',
        'Reset token is invalid, expired or already used',
      );
    }
    // S15-B4 (defensa en profundidad): revalida el estado de la cuenta antes de fijar la
    // contraseña. `forgotPassword` ya solo emite reset a cuentas `active`, y login/guard rechazan
    // las no-activas, pero un token de reset emitido ANTES de bloquear una cuenta no debe permitir
    // fijar contraseña en una cuenta ya bloqueada/eliminada. Mismo trato (y code) que login.
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== UserStatus.active) {
      throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
    }
    const passwordHash = await argon2.hash(password);
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        passwordHash,
        // Revoca sesiones vivas (patrón existente) e implica control del inbox → verificado.
        tokenVersion: { increment: 1 },
        emailVerified: true,
        mustChangePassword: false,
      },
    });
    await this.audit.log({
      actorUserId: userId,
      action: 'auth.password_reset_completed',
      entityType: 'User',
      entityId: userId,
    });
    // v1.80 (C7): quien pulsó el enlace probó el buzón ⇒ levanta el candado de la cuenta y le da un
    // dispositivo conocido: su próximo login no queda atrapado por un atacante que siga golpeando.
    // (Sigue SIN devolver sesión.) ⛔ `forgot-password` NO limpia nada: lo pide cualquiera.
    await this.attempts.clearForUser(user);
    return { ok: true, deviceToken: await this.devices.issue(userId) };
  }

  /**
   * POST /auth/change-password (autenticado, cualquier rol) — v1.67, contrato §1, ARCHITECTURE §4.47.1.
   * Cambia la contraseña de la cuenta de la sesión probando la actual. Única salida de
   * `mustChangePassword` que no pasa por el correo. **Orden de evaluación NORMATIVO (contrato):**
   *  1. cuenta `active` (el guard ya rechazó blocked/deleted con 401; aquí, defensa en profundidad);
   *  2. `passwordHash IS NULL` ⇒ 422 PASSWORD_NOT_SET (no se verifica nada más; este endpoint NO crea
   *     contraseñas: §4.47.3 — remedio: forgot-password);
   *  3. `argon2.verify` falso ⇒ 422 CURRENT_PASSWORD_INCORRECT (⛔ NUNCA 401: el cliente cierra sesión
   *     ante 401 y un dedazo en la actual lo echaría);
   *  4. `newPassword === currentPassword` ⇒ 422 PASSWORD_SAME_AS_CURRENT (DESPUÉS del paso 3);
   *  5. UNA escritura: passwordHash nuevo, `tokenVersion +1`, `mustChangePassword=false`.
   *     `emailVerified` NO cambia (aquí no hubo prueba de inbox; en reset-password sí). `authProvider` no cambia;
   *  6. emite un par NUEVO con el `tokenVersion` ya incrementado y lo devuelve: las demás sesiones
   *     mueren en su siguiente petición/refresh y ÉSTA continúa (difiere de reset-password a propósito);
   *  7. AuditLog `auth.password_changed` (hermano de `auth.password_reset_completed`), sin secretos.
   */
  async changePassword(
    userId: string,
    dto: ChangePasswordDto,
    requestIp?: string | null,
  ): Promise<{ ok: true } & TokenPair> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    // 1. Solo cuentas activas (mismo code que el guard: la sesión no es válida para esta cuenta).
    if (!user || user.status !== UserStatus.active) {
      throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or revoked token');
    }
    // 2. Sin hash no hay actual que probar, y aquí no se crea.
    if (!user.passwordHash) {
      throw BusinessException.validation(
        'PASSWORD_NOT_SET',
        'This account has no password; use forgot-password to set one',
        {},
      );
    }
    // 2-bis (v1.80, C7 — contrato §1): contador PROPIO por userId (no comparte cubo con el login: un
    // atacante que bloquea el login del dueño desde fuera no le impide cambiarla desde dentro). Cada
    // intento que llega al paso 3 se reserva; con candado ⇒ 429 sin argon2 (⛔ nunca 401).
    const cpKey = this.attempts.changePasswordKey(user.id);
    // v1.80.9 (§M6-U.4): el cubo de la CUENTA (su identificador: `email ?? username`), nunca `accountKey(user.email)`.
    const accountKey = this.attempts.accountKeyForUser(user);
    const gate = await this.attempts.reserve(cpKey);
    this.attempts.notifyLock(gate, { via: 'change_password', accountKey, user, actorUserId: user.id });
    // 3. La actual, verificada contra el hash real.
    let currentOk = false;
    try {
      currentOk = await argon2.verify(user.passwordHash, dto.currentPassword);
    } catch {
      currentOk = false;
    }
    if (!currentOk) {
      throw BusinessException.validation('CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect', {
        field: 'currentPassword',
      });
    }
    // 4. Solo tras probar la actual: «cambiar» la temporal por la temporal no la cambia.
    if (dto.newPassword === dto.currentPassword) {
      throw BusinessException.validation(
        'PASSWORD_SAME_AS_CURRENT',
        'New password must differ from the current one',
        { field: 'newPassword' },
      );
    }
    // 5. Una sola escritura. ⛔ `emailVerified` y `authProvider` NO se tocan.
    const passwordHash = await argon2.hash(dto.newPassword);
    const updated = await this.prisma.user.update({
      where: { id: user.id },
      data: {
        passwordHash,
        tokenVersion: { increment: 1 },
        mustChangePassword: false,
      },
    });
    // 6. Par nuevo con el `tokenVersion` YA incrementado (el de `updated`, no el de `user`).
    const tokens = await this.issueTokens(updated);
    // v1.80 (C7): probó la contraseña ⇒ limpia LOS DOS cubos (este y el del login de su correo).
    await this.attempts.clear(cpKey, accountKey);
    // 7. Auditoría, sin volcar ninguna contraseña.
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'auth.password_changed',
      entityType: 'User',
      entityId: user.id,
      ip: requestIp ?? undefined,
    });
    return { ok: true, ...tokens };
  }

  /**
   * POST /auth/login — v1.80 (C7): orden NORMATIVO (`API_CONTRACT §1` «Límite de intentos por
   * cuenta», `ARCHITECTURE §4.57.3`): normalizar → buscar → verificar `deviceToken` → elegir cubo →
   * RESERVAR (o 429) → argon2 (dummy si no hay hash) → 401 | limpiar el cubo usado → 403 → 200.
   *
   *  - La clave sale del correo TECLEADO (normalizado), no de la fila: el contador de un correo que
   *    no existe crece igual que el de uno que existe ⇒ `401×5, 429` idéntico para los dos.
   *  - Con candado, NADIE llega a argon2 (ni a una segunda consulta): el 429 es igual de rápido.
   *  - Un `deviceToken` válido DE ESTA CUENTA elige su propio cubo; uno ajeno/caducado/mal firmado se
   *    IGNORA sin error. ⛔ No autentica: sin la contraseña correcta no entra nadie.
   *  - ⚠️ El acierto por el dispositivo limpia SOLO su cubo: limpiar el de la cuenta le regalaría al
   *    atacante 5 intentos libres cada vez que el dueño entra.
   */
  async login(dto: LoginDto) {
    // v1.80.9 (§M6-U.2): `dto.email` es el IDENTIFICADOR (correo o usuario). Con `@` ⇒ se busca por correo; sin `@`
    // ⇒ por usuario. UNA normalización (`trim().toLowerCase()`) y UNA clave de cubo por identificador: para un correo,
    // bit a bit la de antes (§4.58.4). La bifurcación es de BÚSQUEDA: el resto del orden C7 no cambia.
    const identifier = normalizeIdentifier(dto.email);
    const accountKey = this.attempts.accountKey(identifier);
    const user = await this.prisma.user.findUnique({
      where: identifier.includes('@') ? { email: identifier } : { username: identifier },
    });
    const device = await this.devices.verify(dto.deviceToken);
    let viaDevice = device !== null && user !== null && device.userId === user.id;
    // v1.80.1 (§4.57.10.1 b): tope agregado por cuenta de intentos por vía dispositivo — `bump`
    // atómico ANTES de argon2, fallidos o no, solo con token válido y de esta cuenta. Al pasarse
    // de 30/24 h el token se ignora y el intento va al cubo de la cuenta (no es un 429 propio).
    if (viaDevice && user) viaDevice = await this.attempts.deviceRouteAllowed(user.id);
    const bucket = viaDevice && device ? this.attempts.deviceKey(device.jti) : accountKey;
    const gate = await this.attempts.reserve(bucket);
    this.attempts.notifyLock(gate, { via: viaDevice ? 'device' : 'account', accountKey, user });

    // MITIGACIÓN DE ENUMERACIÓN POR TEMPORIZACIÓN (D5): se ejecuta SIEMPRE un
    // `argon2.verify`, incluso cuando el usuario no existe o su `passwordHash` es null
    // (cuenta solo-Google). En esos casos se verifica contra un hash dummy fijo para que
    // el costo (y por tanto la latencia) sea equivalente al de una cuenta real con
    // contraseña incorrecta. Así la respuesta 401 no revela por temporización si el email
    // existe ni si la cuenta tiene contraseña (caso Google intacto: sigue sin poder
    // loguearse por contraseña, pero sin canal de temporización).
    const hashToVerify = user?.passwordHash ?? DUMMY_PASSWORD_HASH;
    let passwordOk = false;
    try {
      passwordOk = await argon2.verify(hashToVerify, dto.password);
    } catch {
      passwordOk = false;
    }

    if (!user || !user.passwordHash || !passwordOk) {
      throw new BusinessException('INVALID_CREDENTIALS', 401, 'Invalid credentials');
    }
    // La contraseña fue correcta: se limpia el cubo USADO (también antes del 403, conducta intacta).
    await this.attempts.clear(bucket);
    // v1.3.1: `deleted` (soft-delete/anonimizado) también es no-autenticable; mismo code que
    // `blocked` para no revelar el motivo.
    if (user.status === UserStatus.blocked || user.status === UserStatus.deleted) {
      throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
    }
    // v1.80.1: UNA identidad por sesión (§4.57.4): el `sid` viaja en el refresh y es el `jti` del dispositivo.
    const sid = randomUUID();
    const tokens = await this.issueTokens(user, sid);
    return { user: this.publicUser(user), ...tokens, deviceToken: await this.devices.issue(user.id, sid) };
  }

  /**
   * Login/registro con ID token de Google (ARCHITECTURE §4.7, API_CONTRACT §auth/google).
   * Verifica el token server-side (aud/iss/exp/firma + email_verified). El `role` se asigna
   * SIEMPRE server-side (customer para altas nuevas); NUNCA se lee del token. Account-linking
   * por email verificado. Mismo shape de respuesta que /auth/login.
   */
  async google(idToken: string) {
    const identity = await this.googleVerifier.verify(idToken);
    // email_verified obligatorio: sin él no se crea NI se enlaza (evita apropiación de cuenta).
    if (!identity.emailVerified) {
      throw BusinessException.forbidden('GOOGLE_EMAIL_UNVERIFIED', 'Google email not verified');
    }
    const email = identity.email.toLowerCase();

    // 1) Por googleId (ya enlazada anteriormente).
    let user = await this.prisma.user.findUnique({ where: { googleId: identity.sub } });

    // 2) Account-linking por email verificado a una cuenta local existente.
    if (!user) {
      const byEmail = await this.prisma.user.findUnique({ where: { email } });
      if (byEmail) {
        if (byEmail.status === UserStatus.blocked || byEmail.status === UserStatus.deleted) {
          throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
        }
        user = await this.prisma.user.update({
          where: { id: byEmail.id },
          data: {
            googleId: identity.sub,
            emailVerified: true,
            avatarUrl: byEmail.avatarUrl ?? identity.picture ?? null,
          },
        });
        await this.audit.log({
          actorUserId: user.id,
          actorRole: user.role,
          action: 'auth.google_link',
          entityType: 'User',
          entityId: user.id,
        });
      }
    }

    // 3) Alta nueva (solo-Google): passwordHash null, emailVerified true, role SIEMPRE customer.
    if (!user) {
      // v1.67 (D-CTA-4, §4.47.5): si Google no mandó nombre, se sigue derivando del correo (un `name`
      // vacío rompe copys) pero se MARCA `nameSource='derived'` para que no parezca tecleado. Un `name`
      // en blanco del token cuenta como ausente (no se guarda "" ni se marca `google`).
      const googleName = identity.name?.trim() || null;
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: null,
          name: googleName ?? email.split('@')[0],
          nameSource: googleName ? NameSource.google : NameSource.derived,
          role: Role.customer,
          authProvider: AuthProvider.google,
          googleId: identity.sub,
          emailVerified: true,
          avatarUrl: identity.picture ?? null,
        },
      });
    }

    if (user.status === UserStatus.blocked || user.status === UserStatus.deleted) {
      throw BusinessException.forbidden('USER_BLOCKED', 'User is blocked');
    }
    const sid = randomUUID();
    const tokens = await this.issueTokens(user, sid);
    // v1.80 (C7): mismo shape que /auth/login ⇒ también trae `deviceToken`. Google NO entra al
    // contador por cuenta (§4.57.2 #12): no hay contraseña que adivinar. v1.80.1: `jti` = `sid`.
    return { user: this.publicUser(user), ...tokens, deviceToken: await this.devices.issue(user.id, sid) };
  }

  async refresh(refreshToken: string): Promise<TokenPair & { deviceToken: string }> {
    try {
      const payload = await this.jwt.verifyAsync<{
        sub?: unknown; typ?: unknown; tv?: unknown; sid?: unknown; iat?: unknown; sat?: unknown; exp?: unknown;
      }>(
        refreshToken,
        {
          secret: this.config.get<string>('JWT_REFRESH_SECRET'),
          // S-B4: solo se acepta HS256 al verificar (evita algorithm-confusion).
          algorithms: ['HS256'],
          // v1.84 (LIVE-2): la caducidad se comprueba ABAJO, a mano y DESPUÉS del tope de sesión. Con
          // `exp = min(now + TTL, sat + tope)` el refresh siempre caduca justo en el tope; si `jsonwebtoken`
          // lo rechazara aquí, el `401` saldría sin `reason` y SES-1/SES-2 (día 31 / día 8 ⇒
          // `session_max_age`) serían inalcanzables. ⛔ Un token caducado NUNCA emite par: solo cambia el
          // `reason` del 401.
          ignoreExpiration: true,
        },
      );
      // SEC-C7-RT (2026-09-29): la firma no basta. `env.validation` no impide que los dos secretos
      // JWT coincidan, y un `{ typ: "device" }` firmado con la llave de refresh tal cual verifica
      // igual (C7-10). Solo entra lo que `issueTokens` emitió como refresh: `typ === 'refresh'` y
      // `tv` NUMÉRICO. Antes `(tv ?? 0)` convertía «sin tv» en «versión 0» y casaba con cuentas
      // que nunca revocaron sesión.
      if (payload.typ !== 'refresh' || typeof payload.tv !== 'number' || typeof payload.sub !== 'string') {
        throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid refresh token');
      }
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
      if (
        !user ||
        user.status === UserStatus.blocked ||
        user.status === UserStatus.deleted ||
        // v1.3.1: revocación por versión — un refresh con `tv` previo (reset/soft-delete) ya no vale.
        payload.tv !== user.tokenVersion
      ) {
        throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid refresh token');
      }
      // v1.80 (C7): +deviceToken — los navegadores con sesión abierta el día del despliegue reciben
      // su dispositivo conocido en el siguiente refresco, sin esperar a un login (§4.57.4).
      // v1.80.1 (SEC-C7-MINT): el dispositivo es el MISMO con `exp` renovado: `jti` = el `sid` que
      // trae el refresh token, y el par nuevo lo hereda. Antes cada refresco acuñaba un `jti` nuevo
      // y con él 5 intentos libres (seguridad: 30/30 a argon2). Tokens emitidos antes de esta rev
      // (sin `sid`, viven ≤ 30 d): `sid = "legacy:" + sub + ":" + iat`, determinista — reproducir
      // el mismo token da el mismo cubo. Sunset de la rama legado: TECH_DEBT (30 d tras el despliegue).
      const sid = AuthService.sessionIdOf(payload);
      if (sid === null) throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid refresh token');
      // v1.84 (LIVE-2, §14.2 pasos 2-3): tope ABSOLUTO desde el nacimiento de la sesión, con el rol
      // ACTUAL (el de BD, no el del token: un cliente ascendido a staff cae al tope de staff — SES-5).
      const sat = AuthService.sessionStartOf(payload);
      if (sat === null) throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid refresh token');
      const nowSec = Math.floor(Date.now() / 1000);
      // v1.84.1 (§14.14 E-1): `>=`, la MISMA frontera que `now >= exp` de abajo. Como el último refresh lleva
      // `exp = sat + tope`, con `>` el segundo exacto `now = sat + tope` caía en la caducidad ⇒ 401 SIN reason (SES-7).
      if (nowSec - sat >= sessionMaxAgeSeconds(user.role)) {
        throw new BusinessException('UNAUTHENTICATED', 401, 'Session max age exceeded', {
          reason: SESSION_MAX_AGE_REASON,
        });
      }
      // Caducidad normal (la que `jsonwebtoken` hacía con `ignoreExpiration: false`: `now >= exp`).
      if (typeof payload.exp !== 'number' || nowSec >= payload.exp) {
        throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or expired refresh token');
      }
      // Paso 4: mismo `sid` y mismo `sat`; `issueTokens` acota el `exp` al tope.
      const tokens = await this.issueTokens(user, sid, sat);
      return { ...tokens, deviceToken: await this.devices.issue(user.id, sid) };
    } catch (e) {
      if (e instanceof BusinessException) throw e;
      throw new BusinessException('UNAUTHENTICATED', 401, 'Invalid or expired refresh token');
    }
  }

  /**
   * v1.84 (LIVE-2, §14.2 paso 2): el `sat` (nacimiento de la sesión, segundos epoch) de un refresh ya
   * verificado. Claim numérico ⇒ ése; AUSENTE (token pre-v1.84) ⇒ `iat` del token presentado
   * (determinista: el legado gana como mucho un tope completo desde su último refresco); presente pero no
   * numérico, o sin `iat` ⇒ `null` (401).
   */
  static sessionStartOf(payload: { sat?: unknown; iat?: unknown }): number | null {
    if (typeof payload.sat === 'number' && Number.isFinite(payload.sat)) return Math.floor(payload.sat);
    if (payload.sat !== undefined) return null;
    return typeof payload.iat === 'number' && Number.isFinite(payload.iat) ? Math.floor(payload.iat) : null;
  }

  /**
   * v1.80.1: el `sid` de un refresh token ya verificado. Con claim `sid` (string no vacío) ⇒ ése;
   * sin él (legado) ⇒ `"legacy:" + sub + ":" + iat`; sin `iat` numérico no hay de dónde derivar la
   * sesión ⇒ `null` (401). Función pura y estática: la prueba C7-21 fija la fórmula.
   */
  static sessionIdOf(payload: { sub?: unknown; sid?: unknown; iat?: unknown }): string | null {
    if (typeof payload.sid === 'string' && payload.sid.length > 0) return payload.sid;
    if (typeof payload.sub !== 'string' || typeof payload.iat !== 'number') return null;
    return `legacy:${payload.sub}:${payload.iat}`;
  }
}
