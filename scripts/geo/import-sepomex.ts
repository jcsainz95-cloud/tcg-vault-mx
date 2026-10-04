/**
 * import-sepomex.ts — el catálogo de CP de SEPOMEX en la tabla `PostalCode` (M-64), según API_CONTRACT
 * §M4-SHIP.19.23.6 (`C-GEO-1` = qué cuenta como «catálogo cargado»; `C-GEO-2` = cuándo y cómo se carga).
 * Runbook, origen del fichero y rollback: docs/DEVOPS_NOTES.md §79.                                        · devops
 *
 *   boot   --file F [--sha256 HEX]                 C-GEO-2: el paso de ARRANQUE (tras `migrate deploy`, antes de servir).
 *                                                  Si C-GEO-1 (1)(2)(4) ya se cumplen ⇒ no escribe. Si no, inserta con
 *                                                  ON CONFLICT DO NOTHING (⛔ NUNCA borra) y verifica C-GEO-1 entero
 *                                                  DENTRO de la transacción. Falla ⇒ ROLLBACK y salida ≠ 0.
 *   verify --file F [--sha256 HEX]                 C-GEO-1 contra la base, solo lectura. Salida 3 si no se cumple.
 *   import --file F [--sha256 HEX] [--dry-run] [--allow-shrink]
 *                                                  Modo EXPLÍCITO, fuera del arranque: sincroniza la tabla con el
 *                                                  fichero (altas, cambios de municipio/estado y BAJAS), en una
 *                                                  transacción; aborta si quitaría > 10 % sin --allow-shrink.
 *
 * El fichero va fijado por `sha256` (C-GEO-2): `--sha256 HEX`, o si no, el fichero hermano `F.sha256` (formato de
 * `sha256sum`). No coincide o no existe ⇒ no se toca la base. Los pisos de C-GEO-1 (2) son CONSTANTES: ⛔ no hay
 * opción para bajarlos (el contrato lo prohíbe; un piso mal puesto se corrige con errata del arquitecto).
 *
 * Base: `DATABASE_URL` (si es `*.railway.internal` y existe `DATABASE_PUBLIC_URL`, ésta). La URL NUNCA se imprime.
 * Salida: 0 bien · 1 error (fichero, sha256, piso, base, verificación; nada escrito) · 2 uso · 3 `verify` no cumple.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { PrismaService } from '../../backend/src/prisma/prisma.service';
import { LocalPostalCodeSource, PostalCodeService } from '../../backend/src/modules/shipping-provider/geo/postal-code';
import { CatalogStats, computeStats, parseSepomex, ParseResult, PostalCodeRow, SepomexParseError } from './sepomex-parse';

/** C-GEO-1 (2). ⚠️ Los dos primeros son de memoria del arquitecto (NO MEDIDOS contra el archivo real). */
export interface Floors {
  minRows: number;
  minPostalCodes: number;
  exactStates: number;
}
export const C_GEO_FLOORS: Floors = Object.freeze({ minRows: 100_000, minPostalCodes: 25_000, exactStates: 32 });
/** C-GEO-1 (3): los cinco CP del arnés (`backend/prisma/e2e-fixtures.ts` E2E_POSTAL_CODES). */
export const HARNESS_POSTAL_CODES = Object.freeze(['01000', '06600', '14210', '44100', '64000']);
export const SHRINK_LIMIT = 0.1;
const CHUNK = 5000;

export class ImportAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportAbort';
  }
}

type Db = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe' | 'postalCode'>;

// ------------------------------------------------------------------------------------------------ fichero

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** Lee el fichero y comprueba su sha256 ANTES de interpretarlo. */
export function readPinnedFile(file: string, expectedSha?: string): { buf: Buffer; sha256: string } {
  let expected = expectedSha;
  if (!expected) {
    const side = `${file}.sha256`;
    if (!existsSync(side)) throw new ImportAbort(`falta el sha256 fijado: ni --sha256 ni ${side}`);
    expected = readFileSync(side, 'utf8').trim().split(/\s+/)[0];
  }
  if (!/^[0-9a-f]{64}$/i.test(expected)) throw new ImportAbort('el sha256 fijado no tiene forma de sha256');
  const buf = readFileSync(file);
  const sha256 = sha256Of(buf);
  if (sha256 !== expected.toLowerCase()) {
    throw new ImportAbort(`sha256 del fichero ${sha256} ≠ fijado ${expected.toLowerCase()}. No se toca la base.`);
  }
  return { buf, sha256 };
}

