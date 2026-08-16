/**
 * env.validation.ts — Validación ligera de variables de entorno al arranque.
 * NO contiene diales de negocio (esos viven en ConfigSetting/DB). Ver ARCHITECTURE §8.
 *
 * S-B4: la validación ahora corre SIEMPRE (antes solo con `NODE_ENV==='production'`), de modo
 * que staging queda cubierto igual que producción. Se mantiene el patrón local/no-local del
 * repo (seed, pii-crypto): en entornos locales (`development`/`test`/`local` o sin `NODE_ENV`)
 * las claves faltantes NO abortan el arranque (para no romper el dev/CI sin secretos reales);
 * en cualquier entorno NO-local (staging, production, …) sí abortan.
 */

const LOCAL_ENVS = new Set(['development', 'test', 'local']);

/** Longitud mínima recomendada para secretos JWT (defensa en profundidad, S-B4). */
const MIN_JWT_SECRET_LENGTH = 32;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = typeof config.NODE_ENV === 'string' ? config.NODE_ENV : undefined;
  const isLocal = nodeEnv === undefined || LOCAL_ENVS.has(nodeEnv);

  // Requeridas en todo entorno NO-local (incluye staging y production). Nunca se cae a
  // dummies: sin claves reales, la app NO arranca fuera de local.
  //
  // `APP_BASE_URL` va aquí (footgun de config cerrado por techlead+seguridad): sin ella, la
  // allow-list de CORS en `main.ts` cae al fallback solo-localhost, un prod arranca "en verde"
  // pero bloquea al frontend real por CORS (síntoma difícil de diagnosticar). El fallback a
  // localhost queda SOLO como conveniencia de dev/test.
  // `RESEND_API_KEY` (v1.5): la verificación de correo GATEA dinero (comprar/vender/retirar).
  // Si el correo degradara en no-local, los usuarios nunca podrían verificar → quedarían
  // bloqueados. Por eso es requerida en NO-local (staging+prod); en LOCAL_ENVS puede faltar y
  // el módulo `mail` degrada a NoopMailAdapter. `MAIL_FROM` es opcional (default en código).
  const required = [
    'DATABASE_URL',
    'JWT_ACCESS_SECRET',
    'JWT_REFRESH_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'APP_BASE_URL',
    'RESEND_API_KEY',
  ];

  if (!isLocal) {
    const missing = required.filter((k) => !config[k]);
    if (missing.length > 0) {
      throw new Error(`Missing required env vars: ${missing.join(', ')}`);
    }

    // Entropía mínima de los secretos JWT (evita secretos débiles en staging/prod).
    const weakSecrets = (['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const).filter((k) => {
      const v = config[k];
      return typeof v === 'string' && v.length < MIN_JWT_SECRET_LENGTH;
    });
    if (weakSecrets.length > 0) {
      throw new Error(
        `Weak JWT secret(s) (min ${MIN_JWT_SECRET_LENGTH} chars): ${weakSecrets.join(', ')}`,
      );
    }
  }

  return config;
}
