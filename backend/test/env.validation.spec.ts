/**
 * env.validation — patrón fail-fast local/no-local. Cubre el cierre del footgun de config
 * (techlead+seguridad): `APP_BASE_URL` es OBLIGATORIA en entornos no-locales (staging/prod),
 * para que un prod que la olvide NO arranque en verde sirviendo CORS solo-localhost. En local
 * (development/test/local o sin NODE_ENV) las claves faltantes NO abortan (dev/CI sin secretos).
 */

import { validateEnv } from '../src/config/env.validation';

/** Set completo de requeridas en no-local, con secretos JWT de longitud válida (≥32). */
function fullEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db?schema=public',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    STRIPE_SECRET_KEY: 'sk_live_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
    APP_BASE_URL: 'https://app.tcghunt.mx',
    RESEND_API_KEY: 're_live_x',
    ...overrides,
  };
}

describe('validateEnv — fail-fast por entorno', () => {
  describe('entorno NO-local (production/staging)', () => {
    it('arranca cuando están todas las requeridas (incluida APP_BASE_URL)', () => {
      expect(() => validateEnv(fullEnv())).not.toThrow();
    });

    it('FALLA si falta APP_BASE_URL', () => {
      const env = fullEnv();
      delete env.APP_BASE_URL;
      expect(() => validateEnv(env)).toThrow(/APP_BASE_URL/);
    });

    it('FALLA si falta APP_BASE_URL también en staging', () => {
      const env = fullEnv({ NODE_ENV: 'staging' });
      delete env.APP_BASE_URL;
      expect(() => validateEnv(env)).toThrow(/APP_BASE_URL/);
    });

    it('sigue fallando por las demás requeridas (DATABASE_URL, JWT, Stripe)', () => {
      const env = fullEnv();
      delete env.DATABASE_URL;
      delete env.STRIPE_WEBHOOK_SECRET;
      expect(() => validateEnv(env)).toThrow(/DATABASE_URL/);
      expect(() => validateEnv(env)).toThrow(/STRIPE_WEBHOOK_SECRET/);
    });

    it('FALLA si falta RESEND_API_KEY (v1.5: gatea la verificación de correo)', () => {
      const env = fullEnv();
      delete env.RESEND_API_KEY;
      expect(() => validateEnv(env)).toThrow(/RESEND_API_KEY/);
    });
  });

  describe('entorno local (development/test/local/sin NODE_ENV)', () => {
    it('NO exige APP_BASE_URL en development (fallback localhost es conveniencia de dev)', () => {
      expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
    });

    it('NO exige APP_BASE_URL en test', () => {
      expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    });

    it('NO exige APP_BASE_URL sin NODE_ENV', () => {
      expect(() => validateEnv({})).not.toThrow();
    });

    it('NO exige RESEND_API_KEY en local (degrada a NoopMailAdapter)', () => {
      expect(() => validateEnv({ NODE_ENV: 'development' })).not.toThrow();
      expect(() => validateEnv({ NODE_ENV: 'test' })).not.toThrow();
    });
  });
});