export function floorFailures(s: CatalogStats, f: Floors): string[] {
  const out: string[] = [];
  if (s.neighborhoods < f.minRows) out.push(`${s.neighborhoods} filas < ${f.minRows}`);
  if (s.postalCodes < f.minPostalCodes) out.push(`${s.postalCodes} CP < ${f.minPostalCodes}`);
  if (s.states !== f.exactStates) out.push(`${s.states} estados ≠ ${f.exactStates}`);
  return out;
}

// ------------------------------------------------------------------------------------------------ base

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv): { url: string; label: string } {
  let url = env.DATABASE_URL ?? '';
  const host = (u: string) => {
    try {
      return new URL(u).hostname;
    } catch {
      return '';
    }
  };
  if (url && host(url).endsWith('.railway.internal')) {
    if (!env.DATABASE_PUBLIC_URL) {
      throw new ImportAbort(
        'DATABASE_URL apunta a la red privada de Railway (*.railway.internal) y no hay DATABASE_PUBLIC_URL ' +
          '(desde fuera de Railway, usa las variables del servicio de Postgres; DEVOPS_NOTES §79).',
      );
    }
    url = env.DATABASE_PUBLIC_URL;
  }
  if (!url) throw new ImportAbort('falta DATABASE_URL');
  return { url, label: describeUrl(url) };
}

export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
    // Fuera de local, ni el host ni el puerto (la salida puede acabar pegada en un sitio público).
    return `***.${u.hostname.split('.').slice(-2).join('.')}:***${u.pathname}`;
  } catch {
    return '«URL ilegible»';
  }
}

export async function tableStats(db: Pick<Db, '$queryRawUnsafe'>): Promise<CatalogStats & { badShape: number }> {
  const [r] = await db.$queryRawUnsafe<{ cps: bigint; rows: bigint; munis: bigint; states: bigint; bad: bigint }[]>(
    `SELECT COUNT(DISTINCT "postalCode") AS cps, COUNT(*) AS rows,
            COUNT(DISTINCT (state, municipality)) AS munis, COUNT(DISTINCT state) AS states,
            COUNT(*) FILTER (WHERE "postalCode" !~ '^[0-9]{5}$' OR btrim(state) = '' OR btrim(municipality) = ''
                                OR btrim(neighborhood) = '') AS bad
       FROM "PostalCode"`,
  );
  return {
    postalCodes: Number(r.cps),
    neighborhoods: Number(r.rows),
    municipalities: Number(r.munis),
    states: Number(r.states),
    badShape: Number(r.bad),
  };
}

/** C-GEO-1 (1)(2)(4): lo barato, sin resolver CP. Vacío ⇔ se cumplen. */
export async function cheapFailures(db: Db, expected: CatalogStats, floors: Floors): Promise<string[]> {
  const t = await tableStats(db);
  const out: string[] = [];
  if (t.neighborhoods !== expected.neighborhoods) out.push(`(1) la tabla tiene ${t.neighborhoods} filas; el archivo fijado deriva ${expected.neighborhoods}`);
  out.push(...floorFailures(t, floors).map((m) => `(2) tabla: ${m}`));
  if (t.badShape) out.push(`(4) ${t.badShape} filas con forma inválida`);
  return out;
}

/** C-GEO-1 entero: (1)(2)(4) + (3) los CP del arnés por el MISMO cuerpo que la app (`resolvePostalCode`). */
export async function catalogFailures(db: Db, expected: CatalogStats, floors: Floors, probes = HARNESS_POSTAL_CODES): Promise<string[]> {
  const out = await cheapFailures(db, expected, floors);
  const svc = new PostalCodeService([new LocalPostalCodeSource(db as unknown as PrismaService)]);
  for (const cp of probes) {
    const rec = await svc.resolvePostalCode(cp);
    if (!rec || rec.entries.length < 1 || rec.source !== 'local') out.push(`(3) resolvePostalCode(${cp}) sin colonias locales`);
  }
  return out;
}

