/**
 * import-sepomex.ts — el catálogo de CP de SEPOMEX en la tabla `PostalCode` (M-64), según API_CONTRACT
 * §M4-SHIP.19.23.6 (C-GEO-1/C-GEO-2) y §M4-SHIP.19.24 (v1.80.12.4: inclusión + huella, dos modos por blanco,
 * manifiesto). Runbook y rollback: docs/DEVOPS_NOTES.md §79 y §80.                                        · devops
 *
 *   manifest --file F [--out M]          Sin base. Deriva el manifiesto del archivo (sha256, cifras, descartes,
 *                                        setDigest, aviso de la línea 1). Es lo que se commitea (no el archivo).
 *   boot [--file F] [--strict]           C-GEO-2: el paso de ARRANQUE (tras `migrate deploy`, antes de servir).
 *   verify [--file F] [--strict]         C-GEO-1 contra la base, solo lectura. Salida 3 si no se cumple.
 *   import --file F [--dry-run] [--allow-shrink]
 *                                        Recarga EXPLÍCITA, fuera del arranque: reconcilia (altas, cambios, BAJAS).
 *
 * MODO (§19.24.5), decidido por el BLANCO y no por una variable: si la URL con la que de verdad se conecta pasa
 * `assertSeedTarget` (la MISMA función que impide sembrar producción, importada de backend/prisma/seed-target-guard.ts)
 * ⇒ modo ARNÉS; si no ⇒ modo ESTRICTO. `--strict` fuerza el estricto; ⛔ no existe opción que afloje.
 *
 *   ESTRICTO: sin manifiesto ⇒ 1. Manifiesto bajo los pisos ⇒ 1. Tabla = manifiesto (setDigest) y (3)(4) ⇒ 0 sin
 *             escribir y SIN leer el archivo. Si no: archivo (sha256 = manifiesto ANTES de interpretarlo), su setDigest =
 *             el del manifiesto, INSERT … ON CONFLICT DO NOTHING (⛔ nunca borra) y dentro de la tx (1b)(2)(3)(4).
 *             Fila ajena o discrepante ⇒ 1 con la lista (no se borra: se reconcilia con `import`, fuera del arranque).
 *   ARNÉS:    sin `--file` ⇒ no carga, sale 0 sin tocar base ni red. Con `--file` ⇒ exige SU manifiesto (hermano
 *             `<F sin .txt>.manifest.json`), carga igual y verifica (1a) con faltan = 0, (3) y (4); ajenas y
 *             discrepantes se cuentan y se imprimen. Los pisos (2) son del catálogo nacional: solo en estricto.
 *
 * Manifiesto: `--manifest M`, si no el hermano del archivo, si no `scripts/geo/sepomex.manifest.json`.
 * Base: `boot` usa `DATABASE_URL` TAL CUAL (la de la app: dentro de Railway `*.railway.internal` es la red buena).
 * `verify`/`import`, lanzados desde fuera, usan `DATABASE_PUBLIC_URL` si `DATABASE_URL` es `*.railway.internal`.
 * La URL NUNCA se imprime.
 * Salida: 0 bien · 1 error/alarma (nada escrito) · 2 uso · 3 `verify` no cumple.
 */
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { assertSeedTarget, SeedTargetRefusedError } from '../../backend/prisma/seed-target-guard';
import { PrismaService } from '../../backend/src/prisma/prisma.service';
import { LocalPostalCodeSource, PostalCodeService } from '../../backend/src/modules/shipping-provider/geo/postal-code';
import { CatalogStats, DiscardReason, parseSepomex, PostalCodeRow, SepomexParseError } from './sepomex-parse';

