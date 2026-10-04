/**
 * import-sepomex.test.ts — prueba del importador de SEPOMEX (DEVOPS_NOTES §79–§80).                       · devops
 *
 * Norma: API_CONTRACT §M4-SHIP.19.24.9 (G1–G11). Sin base: lector, manifiesto, modo (G1), sin manifiesto (G5), pisos
 * (G10), arnés sin archivo, candado del extracto (G11). Con SEPOMEX_TEST_DATABASE_URL (localhost y nombre con
 * «sepomex»: la prueba vacía la tabla): arnés, G2, G3, G4, G6, G7, G8, G9, ROLLBACK e `import` explícito, resolviendo
 * por el MISMO `PostalCodeService` de la app.
 *
 * Lanzador: scripts/geo/import-sepomex.sh test
 */
import { strict as assert } from 'node:assert';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('boot clasifica y escribe con DATABASE_URL tal cual (sin salto a DATABASE_PUBLIC_URL); verify/import sí saltan', async () => {
  const { resolveDatabaseUrl } = await import('./import-sepomex');
  const env = { DATABASE_URL: 'postgresql://u:p@postgres.railway.internal:5432/railway', DATABASE_PUBLIC_URL: 'postgresql://u:p@x.proxy.rlwy.net:1/railway' } as NodeJS.ProcessEnv;
  assert.equal(resolveDatabaseUrl(env, { allowPublicFallback: false }).url, env.DATABASE_URL);
  assert.equal(resolveDatabaseUrl(env, { allowPublicFallback: true }).url, env.DATABASE_PUBLIC_URL);
  const src = readFileSync(join(__dirname, 'import-sepomex.ts'), 'utf8');
  const bootBlock = src.slice(src.indexOf("if (cmd === 'boot') {"), src.indexOf("if (cmd === 'boot') {") + 300);
  assert.match(bootBlock, /resolveDatabaseUrl\(process\.env, \{ allowPublicFallback: false \}\)/);
});

test('G5: estricto sin manifiesto ⇒ error (antes de tocar la base)', async () => {
  const { bootCatalog, ImportAbort } = await import('./import-sepomex');
  await assert.rejects(bootCatalog(null, { mode: 'strict', manifestPath: null, source: null }), (e: unknown) => e instanceof ImportAbort && /no hay manifiesto/.test(e.message));
  await assert.rejects(bootCatalog(null, { mode: 'strict', manifestPath: join(tmp, 'no-existe.json'), source: null }), /no hay manifiesto/);
});

test('G10: manifiesto bajo los pisos de C-GEO-1 ⇒ error (con los pisos reales)', async () => {
  const { bootCatalog, C_GEO_FLOORS, HARNESS_POSTAL_CODES } = await import('./import-sepomex');
  await assert.rejects(bootCatalog(null, { mode: 'strict', manifestPath: FIX_MANIFEST, source: null }), /no alcanza los pisos/);
  assert.deepEqual({ ...C_GEO_FLOORS }, { minRows: 100_000, minPostalCodes: 25_000, exactStates: 32 });
  assert.ok(Object.isFrozen(C_GEO_FLOORS));
  assert.deepEqual([...HARNESS_POSTAL_CODES], ['01000', '06600', '14210', '44100', '64000']);
});

