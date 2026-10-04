/**
 * import-sepomex.test.ts — prueba del importador de SEPOMEX (DEVOPS_NOTES §79–§81).                       · devops
 *
 * Norma: API_CONTRACT §M4-SHIP.19.24.9 (G1–G11) con la errata v1.80.12.5 (§M4-SHIP.19.25.4): `boot` retirado ⇒ G4
 * fuera; G5 = «`import` estricto sin manifiesto ⇒ sale 1»; G2/G9 en `verify` (alarma, solo lectura), G3/G6/G8 en
 * `import`; el test 19 (que exigía `boot` en el CMD) pasa a ser G-BOOT (el CMD NO lo corre). Sin base: lector,
 * manifiesto, modo (G1), G5, G10, G11, `boot` ya no es subcomando, G-BOOT. Con SEPOMEX_TEST_DATABASE_URL (localhost y
 * nombre con «sepomex»: la prueba vacía la tabla): arnés, G2, G3, G6, G7, G8, G9, `verify` vacía ⇒ 2, ROLLBACK e
 * `import` explícito, resolviendo por el MISMO `PostalCodeService` de la app.
 *
 * Lanzador: scripts/geo/import-sepomex.sh test
 */
import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { parseSepomex, SepomexParseError } from './sepomex-parse';

const FIXTURE = join(__dirname, 'fixtures', 'sepomex-extracto-sintetico.txt');
const latin1 = () => readFileSync(FIXTURE);
const asText = () => new TextDecoder('latin1').decode(latin1());
const enc = (s: string, e: 'latin1' | 'utf8' = 'latin1') => Buffer.from(s, e);

test('lee el extracto Latin-1 (CRLF, aviso, cabecera, `|` final, duplicado)', () => {
  const r = parseSepomex(latin1());
  assert.equal(r.encoding, 'latin1');
  assert.equal(r.sourceLines, 11);
  assert.equal(r.duplicatesDropped, 1); // «Peñón de los Baños» colonia + pueblo en 15520
  assert.equal(r.duplicatesWithOtherMunicipality, 0);
  assert.deepEqual(r.stats, { postalCodes: 8, neighborhoods: 10, municipalities: 8, states: 5 });
  assert.deepEqual(r.discarded, { cp_no_5_digitos: 0, campo_vacio: 0, caracter_ilegible: 0, separador_en_campo: 0 });
  const penon = r.rows.find((x) => x.postalCode === '15520');
  assert.deepEqual(penon, {
    postalCode: '15520',
    neighborhood: 'Peñón de los Baños',
    municipality: 'Venustiano Carranza',
    state: 'Ciudad de México',
  });
  assert.ok(r.rows.some((x) => x.neighborhood === 'Agüita Fría' && x.state === 'Michoacán de Ocampo'));
});

test('el mismo contenido en UTF-8 (con BOM) da las mismas filas', () => {
  const r = parseSepomex(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), enc(asText(), 'utf8')]));
  assert.equal(r.encoding, 'utf-8');
  assert.deepEqual(r.rows, parseSepomex(latin1()).rows);
});

test('columnas por NOMBRE: una cabecera reordenada da las mismas filas', () => {
  const lines = asText().split('\r\n');
  const swap = (l: string) => {
    const f = l.split('|');
    if (f.length < 5) return l;
    [f[0], f[4]] = [f[4], f[0]];
    return f.join('|');
  };
  const r = parseSepomex(enc([lines[0], ...lines.slice(1).map(swap)].join('\r\n')));
  assert.deepEqual(r.rows, parseSepomex(latin1()).rows);
});

test('corrupto a mitad ⇒ ERROR con número de línea (nunca carga parcial)', () => {
  const lines = asText().split('\r\n');
  const cut = [...lines.slice(0, 6), lines[6].slice(0, 20), ...lines.slice(7)].join('\r\n');
  assert.throws(() => parseSepomex(enc(cut)), (e: unknown) => e instanceof SepomexParseError && /línea 7/.test(e.message));
  // cortada DESPUÉS de las columnas que se usan: sigue siendo un fichero roto, y se rechaza
  const tail = lines[6].split('|').slice(0, 6).join('|');
  const cutLate = [...lines.slice(0, 6), tail, ...lines.slice(7)].join('\r\n');
  assert.throws(() => parseSepomex(enc(cutLate)), /6 campos, la cabecera tiene 15/);
});