/** C-GEO-1 (2). ⚠️ Los dos primeros son de memoria del arquitecto (NO MEDIDOS contra el archivo real). */
export interface Floors {
  minRows: number;
  minPostalCodes: number;
  exactStates: number;
}
export const C_GEO_FLOORS: Floors = Object.freeze({ minRows: 100_000, minPostalCodes: 25_000, exactStates: 32 });
/** C-GEO-1 (3): los cinco CP del arnés (`backend/prisma/e2e-fixtures.ts` E2E_POSTAL_CODES). */
export const HARNESS_POSTAL_CODES = Object.freeze(['01000', '06600', '14210', '44100', '64000']);
export const DEFAULT_MANIFEST = join(__dirname, 'sepomex.manifest.json');
export const SHRINK_LIMIT = 0.1;
const CHUNK = 5000;
const EXAMPLES = 10;

export class ImportAbort extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportAbort';
  }
}

type Db = Pick<PrismaService, '$queryRawUnsafe' | '$executeRawUnsafe'>;
export type Mode = 'strict' | 'harness';

// ------------------------------------------------------------------------------------------------ modo

/** §19.24.5: arnés ⇔ el blanco pasa `assertSeedTarget` (importada, no copiada). Cualquier otra cosa: estricto. */
export function classifyTarget(databaseUrl: string, env: NodeJS.ProcessEnv = process.env, forceStrict = false): Mode {
  if (forceStrict) return 'strict';
  try {
    assertSeedTarget({ ...env, DATABASE_URL: databaseUrl });
    return 'harness';
  } catch (e) {
    if (e instanceof SeedTargetRefusedError) return 'strict';
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------ huella

export function sha256Of(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/** §19.24.3: tuplas únicas por clave, `cp TAB colonia TAB municipio TAB estado LF`, orden por BYTES (UTF-8). */
export function setDigestOf(rows: PostalCodeRow[]): string {
  const keyed = rows.map((r) => ({ cp: Buffer.from(r.postalCode, 'utf8'), n: Buffer.from(r.neighborhood, 'utf8'), r }));
  keyed.sort((a, b) => Buffer.compare(a.cp, b.cp) || Buffer.compare(a.n, b.n));
  const h = createHash('sha256');
  for (const { r } of keyed) h.update(Buffer.from(`${r.postalCode}\t${r.neighborhood}\t${r.municipality}\t${r.state}\n`, 'utf8'));
  return h.digest('hex');
}

/** La misma huella en SQL (§19.24.3), con `COLLATE "C"`: ⛔ nunca la intercalación de la base. */
export async function sqlSetDigest(db: Pick<Db, '$queryRawUnsafe'>, relation = '"PostalCode"'): Promise<string> {
  const [r] = await db.$queryRawUnsafe<{ d: string }[]>(
    `SELECT encode(sha256(convert_to(coalesce(string_agg(
         "postalCode" || E'\\t' || neighborhood || E'\\t' || municipality || E'\\t' || state || E'\\n', ''
         ORDER BY "postalCode" COLLATE "C", neighborhood COLLATE "C"), ''), 'UTF8')), 'hex') AS d
       FROM ${relation}`,
  );
  return r.d;
}

// ------------------------------------------------------------------------------------------------ manifiesto

export interface Manifest {
  fileSha256: string;
  encoding: 'latin1' | 'utf-8';
  derived: { rows: number; postalCodes: number; municipalities: number; states: number };
  discarded: Record<DiscardReason, number>;
  duplicatesDropped: number;
  setDigest: string;
  sourceNotice: string;
}

export interface Derived {
  rows: PostalCodeRow[];
  manifest: Manifest;
}

/** Del archivo al manifiesto. Puro. */
export function deriveFromFile(buf: Buffer): Derived {
  const fileSha256 = sha256Of(buf);
  const p = parseSepomex(buf);
  const firstLine = new TextDecoder(p.encoding === 'utf-8' ? 'utf-8' : 'latin1').decode(buf).replace(/^﻿/, '').split(/\r?\n/)[0];
  return {
    rows: p.rows,
    manifest: {
      fileSha256,
      encoding: p.encoding,
      derived: { rows: p.stats.neighborhoods, postalCodes: p.stats.postalCodes, municipalities: p.stats.municipalities, states: p.stats.states },
      discarded: p.discarded,
      duplicatesDropped: p.duplicatesDropped,
      setDigest: setDigestOf(p.rows),
      sourceNotice: firstLine,
    },
  };
}

export function readManifest(path: string): Manifest {
  if (!existsSync(path)) throw new ImportAbort(`no hay manifiesto (${basename(path)}): la versión no se publica (G-1 abierta)`);
  let m: Manifest;
  try {
    m = JSON.parse(readFileSync(path, 'utf8')) as Manifest;
  } catch {
    throw new ImportAbort(`manifiesto ilegible: ${basename(path)}`);
  }
  const hex = /^[0-9a-f]{64}$/;
  const d = m?.derived;
  if (!m || !hex.test(m.fileSha256) || !hex.test(m.setDigest) || !d || ![d.rows, d.postalCodes, d.municipalities, d.states].every(Number.isInteger)) {
    throw new ImportAbort(`manifiesto con forma inválida: ${basename(path)}`);
  }
  return m;
}

export function floorFailures(d: { rows: number; postalCodes: number; states: number }, f: Floors): string[] {
  const out: string[] = [];
  if (d.rows < f.minRows) out.push(`${d.rows} filas < ${f.minRows}`);
  if (d.postalCodes < f.minPostalCodes) out.push(`${d.postalCodes} CP < ${f.minPostalCodes}`);
  if (d.states !== f.exactStates) out.push(`${d.states} estados ≠ ${f.exactStates}`);
  return out;
}

export function manifestPathFor(file: string | undefined, explicit: string | undefined): string {
  if (explicit) return explicit;
  if (file) {
    const sib = join(dirname(file), `${basename(file).replace(/\.txt$/i, '')}.manifest.json`);
    if (existsSync(sib)) return sib;
  }
  return DEFAULT_MANIFEST;
}

/** De dónde sale el archivo. Hoy: solo un fichero local (`--file`). La opción (A) de §19.24.6 entra aquí tras G-1. */
export interface FileSource {
  describe: string;
  fetch(): Promise<Buffer>;
}
export function localFile(path: string): FileSource {
  return { describe: path, fetch: async () => readFileSync(path) };
}

/** sha256 = manifiesto ANTES de interpretar; luego deriva y exige el mismo setDigest (atrapa un cambio del lector). */
export async function obtainVerified(source: FileSource, m: Manifest): Promise<PostalCodeRow[]> {
  const buf = await source.fetch();
  const sha = sha256Of(buf);
  if (sha !== m.fileSha256) throw new ImportAbort(`sha256 del archivo ${sha} ≠ manifiesto ${m.fileSha256}. No se interpreta ni se toca la base.`);
  const d = deriveFromFile(buf);
  if (d.manifest.setDigest !== m.setDigest) {
    throw new ImportAbort(`el archivo deriva setDigest ${d.manifest.setDigest} ≠ manifiesto ${m.setDigest} (¿cambió el lector?)`);
  }
  return d.rows;
}

// ------------------------------------------------------------------------------------------------ base

export function resolveDatabaseUrl(env: NodeJS.ProcessEnv, opts: { allowPublicFallback: boolean }): { url: string; label: string } {
  let url = env.DATABASE_URL ?? '';
  if (!url) throw new ImportAbort('falta DATABASE_URL');
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    throw new ImportAbort('DATABASE_URL no parsea');
  }
  // ⛔ En `boot` NO se salta (§19.24.5): se clasifica y se escribe con la MISMA URL que usa la app.
  if (opts.allowPublicFallback && host.endsWith('.railway.internal')) {
    if (!env.DATABASE_PUBLIC_URL) {
      throw new ImportAbort('DATABASE_URL es *.railway.internal y no hay DATABASE_PUBLIC_URL (desde fuera de Railway; DEVOPS_NOTES §79).');
    }
    url = env.DATABASE_PUBLIC_URL;
  }
  return { url, label: describeUrl(url) };
}

export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Local o servicio de compose (sin punto): no dicen nada fuera de esta máquina.
    if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname) || !u.hostname.includes('.')) return `${u.hostname}:${u.port || '5432'}${u.pathname}`;
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
  return { postalCodes: Number(r.cps), neighborhoods: Number(r.rows), municipalities: Number(r.munis), states: Number(r.states), badShape: Number(r.bad) };
}