async function insertMissing(tx: Db, rows: PostalCodeRow[]): Promise<number> {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    inserted += await tx.$executeRawUnsafe(
      `INSERT INTO "PostalCode" (id, "postalCode", state, municipality, neighborhood)
       SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])
       ON CONFLICT ("postalCode", neighborhood) DO NOTHING`,
      part.map(() => randomUUID()),
      part.map((r) => r.postalCode),
      part.map((r) => r.state),
      part.map((r) => r.municipality),
      part.map((r) => r.neighborhood),
    );
  }
  return inserted;
}

async function txSetup(tx: Db) {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);
  // Un solo importador a la vez: dos réplicas arrancando a la vez se serializan, no se mezclan.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('import-sepomex'))`);
}

export interface BootReport {
  skipped: boolean;
  inserted: number;
  after: CatalogStats;
}

/**
 * C-GEO-2: el paso de arranque. ⛔ Nunca borra. Lanza ⇒ ROLLBACK (y el CLI sale ≠ 0).
 * `floors`/`probes` solo son parámetros para la prueba con el extracto; el CLI pasa siempre `C_GEO_FLOORS`.
 */
export async function bootCatalog(
  prisma: PrismaService,
  rows: PostalCodeRow[],
  floors: Floors = C_GEO_FLOORS,
  probes: readonly string[] = HARNESS_POSTAL_CODES,
  hooks: { afterWrite?: () => void | Promise<void> } = {},
): Promise<BootReport> {
  const expected = computeStats(rows);
  const fileFloor = floorFailures(expected, floors);
  if (fileFloor.length) throw new ImportAbort(`el archivo fijado no alcanza los pisos de C-GEO-1 (2): ${fileFloor.join('; ')}`);
  return prisma.$transaction(
    async (tx) => {
      await txSetup(tx);
      if ((await cheapFailures(tx, expected, floors)).length === 0) {
        const fails = await catalogFailures(tx, expected, floors, probes);
        if (fails.length) throw new ImportAbort(`C-GEO-1 no se cumple: ${fails.join('; ')}`);
        return { skipped: true, inserted: 0, after: await tableStats(tx) };
      }
      const inserted = await insertMissing(tx, rows);
      if (hooks.afterWrite) await hooks.afterWrite();
      const fails = await catalogFailures(tx, expected, floors, probes);
      if (fails.length) throw new ImportAbort(`C-GEO-1 no se cumple tras cargar (ROLLBACK): ${fails.join('; ')}`);
      return { skipped: false, inserted, after: await tableStats(tx) };
    },
    { maxWait: 15_000, timeout: 600_000 },
  );
}

export interface SyncReport {
  before: CatalogStats;
  after: CatalogStats;
  added: number;
  updated: number;
  removed: number;
}

