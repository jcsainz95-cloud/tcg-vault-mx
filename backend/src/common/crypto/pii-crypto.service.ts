import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
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
 * ### S-88-2 (seguridad, blue team) — las claves ya NO cuelgan de `NODE_ENV`
 *
 * Este servicio tenía **el mismo defecto de clase que `P-WH-1`**: la protección se condicionaba a
 * `NODE_ENV`, y su AUSENCIA degradaba —en silencio, con un `warn`— a algo que no protege. Con
 * `NODE_ENV` ausente/`development`/`test`/`local` y sin claves, derivaba
 * `sha256('local-dev-pii-encryption-key')`: una cadena **escrita en este repositorio, que es
 * público**. Seguridad lo demostró descifrando una CLABE sintética con solo el literal del repo.
 * Cifrar con una clave publicada no es cifrar.
 *
 * El arreglo es el mismo de `stripe.service.ts` (707c4f4) y mantiene DOS casos que son distintos
 * —confundirlos rompe el arnés sin cerrar nada—:
 *
 *  - **«Este proceso no tiene claves de verdad»** (arnés local/CI, datos sintéticos y desechables):
 *    permitido. La app arranca sin configurar nada, como hasta ahora.
 *  - **«Protejo PII con una clave que cualquiera puede derivar del repo»**: prohibido SIEMPRE, en
 *    todos los entornos. Ya no existe esa clave.
 *
 * Dos mecanismos, independientes:
 *
 * 1. **El respaldo dejó de ser derivable.** Sin claves configuradas se genera una clave
 *    **EFÍMERA ALEATORIA por proceso** (`randomBytes(32)`, compartida por todas las instancias del
 *    mismo proceso para que el arnés funcione). Ninguna cadena de este repo descifra nada, con
 *    cualquier `NODE_ENV`. Y como la clave muere con el proceso, un entorno con datos REALES que
 *    olvide las claves **falla ruidoso** al leer la primera fila existente (el GCM no autentica),
 *    en vez de seguir «cifrando» con una clave publicada.
 * 2. **La exigencia cuelga del HECHO, no de `NODE_ENV`.** Las claves son obligatorias si
 *    (a) `NODE_ENV` es `production`/`staging`; (b) `NODE_ENV` **falta** —la ausencia ya no degrada
 *    a permisiva: solo los tres valores locales EXPLÍCITOS cuentan como arnés—; o (c) hay una clave
 *    Stripe **LIVE** (`sk_live_`/`rk_live_`): si se cobra dinero real hay personas reales, y su
 *    CLABE/RFC no puede depender de qué diga `NODE_ENV`.
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

  /**
   * Entornos que cuentan como ARNÉS. Se listan EXPLÍCITAMENTE: `NODE_ENV` ausente NO está aquí.
   * (Mismo criterio fail-safe que `config/test-env.ts` y que `config/env.validation.ts`.)
   */
  private static readonly HARNESS_ENVS = new Set(['development', 'test', 'local']);

  /**
   * Clave EFÍMERA por PROCESO (no por instancia): sin claves configuradas, todas las instancias
   * del mismo proceso comparten la misma para que el arnés —que construye varias— siga cerrando
   * el round-trip. Se genera perezosamente y **no es derivable de nada publicado**.
   */
  private static ephemeralEncKey?: Buffer;
  private static ephemeralHmacKey?: Buffer;

  /**
   * ¿Este proceso maneja PII que NO es desechable? El hecho, no `NODE_ENV` a secas.
   *
   * `true` (claves obligatorias, fail-fast de arranque) si:
   *  - `NODE_ENV` es un entorno no-local (`production`, `staging`, cualquier valor desconocido), **o**
   *  - `NODE_ENV` **falta** (la ausencia falla CERRADA: `node dist/main.js` sin `NODE_ENV` era el
   *    escenario exacto que seguridad midió como desprotegido), **o**
   *  - hay una clave Stripe **LIVE**: se cobra dinero real ⇒ hay clientes reales ⇒ su CLABE/RFC es
   *    PII real, diga lo que diga `NODE_ENV`.
   */
  private static keysRequired(config: ConfigService): { required: boolean; reason: string } {
    const nodeEnv = process.env.NODE_ENV;
    if (nodeEnv === undefined || nodeEnv.trim() === '') {
      return { required: true, reason: 'NODE_ENV ausente (la ausencia no degrada a local)' };
    }
    if (!PiiCryptoService.HARNESS_ENVS.has(nodeEnv)) {
      return { required: true, reason: `NODE_ENV=${nodeEnv} (entorno no-local)` };
    }
    const stripeKey = (config.get<string>('STRIPE_SECRET_KEY') ?? '').trim();
    if (/^(sk|rk)_live_/.test(stripeKey)) {
      return {
        required: true,
        reason: `hay una clave Stripe LIVE (NODE_ENV=${nodeEnv} no exime: si se cobra dinero real, la PII es real)`,
      };
    }
    return { required: false, reason: `arnés local (NODE_ENV=${nodeEnv}, sin Stripe live)` };
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
    const { required, reason } = PiiCryptoService.keysRequired(config);
    if (required) {
      throw new Error(
        `PII_ENCRYPTION_KEY is required here: ${reason}. Refusing to start without a real 32-byte ` +
          'key: there is no derivable fallback. Generate: openssl rand -base64 32',
      );
    }
    this.logger.warn(
      'PII_ENCRYPTION_KEY not set — using an EPHEMERAL random key for this process ' +
        `(${reason}). Anything encrypted now is UNREADABLE after a restart; set PII_ENCRYPTION_KEY ` +
        'if this environment keeps data.',
    );
    if (!PiiCryptoService.ephemeralEncKey) {
      PiiCryptoService.ephemeralEncKey = randomBytes(32);
    }
    return PiiCryptoService.ephemeralEncKey;
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
    const { required, reason } = PiiCryptoService.keysRequired(config);
    if (required) {
      throw new Error(
        `PII_HMAC_KEY is required here: ${reason}. Refusing to start without a real HMAC key: ` +
          'there is no derivable fallback. Generate: openssl rand -base64 32',
      );
    }
    this.logger.warn(
      'PII_HMAC_KEY not set — using an EPHEMERAL random key for this process ' +
        `(${reason}). Blind indexes written now will NOT match after a restart; set PII_HMAC_KEY ` +
        'if this environment keeps data.',
    );
    if (!PiiCryptoService.ephemeralHmacKey) {
      PiiCryptoService.ephemeralHmacKey = randomBytes(32);
    }
    return PiiCryptoService.ephemeralHmacKey;
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
