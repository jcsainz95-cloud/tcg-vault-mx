/**
 * limpieza-db.ts — arnés de P-DB-LIMPIEZA (docs/specs/LIMPIEZA_DB.md §9). Propiedad: backend.
 *
 * Los guiones de `prisma/data-repair/20261006_pdblimpieza_*` son SQL para **psql** (variables `\set`, `\echo`): se
 * prueban como los corre el dueño — el TEXTO del fichero por la entrada estándar de `psql` — y NO re-escritos en TS.
 * Cada prueba trabaja en un **esquema propio** (`lz_<corrida>_<n>`) de la BD de `DATABASE_URL`, migrado desde cero con
 * `prisma migrate deploy`: el guion borra TODO lo transaccional y no puede correr sobre la BD compartida de la suite.
 * El esquema se elige con `search_path` (PGOPTIONS), así que los guiones no nombran esquema (en Railway es `public`).
 *
 * ⛔ Requiere el binario `psql` (cliente de PostgreSQL) en el PATH. Si falta, la prueba FALLA con ese mensaje
 * (no se salta): una prueba de dinero que se salta a sí misma es la clase que este repo ya tuvo que censar.
 */
import { spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

export const BACKEND_DIR = join(__dirname, '..', '..', '..');
export const REPAIR_DIR = join(BACKEND_DIR, 'prisma', 'data-repair');
export const FILES = {
  censo: '20261006_pdblimpieza_1_censo.sql',
  limpieza: '20261006_pdblimpieza_2_limpieza.sql',
  folio: '20261006_pdblimpieza_3_folio_pedidos.sql',
  verificacion: '20261006_pdblimpieza_4_verificacion.sql',
} as const;

export function readRepair(name: keyof typeof FILES): string {
  return readFileSync(join(REPAIR_DIR, FILES[name]), 'utf8');
}

function baseUrl(): URL {
  const raw = process.env.DATABASE_URL;
  if (!raw) throw new Error('P-DB-LIMPIEZA: DATABASE_URL no está definida (la suite necesita Postgres real)');
  return new URL(raw);
}

export function schemaUrl(schema: string): string {
  const u = baseUrl();
  u.searchParams.set('schema', schema);
  return u.toString();
}

/** URL para libpq (psql): sin `?schema=`/`connection_limit`, que son de Prisma. */
function libpqUrl(): string {
  const u = baseUrl();
  u.search = '';
  return u.toString();
}

export interface PsqlResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/** Corre `sql` en psql como lo pega el dueño, con `search_path` = `schema`. */
export function psql(schema: string, sql: string): PsqlResult {
  const r = spawnSync('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', libpqUrl()], {
    input: sql,
    encoding: 'utf8',
    env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.error) throw new Error(`P-DB-LIMPIEZA: no pude ejecutar psql (${r.error.message}). Instala el cliente de PostgreSQL.`);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/**
 * ⚠️ Medido 2026-10-06: las migraciones protegen 46 `ADD CONSTRAINT` con `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE
 * conname = '…')`, que NO mira el esquema. En una base con varios esquemas, el segundo esquema migrado se queda SIN esas
 * FK y CHECK (p. ej. `ShipmentQuote → ShipmentRequest` CASCADE) porque «ya existen» en otro. En producción (un solo
 * esquema, `public`) no pasa. Para que cada esquema de prueba tenga TODAS sus llaves, se migra desde una COPIA de
 * `prisma/` cuyas guardas se acotan al esquema actual; y `assertConstraintsComplete` lo comprueba.
 */
let migDir: string | null = null;
export const GUARD = /FROM pg_constraint WHERE conname = /g;
export function scopedMigrations(): string {
  if (migDir) return migDir;
  const dir = mkdtempSync(join(tmpdir(), 'lz-mig-'));
  cpSync(join(BACKEND_DIR, 'prisma', 'schema.prisma'), join(dir, 'schema.prisma'));
  cpSync(join(BACKEND_DIR, 'prisma', 'migrations'), join(dir, 'migrations'), { recursive: true });
  for (const m of readdirSync(join(dir, 'migrations'))) {
    const f = join(dir, 'migrations', m, 'migration.sql');
    if (!existsSync(f)) continue;
    const sql = readFileSync(f, 'utf8');
    writeFileSync(f, sql.replace(GUARD, 'FROM pg_constraint WHERE connamespace = current_schema()::regnamespace AND conname = '));
  }
  migDir = dir;
  return dir;
}
export function cleanupMigrations(): void {
  if (migDir) rmSync(migDir, { recursive: true, force: true });
  migDir = null;
}

/** Migra un esquema nuevo desde cero (todas las migraciones del árbol, M-72 incluida). */
export function migrateSchema(schema: string): void {
  execFileSync(
    process.execPath,
    [join(BACKEND_DIR, 'node_modules', 'prisma', 'build', 'index.js'), 'migrate', 'deploy', '--schema', join(scopedMigrations(), 'schema.prisma')],
    { cwd: BACKEND_DIR, env: { ...process.env, DATABASE_URL: schemaUrl(schema) }, stdio: 'pipe' },
  );
}

/** Cada nombre que una migración añade tras una guarda `conname = '…'` existe en `schema` (las llaves están completas). */
export async function assertConstraintsComplete(admin: PrismaClient, schema: string): Promise<void> {
  const names = new Set<string>();
  const dropped = new Set<string>();
  const dir = join(BACKEND_DIR, 'prisma', 'migrations');
  for (const m of readdirSync(dir).sort()) {
    const f = join(dir, m, 'migration.sql');
    if (!existsSync(f)) continue;
    const sql = readFileSync(f, 'utf8').replace(/--.*$/gm, '');
    for (const x of sql.matchAll(/ADD CONSTRAINT "([^"]+)"/g)) { names.add(x[1]); dropped.delete(x[1]); }
    for (const x of sql.matchAll(/DROP CONSTRAINT (?:IF EXISTS )?"([^"]+)"/g)) {
      // un DROP seguido de su ADD en la misma migración es «recrear»: lo resuelve el orden de abajo
      const after = sql.slice(x.index! + x[0].length);
      if (!new RegExp(`ADD CONSTRAINT "${x[1]}"`).test(after)) dropped.add(x[1]);
    }
  }
  const have = new Set(
    (await admin.$queryRawUnsafe<{ n: string }[]>(`SELECT conname AS n FROM pg_constraint WHERE connamespace = $1::regnamespace`, schema)).map((r) => r.n),
  );
  const missing = [...names].filter((x) => !dropped.has(x) && !have.has(x));
  if (missing.length > 0) throw new Error(`esquema ${schema} sin llaves que las migraciones añaden: ${missing.join(', ')}`);
}

export async function dropSchema(admin: PrismaClient, schema: string): Promise<void> {
  await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
}

/**
 * §11 — quita M-72 de un esquema ya sembrado: lo que queda es el esquema de `production` sin el PR #78 (mismas tablas,
 * sin `kind`/`sellRequestId`/`inboundGuideClockStartedAt`). Los dos `ADD VALUE` de enum no se pueden quitar y no
 * importan (ninguna fila los usa). La fila de `_prisma_migrations` se borra: el censo la lee.
 */
export async function revertM72(admin: PrismaClient, schema: string): Promise<void> {
  const s = `"${schema}"`;
  for (const stmt of [
    `DELETE FROM ${s}."ShipmentRequest" WHERE kind::text = 'buylist_inbound'`,
    `ALTER TABLE ${s}."ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_kind_link"`,
    `ALTER TABLE ${s}."ShipmentRequest" DROP CONSTRAINT IF EXISTS "shipment_inbound_status"`,
    `ALTER TABLE ${s}."ShipmentRequest" DROP CONSTRAINT IF EXISTS "ShipmentRequest_sellRequestId_fkey"`,
    `ALTER TABLE ${s}."ShipmentRequest" DROP COLUMN "kind", DROP COLUMN "sellRequestId"`,
    `ALTER TABLE ${s}."SellRequest" DROP COLUMN "inboundGuideClockStartedAt"`,
    `DROP TYPE ${s}."ShipmentKind"`,
    `DELETE FROM ${s}."_prisma_migrations" WHERE migration_name LIKE '%_m72_bsd_inbound_label'`,
  ]) {
    await admin.$executeRawUnsafe(stmt);
  }
}

export interface TableState {
  n: number;
  h: string;
}
export interface Snapshot {
  tables: Record<string, TableState>;
  sequences: Record<string, { last_value: string; is_called: boolean }>;
}

export const SEQUENCES = ['order_number_seq', 'shipment_folio_seq', 'inventory_folio_seq'] as const;

/** Foto EXACTA del esquema: conteo + md5 del contenido de cada tabla, y las tres secuencias. */
export async function snapshot(admin: PrismaClient, schema: string): Promise<Snapshot> {
  const names = await admin.$queryRawUnsafe<{ t: string }[]>(
    `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`,
    schema,
  );
  const tables: Record<string, TableState> = {};
  for (const { t } of names) {
    const [r] = await admin.$queryRawUnsafe<{ n: number; h: string }[]>(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM "${schema}"."${t}" x`,
    );
    tables[t] = r;
  }
  const sequences: Snapshot['sequences'] = {};
  for (const q of SEQUENCES) {
    const [r] = await admin.$queryRawUnsafe<{ last_value: string; is_called: boolean }[]>(
      `SELECT last_value::text AS last_value, is_called FROM "${schema}".${q}`,
    );
    sequences[q] = r;
  }
  return { tables, sequences };
}

/** El guion B con las variables del dueño escritas en su sitio (las tres líneas `\set` de arriba). */
export function limpiezaSql(opts: { respaldo?: string; fueraDeVenta?: string; buylist?: string; commit?: boolean }): string {
  let sql = readRepair('limpieza');
  const put = (name: string, value: string) => {
    const line = `\\set ${name} ''`;
    const count = sql.split(line).length - 1;
    if (count !== 1) throw new Error(`el guion debe tener EXACTAMENTE una línea «${line}» (tiene ${count})`);
    sql = sql.replace(line, `\\set ${name} '${value.replace(/'/g, "''")}'`);
  };
  put('respaldo_manual', opts.respaldo ?? '');
  put('fuera_de_venta', opts.fueraDeVenta ?? '');
  put('buylist_piezas', opts.buylist ?? '');
  if (opts.commit) sql = toCommit(sql);
  return sql;
}

/** Lo que hace el dueño en el paso 5: la ÚLTIMA sentencia `ROLLBACK;` pasa a `COMMIT;`. */
export function toCommit(sql: string): string {
  const lines = sql.replace(/\s+$/, '').split('\n');
  const last = lines[lines.length - 1];
  if (last.trim() !== 'ROLLBACK;') throw new Error(`la última línea del guion debe ser «ROLLBACK;» (es «${last}»)`);
  lines[lines.length - 1] = 'COMMIT;';
  return lines.join('\n') + '\n';
}