export interface Inclusion {
  missing: number;
  discrepant: number;
  foreign: number;
  examples: { missing: string[]; discrepant: string[]; foreign: string[] };
}

/** C-GEO-1 (1a): faltan / discrepantes / ajenas entre el conjunto derivado y la tabla. */
export async function inclusion(db: Pick<Db, '$queryRawUnsafe'>, rows: PostalCodeRow[]): Promise<Inclusion> {
  const table = await db.$queryRawUnsafe<PostalCodeRow[]>(`SELECT "postalCode", neighborhood, municipality, state FROM "PostalCode"`);
  const key = (r: PostalCodeRow) => `${r.postalCode}\t${r.neighborhood}`;
  const inTable = new Map(table.map((r) => [key(r), r]));
  const inFile = new Set(rows.map(key));
  const res: Inclusion = { missing: 0, discrepant: 0, foreign: 0, examples: { missing: [], discrepant: [], foreign: [] } };
  const ex = (k: 'missing' | 'discrepant' | 'foreign', r: PostalCodeRow) => {
    res[k]++;
    if (res.examples[k].length < EXAMPLES) res.examples[k].push(`${r.postalCode} «${r.neighborhood}»`);
  };
  for (const r of rows) {
    const t = inTable.get(key(r));
    if (!t) ex('missing', r);
    else if (t.municipality !== r.municipality || t.state !== r.state) ex('discrepant', r);
  }
  for (const t of table) if (!inFile.has(key(t))) ex('foreign', t);
  return res;
}

