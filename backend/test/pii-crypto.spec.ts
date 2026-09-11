import { ConfigService } from '@nestjs/config';
import { createDecipheriv, createHash, createHmac } from 'crypto';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * Cifrado en reposo (AES-256-GCM) + blind index (HMAC-SHA256) de PII.
 * Round-trip, formato versionado, detección de manipulación, y determinismo del índice.
 */
describe('PiiCryptoService', () => {
  const CLABE = '012345678901234567';

  function withKeys() {
    // Claves reales de 32 bytes (base64) para no depender del fallback de desarrollo.
    const encKey = Buffer.alloc(32, 7).toString('base64');
    const hmacKey = Buffer.alloc(32, 9).toString('base64');
    return new PiiCryptoService(
      new ConfigService({ PII_ENCRYPTION_KEY: encKey, PII_HMAC_KEY: hmacKey }),
    );
  }

  it('round-trip: descifrar(cifrar(x)) === x', () => {
    const svc = withKeys();
    expect(svc.decrypt(svc.encrypt(CLABE))).toBe(CLABE);
    expect(svc.decrypt(svc.encrypt('XAXX010101000'))).toBe('XAXX010101000');
    expect(svc.decrypt(svc.encrypt(''))).toBe('');
  });

  it('formato versionado v1:iv:tag:ct y ciphertext distinto en cada cifrado (IV aleatorio)', () => {
    const svc = withKeys();
    const a = svc.encrypt(CLABE);
    const b = svc.encrypt(CLABE);
    expect(a.split(':')).toHaveLength(4);
    expect(a.startsWith('v1:')).toBe(true);
    expect(a).not.toBe(b); // IV aleatorio ⇒ ciphertext no determinista
    expect(a).not.toContain(CLABE); // nunca el valor en claro
  });

  it('detecta manipulación del authTag (GCM) y del formato', () => {
    const svc = withKeys();
    const enc = svc.encrypt(CLABE);
    const parts = enc.split(':');
    // Corrompe el ciphertext.
    const tampered = [parts[0], parts[1], parts[2], Buffer.from('deadbeef').toString('base64')].join(':');
    expect(() => svc.decrypt(tampered)).toThrow();
    expect(() => svc.decrypt('garbage')).toThrow();
    expect(() => svc.decrypt('v2:a:b:c')).toThrow();
  });

  it('rechaza un authTag GCM truncado (longitud != 16) sin distinguir el motivo', () => {
    const svc = withKeys();
    const enc = svc.encrypt(CLABE);
    const parts = enc.split(':');
    // authTag legítimo es de 16 bytes; lo truncamos a 12.
    const fullTag = Buffer.from(parts[2], 'base64');
    expect(fullTag).toHaveLength(16);
    const truncated = [
      parts[0],
      parts[1],
      fullTag.subarray(0, 12).toString('base64'), // 12 bytes → debe rechazarse
      parts[3],
    ].join(':');
    // No descifra: se rechaza antes de setAuthTag, con el mensaje genérico
    // (mismo que un payload mal formado, para no ofrecer un oráculo).
    expect(() => svc.decrypt(truncated)).toThrow('Malformed PII ciphertext');

    // Un tag vacío o sobredimensionado tampoco pasa.
    const emptyTag = [parts[0], parts[1], '', parts[3]].join(':');
    expect(() => svc.decrypt(emptyTag)).toThrow('Malformed PII ciphertext');
    const longTag = [
      parts[0],
      parts[1],
      Buffer.concat([fullTag, Buffer.alloc(4)]).toString('base64'), // 20 bytes
      parts[3],
    ].join(':');
    expect(() => svc.decrypt(longTag)).toThrow('Malformed PII ciphertext');
  });

  it('decryptOptional tolera null/undefined', () => {
    const svc = withKeys();
    expect(svc.decryptOptional(null)).toBeUndefined();
    expect(svc.decryptOptional(undefined)).toBeUndefined();
    expect(svc.decryptOptional(svc.encrypt(CLABE))).toBe(CLABE);
  });

  it('blind index: determinista, normaliza no-dígitos, y compara en tiempo constante', () => {
    const svc = withKeys();
    const idx = svc.clabeBlindIndex(CLABE);
    expect(idx).toBe(svc.clabeBlindIndex(CLABE)); // determinista
    // Normaliza espacios/guiones a la misma CLABE.
    expect(svc.clabeBlindIndex('0123 4567-8901 234567')).toBe(idx);
    // Distinta CLABE ⇒ distinto índice.
    expect(svc.clabeBlindIndex('111122223333444455')).not.toBe(idx);
    expect(svc.blindIndexEquals(idx, idx)).toBe(true);
    expect(svc.blindIndexEquals(idx, svc.clabeBlindIndex('111122223333444455'))).toBe(false);
    expect(svc.blindIndexEquals(idx, null)).toBe(false);
  });

  it('llaves distintas ⇒ blind index distinto (la clave HMAC importa)', () => {
    const a = new PiiCryptoService(
      new ConfigService({
        PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
        PII_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
      }),
    );
    const b = new PiiCryptoService(
      new ConfigService({
        PII_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
        PII_HMAC_KEY: Buffer.alloc(32, 3).toString('base64'),
      }),
    );
    expect(a.clabeBlindIndex(CLABE)).not.toBe(b.clabeBlindIndex(CLABE));
  });

  it('rechaza PII_ENCRYPTION_KEY con longitud incorrecta', () => {
    expect(
      () =>
        new PiiCryptoService(
          new ConfigService({
            PII_ENCRYPTION_KEY: Buffer.alloc(16, 1).toString('base64'), // 16 bytes, no 32
            PII_HMAC_KEY: Buffer.alloc(32, 2).toString('base64'),
          }),
        ),
    ).toThrow(/32 bytes/);
  });

  it('en NO-local, FALLA claro si faltan las claves', () => {
    const prev = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(/PII_ENCRYPTION_KEY is required/);
    } finally {
      process.env.NODE_ENV = prev;
    }
  });

  it('en local (test) sin claves arranca (el arnés no necesita claves de produccion)', () => {
    const svc = new PiiCryptoService(new ConfigService({}));
    expect(svc.decrypt(svc.encrypt(CLABE))).toBe(CLABE);
  });
});