/** Modo EXPLÍCITO (fuera del arranque): reconcilia la tabla con el fichero. Lanza ⇒ ROLLBACK. */
export async function syncPostalCodes(
  prisma: PrismaService,
  rows: PostalCodeRow[],
  opts: { allowShrink?: boolean; afterWriteHook?: () => void | Promise<void> } = {},
): Promise<SyncReport> {
  const expected = computeStats(rows);
  return prisma.$transaction(
    async (tx) => {
      await txSetup(tx);
      const before = await tableStats(tx);
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE sepomex_stage (id text, "postalCode" text, state text, municipality text, neighborhood text) ON COMMIT DROP`,
      );
      for (let i = 0; i < rows.length; i += CHUNK) {
        const part = rows.slice(i, i + CHUNK);
        await tx.$executeRawUnsafe(
          `INSERT INTO sepomex_stage SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[])`,
          part.map(() => randomUUID()),
          part.map((r) => r.postalCode),
          part.map((r) => r.state),
          part.map((r) => r.municipality),
          part.map((r) => r.neighborhood),
        );
      }
      await tx.$executeRawUnsafe(`CREATE INDEX ON sepomex_stage ("postalCode", neighborhood)`);
      const removed = await tx.$executeRawUnsafe(
        `DELETE FROM "PostalCode" p WHERE NOT EXISTS (
           SELECT 1 FROM sepomex_stage s WHERE s."postalCode" = p."postalCode" AND s.neighborhood = p.neighborhood)`,
      );
      const updated = await tx.$executeRawUnsafe(
        `UPDATE "PostalCode" p SET state = s.state, municipality = s.municipality
           FROM sepomex_stage s
          WHERE s."postalCode" = p."postalCode" AND s.neighborhood = p.neighborhood
            AND (p.state IS DISTINCT FROM s.state OR p.municipality IS DISTINCT FROM s.municipality)`,
      );
      const added = await tx.$executeRawUnsafe(
        `INSERT INTO "PostalCode" (id, "postalCode", state, municipality, neighborhood)
         SELECT s.id, s."postalCode", s.state, s.municipality, s.neighborhood FROM sepomex_stage s
          WHERE NOT EXISTS (SELECT 1 FROM "PostalCode" p WHERE p."postalCode" = s."postalCode" AND p.neighborhood = s.neighborhood)`,
      );
      if (opts.afterWriteHook) await opts.afterWriteHook();
      if (before.neighborhoods > 0 && removed > before.neighborhoods * SHRINK_LIMIT && !opts.allowShrink) {
        throw new ImportAbort(
          `la sincronización quitaría ${removed} de ${before.neighborhoods} filas (> ${SHRINK_LIMIT * 100} %). ` +
            'ROLLBACK. Si es intencional, repite con --allow-shrink.',
        );
      }
      const after = await tableStats(tx);
      if (after.neighborhoods !== expected.neighborhoods || after.postalCodes !== expected.postalCodes || after.states !== expected.states) {
        throw new ImportAbort(`comprobación final: la tabla quedaría con ${fmt(after)} y el fichero dice ${fmt(expected)}. ROLLBACK.`);
      }
      return { before, after, added, updated, removed };
    },
    { maxWait: 15_000, timeout: 600_000 },
  );
}

// ------------------------------------------------------------------------------------------------ CLI

function fmt(s: CatalogStats): string {
  return `${s.postalCodes} CP · ${s.neighborhoods} filas (colonias) · ${s.municipalities} municipios · ${s.states} estados`;
}

function describeFile(file: string, sha256: string, p: ParseResult): void {
  const d = p.discarded;
  console.log(`[sepomex] archivo ${file} · sha256 ${sha256} · ${p.encoding} · ${p.sourceLines} filas leídas`);
  console.log(`[sepomex] archivo deriva: ${fmt(p.stats)}`);
  console.log(
    `[sepomex] descartes: ${p.duplicatesDropped} duplicadas exactas (CP, colonia)` +
      (p.duplicatesWithOtherMunicipality ? ` [${p.duplicatesWithOtherMunicipality} con otro municipio/estado: queda la primera]` : '') +
      ` · ${d.cp_no_5_digitos} CP no ^\\d{5}$ · ${d.campo_vacio} con campo vacío · ${d.caracter_ilegible} con carácter ilegible`,
  );
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new ImportAbort(`argumento inesperado «${a}»`);
    const k = a.slice(2);
    if (['dry-run', 'allow-shrink'].includes(k)) out[k] = true;
    else if (['file', 'sha256'].includes(k)) {
      const v = argv[++i];
      if (v === undefined) throw new ImportAbort(`--${k} necesita valor`);
      out[k] = v;
    } else throw new ImportAbort(`opción desconocida --${k}`);
  }
  return out;
}

async function withDb<T>(fn: (p: PrismaService, label: string) => Promise<T>): Promise<T> {
  const { url, label } = resolveDatabaseUrl(process.env);
  const prisma = new PrismaService({ datasources: { db: { url } } });
  try {
    return await fn(prisma, label);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<number> {
  const [mode, ...rest] = process.argv.slice(2);
  if (!['boot', 'verify', 'import'].includes(mode)) {
    console.error('uso: boot --file F [--sha256 H] | verify --file F [--sha256 H] | import --file F [--sha256 H] [--dry-run] [--allow-shrink]');
    return 2;
  }
  const args = parseArgs(rest);
  if (typeof args.file !== 'string') throw new ImportAbort('falta --file');
  const t0 = Date.now();
  const { buf, sha256 } = readPinnedFile(args.file, typeof args.sha256 === 'string' ? args.sha256 : undefined);
  const parsed = parseSepomex(buf);
  describeFile(args.file, sha256, parsed);
  const floorFail = floorFailures(parsed.stats, C_GEO_FLOORS);
  console.log(
    `[sepomex] pisos C-GEO-1 (2): ≥ ${C_GEO_FLOORS.minRows} filas · ≥ ${C_GEO_FLOORS.minPostalCodes} CP · = ${C_GEO_FLOORS.exactStates} estados ⇒ ` +
      (floorFail.length ? `NO ALCANZA (${floorFail.join('; ')})` : 'OK'),
  );
  if (floorFail.length) {
    throw new ImportAbort('el archivo no alcanza los pisos: se PARA y se pide errata al arquitecto (el piso no se baja aquí)');
  }

  if (mode === 'verify') {
    return withDb(async (prisma, label) => {
      const t = await tableStats(prisma);
      console.log(`[sepomex] verify · base ${label}: ${fmt(t)}`);
      const fails = await catalogFailures(prisma, parsed.stats, C_GEO_FLOORS);
      for (const f of fails) console.log(`[sepomex]   ✗ ${f}`);
      console.log(fails.length ? '[sepomex] ⛔ C-GEO-1 NO se cumple: catálogo NO cargado.' : '[sepomex] C-GEO-1 se cumple: CATÁLOGO CARGADO.');
      return fails.length ? 3 : 0;
    });
  }

  if (mode === 'boot') {
    return withDb(async (prisma, label) => {
      const r = await bootCatalog(prisma, parsed.rows);
      console.log(
        `[sepomex] boot · base ${label}: ${r.skipped ? 'ya cargado (C-GEO-1 se cumple), sin escribir' : `+${r.inserted} filas insertadas (ON CONFLICT DO NOTHING), COMMIT`}`,
      );
      console.log(`[sepomex] boot · tabla: ${fmt(r.after)} · C-GEO-1 OK · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      return 0;
    });
  }

  // import (explícito)
  if (args['dry-run']) {
    if (process.env.DATABASE_URL || process.env.DATABASE_PUBLIC_URL) {
      await withDb(async (prisma, label) => console.log(`[sepomex] dry-run · base ${label} hoy: ${fmt(await tableStats(prisma))}`));
    }
    console.log('[sepomex] DRY-RUN: nada escrito.');
    return 0;
  }
  return withDb(async (prisma, label) => {
    console.log(`[sepomex] import · base ${label}: sincronizando en una transacción…`);
    const r = await syncPostalCodes(prisma, parsed.rows, { allowShrink: Boolean(args['allow-shrink']) });
    console.log(`[sepomex] antes:   ${fmt(r.before)}`);
    console.log(`[sepomex] después: ${fmt(r.after)}`);
    console.log(`[sepomex] filas: +${r.added} · ~${r.updated} · -${r.removed} · ${((Date.now() - t0) / 1000).toFixed(1)} s · COMMIT`);
    return 0;
  });
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (e: unknown) => {
      if (e instanceof ImportAbort || e instanceof SepomexParseError) {
        console.error(`[sepomex] ⛔ ${e.message}`);
      } else {
        // Los errores de Prisma pueden llevar la URL de conexión: solo nombre, código y la cola del mensaje, sin URL.
        const err = e as { name?: string; code?: string; message?: string };
        const msg = (err.message ?? '').replace(/postgres(ql)?:\/\/[^\s'"]+/gi, '«url»');
        console.error(`[sepomex] ⛔ ${err.name ?? 'Error'}${err.code ? ` ${err.code}` : ''}: ${msg.split('\n').slice(-3).join(' ')}`);
      }
      console.error('[sepomex] nada escrito (ROLLBACK o abortado antes de la transacción).');
      process.exit(1);
    },
  );
}
