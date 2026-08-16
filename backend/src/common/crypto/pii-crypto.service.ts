import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  createHash,
  randomBytes,
  timingSafeEqual,
} from 'crypto';

/**
 * PiiCryptoService — Cifrado en reposo (AES-256-GCM) + blind index (HMAC-SHA256)
 * para datos personales sensibles (PII): CLABE, RFC, snapshot de CLABE.
 *
 * - Cifrado autenticado AES-256-GCM. Formato serializado: `v1:iv:tag:ciphertext`
 *   (cada campo en base64). El IV (12 bytes) es aleatorio por operación; el authTag
 *   (16 bytes) protege integridad/autenticidad.
 * - Blind index: HMAC-SHA256 con clave dedicada (`PII_HMAC_KEY`) sobre el valor
 *   NORMALIZADO. Permite igualar/buscar CLABE (match "a nombre propio") SIN descifrar.
 *
 * Claves (env):
 *   - `PII_ENCRYPTION_KEY`: 32 bytes en base64 (AES-256).
 *   - `PII_HMAC_KEY`: clave del HMAC (base64 recomendado; se aceptan >= 32 bytes).
 *
 * En entornos NO-locales (NODE_ENV ∉ {development,test,local}) el servicio FALLA claro
 * si faltan/están mal formadas. En local, si faltan, deriva claves de desarrollo
 * DETERMINISTAS (con aviso) para no bloquear el arranque; nunca deben usarse fuera de local.
 */
@Injectable()
export class PiiCryptoService {
  private readonly logger = new Logger(PiiCryptoService.name);
  private readonly encKey: Buffer; // 32 bytes
  private readonly hmacKey: Buffer;
  private static readonly VERSION = 'v1';
  private static readonly IV_BYTES = 12;
  private static readonly TAG_BYTES = 16;

  constructor(config: ConfigService) {
    this.encKey = this.resolveEncKey(config);
    this.hmacKey = this.resolveHmacKey(config);
  }

  private static isLocalEnv(): boolean {
    const env = process.env.NODE_ENV ?? 'development';
    return env === 'development' || env === 'test' || env === 'local';
  }

  private resolveEncKey(config: ConfigService): Buffer {
    const raw = config.get<string>('PII_ENCRYPTION_KEY');
    if (raw && raw.length > 0) {
      let key: Buffer;
      try {
        key = Buffer.from(raw, 'base64');
      } catch {
        throw new Error('PII_ENCRYPTION_KEY must be valid base64');
      }
      if (key.length !== 32) {
        throw new Error(
          `PII_ENCRYPTION_KEY must decode to exactly 32 bytes (got ${key.length}). ` +
            'Generate one with: openssl rand -base64 32',
        );
      }
      return key;
    }
    if (!PiiCryptoService.isLocalEnv()) {
      throw new Error(
        `PII_ENCRYPTION_KEY is required in a non-local environment (NODE_ENV=${process.env.NODE_ENV}). ` +
          'Refusing to start without a real 32-byte key. Generate: openssl rand -base64 32',
      );
    }
    this.logger.warn(
      'PII_ENCRYPTION_KEY not set — deriving a LOCAL-ONLY dev key. Do NOT use outside local development.',
    );
    return createHash('sha256').update('local-dev-pii-encryption-key').digest();
  }

  private resolveHmacKey(config: ConfigService): Buffer {
    const raw = config.get<string>('PII_HMAC_KEY');
    if (raw && raw.length > 0) {
      // Acepta base64 o texto plano; exige suficiente entropía (>= 32 bytes).
      const asB64 = Buffer.from(raw, 'base64');
      const key = asB64.length >= 32 ? asB64 : Buffer.from(raw, 'utf8');
      if (key.length < 32) {
        throw new Error('PII_HMAC_KEY must provide at least 32 bytes of key material');
      }
      return key;
    }
    if (!PiiCryptoService.isLocalEnv()) {
      throw new Error(
        `PII_HMAC_KEY is required in a non-local environment (NODE_ENV=${process.env.NODE_ENV}). ` +
          'Refusing to start without a real HMAC key. Generate: openssl rand -base64 32',
      );
    }
    this.logger.warn(
      'PII_HMAC_KEY not set — deriving a LOCAL-ONLY dev key. Do NOT use outside local development.',
    );
    return createHash('sha256').update('local-dev-pii-hmac-key').digest();
  }

  /** Cifra un valor en claro. Devuelve `v1:iv:tag:ciphertext` (base64 por campo). */
  encrypt(plaintext: string): string {
    const iv = randomBytes(PiiCryptoService.IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.encKey, iv, {
      authTagLength: PiiCryptoService.TAG_BYTES,
    });
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return [
      PiiCryptoService.VERSION,
      iv.toString('base64'),
      tag.toString('base64'),
      ct.toString('base64'),
    ].join(':');
  }

  /** Descifra un payload `v1:iv:tag:ciphertext`. Lanza si está manipulado/mal formado. */
  decrypt(payload: string): string {
    const parts = payload.split(':');
    if (parts.length !== 4 || parts[0] !== PiiCryptoService.VERSION) {
      throw new Error('Malformed PII ciphertext');
    }
    const iv = Buffer.from(parts[1], 'base64');
    const tag = Buffer.from(parts[2], 'base64');
    const ct = Buffer.from(parts[3], 'base64');
    // Endurecimiento GCM: exigimos exactamente 16 bytes de authTag ANTES de
    // setAuthTag. Un tag más corto debilitaría la autenticación (riesgo de forja).
    // Mismo mensaje genérico que el resto para no ofrecer un oráculo al atacante.
    if (tag.length !== PiiCryptoService.TAG_BYTES) {
      throw new Error('Malformed PII ciphertext');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.encKey, iv, {
      authTagLength: PiiCryptoService.TAG_BYTES,
    });
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  }

  /** Descifra tolerando `null/undefined` (devuelve `undefined`). */
  decryptOptional(payload?: string | null): string | undefined {
    if (!payload) return undefined;
    return this.decrypt(payload);
  }

  /**
   * Blind index determinista (HMAC-SHA256, hex) sobre el valor NORMALIZADO.
   * Para CLABE la normalización elimina cualquier no-dígito (defensa ante espacios).
   * Igual entrada ⇒ igual índice ⇒ permite comparar/buscar sin descifrar.
   */
  blindIndex(normalized: string): string {
    return createHmac('sha256', this.hmacKey).update(normalized).digest('hex');
  }

  /** Blind index específico de CLABE (normaliza a solo dígitos). */
  clabeBlindIndex(clabe: string): string {
    return this.blindIndex(clabe.replace(/\D/g, ''));
  }

  /** Compara dos blind index en tiempo constante. */
  blindIndexEquals(a?: string | null, b?: string | null): boolean {
    if (!a || !b) return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    if (ba.length !== bb.length) return false;
    return timingSafeEqual(ba, bb);
  }
}