test('filas inválidas se DESCARTAN y se cuentan por motivo (C-GEO-1 (1))', () => {
  const bad = asText()
    .replace('06600|Juárez', '6600|Juárez')
    .replace('|Agüita Fría|', '|   |')
    .replace('|Monterrey Centro|', '|Monterrey \uFFFD|')
    .replace('|Mérida Centro|', '|Mérida\tCentro|');
  const r = parseSepomex(enc(bad, 'utf8'));
  assert.deepEqual(r.discarded, { cp_no_5_digitos: 1, campo_vacio: 1, caracter_ilegible: 1, separador_en_campo: 1 });
  assert.equal(r.stats.neighborhoods, 6);
  assert.ok(!r.rows.some((x) => x.postalCode === '06600'));
});

test('rechaza lo que no es el TXT: ZIP, XML, sin cabecera, vacío', () => {
  assert.throws(() => parseSepomex(Buffer.from('PK\u0003\u0004xxxx', 'latin1')), /ZIP/);
  assert.throws(() => parseSepomex(enc('<?xml version="1.0"?><NewDataSet/>')), /XML/);
  assert.throws(() => parseSepomex(enc('a|b|c\r\n1|2|3\r\n')), /cabecera/);
  assert.throws(() => parseSepomex(enc(asText().split('\r\n').slice(0, 2).join('\r\n'))), /ninguna fila/);
});


// ------------------------------------------------------------------------------------------------ manifiesto, modo, pisos (sin base)
const FIX_MANIFEST = join(__dirname, 'fixtures', 'sepomex-extracto-sintetico.manifest.json');
// Pisos del EXTRACTO (8 CP, 10 filas, 5 estados): misma lógica que con los de C-GEO-1. El CLI no admite pisos.
const FIX_FLOORS = { minRows: 10, minPostalCodes: 8, exactStates: 5 };
const tmp = mkdtempSync(join(tmpdir(), 'sepomex-test-'));
process.on('exit', () => rmSync(tmp, { recursive: true, force: true }));

test('manifiesto: el commiteado del extracto es lo que el archivo deriva; huella por bytes', async () => {
  const { deriveFromFile, readManifest, setDigestOf } = await import('./import-sepomex');
  const m = readManifest(FIX_MANIFEST);
  assert.deepEqual(deriveFromFile(latin1()).manifest, m);
  assert.match(m.sourceNotice, /SINTÉTICO/);
  // el orden de entrada no cambia la huella; un municipio distinto sí
  const rows = parseSepomex(latin1()).rows;
  assert.equal(setDigestOf([...rows].reverse()), m.setDigest);
  assert.notEqual(setDigestOf(rows.map((r, i) => (i === 0 ? { ...r, municipality: 'X' } : r))), m.setDigest);
});

test('G1: el modo lo decide el blanco con assertSeedTarget (importada, no copiada)', async () => {
  const { classifyTarget } = await import('./import-sepomex');
  const u = (h: string) => `postgresql://u:p@${h}:5432/railway`;
  const env = {} as NodeJS.ProcessEnv;
  assert.equal(classifyTarget(u('postgres.railway.internal'), env), 'strict');
  assert.equal(classifyTarget(u('x.proxy.rlwy.net'), env), 'strict');
  assert.equal(classifyTarget(u('db.neon.tech'), env), 'strict');
  assert.equal(classifyTarget(u('localhost'), env), 'harness');
  assert.equal(classifyTarget(u('postgres'), env), 'harness');
  assert.equal(classifyTarget('postgresql://u:p@db.example.com:5432/tcg_staging', env), 'harness');
  assert.equal(classifyTarget(u('localhost'), env, true), 'strict'); // --strict fuerza; nada afloja
  assert.equal(classifyTarget(u('x.proxy.rlwy.net'), { SEED_E2E_ALLOW_HOST: 'x.proxy.rlwy.net' } as NodeJS.ProcessEnv), 'harness'); // la escotilla del seed, la misma
  const src = readFileSync(join(__dirname, 'import-sepomex.ts'), 'utf8');
  assert.match(src, /import \{ assertSeedTarget, SeedTargetRefusedError \} from '\.\.\/\.\.\/backend\/prisma\/seed-target-guard';/);
  assert.doesNotMatch(src, /isRecognizedSeedTarget|LOCAL_HOSTS|--harness|SEPOMEX_HARNESS/);
});