export function fmtInclusion(i: Inclusion): string {
  const part = (n: number, xs: string[]) => `${n}${xs.length ? ` [${xs.join(', ')}${n > xs.length ? ', …' : ''}]` : ''}`;
  return `faltan ${part(i.missing, i.examples.missing)} · discrepantes ${part(i.discrepant, i.examples.discrepant)} · ajenas ${part(i.foreign, i.examples.foreign)}`;
}

/** (3) los CP del arnés por el MISMO cuerpo que la app; (4) forma. */
async function functionalFailures(db: Db, probes: readonly string[]): Promise<string[]> {
  const out: string[] = [];
  const svc = new PostalCodeService([new LocalPostalCodeSource(db as unknown as PrismaService)]);
  for (const cp of probes) {
    const rec = await svc.resolvePostalCode(cp);
    if (!rec || rec.entries.length < 1 || rec.source !== 'local') out.push(`(3) resolvePostalCode(${cp}) sin colonias locales`);
  }
  const t = await tableStats(db);
  if (t.badShape) out.push(`(4) ${t.badShape} filas con forma inválida`);
  return out;
}

async function txSetup(tx: Db) {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '10s'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '300s'`);
  // Un solo importador a la vez: dos réplicas arrancando a la vez se serializan, no se mezclan.
  await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(hashtext('import-sepomex'))`);
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

// ------------------------------------------------------------------------------------------------ boot

export interface BootOptions {
  mode: Mode;
  /** Ruta del manifiesto (o `null` = no hay). En arnés sin archivo no se lee. */
  manifestPath: string | null;
  source: FileSource | null;
  /** Solo pruebas (extracto). El CLI pasa siempre `C_GEO_FLOORS`. */
  floors?: Floors;
  probes?: readonly string[];
  afterWrite?: () => void | Promise<void>;
  log?: (line: string) => void;
}