/**
 * S-88-2 (seguridad) — las claves de PII colgaban de `NODE_ENV` y su AUSENCIA degradaba a una
 * clave DERIVABLE DEL REPO (`sha256('local-dev-pii-encryption-key')`). Misma clase que `P-WH-1`.
 *
 * Estos tests son el candado de las DOS mitades del arreglo:
 *  (1) el respaldo ya no es derivable de ninguna cadena publicada — es aleatorio por proceso;
 *  (2) la exigencia cuelga del HECHO (ausencia de `NODE_ENV`, entorno no-local, Stripe LIVE),
 *      sin romper el arnés local/CI, que DEBE seguir arrancando sin claves.
 */
describe('PiiCryptoService — S-88-2: las claves NO cuelgan de NODE_ENV', () => {
  const CLABE = '012345678901234567';
  const prevEnv = process.env.NODE_ENV;
  const prevStripe = process.env.STRIPE_SECRET_KEY;

  afterEach(() => {
    if (prevEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = prevEnv;
    if (prevStripe === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = prevStripe;
  });

  // ---- (1) el respaldo dejó de ser derivable ----

  it('el fallback NO es la clave del repo: lo que cifra no se descifra con sha256(literal)', () => {
    process.env.NODE_ENV = 'test';
    const svc = new PiiCryptoService(new ConfigService({}));
    const payload = svc.encrypt(CLABE);

    // El PoC EXACTO de seguridad: derivar la clave con la cadena que vive en el repo publico.
    const repoKey = createHash('sha256').update('local-dev-pii-encryption-key').digest();
    const [, ivB64, tagB64, ctB64] = payload.split(':');
    const decipher = createDecipheriv('aes-256-gcm', repoKey, Buffer.from(ivB64, 'base64'), {
      authTagLength: 16,
    });
    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
    expect(() =>
      Buffer.concat([decipher.update(Buffer.from(ctB64, 'base64')), decipher.final()]),
    ).toThrow(); // GCM no autentica ⇒ el literal del repo ya no abre nada
  });

  it('el blind index tampoco se reproduce con la cadena del repo (el indice sigue ciego)', () => {
    process.env.NODE_ENV = 'test';
    const svc = new PiiCryptoService(new ConfigService({}));
    const repoHmacKey = createHash('sha256').update('local-dev-pii-hmac-key').digest();
    const derivable = createHmac('sha256', repoHmacKey).update(CLABE).digest('hex');
    expect(svc.clabeBlindIndex(CLABE)).not.toBe(derivable);
  });

  it('el fallback efimero es ESTABLE dentro del proceso: dos instancias se entienden', () => {
    process.env.NODE_ENV = 'test';
    const a = new PiiCryptoService(new ConfigService({}));
    const b = new PiiCryptoService(new ConfigService({}));
    // Si la clave fuera por-instancia, el arnes (que construye una por spec) se rompería.
    expect(b.decrypt(a.encrypt(CLABE))).toBe(CLABE);
    expect(b.clabeBlindIndex(CLABE)).toBe(a.clabeBlindIndex(CLABE));
  });

  // ---- (2) la exigencia cuelga del hecho ----

  it('NODE_ENV AUSENTE ya no es "local": exige las claves (era el agujero medido)', () => {
    delete process.env.NODE_ENV;
    expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(
      /PII_ENCRYPTION_KEY is required here: NODE_ENV ausente/,
    );
  });

  it('NODE_ENV vacio ("") tampoco cuela', () => {
    process.env.NODE_ENV = '   ';
    expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(/PII_ENCRYPTION_KEY is required/);
  });

  it.each(['production', 'staging', 'preprod'])('%s exige las claves', (env) => {
    process.env.NODE_ENV = env;
    expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(/PII_ENCRYPTION_KEY is required/);
  });

  it('con Stripe LIVE, ni "development" exime: dinero real ⇒ PII real', () => {
    process.env.NODE_ENV = 'development';
    process.env.STRIPE_SECRET_KEY = 'sk_live_deadbeef';
    expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(/Stripe LIVE/);
    process.env.STRIPE_SECRET_KEY = 'rk_live_deadbeef';
    expect(() => new PiiCryptoService(new ConfigService({}))).toThrow(/Stripe LIVE/);
  });

  it('la HMAC se exige con el MISMO criterio (no basta con poner solo la de cifrado)', () => {
    delete process.env.NODE_ENV;
    expect(
      () =>
        new PiiCryptoService(
          new ConfigService({ PII_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString('base64') }),
        ),
    ).toThrow(/PII_HMAC_KEY is required here: NODE_ENV ausente/);
  });

  // ---- la asimetria deliberada: el arnes NO se rompe ----

  it.each(['development', 'test', 'local'])(
    '%s con Stripe de PRUEBA sigue arrancando sin claves (arnes local/CI intacto)',
    (env) => {
      process.env.NODE_ENV = env;
      process.env.STRIPE_SECRET_KEY = 'sk_test_e2e_dummy';
      const svc = new PiiCryptoService(new ConfigService({}));
      expect(svc.decrypt(svc.encrypt(CLABE))).toBe(CLABE);
    },
  );

  it('con claves REALES cargadas, ningun entorno falla (incluido NODE_ENV ausente)', () => {
    delete process.env.NODE_ENV;
    const svc = new PiiCryptoService(
      new ConfigService({
        PII_ENCRYPTION_KEY: Buffer.alloc(32, 5).toString('base64'),
        PII_HMAC_KEY: Buffer.alloc(32, 6).toString('base64'),
      }),
    );
    expect(svc.decrypt(svc.encrypt(CLABE))).toBe(CLABE);
  });
});
