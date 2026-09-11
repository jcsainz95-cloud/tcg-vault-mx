import { PrismaClient } from '@prisma/client';
import { seedE2E } from '../prisma/seed-e2e';
import {
  SEED_E2E_ALLOW_HOST_ENV,
  SeedTargetRefusedError,
  assertSeedTarget,
  isRecognizedSeedTarget,
} from '../prisma/seed-target-guard';

/**
 * N1 (QA/techlead 2026-09-11, condición de release): `seedE2E()` es FAIL-CLOSED sobre `DATABASE_URL`.
 * Se niega —ANTES de la primera consulta— contra cualquier BD que no reconozca como local / servicio
 * de compose / staging, salvo escotilla explícita `SEED_E2E_ALLOW_HOST=<host exacto>`. Cubre las tres
 * rutas de invocación (script de devops, `npm run seed:synthetic`, paso de `e2e-real.yml`).
 */
const PROD_LIKE = 'postgresql://user:pw@containers-us-west-42.railway.app:6543/railway?schema=public';
const ORIGINAL = { ...process.env };

/** Un `PrismaClient` que EXPLOTA si alguien lo toca: la guarda tiene que dispararse antes. */
const untouchable = new Proxy({} as PrismaClient, {
  get(_t, prop) {
    throw new Error(`prisma.${String(prop)} fue tocado: la guarda no corrió antes de la primera consulta`);
  },
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe('seedE2E() — se niega contra una BD de aspecto productivo (fail-closed)', () => {
  it('DATABASE_URL de producción ⇒ SeedTargetRefusedError sin tocar Prisma', async () => {
    process.env.DATABASE_URL = PROD_LIKE;
    delete process.env[SEED_E2E_ALLOW_HOST_ENV];
    await expect(seedE2E(untouchable)).rejects.toBeInstanceOf(SeedTargetRefusedError);
    await expect(seedE2E(untouchable)).rejects.toThrow(/SEED_E2E_REFUSED.*railway\.app/);
  });

  it('sin DATABASE_URL ⇒ rechazo (no se siembra un blanco desconocido)', async () => {
    delete process.env.DATABASE_URL;
    await expect(seedE2E(untouchable)).rejects.toBeInstanceOf(SeedTargetRefusedError);
  });

  it('escotilla con OTRO host ⇒ sigue rechazando; con el host EXACTO ⇒ pasa la guarda (y entonces sí toca Prisma)', async () => {
    process.env.DATABASE_URL = PROD_LIKE;
    process.env[SEED_E2E_ALLOW_HOST_ENV] = 'otro.host.example';
    await expect(seedE2E(untouchable)).rejects.toBeInstanceOf(SeedTargetRefusedError);
    process.env[SEED_E2E_ALLOW_HOST_ENV] = 'containers-us-west-42.railway.app';
    await expect(seedE2E(untouchable)).rejects.toThrow(/prisma\.configSetting fue tocado/);
  });
});

describe('assertSeedTarget / isRecognizedSeedTarget — la regla', () => {
  it.each([
    ['local .native-stack', 'postgresql://tcg:x@localhost:5432/tcg_marketplace?schema=public'],
    ['ci.yml', 'postgresql://tcg:x@localhost:5432/tcg_ci?schema=public'],
    ['127.0.0.1', 'postgresql://tcg:x@127.0.0.1:5432/tcg_fix1'],
    ['servicio de compose (e2e-real)', 'postgresql://tcg:x@postgres:5432/tcg_marketplace?schema=public'],
    ['servicio `db`', 'postgresql://tcg:x@db:5432/tcg_e2e'],
    ['staging por nombre', 'postgresql://tcg:x@pg.internal.example:5432/tcg_staging'],
  ])('reconoce %s', (_l, url) => {
    expect(isRecognizedSeedTarget(url)).toBe(true);
    expect(() => assertSeedTarget({ DATABASE_URL: url })).not.toThrow();
  });

  it.each([
    ['railway', PROD_LIKE],
    ['rlwy proxy', 'postgresql://u:p@roundhouse.proxy.rlwy.net:12345/railway'],
    ['neon', 'postgresql://u:p@ep-cool-1234.us-east-2.aws.neon.tech/neondb?sslmode=require'],
    ['rds', 'postgresql://u:p@tcg.abc123.us-east-1.rds.amazonaws.com:5432/tcg'],
    ['no parsea', 'esto-no-es-una-url'],
    ['vacía', ''],
  ])('rechaza %s', (_l, url) => {
    expect(isRecognizedSeedTarget(url)).toBe(false);
    expect(() => assertSeedTarget({ DATABASE_URL: url })).toThrow(SeedTargetRefusedError);
  });

  it('la escotilla exige el host EXACTO (ni vacía, ni `1`, ni otro host)', () => {
    const host = 'containers-us-west-42.railway.app';
    expect(() => assertSeedTarget({ DATABASE_URL: PROD_LIKE, [SEED_E2E_ALLOW_HOST_ENV]: '' })).toThrow(SeedTargetRefusedError);
    expect(() => assertSeedTarget({ DATABASE_URL: PROD_LIKE, [SEED_E2E_ALLOW_HOST_ENV]: '1' })).toThrow(SeedTargetRefusedError);
    expect(() => assertSeedTarget({ DATABASE_URL: PROD_LIKE, [SEED_E2E_ALLOW_HOST_ENV]: 'railway.app' })).toThrow(SeedTargetRefusedError);
    expect(() => assertSeedTarget({ DATABASE_URL: PROD_LIKE, [SEED_E2E_ALLOW_HOST_ENV]: host })).not.toThrow();
  });
});
