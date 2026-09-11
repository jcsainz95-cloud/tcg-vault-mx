/**
 * env.validation.ts — Validación ligera de variables de entorno al arranque.
 * NO contiene diales de negocio (esos viven en ConfigSetting/DB). Ver ARCHITECTURE §8.
 *
 * S-B4: la validación ahora corre SIEMPRE (antes solo con `NODE_ENV==='production'`), de modo
 * que staging queda cubierto igual que producción. Se mantiene el patrón local/no-local del
 * repo (seed, pii-crypto): en entornos locales (`development`/`test`/`local`) las claves faltantes
 * NO abortan el arranque (para no romper el dev/CI sin secretos reales); en cualquier entorno
 * NO-local (staging, production, …) sí abortan.
 *
 * ### S-88-2 (seguridad) — `NODE_ENV` AUSENTE ya no significa «local»
 *
 * Seguridad midió que con `NODE_ENV` ausente esta función **pasaba sin exigir NADA**: ni
 * `DATABASE_URL`, ni los secretos JWT, ni su entropía, ni Stripe, ni `APP_BASE_URL`, ni Resend.
 * Es la clase de defecto de `P-WH-1`: *la ausencia de una variable degrada en silencio a lo
 * permisivo*, y justo en el arranque que NO fija `NODE_ENV` (`npm run start:prod` →
 * `node dist/main.js`). Ahora **solo los tres valores locales EXPLÍCITOS** relajan; la ausencia
 * falla CERRADA y exige el set completo. Medido antes de cambiarlo: todos los arranques del arnés
 * fijan `NODE_ENV` explícitamente (`ci.yml`/`e2e.yml` → `test`, `docker-compose.yml` y
 * `stack-native.sh` → `development`, jest → `test`), así que esto no rompe ninguno.
 *
 * Las claves de PII entran a la lista de requeridas: `PiiCryptoService` ya abortaba por su cuenta
 * en no-local, así que esto no añade un fallo nuevo — lo adelanta al arranque y con mejor mensaje.
 */

const LOCAL_ENVS = new Set(['development', 'test', 'local']);

/** Longitud mínima recomendada para secretos JWT (defensa en profundidad, S-B4). */
const MIN_JWT_SECRET_LENGTH = 32;

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const nodeEnv = typeof config.NODE_ENV === 'string' ? config.NODE_ENV : undefined;
  // S-88-2: la AUSENCIA no relaja. Solo relajan los tres valores locales explícitos.
  const isLocal = nodeEnv !== undefined && LOCAL_ENVS.has(nodeEnv);

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
    // S-88-2: cifrado en reposo de CLABE/RFC. `PiiCryptoService` ya se niega a arrancar sin ellas
    // fuera del arnés (y ya no existe respaldo derivable); aquí el fallo llega antes y nombra
    // ambas de una vez en lugar de una por reinicio.
    'PII_ENCRYPTION_KEY',
    'PII_HMAC_KEY',
  ];

  // v1.14-price-ingest (WS-A, §4.15h): `POKEMONPRICETRACKER_API_KEY` es requisito operativo en
  // no-local SOLO cuando el proveedor de ingest es el de PAGA. La AUTORIDAD en runtime es el dial
  // `price_provider` (BD, editable sin redeploy) — que env.validation no puede leer — por eso el
  // fail-fast se activa con un HINT de env `PRICE_PROVIDER=pokemonpricetracker` (opt-in de devops).
  // Sin el hint, la key queda OPCIONAL y el ingest degrada seguro (no escribe, precios STALE + log),
  // NUNCA borra precios ni cae en fallback silencioso a otra fuente.
  if (config.PRICE_PROVIDER === 'pokemonpricetracker') {
    required.push('POKEMONPRICETRACKER_API_KEY');
  }

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