test('arnés sin archivo ⇒ no carga, sale bien, sin base ni red', async () => {
  const { bootCatalog } = await import('./import-sepomex');
  const lines: string[] = [];
  const r = await bootCatalog(null, { mode: 'harness', manifestPath: null, source: null, log: (l) => lines.push(l) });
  assert.equal(r.outcome, 'harness-no-file');
  assert.deepEqual(lines, ['[sepomex] modo arnés: sin archivo, no se carga; los CP los siembra el arnés']);
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
  await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
  /** Un obtenedor de archivo que cuenta llamadas (G4/G6). */
  const counting = (buf: Buffer) => {
    const src = { describe: 'doble', calls: 0, fetch: async () => (src.calls++, buf) };
    return src;
  };
  const boot = (mode: 'strict' | 'harness', extra: Partial<Parameters<typeof mod.bootCatalog>[1]> = {}) =>
    mod.bootCatalog(prisma, { mode, manifestPath: FIX_MANIFEST, source: mod.localFile(FIXTURE), floors: FIX_FLOORS, ...extra });
  return { prisma, svc, snapshot, counting, boot, ...mod };
}

test('arnés: carga el extracto y resuelve por el cuerpo de la app; falla-cerrado y ROLLBACK', { skip }, async () => {
  const { prisma, svc, boot, ImportAbort, deriveFromFile, localFile } = await harness();
  try {
    const r1 = await boot('harness');
    assert.deepEqual([r1.outcome, r1.inserted, r1.inclusion?.missing], ['loaded', 10, 0]);
    const gdl = await svc.resolvePostalCode('44100');
    assert.deepEqual(gdl?.entries.map((e) => e.neighborhood), ['Centro Barranquitas', 'Guadalajara Centro']);
    assert.equal(gdl?.source, 'local');
    assert.deepEqual((await svc.resolvePostalCode('06600'))?.entries, [{ neighborhood: 'Juárez', municipality: 'Cuauhtémoc', state: 'Ciudad de México' }]);
    assert.deepEqual(await svc.canonicalize('15520', '  penon   de los BANOS '), {
      postalCode: '15520',
      neighborhood: 'Peñón de los Baños',
      city: 'Venustiano Carranza',
      state: 'Ciudad de México',
    });
    assert.equal((await svc.canonicalize('58000', 'AGUITA FRIA')).neighborhood, 'Agüita Fría');
    assert.equal((await svc.canonicalize('14210', 'jardines de la montana')).neighborhood, 'Jardines de la Montaña');
    assert.equal(await svc.resolvePostalCode('99999'), null);
    const r2 = await boot('harness');
    assert.deepEqual([r2.inserted, r2.inclusion?.missing], [0, 0]);

    // (3): un archivo sin un CP del arnés (con SU manifiesto) ⇒ carga, (3) falla dentro de la tx ⇒ ROLLBACK
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    const sin = enc(asText().split('\r\n').filter((l) => !l.startsWith('14210|')).join('\r\n'));
    const f = join(tmp, 'sin14210.txt');
    writeFileSync(f, sin);
    writeFileSync(join(tmp, 'sin14210.manifest.json'), JSON.stringify(deriveFromFile(sin).manifest));
    await assert.rejects(
      boot('harness', { source: localFile(f), manifestPath: join(tmp, 'sin14210.manifest.json') }),
      (e: unknown) => e instanceof ImportAbort && /\(3\) resolvePostalCode\(14210\)/.test(e.message),
    );
    assert.equal(await prisma.postalCode.count(), 0);

    // fallo a mitad de la transacción, tras insertar ⇒ ROLLBACK
    let seen = -1;
    await assert.rejects(
      boot('harness', {
        afterWrite: async () => {
          seen = await prisma.postalCode.count(); // fuera de la tx: no ve nada
          throw new Error('fallo simulado');
        },
      }),
      /fallo simulado/,
    );
    assert.deepEqual([seen, await prisma.postalCode.count()], [0, 0]);
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G3: arnés + filas de E2E_POSTAL_CODES + archivo ⇒ bien, ajenas contadas e impresas', { skip }, async () => {
  const { prisma, boot } = await harness();
  const { E2E_POSTAL_CODES } = await import('../../backend/prisma/e2e-fixtures');
  try {
    await prisma.postalCode.createMany({ data: [...E2E_POSTAL_CODES], skipDuplicates: true });
    const logs: string[] = [];
    const r = await boot('harness', { log: (l) => logs.push(l) });
    assert.equal(r.outcome, 'loaded');
    assert.deepEqual([r.inclusion?.missing, r.inclusion?.discrepant, r.inclusion?.foreign], [0, 0, 2]); // 01000 «Centro», 06600 «Roma Norte»
    assert.ok(logs.some((l) => /ajenas 2 \[.*Roma Norte/.test(l)), logs.join('\n'));
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('G2/G4/G6/G8/G9: modo estricto — alarma sin borrar, re-arranque sin archivo, sha antes de leer, reparación', { skip }, async () => {
  const { prisma, snapshot, counting, boot, ImportAbort } = await harness();
  try {
    // G6: objeto con sha256 distinto ⇒ error de sha ANTES de interpretarlo (basura no parseable: si se parseara antes, el error sería otro)
    const bad = counting(Buffer.from('esto no es un TXT de SEPOMEX', 'utf8'));
    await assert.rejects(boot('strict', { source: bad }), (e: unknown) => e instanceof ImportAbort && /sha256 del archivo/.test(e.message));
    assert.deepEqual([bad.calls, await prisma.postalCode.count()], [1, 0]);

    // carga estricta desde vacío
    const r1 = await boot('strict');
    assert.deepEqual([r1.outcome, r1.inserted], ['loaded', 10]);
    const s1 = await snapshot();

    // G4: tabla = manifiesto ⇒ sin escribir y SIN pedir el archivo
    const spy = counting(latin1());
    const r2 = await boot('strict', { source: spy });
    assert.deepEqual([r2.outcome, r2.inserted, spy.calls], ['already-loaded', 0, 0]);
    assert.equal(await snapshot(), s1);
    // …y sin obtenedor alguno, igual
    assert.equal((await boot('strict', { source: null })).outcome, 'already-loaded');

    // G2: una fila ajena ⇒ alarma, sale con error, la fila SIGUE, tabla idéntica
    await prisma.postalCode.create({ data: { postalCode: '06600', neighborhood: 'Roma Norte', municipality: 'Cuauhtémoc', state: 'Ciudad de México' } });
    const s2 = await snapshot();
    await assert.rejects(boot('strict'), (e: unknown) => e instanceof ImportAbort && /ALARMA: 0 discrepantes y 1 ajenas/.test(e.message));
    assert.equal(await snapshot(), s2);
    // y sin archivo, la huella distinta tampoco pasa
    await assert.rejects(boot('strict', { source: null }), /no coincide con el manifiesto/);
    await prisma.postalCode.deleteMany({ where: { neighborhood: 'Roma Norte' } });
    assert.equal(await snapshot(), s1);

    // G9: misma clave, otro municipio ⇒ alarma (el conteo y la clave no lo verían; la huella sí)
    await prisma.postalCode.updateMany({ where: { postalCode: '06600', neighborhood: 'Juárez' }, data: { municipality: 'OTRO' } });
    const s3 = await snapshot();
    await assert.rejects(boot('strict'), (e: unknown) => e instanceof ImportAbort && /1 discrepantes y 0 ajenas/.test(e.message));
    assert.equal(await snapshot(), s3);
    await prisma.postalCode.updateMany({ where: { postalCode: '06600', neighborhood: 'Juárez' }, data: { municipality: 'Cuauhtémoc' } });

    // G8: falta UNA fila del archivo y nada más ⇒ la inserta y sale bien (reparación sin borrar)
    await prisma.postalCode.deleteMany({ where: { postalCode: '97000' } });
    const r3 = await boot('strict');
    assert.deepEqual([r3.outcome, r3.inserted], ['loaded', 1]);
    assert.equal((await boot('strict', { source: null })).outcome, 'already-loaded');
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
    assert.equal((await svc.canonicalize('06600', 'juarez')).city, 'OTRO');
    assert.equal(await svc.resolvePostalCode('97000'), null);
  } finally {
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    await prisma.$disconnect();
  }
});

test('C-GEO-2 cableado: el CMD corre `boot` entre `migrate deploy` y `node dist/main.js`; la imagen trae el importador y no su prueba', () => {
  const root = join(__dirname, '..', '..');
  const dk = readFileSync(join(root, 'Dockerfile.backend'), 'utf8');
  const cmd = dk.split('\n').filter((l) => /^\s*CMD\b/.test(l));
  assert.equal(cmd.length, 1);
  const c = cmd[0];
  const iMig = c.indexOf('migrate deploy');
  const iBoot = c.indexOf('/opt/geo/scripts/geo/import-sepomex.ts boot');
  const iMain = c.indexOf('node dist/main.js');
  assert.ok(iMig > 0 && iBoot > iMig && iMain > iBoot, `orden del CMD: ${c}`);
  assert.match(c.slice(iMig), /migrate deploy && .*import-sepomex\.ts boot && node dist\/main\.js/); // `&&`: falla-cerrado
  assert.doesNotMatch(c, /import-sepomex\.ts boot[^&]*--(file|manifest)/); // hoy sin archivo (G-1 abierta)
  assert.match(dk, /COPY --chown=nestjs:nodejs scripts\/geo\/ \/opt\/geo\/scripts\/geo\//);
  const di = readFileSync(join(root, '.dockerignore'), 'utf8').split('\n').map((l) => l.trim());
  const at = (x: string) => di.lastIndexOf(x);
  assert.ok(at('!scripts/geo') > at('scripts'), '.dockerignore: !scripts/geo después de scripts');
  assert.ok(at('scripts/geo/*.test.ts') > at('!scripts/geo') && at('scripts/geo/fixtures') > at('!scripts/geo'), '.dockerignore: prueba y extracto fuera');
});
