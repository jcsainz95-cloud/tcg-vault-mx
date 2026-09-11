/**
 * seed-target-guard.ts — **el seed sintético se niega a correr contra una BD que no reconozca.**
 * Propiedad: backend (lo consume `seed-e2e.ts`; `scripts/seed-synthetic.sh` de devops mantiene su
 * propia guarda como defensa en profundidad).
 *
 * Por qué vive AQUÍ y no solo en el script (N1, QA/techlead 2026-09-11): `seedE2E()` borra-y-declara
 * pedidos, envíos, solicitudes de venta, KYC y referencias de precio de los usuarios del fixture, y
 * lo hacía sin mirar a qué apunta `DATABASE_URL`. De las tres rutas por las que se invoca —
 * `scripts/seed-synthetic.sh`, `npm run seed:synthetic` (→ `ts-node prisma/seed-e2e.ts`) y el paso
 * de `e2e-real.yml` que ejecuta el script de `package.json` dentro del contenedor— **solo la primera**
 * pasaba por la guarda del script. Un `DATABASE_URL` de producción exportado por error en cualquiera
 * de las otras dos habría sembrado producción. La guarda tiene que estar donde está el daño.
 *
 * Regla (FAIL-CLOSED: lo no reconocido se rechaza):
 *   - sin `DATABASE_URL` ⇒ rechazo (no se sabe adónde apunta; el error de Prisma llegaría después,
 *     pero «después» no es una garantía).
 *   - URL que no parsea ⇒ rechazo.
 *   - host `localhost` / `127.0.0.1` / `::1` ⇒ OK (entorno local y los `services:` de `ci.yml`/`e2e.yml`).
 *   - host SIN PUNTO (`postgres`, `db`: nombre de servicio de docker compose, como en
 *     `docker-compose.yml:154` y el compose de `e2e-real.yml`) ⇒ OK. Un host de producción real
 *     (`*.railway.app`, `*.rlwy.net`, `*.neon.tech`, `*.amazonaws.com`…) siempre lleva puntos.
 *   - URL que contiene `staging` ⇒ OK (paridad con la guarda de devops; HECHOS.md: hoy no hay staging).
 *   - cualquier otra cosa ⇒ rechazo, salvo la ESCOTILLA EXPLÍCITA: `SEED_E2E_ALLOW_HOST` igual, carácter
 *     a carácter, al host de la URL. Nombrar el host obliga a mirarlo; un `=1` genérico se deja puesto.
 */

export const SEED_E2E_ALLOW_HOST_ENV = 'SEED_E2E_ALLOW_HOST';

export class SeedTargetRefusedError extends Error {
  constructor(message: string) {
    super(`SEED_E2E_REFUSED: ${message}`);
    this.name = 'SeedTargetRefusedError';
  }
}

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostOf(url: string): string | null {
  try {
    // `new URL` entiende `postgresql://user:pass@host:5432/db?schema=public`.
    const host = new URL(url).hostname;
    return host.length > 0 ? host : null;
  } catch {
    return null;
  }
}

/** ¿Es un blanco reconociblemente local / de CI / de staging? (Sin escotilla.) */
export function isRecognizedSeedTarget(databaseUrl: string): boolean {
  const host = hostOf(databaseUrl);
  if (!host) return false;
  if (LOCAL_HOSTS.has(host)) return true;
  if (!host.includes('.')) return true; // servicio de compose: `postgres`, `db`
  if (/staging/i.test(databaseUrl)) return true;
  return false;
}

/**
 * Lanza `SeedTargetRefusedError` si `DATABASE_URL` no es un blanco reconocido y la escotilla no lo
 * nombra. No toca la BD: se evalúa ANTES de la primera consulta.
 */
export function assertSeedTarget(env: NodeJS.ProcessEnv = process.env): void {
  const url = env.DATABASE_URL;
  if (!url) {
    throw new SeedTargetRefusedError(
      'DATABASE_URL no está definida: el seed sintético no siembra un blanco que no conoce.',
    );
  }
  if (isRecognizedSeedTarget(url)) return;
  const host = hostOf(url) ?? '<no parsea>';
  const allowed = env[SEED_E2E_ALLOW_HOST_ENV];
  if (allowed !== undefined && allowed.length > 0 && allowed === host) return;
  throw new SeedTargetRefusedError(
    `DATABASE_URL apunta a "${host}", que no es local, ni un servicio de compose, ni staging. ` +
      `El seed sintético NUNCA corre contra una base que no reconoce (borra y reescribe datos). ` +
      `Si de verdad es un blanco de pruebas, exporta ${SEED_E2E_ALLOW_HOST_ENV}=${host} (exacto).`,
  );
}
