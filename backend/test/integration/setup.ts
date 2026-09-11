/**
 * setup.ts — Preparación del entorno para la suite de integración/E2E.
 * Propiedad: backend. Se carga vía `setupFilesAfterEnv` (jest-integration.config.js).
 *
 * Establece defaults SEGUROS para variables no críticas si CI/local no las provee,
 * de modo que la app arranque. Las variables de INFRA REAL (DATABASE_URL, REDIS_URL,
 * S3_*) las provee devops.
 *
 * ### v1.53-b — el aviso de `DATABASE_URL` gritaba «no está definida» en TODA corrida VERDE
 *
 * El docstring anterior afirmaba que «si `DATABASE_URL` falta, la suite fallará explícitamente».
 * **No fallaba: sólo hacía `console.warn`** — otro comentario describiendo un mundo que no existe.
 * Y el aviso saltaba SIEMPRE, incluso con Postgres perfectamente levantado, porque este archivo leía
 * `process.env.DATABASE_URL` **antes** de que `@prisma/client` cargara `.env` por su cuenta. Así que
 * las 16 suites imprimían «la suite de integración requiere Postgres real» mientras corrían, en
 * verde, contra Postgres real.
 *
 * Eso no es cosmético: entrena a quien lee la salida a ignorar el aviso, y el día que la infra falte
 * de verdad la señal es **indistinguible del ruido de siempre**. Se arregla en las dos puntas:
 * cargar `.env` igual que hace la CLI de Prisma (para que la comprobación mire la realidad), y que
 * la ausencia sea sólo un aviso —**es lo que era**—, ahora ya sin mentir sobre ello. La suite falla
 * igual y con mejor mensaje en el `$connect()` del primer spec, que es donde la ausencia de infra se
 * manifiesta de verdad (probado apuntando a un Postgres inexistente: 3/3 rojos).
 */
import { randomBytes } from 'crypto';

// eslint-disable-next-line @typescript-eslint/no-var-requires
require('dotenv').config({ quiet: true });

jest.setTimeout(30000);

// Secretos/valores dummy para que la app arranque (NO se usan contra red real salvo
// el webhook, que verifica firma con STRIPE_WEBHOOK_SECRET — debe ser estable).

// ### S-88-4 — aquí decía `|| 'whsec_e2e_test_secret'`
//
// Era el MISMO patrón de `P-WH-1` (*el literal público gana cuando falta el de verdad*) y en el
// peor sitio posible: **el fichero que decide si un test de dinero es válido**. Con ese literal,
// una corrida sin `STRIPE_WEBHOOK_SECRET` verificaba firmas con una clave commiteada en un repo
// público — verde igual, pero verde contra algo forjable, y el preflight de devops **no lo cazaba**
// (seguridad lo midió: `sk_live_…` + `whsec_e2e_test_secret` PASA el preflight).
//
// Se retira. En su lugar, un secreto **EFÍMERO ALEATORIO por corrida**: irrepetible, nunca
// publicado, y estable dentro del proceso (`maxWorkers: 1`, y la app se levanta EN ESTE MISMO
// proceso desde `helpers/e2e-app.ts`, así que firmante y verificador comparten `process.env`).
// Misma solución que devops ya aplicó en `ci.yml`/`e2e.yml` con `webhook-secret-preflight.sh`.
process.env.STRIPE_WEBHOOK_SECRET =
  process.env.STRIPE_WEBHOOK_SECRET || `whsec_${randomBytes(24).toString('hex')}`;
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_e2e_dummy';
process.env.STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_e2e_dummy';
process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'e2e_access_secret';
process.env.JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'e2e_refresh_secret';
process.env.DEFAULT_LOCALE = process.env.DEFAULT_LOCALE || 'es';

if (!process.env.DATABASE_URL) {
  // Aviso temprano y claro: la suite E2E requiere Postgres real. Ahora sólo suena cuando de verdad
  // falta (tras cargar `.env`), así que volver a verlo SÍ significa algo.
  // eslint-disable-next-line no-console
  console.warn(
    '[e2e] DATABASE_URL no está definida (ni en el entorno ni en `.env`). La suite de integración ' +
      'requiere Postgres real (docker compose up -d + prisma migrate deploy). ' +
      'Ver docs/BACKEND_NOTES.md §Integración.',
  );
}
