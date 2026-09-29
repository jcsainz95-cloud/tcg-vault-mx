import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { hkdfSync, randomUUID } from 'crypto';

/** `info` de la derivación HKDF: separa el dominio del `deviceToken` del de access y refresh. */
export const DEVICE_TOKEN_HKDF_INFO = 'tcg-hunt/device-token/v1';

/** Vida del `deviceToken` (§4.57.4). */
export const DEVICE_TOKEN_TTL = '90d';

export interface VerifiedDevice {
  userId: string;
  jti: string;
}

/**
 * DeviceTokenService — C7 (v1.80), `ARCHITECTURE §4.57.4`: el «dispositivo conocido».
 *
 * JWT HS256 `{ typ: "device", sub, jti, iat, exp }`, 90 días, firmado con una llave DERIVADA:
 * `HKDF-SHA256(JWT_REFRESH_SECRET, salt = "", info = "tcg-hunt/device-token/v1", 32 bytes)`.
 * Cero secretos nuevos. La separación por `info` hace que un `deviceToken` no verifique como access
 * ni como refresh, ni al revés (C7-10). ⚠️ Rotar `JWT_REFRESH_SECRET` los invalida todos: aceptado.
 *
 * ⛔ **No autentica.** Solo elige qué contador mira el candado del login (§4.57.3). Sin estado, sin
 * tabla, y NO ligado a `tokenVersion` (cerrar sesión no tira la puerta del dueño).
 */
@Injectable()
export class DeviceTokenService {
  private cachedKey?: { from: string; key: Buffer };

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** La llave derivada. Se recalcula solo si cambia el secreto de origen (tests que lo varían). */
  private key(): Buffer {
    const secret = this.config.get<string>('JWT_REFRESH_SECRET') ?? '';
    if (!secret) throw new Error('JWT_REFRESH_SECRET is required to derive the device-token key');
    if (this.cachedKey?.from !== secret) {
      const key = Buffer.from(hkdfSync('sha256', secret, Buffer.alloc(0), DEVICE_TOKEN_HKDF_INFO, 32));
      this.cachedKey = { from: secret, key };
    }
    return this.cachedKey.key;
  }

  /**
   * v1.80.1 (`SEC-C7-MINT`, §4.57.10.1 a): `jti` = el `sid` de la SESIÓN cuando hay una
   * (`login`/`google`: nuevo; `refresh`: el heredado del refresh token) — así N refrescos devuelven
   * el mismo dispositivo con `exp` renovado, no N cubos. Sin `jti` (reset-password: no hay sesión)
   * se acuña uno aleatorio.
   */
  issue(userId: string, jti: string = randomUUID()): Promise<string> {
    if (typeof jti !== 'string' || jti.length === 0) throw new Error('deviceToken: jti must be a non-empty string');
    return this.jwt.signAsync(
      { typ: 'device', sub: userId, jti },
      { secret: this.key(), algorithm: 'HS256', expiresIn: DEVICE_TOKEN_TTL },
    );
  }

  /**
   * `null` si falta, está mal firmado, caducó o no es un `deviceToken`. ⛔ Nunca lanza: un token
   * malo se IGNORA (un error distinto diría algo sobre la cuenta, §4.57.3).
   */
  async verify(token: string | undefined | null): Promise<VerifiedDevice | null> {
    if (typeof token !== 'string' || token.length === 0) return null;
    try {
      const p = await this.jwt.verifyAsync<{ typ?: unknown; sub?: unknown; jti?: unknown }>(token, {
        secret: this.key(),
        algorithms: ['HS256'],
      });
      if (p.typ !== 'device' || typeof p.sub !== 'string' || typeof p.jti !== 'string') return null;
      if (p.sub.length === 0 || p.jti.length === 0) return null;
      return { userId: p.sub, jti: p.jti };
    } catch {
      return null;
    }
  }
}