/** El CLI real, como lo corre el dueño (mismo node + ts-node que esta prueba, vía el lanzador). */
const CLI = join(__dirname, 'import-sepomex.ts');
function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
  const r = spawnSync(process.execPath, ['--require', 'ts-node/register', CLI, ...args], {
    env: { PATH: process.env.PATH, TS_NODE_PROJECT: process.env.TS_NODE_PROJECT, TS_NODE_TRANSPILE_ONLY: '1', ...env },
    encoding: 'utf8',
    timeout: 120_000,
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('`verify`/`import` saltan a DATABASE_PUBLIC_URL si DATABASE_URL es *.railway.internal (se lanzan desde fuera)', async () => {
  const { resolveDatabaseUrl, ImportAbort } = await import('./import-sepomex');
  const env = { DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/railway', DATABASE_PUBLIC_URL: 'postgresql://u:p@x.proxy.rlwy.net:1/railway' } as NodeJS.ProcessEnv;
  assert.equal(resolveDatabaseUrl(env).url, env.DATABASE_PUBLIC_URL);
  assert.throws(() => resolveDatabaseUrl({ DATABASE_URL: env.DATABASE_URL } as NodeJS.ProcessEnv), (e: unknown) => e instanceof ImportAbort && /DATABASE_PUBLIC_URL/.test(e.message));
  const local = { DATABASE_URL: 'postgresql://u:p@localhost:5432/x' } as NodeJS.ProcessEnv;
  assert.equal(resolveDatabaseUrl(local).url, local.DATABASE_URL);
});

test('`boot` retirado (§19.25.4): ni subcomando, ni función, ni rama en el lanzador; pedirlo es error de uso (64)', () => {
  const ts = readFileSync(CLI, 'utf8');
  assert.doesNotMatch(ts, /bootCatalog|BootOptions|BootReport|cmd === 'boot'|'boot'/);
  const sh = readFileSync(join(__dirname, 'import-sepomex.sh'), 'utf8');
  assert.doesNotMatch(sh.split('\n').filter((l) => !l.startsWith('#')).join('\n'), /\bboot\b/);
  const r = cli(['boot'], { DATABASE_URL: 'postgresql://u:p@localhost:1/x' });
  assert.equal(r.code, 64, r.out);
  assert.match(r.out, /^uso: manifest/m);
  assert.doesNotMatch(r.out, /boot/);
});

test('G5: `import` estricto sin manifiesto ⇒ sale 1, antes de tocar la base (puerto muerto: no llega a conectar)', () => {
  const r = cli(['import', '--file', FIXTURE, '--strict', '--manifest', join(tmp, 'no-existe.json')], { DATABASE_URL: 'postgresql://u:canario-g5@localhost:1/x' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no hay manifiesto \(no-existe\.json\)/);
  assert.doesNotMatch(r.out, /canario-g5|ECONNREFUSED|P1001/); // ni la contraseña, ni un intento de conexión
});

test('G10: manifiesto bajo los pisos de C-GEO-1 ⇒ error en estricto (con los pisos reales); en arnés no aplica', async () => {
  const { assertManifestFloors, readManifest, C_GEO_FLOORS, HARNESS_POSTAL_CODES } = await import('./import-sepomex');
  const m = readManifest(FIX_MANIFEST);
  assert.throws(() => assertManifestFloors(m, 'strict'), /no alcanza los pisos/);
  assert.doesNotThrow(() => assertManifestFloors(m, 'harness'));
  assert.doesNotThrow(() => assertManifestFloors(m, 'strict', FIX_FLOORS));
  assert.deepEqual({ ...C_GEO_FLOORS }, { minRows: 100_000, minPostalCodes: 25_000, exactStates: 32 });
  assert.ok(Object.isFrozen(C_GEO_FLOORS));
  assert.deepEqual([...HARNESS_POSTAL_CODES], ['01000', '06600', '14210', '44100', '64000']);
  // y por el CLI: el extracto (10 filas) en estricto ⇒ sale 1 por pisos, sin conectar
  const r = cli(['import', '--file', FIXTURE, '--strict'], { DATABASE_URL: 'postgresql://u:p@localhost:1/x' });
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /no alcanza los pisos/);
});

/** G11 (§19.24.7): el extracto es SINTÉTICO y pequeño. */
function assertSyntheticExtract(buf: Buffer): void {
  const lines = new TextDecoder('latin1').decode(buf).split(/\r?\n/);
  if (!/SINTÉTICO/.test(lines[0])) throw new Error('G11: la línea 1 del extracto no dice SINTÉTICO');
  const data = lines.slice(2).filter((l) => l.trim() !== '').length;
  if (data > 20) throw new Error(`G11: el extracto tiene ${data} filas de datos (> 20)`);
}

test('G11: candado del extracto (≤ 20 filas de datos y «SINTÉTICO» en la línea 1) + canarios', () => {
  assertSyntheticExtract(latin1());
  const lines = asText().split('\r\n').filter((l) => l !== '');
  const extra = Array.from({ length: 21 - (lines.length - 2) }, (_, i) => `2${String(i).padStart(4, '0')}|Inventada ${i}|Colonia|M|E|C|||||||||`);
  assert.throws(() => assertSyntheticExtract(enc([...lines, ...extra].join('\r\n'))), /21 filas de datos/);
  assert.throws(() => assertSyntheticExtract(enc([lines[0].replace('SINTÉTICO', 'OFICIAL'), ...lines.slice(1)].join('\r\n'))), /SINTÉTICO/);
});

// ------------------------------------------------------------------------------------------------ con base
const DB_URL = process.env.SEPOMEX_TEST_DATABASE_URL;
const dbOk = (() => {
  if (!DB_URL) return false;
  const u = new URL(DB_URL);
  if (!['localhost', '127.0.0.1', '::1'].includes(u.hostname) || !/sepomex/.test(u.pathname)) {
    throw new Error('SEPOMEX_TEST_DATABASE_URL debe ser localhost y una base cuyo nombre contenga «sepomex» (la prueba la vacía)');
  }
  return true;
})();
const skip = !dbOk && 'sin SEPOMEX_TEST_DATABASE_URL';

async function harness() {
  // Importes perezosos: sin base, la parte pura no necesita el cliente de Prisma generado.
  const { PrismaService } = await import('../../backend/src/prisma/prisma.service');
  const { LocalPostalCodeSource, PostalCodeService } = await import('../../backend/src/modules/shipping-provider/geo/postal-code');
  const mod = await import('./import-sepomex');
  const prisma = new PrismaService({ datasources: { db: { url: DB_URL! } } });
  const svc = new PostalCodeService([new LocalPostalCodeSource(prisma)]);
  const snapshot = async () =>
    JSON.stringify(await prisma.postalCode.findMany({ orderBy: [{ postalCode: 'asc' }, { neighborhood: 'asc' }] }));
  /** El contenido sin `id`: tras una reparación la fila re-insertada trae un `id` nuevo (lo que importa son las 4 columnas). */
  const content = async () =>
    JSON.stringify(await prisma.postalCode.findMany({ select: { postalCode: true, neighborhood: true, municipality: true, state: true }, orderBy: [{ postalCode: 'asc' }, { neighborhood: 'asc' }] }));
  await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
  /** Un obtenedor de archivo que cuenta llamadas (G6). */
  const counting = (buf: Buffer) => {
    const src = { describe: 'doble', calls: 0, fetch: async () => (src.calls++, buf) };
    return src;
  };
  const m = mod.readManifest(FIX_MANIFEST);
  const rows = await mod.obtainVerified(mod.localFile(FIXTURE), m);
  const load = (mode: 'strict' | 'harness', extra: Partial<Parameters<typeof mod.importCatalog>[1]> = {}) =>
    mod.importCatalog(prisma, { mode, manifest: m, rows, floors: FIX_FLOORS, ...extra });
  const verify = (mode: 'strict' | 'harness', extra: Partial<Parameters<typeof mod.verifyCatalog>[1]> = {}) =>
    mod.verifyCatalog(prisma, { mode, manifestPath: FIX_MANIFEST, source: mod.localFile(FIXTURE), floors: FIX_FLOORS, ...extra });
  return { prisma, svc, snapshot, content, counting, load, verify, m, rows, ...mod };
}

/**
 * La colonia canónica tal como la resuelve la app: `resolvePostalCode` (el ÚNICO cuerpo que lee `PostalCode`, C-SDX-3)
 * + `normalizeColonia`. No usa la función de alto nivel de backend (que v1.80.12.5 renombra): lo que se prueba aquí es
 * el catálogo que deja el importador, no la regla de la dirección.
 */
async function canon(svc: { resolvePostalCode(cp: string): Promise<{ entries: { neighborhood: string; municipality: string; state: string }[] } | null> }, cp: string, typed: string) {
  const { normalizeColonia } = await import('../../backend/src/modules/shipping-provider/geo/postal-code');
  const hit = (await svc.resolvePostalCode(cp))?.entries.find((e) => normalizeColonia(e.neighborhood) === normalizeColonia(typed));
  return hit ? { postalCode: cp, neighborhood: hit.neighborhood, city: hit.municipality, state: hit.state } : null;
}

test('arnés: `import` carga el extracto y resuelve por el cuerpo de la app; falla-cerrado y ROLLBACK', { skip }, async () => {
  const { prisma, svc, load, ImportAbort, deriveFromFile, obtainVerified, localFile, readManifest } = await harness();
  try {
    const r1 = await load('harness');
    assert.deepEqual([r1.added, r1.removed, r1.inclusion.missing], [10, 0, 0]);
    const gdl = await svc.resolvePostalCode('44100');
    assert.deepEqual(gdl?.entries.map((e) => e.neighborhood), ['Centro Barranquitas', 'Guadalajara Centro']);
    assert.equal(gdl?.source, 'local');
    assert.deepEqual((await svc.resolvePostalCode('06600'))?.entries, [{ neighborhood: 'Juárez', municipality: 'Cuauhtémoc', state: 'Ciudad de México' }]);
    assert.deepEqual(await canon(svc, '15520', '  penon   de los BANOS '), {
      postalCode: '15520',
      neighborhood: 'Peñón de los Baños',
      city: 'Venustiano Carranza',
      state: 'Ciudad de México',
    });
    assert.equal((await canon(svc, '58000', 'AGUITA FRIA'))?.neighborhood, 'Agüita Fría');
    assert.equal((await canon(svc, '14210', 'jardines de la montana'))?.neighborhood, 'Jardines de la Montaña');
    assert.equal(await svc.resolvePostalCode('99999'), null);
    const r2 = await load('harness');
    assert.deepEqual([r2.added, r2.inclusion.missing], [0, 0]);

    // (3): un archivo sin un CP del arnés (con SU manifiesto) ⇒ carga, (3) falla dentro de la tx ⇒ ROLLBACK
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    const sin = enc(asText().split('\r\n').filter((l) => !l.startsWith('14210|')).join('\r\n'));
    const f = join(tmp, 'sin14210.txt');
    writeFileSync(f, sin);
    writeFileSync(join(tmp, 'sin14210.manifest.json'), JSON.stringify(deriveFromFile(sin).manifest));
    const m2 = readManifest(join(tmp, 'sin14210.manifest.json'));
    await assert.rejects(
      load('harness', { manifest: m2, rows: await obtainVerified(localFile(f), m2) }),
      (e: unknown) => e instanceof ImportAbort && /\(3\) resolvePostalCode\(14210\)/.test(e.message),
    );
    assert.equal(await prisma.postalCode.count(), 0);

    // fallo a mitad de la transacción, tras insertar ⇒ ROLLBACK (en los dos modos)
    for (const mode of ['harness', 'strict'] as const) {
      let seen = -1;
      await assert.rejects(
        load(mode, {
          afterWrite: async () => {
            seen = await prisma.postalCode.count(); // fuera de la tx: no ve nada
            throw new Error('fallo simulado');
          },
        }),
        /fallo simulado/,
      );
      assert.deepEqual([mode, seen, await prisma.postalCode.count()], [mode, 0, 0]);
    }
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G3: arnés + filas de E2E_POSTAL_CODES + archivo ⇒ `import` bien, ajenas contadas, impresas y NO borradas', { skip }, async () => {
  const { prisma, load } = await harness();
  const { E2E_POSTAL_CODES } = await import('../../backend/prisma/e2e-fixtures');
  try {
    await prisma.postalCode.createMany({ data: [...E2E_POSTAL_CODES], skipDuplicates: true });
    const logs: string[] = [];
    const r = await load('harness', { log: (l) => logs.push(l) });
    assert.deepEqual([r.inclusion.missing, r.inclusion.discrepant, r.inclusion.foreign, r.removed], [0, 0, 2, 0]); // 01000 «Centro», 06600 «Roma Norte»
    assert.ok(logs.some((l) => /ajenas 2 \[.*Roma Norte/.test(l)), logs.join('\n'));
    assert.equal(await prisma.postalCode.count({ where: { neighborhood: 'Roma Norte' } }), 1);
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G2/G6/G8/G9: estricto — sha antes de leer, carga, `verify` alarma sin borrar, `import` repara y reconcilia', { skip }, async () => {
  const { prisma, snapshot, content, counting, load, verify, obtainVerified, m, ImportAbort } = await harness();
  try {
    // G6: objeto con sha256 distinto ⇒ error de sha ANTES de interpretarlo (basura no parseable: si se parseara antes, el error sería otro)
    const bad = counting(Buffer.from('esto no es un TXT de SEPOMEX', 'utf8'));
    await assert.rejects(obtainVerified(bad, m), (e: unknown) => e instanceof ImportAbort && /sha256 del archivo/.test(e.message));
    assert.deepEqual([bad.calls, await prisma.postalCode.count()], [1, 0]);

    // carga estricta desde vacío (§19.25.4: «tabla vacía ⇒ carga normal, todo es falta»)
    const r1 = await load('strict');
    assert.deepEqual([r1.added, r1.updated, r1.removed, r1.inclusion.missing], [10, 0, 0, 0]);
    const s1 = await snapshot();
    const c1 = await content();
    assert.deepEqual(await verify('strict'), { empty: false, fails: [] });
    assert.deepEqual(await verify('strict', { source: null }), { empty: false, fails: [] }); // (1b) por huella, sin archivo
    // idempotente: segunda carga, cero cambios
    const r2 = await load('strict');
    assert.deepEqual([r2.added, r2.updated, r2.removed], [0, 0, 0]);
    assert.equal(await snapshot(), s1);

    // G2: una fila ajena ⇒ `verify` estricto da ALARMA, y como es solo lectura la fila SIGUE y la tabla es idéntica
    await prisma.postalCode.create({ data: { postalCode: '06600', neighborhood: 'Roma Norte', municipality: 'Cuauhtémoc', state: 'Ciudad de México' } });
    const s2 = await snapshot();
    const v2 = await verify('strict');
    assert.match(v2.fails.join('; '), /ALARMA: 0 discrepantes y 1 ajenas/);
    assert.match(v2.fails.join('; '), /\(1b\) setDigest\(tabla\)/);
    assert.match((await verify('strict', { source: null })).fails.join('; '), /\(1b\)/); // sin archivo, la huella también la ve
    assert.equal(await snapshot(), s2);
    // …y en arnés la misma fila es tolerada (autor legítimo: el seed)
    assert.deepEqual((await verify('harness')).fails, []);
    // `import` estricto es el acto que la corrige: reconcilia (§19.24.5) y vuelve a la huella del manifiesto
    const r3 = await load('strict');
    assert.deepEqual([r3.added, r3.updated, r3.removed], [0, 0, 1]);
    assert.equal(await snapshot(), s1);

    // G9: misma clave, otro municipio ⇒ `verify` estricto da alarma (el conteo y la clave no lo verían; la huella sí)
    await prisma.postalCode.updateMany({ where: { postalCode: '06600', neighborhood: 'Juárez' }, data: { municipality: 'OTRO' } });
    const s3 = await snapshot();
    assert.match((await verify('strict')).fails.join('; '), /ALARMA: 1 discrepantes y 0 ajenas/);
    assert.equal(await snapshot(), s3);
    const r4 = await load('strict');
    assert.deepEqual([r4.added, r4.updated, r4.removed], [0, 1, 0]);

    // G8: falta UNA fila del archivo y nada más ⇒ `import` la inserta y sale bien (reparación sin borrar)
    await prisma.postalCode.deleteMany({ where: { postalCode: '97000' } });
    assert.match((await verify('strict')).fails.join('; '), /\(1a\) faltan 1/);
    const r5 = await load('strict');
    assert.deepEqual([r5.added, r5.updated, r5.removed], [1, 0, 0]);
    assert.equal(await content(), c1);
    assert.deepEqual(await verify('strict'), { empty: false, fails: [] });
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('`verify` con la tabla vacía ⇒ «catálogo vacío» y sale 2 (≠ 1 «cargado pero mal»), aunque no haya manifiesto', { skip }, async () => {
  const { prisma, verify } = await harness();
  try {
    const logs: string[] = [];
    assert.deepEqual(await verify('strict', { manifestPath: null, source: null, log: (l) => logs.push(l) }), { empty: true, fails: [] });
    assert.deepEqual(logs, ['[sepomex] catálogo vacío: 0 filas (no cargado)']);
    // por el CLI, en los dos modos (localhost es arnés; --strict fuerza)
    for (const extra of [[], ['--strict']]) {
      const r = cli(['verify', ...extra], { DATABASE_URL: DB_URL });
      assert.equal(r.code, 2, r.out);
      assert.match(r.out, /\[sepomex\] catálogo vacío: 0 filas \(no cargado\)/);
    }
    // con filas y sin manifiesto ya no es «vacío»: es error (1)
    await prisma.postalCode.create({ data: { postalCode: '06600', neighborhood: 'Juárez', municipality: 'Cuauhtémoc', state: 'Ciudad de México' } });
    const r = cli(['verify', '--strict', '--manifest', join(tmp, 'no-existe.json')], { DATABASE_URL: DB_URL });
    assert.equal(r.code, 1, r.out);
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G7: setDigest en TS = en SQL aunque la intercalación ordene distinto que los bytes', { skip }, async () => {
  const { prisma, sqlSetDigest, setDigestOf } = await harness();
  try {
    const rows = ['Zapata', 'Ángel', 'a', 'B', 'ñu', 'nz', 'Ñandú', 'Óscar'].map((n, i) => ({
      postalCode: i % 2 ? '01000' : '00100',
      neighborhood: n,
      municipality: 'M',
      state: 'E',
    }));
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        `CREATE TEMP TABLE g7 ("postalCode" text COLLATE "und-x-icu", neighborhood text COLLATE "und-x-icu", municipality text, state text) ON COMMIT DROP`,
      );
      for (const r of rows) await tx.$executeRawUnsafe(`INSERT INTO g7 VALUES ($1, $2, $3, $4)`, r.postalCode, r.neighborhood, r.municipality, r.state);
      // premisa del canario: la intercalación de la columna NO ordena por bytes
      const icu = (await tx.$queryRawUnsafe<{ n: string }[]>(`SELECT neighborhood AS n FROM g7 ORDER BY "postalCode", neighborhood`)).map((x) => x.n);
      const bytes = (await tx.$queryRawUnsafe<{ n: string }[]>(`SELECT neighborhood AS n FROM g7 ORDER BY "postalCode" COLLATE "C", neighborhood COLLATE "C"`)).map((x) => x.n);
      assert.notDeepEqual(icu, bytes);
      assert.equal(await sqlSetDigest(tx, 'g7'), setDigestOf(rows));
    });
  } finally {
    await prisma.$disconnect();
  }
});


test('import explícito: idempotente, y todo fallo deja la tabla idéntica', { skip }, async () => {
  const { prisma, svc, snapshot, syncPostalCodes, ImportAbort } = await harness();
  try {
    const rows = parseSepomex(latin1()).rows;
    const r1 = await syncPostalCodes(prisma, rows);
    assert.deepEqual([r1.added, r1.updated, r1.removed], [10, 0, 0]);

    const s1 = await snapshot();
    const r2 = await syncPostalCodes(prisma, rows);
    assert.deepEqual([r2.added, r2.updated, r2.removed], [0, 0, 0]);
    assert.equal(await snapshot(), s1);

    // fichero corrupto a mitad: el lector lo para antes de abrir la transacción
    const lines = asText().split('\r\n');
    assert.throws(() => parseSepomex(enc([...lines.slice(0, 8), '64000|Monterrey', ...lines.slice(9)].join('\r\n'))), SepomexParseError);
    assert.equal(await snapshot(), s1);

    // fallo DENTRO de la transacción, tras altas, cambios y bajas ⇒ ROLLBACK
    const changed = rows
      .filter((r) => r.postalCode !== '97000')
      .map((r) => (r.postalCode === '06600' ? { ...r, municipality: 'OTRO' } : r))
      .concat([{ postalCode: '20000', neighborhood: 'Zona Centro', municipality: 'Aguascalientes', state: 'Aguascalientes' }]);
    await assert.rejects(syncPostalCodes(prisma, changed, { allowShrink: true, afterWriteHook: () => { throw new Error('fallo simulado'); } }), /fallo simulado/);
    assert.equal(await snapshot(), s1);

    // guarda de encogimiento (dentro de la tx)
    await assert.rejects(syncPostalCodes(prisma, rows.slice(0, 2)), (e: unknown) => e instanceof ImportAbort && /quitaría 8 de 10/.test(e.message));
    assert.equal(await snapshot(), s1);

    // sin fallo aplica exactamente lo esperado (1 de 10 = 10 %, no supera el límite)
    const r3 = await syncPostalCodes(prisma, changed);
    assert.deepEqual([r3.added, r3.updated, r3.removed], [1, 1, 1]);
    assert.equal((await canon(svc, '06600', 'juarez'))?.city, 'OTRO');
    assert.equal(await svc.resolvePostalCode('97000'), null);
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G-BOOT (§19.25.4, sustituye al test 19 de §80.2): ningún arranque corre el importador; canario: reponer `boot` ⇒ ROJO', () => {
  const root = join(__dirname, '..', '..');
  const gate = join(root, 'scripts', 'check-boot-no-geo.sh');
  // 1) El candado sobre el árbol real ⇒ verde.
  const real = spawnSync('bash', [gate, '--root', root], { encoding: 'utf8' });
  assert.equal(real.status, 0, `${real.stdout}${real.stderr}`);
  // 2) Lo mismo, leído aquí sin el script (dos implementaciones: si una se rompe, la otra lo dice).
  const dk = readFileSync(join(root, 'Dockerfile.backend'), 'utf8');
  const cmd = dk.split('\n').filter((l) => /^\s*CMD\b/.test(l));
  assert.equal(cmd.length, 1);
  assert.doesNotMatch(cmd[0], /import-sepomex|scripts\/geo|\/opt\/geo/);
  assert.match(cmd[0], /migrate deploy && node dist\/main\.js"\]$/);
  const code = dk.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(code, /scripts\/geo|\/opt\/geo|import-sepomex/);
  const di = readFileSync(join(root, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  assert.ok(di.includes('scripts') && !di.some((l) => /^!\/?scripts(\/geo|\/?$|\/\*)/.test(l)), '.dockerignore: scripts fuera y scripts/geo sin reincluir');
  // 3) Canario: el CMD de v1.80.12.4 (con `boot`) en una copia ⇒ el candado se pone ROJO y nombra el CMD.
  const copy = join(tmp, 'gboot');
  mkdirSync(join(copy, 'scripts'), { recursive: true });
  for (const f of ['Dockerfile.backend', '.dockerignore', 'railway.json']) copyFileSync(join(root, f), join(copy, f));
  copyFileSync(gate, join(copy, 'scripts', 'check-boot-no-geo.sh'));
  const boot = 'TS_NODE_PROJECT=/app/tsconfig.json TS_NODE_TRANSPILE_ONLY=1 node -r ts-node/register /opt/geo/scripts/geo/import-sepomex.ts boot';
  const mutated = dk.replace(/(migrate deploy) && node dist\/main\.js"\]/, `$1 && ${boot} && node dist/main.js"]`);
  assert.notEqual(mutated, dk, 'el canario no encontró el CMD que muta');
  writeFileSync(join(copy, 'Dockerfile.backend'), mutated);
  const red = spawnSync('bash', [join(copy, 'scripts', 'check-boot-no-geo.sh'), '--root', copy], { encoding: 'utf8' });
  assert.equal(red.status, 1, red.stdout);
  assert.match(red.stdout, /\(A\) Dockerfile\.backend:\d+ — el CMD\/ENTRYPOINT corre el importador/);
});