export interface BootReport {
  mode: Mode;
  outcome: 'harness-no-file' | 'already-loaded' | 'loaded';
  inserted: number;
  inclusion?: Inclusion;
}

/** C-GEO-2 con §19.24.5. Lanza ⇒ ROLLBACK (el CLI sale 1). ⛔ Nunca borra. */
export async function bootCatalog(prisma: PrismaService | null, o: BootOptions): Promise<BootReport> {
  const floors = o.floors ?? C_GEO_FLOORS;
  const probes = o.probes ?? HARNESS_POSTAL_CODES;
  const log = o.log ?? (() => undefined);

  if (o.mode === 'harness' && !o.source) {
    log('[sepomex] modo arnés: sin archivo, no se carga; los CP los siembra el arnés');
    return { mode: o.mode, outcome: 'harness-no-file', inserted: 0 };
  }
  if (!o.manifestPath) throw new ImportAbort('no hay manifiesto: la versión no se publica (G-1 abierta)');
  const m = readManifest(o.manifestPath);
  if (o.mode === 'strict') {
    const ff = floorFailures(m.derived, floors);
    if (ff.length) throw new ImportAbort(`el manifiesto no alcanza los pisos de C-GEO-1 (2): ${ff.join('; ')}`);
  }
  if (!prisma) throw new ImportAbort('falta la base');

  if (o.mode === 'strict') {
    // Camino barato del re-arranque: ⛔ ni archivo ni red si la tabla ya es el manifiesto.
    if ((await sqlSetDigest(prisma)) === m.setDigest && (await functionalFailures(prisma, probes)).length === 0) {
      log('[sepomex] modo estricto: la tabla = manifiesto (setDigest) y C-GEO-1 se cumple; sin escribir');
      return { mode: o.mode, outcome: 'already-loaded', inserted: 0 };
    }
    if (!o.source) throw new ImportAbort('la tabla no coincide con el manifiesto y no hay de dónde obtener el archivo (G-1)');
  }
  const rows = await obtainVerified(o.source!, m);

  return prisma.$transaction(
    async (tx) => {
      await txSetup(tx);
      const inserted = await insertMissing(tx, rows);
      if (o.afterWrite) await o.afterWrite();
      const inc = await inclusion(tx, rows);
      const fails = await functionalFailures(tx, probes);
      log(`[sepomex] (1a) ${fmtInclusion(inc)}`);
      if (inc.missing) fails.unshift(`(1a) faltan ${inc.missing}`);
      if (o.mode === 'strict') {
        if (inc.discrepant || inc.foreign) {
          fails.unshift(`ALARMA: ${inc.discrepant} discrepantes y ${inc.foreign} ajenas (sin escritor legítimo; se reconcilia con \`import\` fuera del arranque)`);
        }
        const td = await sqlSetDigest(tx);
        if (td !== m.setDigest) fails.push(`(1b) setDigest(tabla) ${td} ≠ manifiesto ${m.setDigest}`);
        const t = await tableStats(tx);
        fails.push(...floorFailures({ rows: t.neighborhoods, postalCodes: t.postalCodes, states: t.states }, floors).map((x) => `(2) tabla: ${x}`));
      }
      if (fails.length) throw new ImportAbort(`C-GEO-1 no se cumple (ROLLBACK): ${fails.join('; ')}`);
      return { mode: o.mode, outcome: 'loaded' as const, inserted, inclusion: inc };
    },
    { maxWait: 15_000, timeout: 600_000 },
  );
}

// ------------------------------------------------------------------------------------------------ import explícito

export interface SyncReport {
  before: CatalogStats;
  after: CatalogStats;
  added: number;
  updated: number;
  removed: number;
}

