/**
 * setup.ts — Preparación del entorno para la suite de integración/E2E.
 * Propiedad: backend. Se carga vía `setupFilesAfterEnv` (jest-integration.config.js).
 *
 * Establece defaults SEGUROS para variables no críticas si CI/local no las provee,
 * de modo que la app arranque. Las variables de INFRA REAL (DATABASE_URL, REDIS_URL,
 * S3_*) las provee devops; si `DATABASE_URL` falta, la suite fallará explícitamente
 * (es un test de "realidad": exige infra).
 */
jest.setTimeout(30000);

// Secretos/valores dummy para que la app arranque (NO se usan contra red real salvo
// el webhook, que verifica firma con STRIPE_WEBHOOK_SECRET — debe ser estable).
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_e2e_test_secret';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_e2e_dummy';
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_e2e_dummy';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'e2e_access_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'e2e_refresh_secret';
process.env.DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'es';

if (!process.env.DATABASE_URL) {
  // Aviso temprano y claro: la suite E2E requiere Postgres real.
  // eslint-disable-next-line no-console
  console.warn(
    '[e2e] DATABASE_URL no está definida. La suite de integración requiere Postgres real ' +
      '(docker compose up -d + prisma migrate deploy). Ver docs/BACKEND_NOTES.md §Integración.',
  );
}
