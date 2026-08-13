import { ConfigService } from '@nestjs/config';
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

  it('en local (test) sin claves usa un fallback de desarrollo (no rompe el arranque)', () => {
    const svc = new PiiCryptoService(new ConfigService({}));
    expect(svc.decrypt(svc.encrypt(CLABE))).toBe(CLABE);
  });
});