/** Modo EXPLÍCITO (fuera del arranque): reconcilia la tabla con el conjunto derivado. Lanza ⇒ ROLLBACK. */
export async function syncPostalCodes(
  prisma: PrismaService,
  rows: PostalCodeRow[],
  opts: { allowShrink?: boolean; afterWriteHook?: () => void | Promise<void> } = {},
): Promise<SyncReport> {
  const expectedDigest = setDigestOf(rows);
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
      const td = await sqlSetDigest(tx);
      if (td !== expectedDigest) throw new ImportAbort(`comprobación final: setDigest(tabla) ${td} ≠ archivo ${expectedDigest}. ROLLBACK.`);
      return { before, after: await tableStats(tx), added, updated, removed };
    },
    { maxWait: 15_000, timeout: 600_000 },
  );
}

// ------------------------------------------------------------------------------------------------ CLI

function fmt(s: CatalogStats): string {
  return `${s.postalCodes} CP · ${s.neighborhoods} filas (colonias) · ${s.municipalities} municipios · ${s.states} estados`;
}

function printManifest(m: Manifest, file: string): void {
  const d = m.discarded;
  console.log(`[sepomex] archivo ${file} · sha256 ${m.fileSha256} · ${m.encoding}`);
  console.log(
    `[sepomex] deriva: ${m.derived.postalCodes} CP · ${m.derived.rows} filas · ${m.derived.municipalities} municipios · ` +
      `${m.derived.states} estados · setDigest ${m.setDigest}`,
  );
  console.log(
    `[sepomex] descartes: ${m.duplicatesDropped} duplicadas exactas · ${d.cp_no_5_digitos} CP no ^\\d{5}$ · ${d.campo_vacio} campo vacío · ` +
      `${d.caracter_ilegible} carácter ilegible · ${d.separador_en_campo} separador en campo`,
  );
  const ff = floorFailures(m.derived, C_GEO_FLOORS);
  console.log(
    `[sepomex] pisos C-GEO-1 (2): ≥ ${C_GEO_FLOORS.minRows} filas · ≥ ${C_GEO_FLOORS.minPostalCodes} CP · = ${C_GEO_FLOORS.exactStates} estados ⇒ ` +
      (ff.length ? `NO ALCANZA (${ff.join('; ')})` : 'OK'),
  );
  console.log(`[sepomex] aviso (línea 1): ${m.sourceNotice}`);
}

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new ImportAbort(`argumento inesperado «${a}»`);
    const k = a.slice(2);
    if (['dry-run', 'allow-shrink', 'strict'].includes(k)) out[k] = true;
    else if (['file', 'manifest', 'out'].includes(k)) {
      const v = argv[++i];
      if (v === undefined) throw new ImportAbort(`--${k} necesita valor`);
      out[k] = v;
    } else throw new ImportAbort(`opción desconocida --${k}`);
  }
  return out;
}

