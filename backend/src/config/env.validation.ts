/**
 * env.validation.ts — Validación ligera de variables de entorno al arranque.
 * NO contiene diales de negocio (esos viven en ConfigSetting/DB). Ver ARCHITECTURE §8.
 */
export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  // B6: en producción exigimos también las claves de Stripe (secret + webhook). Nunca se
  // cae al `sk_test_dummy`: sin claves reales, la app NO arranca en producción.
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
  ];
  const missing = required.filter((k) => !config[k]);
  if (missing.length > 0 && config.NODE_ENV === 'production') {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }
  return config;
}
