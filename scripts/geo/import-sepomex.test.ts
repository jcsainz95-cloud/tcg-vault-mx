/**
 * import-sepomex.test.ts — prueba del importador de SEPOMEX (DEVOPS_NOTES §79).                       · devops
 *
 * Parte 1 (siempre, sin base): el lector del TXT — Latin-1 y UTF-8, cabecera por nombre, duplicados, y que un
 * fichero corrupto a mitad sea ERROR (no «carga parcial»).
 * Parte 2 (solo con SEPOMEX_TEST_DATABASE_URL, una base DEDICADA cuyo nombre contenga «sepomex», en localhost):
 * carga, resolución por el MISMO `PostalCodeService.resolvePostalCode`/`canonicalize` de la app, idempotencia
 * (segunda corrida = cero escrituras, mismos ids), y que todo fallo —fichero corrupto, fallo dentro de la
 * transacción tras escribir, guarda de encogimiento— deja la tabla IDÉNTICA.
 *
 * Lanzador: scripts/geo/import-sepomex.sh test
 */
import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
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
  assert.deepEqual(r.discarded, { cp_no_5_digitos: 0, campo_vacio: 0, caracter_ilegible: 0 });
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
    .replace('|Monterrey Centro|', '|Monterrey \uFFFD|');
  const r = parseSepomex(enc(bad, 'utf8'));
  assert.deepEqual(r.discarded, { cp_no_5_digitos: 1, campo_vacio: 1, caracter_ilegible: 1 });
  assert.equal(r.stats.neighborhoods, 7);
  assert.ok(!r.rows.some((x) => x.postalCode === '06600'));
});

test('rechaza lo que no es el TXT: ZIP, XML, sin cabecera, vacío', () => {
  assert.throws(() => parseSepomex(Buffer.from('PK\u0003\u0004xxxx', 'latin1')), /ZIP/);
  assert.throws(() => parseSepomex(enc('<?xml version="1.0"?><NewDataSet/>')), /XML/);
  assert.throws(() => parseSepomex(enc('a|b|c\r\n1|2|3\r\n')), /cabecera/);
  assert.throws(() => parseSepomex(enc(asText().split('\r\n').slice(0, 2).join('\r\n'))), /ninguna fila/);
});


test('el archivo va fijado por sha256 (hermano `.sha256` o --sha256) y los pisos son constantes', async () => {
  const { readPinnedFile, C_GEO_FLOORS, HARNESS_POSTAL_CODES, floorFailures, ImportAbort } = await import('./import-sepomex');
  const { sha256 } = readPinnedFile(FIXTURE);
  assert.equal(sha256, readFileSync(`${FIXTURE}.sha256`, 'utf8').split(/\s+/)[0]);
  assert.throws(() => readPinnedFile(FIXTURE, '0'.repeat(64)), (e: unknown) => e instanceof ImportAbort && /≠ fijado/.test(e.message));
  assert.throws(() => readPinnedFile(FIXTURE, 'abc'), /forma de sha256/);
  // C-GEO-1 (2) y (3) tal cual el contrato; ⛔ no se bajan (si el archivo real no llega, errata del arquitecto)
  assert.deepEqual({ ...C_GEO_FLOORS }, { minRows: 100_000, minPostalCodes: 25_000, exactStates: 32 });
  assert.ok(Object.isFrozen(C_GEO_FLOORS));
  assert.deepEqual([...HARNESS_POSTAL_CODES], ['01000', '06600', '14210', '44100', '64000']);
  assert.equal(floorFailures(parseSepomex(latin1()).stats, C_GEO_FLOORS).length, 3); // el extracto NO pasa los pisos reales
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
// Pisos y CP del EXTRACTO (8 CP, 10 filas, 5 estados): la lógica es la misma que con los de C-GEO-1.
const FIX_FLOORS = { minRows: 10, minPostalCodes: 8, exactStates: 5 };

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
  return { prisma, svc, snapshot, ...mod };
}

test('boot (C-GEO-2): carga, resuelve, idempotente, nunca borra y falla-cerrado', { skip }, async () => {
  const h = await harness();
  const { prisma, svc, snapshot, bootCatalog, ImportAbort } = h;
  try {
    const rows = parseSepomex(latin1()).rows;

    // 1) arranque con la tabla vacía: inserta y C-GEO-1 se cumple
    const b1 = await bootCatalog(prisma, rows, FIX_FLOORS);
    assert.deepEqual([b1.skipped, b1.inserted], [false, 10]);
    assert.deepEqual({ ...b1.after, badShape: undefined }, { postalCodes: 8, neighborhoods: 10, municipalities: 8, states: 5, badShape: undefined });

    // 2) resolución por el cuerpo de la app (C-SDX-3)
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

    // 3) segundo arranque: no escribe, mismos ids
    const s1 = await snapshot();
    const b2 = await bootCatalog(prisma, rows, FIX_FLOORS);
    assert.deepEqual([b2.skipped, b2.inserted], [true, 0]);
    assert.equal(await snapshot(), s1);

    // 4) una fila de más en la tabla (p. ej. del arnés): el arranque NO la borra y C-GEO-1 (1) falla ⇒ ROLLBACK, ≠0
    await prisma.postalCode.create({ data: { postalCode: '06600', neighborhood: 'Roma Norte', municipality: 'Cuauhtémoc', state: 'Ciudad de México' } });
    const s2 = await snapshot();
    await assert.rejects(bootCatalog(prisma, rows, FIX_FLOORS), (e: unknown) => e instanceof ImportAbort && /\(1\) la tabla tiene 11 filas/.test(e.message));
    assert.equal(await snapshot(), s2);
    await prisma.postalCode.deleteMany({ where: { neighborhood: 'Roma Norte' } });

    // 5) falla-cerrado: archivo sin un CP del arnés ⇒ carga, (3) falla dentro de la tx ⇒ ROLLBACK (tabla vacía igual)
    await prisma.$executeRawUnsafe('DELETE FROM "PostalCode"');
    const sin14210 = rows.filter((r) => r.postalCode !== '14210');
    await assert.rejects(
      bootCatalog(prisma, sin14210, { minRows: 9, minPostalCodes: 7, exactStates: 5 }),
      (e: unknown) => e instanceof ImportAbort && /\(3\) resolvePostalCode\(14210\)/.test(e.message),
    );
    assert.equal((await prisma.postalCode.count()), 0);

    // 6) el archivo no alcanza el piso ⇒ ni abre la transacción
    await assert.rejects(bootCatalog(prisma, rows, { minRows: 11, minPostalCodes: 8, exactStates: 5 }), /no alcanza los pisos/);
    await assert.rejects(bootCatalog(prisma, rows, { minRows: 10, minPostalCodes: 8, exactStates: 32 }), /5 estados ≠ 32/);

    // 7) fallo a mitad de la transacción, tras insertar ⇒ ROLLBACK
    let seen = -1;
    await assert.rejects(
      bootCatalog(prisma, rows, FIX_FLOORS, undefined, {
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