async function withDb<T>(url: string, fn: (p: PrismaService) => Promise<T>): Promise<T> {
  const prisma = new PrismaService({ datasources: { db: { url } } });
  try {
    return await fn(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

async function main(): Promise<number> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (!['manifest', 'boot', 'verify', 'import'].includes(cmd)) {
    console.error(
      'uso: manifest --file F [--out M] | boot [--file F] [--strict] | verify [--file F] [--strict] | ' +
        'import --file F [--dry-run] [--allow-shrink]   (todas: [--manifest M])',
    );
    return 2;
  }
  const a = parseArgs(rest);
  const file = typeof a.file === 'string' ? a.file : undefined;
  const t0 = Date.now();

  if (cmd === 'manifest') {
    if (!file) throw new ImportAbort('falta --file');
    const { manifest } = deriveFromFile(readFileSync(file));
    printManifest(manifest, file);
    const json = `${JSON.stringify(manifest, null, 2)}\n`;
    if (typeof a.out === 'string') {
      writeFileSync(a.out, json);
      console.log(`[sepomex] manifiesto escrito en ${a.out}`);
    } else process.stdout.write(json);
    return 0;
  }

  const manifestPath = manifestPathFor(file, typeof a.manifest === 'string' ? a.manifest : undefined);

  if (cmd === 'boot') {
    const { url, label } = resolveDatabaseUrl(process.env, { allowPublicFallback: false });
    const mode = classifyTarget(url, process.env, Boolean(a.strict));
    console.log(`[sepomex] boot · base ${label} · modo ${mode === 'strict' ? 'ESTRICTO' : 'arnés'}`);
    if (mode === 'harness' && !file) {
      await bootCatalog(null, { mode, manifestPath: null, source: null, log: console.log });
      return 0;
    }
    return withDb(url, async (prisma) => {
      const r = await bootCatalog(prisma, { mode, manifestPath, source: file ? localFile(file) : null, log: console.log });
      const t = await tableStats(prisma);
      console.log(
        `[sepomex] boot · ${r.outcome === 'already-loaded' ? 'ya cargado, sin escribir' : `+${r.inserted} filas (ON CONFLICT DO NOTHING), COMMIT`} · ` +
          `tabla: ${fmt(t)} · C-GEO-1 OK · ${((Date.now() - t0) / 1000).toFixed(1)} s`,
      );
      return 0;
    });
  }

  const { url, label } = resolveDatabaseUrl(process.env, { allowPublicFallback: true });

  if (cmd === 'verify') {
    const mode = classifyTarget(url, process.env, Boolean(a.strict));
    const m = readManifest(manifestPath);
    return withDb(url, async (prisma) => {
      const fails: string[] = [];
      console.log(`[sepomex] verify · base ${label} · modo ${mode === 'strict' ? 'ESTRICTO' : 'arnés'} · tabla: ${fmt(await tableStats(prisma))}`);
      if (mode === 'strict') {
        fails.push(...floorFailures(m.derived, C_GEO_FLOORS).map((x) => `(2) manifiesto: ${x}`));
        const td = await sqlSetDigest(prisma);
        if (td !== m.setDigest) fails.push(`(1b) setDigest(tabla) ${td} ≠ manifiesto ${m.setDigest}`);
      }
      if (file) {
        const inc = await inclusion(prisma, await obtainVerified(localFile(file), m));
        console.log(`[sepomex] (1a) ${fmtInclusion(inc)}`);
        if (inc.missing) fails.push(`(1a) faltan ${inc.missing}`);
      } else if (mode === 'harness') fails.push('(1a) en modo arnés hace falta --file para medir la inclusión');
      fails.push(...(await functionalFailures(prisma, HARNESS_POSTAL_CODES)));
      for (const f of fails) console.log(`[sepomex]   ✗ ${f}`);
      console.log(fails.length ? '[sepomex] ⛔ C-GEO-1 NO se cumple: catálogo NO cargado.' : '[sepomex] C-GEO-1 se cumple: CATÁLOGO CARGADO.');
      return fails.length ? 3 : 0;
    });
  }

  // import (explícito)
  if (!file) throw new ImportAbort('falta --file');
  const m = readManifest(manifestPath);
  const rows = await obtainVerified(localFile(file), m);
  printManifest(m, file);
  if (a['dry-run']) {
    await withDb(url, async (prisma) =>
      console.log(`[sepomex] dry-run · base ${label} hoy: ${fmt(await tableStats(prisma))} · (1a) ${fmtInclusion(await inclusion(prisma, rows))}`),
    );
    console.log('[sepomex] DRY-RUN: nada escrito.');
    return 0;
  }
  return withDb(url, async (prisma) => {
    console.log(`[sepomex] import · base ${label}: reconciliando en una transacción…`);
    const r = await syncPostalCodes(prisma, rows, { allowShrink: Boolean(a['allow-shrink']) });
    console.log(`[sepomex] antes: ${fmt(r.before)} · después: ${fmt(r.after)}`);
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
