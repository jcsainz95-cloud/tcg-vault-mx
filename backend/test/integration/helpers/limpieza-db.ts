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
import { spawn, spawnSync, execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';

export const BACKEND_DIR = join(__dirname, '..', '..', '..');
export const REPAIR_DIR = join(BACKEND_DIR, 'prisma', 'data-repair');
export const FILES = {
  censo: '20261006_pdblimpieza_1_censo.sql',
  limpieza: '20261006_pdblimpieza_2_limpieza.sql',
  folio: '20261006_pdblimpieza_3_folios.sql',
  verificacion: '20261006_pdblimpieza_4_verificacion.sql',
} as const;

export function readRepair(name: keyof typeof FILES): string {
  return readFileSync(join(REPAIR_DIR, FILES[name]), 'utf8');
}

/**
 * §14.13.5 T-AC3 — COPIA CONGELADA del guion B de `a7232d7a` (el que el dueño corrió en producción, sin M-73/M-74). Es
 * copia y no `git show` porque que el checkout de CI traiga ese sha: NO MEDIDO. Su 1.ª línea dice de dónde sale; el resto
 * es el fichero byte a byte (`FROZEN_B_SHA256` lo vigila).
 */
export const FROZEN_B = join(__dirname, '..', 'fixtures', 'pdblimpieza_2_limpieza.a7232d7a.sql');
export const FROZEN_B_SHA256 = '7c6f672cd1189a3caeb9eb4a6ff1f9fc76029bc6f288f868765934a79da3930e';
export function readFrozenB(): string {
  const raw = readFileSync(FROZEN_B, 'utf8');
  return raw.slice(raw.indexOf('\n') + 1);
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
 * C-1 (techlead, 2.º pase): como lo corre el dueño según el encabezado — `psql "$URL" -v ON_ERROR_STOP=1 -f fichero.sql` —
 * con stdout y stderr MEZCLADOS en el orden en que salen (lo que ve en la terminal). El texto va a un fichero temporal.
 */
export function psqlFile(schema: string, sql: string): PsqlResult & { out: string } {
  const dir = mkdtempSync(join(tmpdir(), 'lz-f-'));
  const file = join(dir, 'guion.sql');
  writeFileSync(file, sql);
  try {
    const r = spawnSync('sh', ['-c', 'psql -X -v ON_ERROR_STOP=1 -d "$LZ_URL" -f "$LZ_FILE" 2>&1'], {
      encoding: 'utf8',
      env: { ...process.env, LZ_URL: libpqUrl(), LZ_FILE: file, PGOPTIONS: `-c search_path=${schema}` },
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.error) throw new Error(`P-DB-LIMPIEZA: no pude ejecutar psql (${r.error.message}).`);
    return { status: r.status, stdout: r.stdout, stderr: '', out: r.stdout };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Corre `sql` en psql en SEGUNDO PLANO (para medir concurrencia): devuelve la promesa de su salida. */
export function psqlAsync(schema: string, sql: string): Promise<PsqlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('psql', ['-X', '-v', 'ON_ERROR_STOP=1', '-d', libpqUrl()], {
      env: { ...process.env, PGOPTIONS: `-c search_path=${schema}` },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => (stdout += b));
    child.stderr.on('data', (b) => (stderr += b));
    child.on('error', reject);
    child.on('close', (status) => resolve({ status, stdout, stderr }));
    child.stdin.end(sql);
  });
}

/** El bloque de comentarios del principio de un guion (lo que el dueño lee antes de correrlo). */
export function header(sql: string): string {
  const out: string[] = [];
  for (const line of sql.split('\n')) {
    if (!line.startsWith('--')) break;
    out.push(line);
  }
  return out.join('\n');
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

/** Corre un bloque de SQL en `schema` por psql y exige que salga 0 (para preparar esquemas, no para probar guiones). */
function psqlOk(schema: string, sql: string, what: string): void {
  const r = psql(schema, sql);
  if (r.status !== 0) throw new Error(`${what}: psql salió ${r.status}\n${r.stderr}`);
}

/**
 * §14.13.5 — quita M-73 de un esquema ya sembrado: queda el esquema de `production` sin el PR #84 (accesorios). Ejecuta el
 * bloque de REVERSA del propio fichero de M-73 (entre `REVERSA:BEGIN`/`REVERSA:END`, sin el `-- ` inicial), que REPONE
 * los dos CHECK de `PaymentRefund` de M-61/M-70 con su texto literal antes de quitar las columnas (un `DROP COLUMN` se
 * llevaría en silencio todo CHECK que las nombre). Antes borra las filas del libro que apuntan a un renglón de accesorio:
 * con ellas, reponer el CHECK de carta fallaría.
 */
export function revertM73(schema: string): void {
  const file = readdirSync(join(BACKEND_DIR, 'prisma', 'migrations')).find((m) => m.endsWith('_m73_accessories'));
  if (!file) throw new Error('revertM73: no encuentro la migración M-73');
  const sql = readFileSync(join(BACKEND_DIR, 'prisma', 'migrations', file, 'migration.sql'), 'utf8');
  const m = /^-- REVERSA:BEGIN[^\n]*\n([\s\S]*?)^-- REVERSA:END/m.exec(sql);
  if (!m) throw new Error('revertM73: M-73 no trae el bloque REVERSA:BEGIN … REVERSA:END');
  const block = m[1]
    .split('\n')
    .map((l) => l.replace(/^--(?: |$)/, ''))
    .join('\n');
  psqlOk(
    schema,
    `BEGIN;\nDELETE FROM "PaymentRefund" WHERE "orderAccessoryLineId" IS NOT NULL OR "shipmentAccessoryLineId" IS NOT NULL;\n${block}\nCOMMIT;\n`,
    'revertM73',
  );
}

/** §14.13.5 — quita M-74 (lista de deseos) de un esquema ya sembrado: la REVERSA documentada en la cabecera de M-74. */
export function revertM74(schema: string): void {
  psqlOk(
    schema,
    `BEGIN;
DROP TABLE IF EXISTS "WishlistNotice";
DROP TABLE IF EXISTS "WishlistMail";
DROP TABLE IF EXISTS "WishlistItem";
DROP TYPE IF EXISTS "WishlistNoticeStatus";
ALTER TABLE "User" DROP COLUMN IF EXISTS "wishlistAlertsPausedAt";
DROP INDEX IF EXISTS "SealedRestockSubscription_email_notifiedAt_idx";
ALTER TABLE "SealedRestockSubscription" DROP COLUMN IF EXISTS "armedAt", DROP COLUMN IF EXISTS "matchedAt";
DELETE FROM "ConfigSetting" WHERE key IN ('wishlist_enabled','wishlist_max_per_account','wishlist_max_iva_mode',
  'wishlist_daily_mail_cap','wishlist_mail_window_min','wishlist_target_margin_pct','wishlist_margin_basis',
  'sealed_restock_max_pending_per_email') AND "updatedBy" = 'migration:m74-wishlist';
DELETE FROM "_prisma_migrations" WHERE migration_name = '20261027120000_m74_wishlist';
COMMIT;
`,
    'revertM74',
  );
}

/**
 * §14.13.5 T-AC3 — deja `to` (ya migrado y con la MISMA forma que `from`) con el contenido EXACTO de `from`: todas las
 * tablas (también `_prisma_migrations`) y todas las secuencias. Así dos guiones se comparan sobre esquemas gemelos de
 * verdad (el fixture usa ids y marcas de tiempo aleatorias: sembrar dos veces no da dos bases iguales). Copia con
 * `session_replication_role = replica` (sin disparadores ni FK: es una copia de una base que ya las cumple). La igualdad
 * de las dos fotos (`snapshot`) la comprueba la prueba antes de usarlos.
 */
export async function cloneSchema(admin: PrismaClient, from: string, to: string): Promise<void> {
  const tables = (
    await admin.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name AS t FROM information_schema.tables WHERE table_schema = $1 AND table_type = 'BASE TABLE' ORDER BY 1`,
      from,
    )
  ).map((r) => r.t);
  const seqs = (
    await admin.$queryRawUnsafe<{ s: string }[]>(`SELECT sequence_name AS s FROM information_schema.sequences WHERE sequence_schema = $1 ORDER BY 1`, from)
  ).map((r) => r.s);
  await admin.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL session_replication_role = replica`);
      await tx.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${to}"."${t}"`).join(', ')}`);
      // Los enums son TIPOS de cada esquema (`a."Role"` ≠ `b."Role"`): esas columnas (y sus arreglos) se castean por texto
      // al tipo gemelo de `to`; las demás pasan tal cual (sin JSON de por medio: un `jsonb` `null` no se vuelve NULL).
      for (const t of tables) {
        const cols = await tx.$queryRawUnsafe<{ c: string; ty: string; own: boolean }[]>(
          `SELECT a.attname AS c, format_type(a.atttypid, a.atttypmod) AS ty, ty.typnamespace = $1::regnamespace AS own
             FROM pg_attribute a JOIN pg_type ty ON ty.oid = a.atttypid
            WHERE a.attrelid = $2::regclass AND a.attnum > 0 AND NOT a.attisdropped ORDER BY a.attnum`,
          from,
          `"${from}"."${t}"`,
        );
        const target = cols.map((x) => `"${x.c}"`).join(', ');
        const exprs = cols
          .map((x) => {
            if (!x.own) return `x."${x.c}"`;
            const ty = x.ty.startsWith(`${from}.`) ? `"${to}".${x.ty.slice(from.length + 1)}` : x.ty.replace(`"${from}".`, `"${to}".`);
            return `x."${x.c}"::text::${ty}`;
          })
          .join(', ');
        await tx.$executeRawUnsafe(`INSERT INTO "${to}"."${t}" (${target}) SELECT ${exprs} FROM "${from}"."${t}" x`);
      }
      for (const q of seqs) {
        const [r] = await tx.$queryRawUnsafe<{ v: string; c: boolean }[]>(`SELECT last_value::text AS v, is_called AS c FROM "${from}"."${q}"`);
        await tx.$queryRawUnsafe(`SELECT setval('"${to}"."${q}"', ${r.v}, ${r.c})`);
      }
    },
    { timeout: 120_000 },
  );
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

/** El guion B con las variables del dueño escritas en su sitio (las dos líneas `\set` ✏️ de arriba, v2 §14.3). */
export function limpiezaSql(opts: { respaldo?: string; cuentas?: string; commit?: boolean; frozen?: boolean }): string {
  // `frozen`: la copia congelada de `a7232d7a` (T-AC3), con las mismas dos líneas ✏️ y la misma última línea.
  let sql = opts.frozen ? readFrozenB() : readRepair('limpieza');
  const put = (name: string, value: string) => {
    const line = `\\set ${name} ''`;
    const count = sql.split(line).length - 1;
    if (count !== 1) throw new Error(`el guion debe tener EXACTAMENTE una línea «${line}» (tiene ${count})`);
    sql = sql.replace(line, `\\set ${name} '${value.replace(/'/g, "''")}'`);
  };
  put('respaldo_manual', opts.respaldo ?? '');
  put('cuentas_prueba', opts.cuentas ?? '');
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
