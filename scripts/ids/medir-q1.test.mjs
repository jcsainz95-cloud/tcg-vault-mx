// scripts/ids/medir-q1.test.mjs — el botón «Medir D-IDS-1» corre de verdad contra una base y su prueba de solo lectura muerde.   · devops
//   IDS_FOTO_TEST_DATABASE_URL=postgresql://… node --test scripts/ids/medir-q1.test.mjs
// Solo con IDS_FOTO_TEST_DATABASE_URL (una base DESECHABLE y migrada, nunca producción; en CI, la del job `backend`).
// Sin ella se omite, y el paso de CI exige `# skipped 0`. DEVOPS_NOTES §108.5.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const URL_DB = process.env.IDS_FOTO_TEST_DATABASE_URL;

function correr(root) {
  const dir = mkdtempSync(join(tmpdir(), 'ids-q1-'));
  const summary = join(dir, 'summary.md');
  writeFileSync(summary, '');
  const env = { PATH: process.env.PATH, HOME: process.env.HOME, GITHUB_ACTIONS: 'true', GITHUB_SHA: 'test', GITHUB_STEP_SUMMARY: summary, IDS_RO_DATABASE_URL: URL_DB };
  const r = spawnSync('bash', [join(root, 'scripts/ids/medir-q1-produccion.sh')], { env, encoding: 'utf8' });
  const out = { rc: r.status, log: r.stdout + r.stderr, summary: readFileSync(summary, 'utf8') };
  rmSync(dir, { recursive: true, force: true });
  return out;
}
const sinMascaras = (log) => log.split('\n').filter((l) => !l.startsWith('::add-mask::')).join('\n');

test('el botón mide: rc 0, prueba 25006, Q1 en el resumen, sin la URL en log ni resumen', { skip: !URL_DB }, () => {
  const { rc, log, summary } = correr(join(HERE, '../..'));
  assert.equal(rc, 0, log);
  assert.match(log, /escritura de prueba rechazada \(25006\)/);
  assert.match(summary, /escritura de prueba: \*\*rechazada \(25006\)\*\*/);
  assert.match(summary, /\*\*Q1 — piezas de plataforma vendibles/);
  assert.match(summary, /promo \+ deck_exclusive = \d+/);
  assert.match(summary, /\*\*Q1c — piezas de clientes en bóveda/);
  const pass = new globalThis.URL(URL_DB).password;
  for (const t of [sinMascaras(log), summary]) {
    assert.ok(!t.includes(URL_DB), 'la URL aparece');
    if (pass) assert.ok(!t.includes(decodeURIComponent(pass)), 'la contraseña aparece');
  }
});

// ---------------------------------------------------------------------------------------------------------------
// Q1c (API_CONTRACT §IDS.9 v1.116.4; H-Q1): piezas de CLIENTES en bóveda con producto promo/deck_exclusive. Se siembra
// un lote con sufijo único (fuera del botón, que es READ ONLY), se miden DIFERENCIAS antes/después en la tabla por kind
// (la base de CI puede traer filas de otras pruebas) y la fila EXACTA del detalle de su producto (nombre único), y se
// borra el lote al final. Lote (cliente U salvo la 5):
//   1 promo    in_custody raw NM normal · ref base: manual 50.00 (vieja) gana a tcgcsv 10.00 (nueva) · Q: 20.00 (vieja) y 30.00 (última) ⇒ 30.00
//   2 deck     picking    raw NM holofoil · sin ref base · sin origen · en retiro activo (envío `picking`)
//   3 promo    withdrawn  ⇒ fuera (portafolio)
//   4 set_base in_custody ⇒ fuera (kind)
//   5 promo    listed, de PLATAFORMA ⇒ fuera de Q1c (sí cuenta en Q1)
//   6 promo    lost raw NM normal · caso «Por reponer» `open` (su envío está `cancelado`: no es retiro activo) · sin origen
// Esperado: Q1c +3 (promo +2, deck +1; caso +1; retiro +1), Q1 +1, y la fila del detalle de la promo:
//   piezas 2 · clientes 1 · con ref 2 · Σ 100.00 · mín/máx 50.00 · sin origen 1 · Q Σ/mín/máx 30.00.
// Canario: la Q1c o su detalle mutados (sin filtro de cliente / sin filtro de portafolio) NO dan esos números.
const psqlRun = (sql) => spawnSync('psql', [URL_DB, '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-c', sql], { encoding: 'utf8' });
const q1cDe = (summary) => {
  const m = summary.match(/Q1c — piezas de clientes en bóveda con producto promo\/deck_exclusive = (\d+)/);
  assert.ok(m, `sin la línea Q1c en el resumen:\n${summary}`);
  return Number(m[1]);
};
const q1De = (summary) => Number((summary.match(/promo \+ deck_exclusive = (\d+)/) ?? assert.fail('sin Q1'))[1]);
// | kind | piezas | clientes | con caso | en retiro |  (ceros si la tabla no la trae)
const filaKind = (summary, kind) => {
  const m = summary.match(new RegExp(String.raw`^\| ${kind} \| (\d+) \| (\d+) \| (\d+) \| (\d+) \|$`, 'm'));
  return m ? m.slice(1).map(Number) : [0, 0, 0, 0];
};
function sembrar(sfx) {
  const pid = 2_000_000_000 - Math.floor(Math.random() * 1_000_000) * 4;
  const u = `'q1c-${sfx}-u'`;
  const c = `'q1c-${sfx}-c'`;
  const it = (n, owner, kindPid, status, finish) =>
    `('q1c-${sfx}-i${n}', 'Q1C-${sfx}-${n}', ${c}, ${kindPid}, 'raw', 'compra', '${owner}', ` +
    `${owner === 'customer' ? u : 'NULL'}, ${owner === 'customer' ? `'settled'` : 'NULL'}, '${status}', '${finish}', now())`;
  const ord = (n, settled, precio) => `INSERT INTO "Order"(id, "userId", "fulfillmentMode", status, "settledAt", "priceConvention", "subtotalCents", "ivaCents", "processingFeeCents", "totalCents")
  VALUES ('q1c-${sfx}-o${n}', ${u}, 'vault', 'settled', '${settled}', 'IVA_INCLUSIVE', ${precio}, 0, 0, ${precio});
INSERT INTO "OrderItem"(id, "orderId", "inventoryItemId", "cardSnapshot", "unitPriceCents") VALUES ('q1c-${sfx}-oi${n}', 'q1c-${sfx}-o${n}', 'q1c-${sfx}-i1', '{}', ${precio});`;
  const envio = (n, status) => `INSERT INTO "ShipmentRequest"(id, "userId", status, "addressSnapshot", "shippingFeeCents", "priceConvention")
  VALUES ('q1c-${sfx}-sr${n}', ${u}, '${status}', '{}', 0, 'IVA_INCLUSIVE');`;
  const sql = `BEGIN;
INSERT INTO "User"(id, name, email, "updatedAt") VALUES (${u}, 'Prueba Q1c', 'q1c-${sfx}@example.invalid', now());
INSERT INTO "CardSet"(id, "externalId", name) VALUES ('q1c-${sfx}-s', 'set-q1c-${sfx}', 'Set Q1c');
INSERT INTO "Card"(id, "externalId", "setId", name, number) VALUES (${c}, 'carta-q1c-${sfx}', 'q1c-${sfx}-s', 'Carta Q1c', '1');
INSERT INTO "CardProduct"(id, "cardId", "tcgplayerProductId", name, kind, "updatedAt") VALUES
  ('q1c-${sfx}-p1', ${c}, ${pid}, 'Q1c promo ${sfx}', 'promo', now()),
  ('q1c-${sfx}-p2', ${c}, ${pid + 1}, 'Q1c deck ${sfx}', 'deck_exclusive', now()),
  ('q1c-${sfx}-p3', ${c}, ${pid + 2}, 'Q1c base ${sfx}', 'set_base', now());
INSERT INTO "InventoryItem"(id, folio, "cardId", "cardProductId", "productType", "acquisitionType", "ownerType", "ownerUserId", "ownershipStatus", status, finish, "updatedAt") VALUES
  ${[it(1, 'customer', pid, 'in_custody', 'normal'), it(2, 'customer', pid + 1, 'picking', 'holofoil'),
     it(3, 'customer', pid, 'withdrawn', 'normal'), it(4, 'customer', pid + 2, 'in_custody', 'normal'),
     it(5, 'platform', pid, 'listed', 'normal'), it(6, 'customer', pid, 'lost', 'normal')].join(',\n  ')};
INSERT INTO "PriceReference"(id, "cardId", "productType", "gradeKey", finish, source, "priceMxnCents", "capturedDate", "isManualOverride") VALUES
  ('q1c-${sfx}-r1', ${c}, 'raw', 'raw:NM', 'normal', 'manual', 5000, '2026-01-01', true),
  ('q1c-${sfx}-r2', ${c}, 'raw', 'raw:NM', 'normal', 'tcgcsv_singles', 1000, '2026-11-01', false);
${ord(1, '2026-03-01', 2000)}
${ord(2, '2026-06-01', 3000)}
${envio(1, 'picking')}
INSERT INTO "ShipmentItem"(id, "shipmentRequestId", "inventoryItemId") VALUES ('q1c-${sfx}-si1', 'q1c-${sfx}-sr1', 'q1c-${sfx}-i2');
${envio(2, 'cancelado')}
INSERT INTO "ShipmentItem"(id, "shipmentRequestId", "inventoryItemId") VALUES ('q1c-${sfx}-si2', 'q1c-${sfx}-sr2', 'q1c-${sfx}-i6');
INSERT INTO "ReplacementCase"(id, source, status, "shipmentItemId", "shipmentRequestId", "customerUserId", "originalInventoryItemId", "missingReason", "openedAt", "openedByUserId")
  VALUES ('q1c-${sfx}-rc', 'withdrawal', 'open', 'q1c-${sfx}-si2', 'q1c-${sfx}-sr2', ${u}, 'q1c-${sfx}-i6', 'not_found', now(), ${u});
COMMIT;`;
  const r = psqlRun(sql);
  assert.equal(r.status, 0, `la siembra falló: ${r.stderr}`);
}
function limpiar(sfx) {
  const like = `LIKE 'q1c-${sfx}-%'`;
  const tablas = ['ReplacementCase', 'ShipmentItem', 'ShipmentRequest', 'OrderItem', 'Order', 'PriceReference', 'InventoryItem',
    'CardProduct', 'Card', 'CardSet', 'User'];
  return psqlRun(`BEGIN;\n${tablas.map((t) => `DELETE FROM "${t}" WHERE id ${like};`).join('\n')}\nCOMMIT;`);
}
function arbolMutado(desde, hasta, n) {
  const root = mkdtempSync(join(tmpdir(), 'ids-q1c-mut-'));
  mkdirSync(join(root, 'scripts'), { recursive: true });
  cpSync(HERE, join(root, 'scripts/ids'), { recursive: true });
  const f = join(root, 'scripts/ids/ids-d1-q1.sql');
  const sql = readFileSync(f, 'utf8');
  // La n-ésima aparición: 1 = la tabla por kind, 2 = el detalle.
  let k = -1;
  for (let i = 0; i < n; i += 1) {
    k = sql.indexOf(desde, k + 1);
    assert.ok(k >= 0, `la mutación no encuentra su ancla (${n}): el canario no prueba nada`);
  }
  writeFileSync(f, sql.slice(0, k) + hasta + sql.slice(k + desde.length));
  return root;
}
const FILTRO = `WHERE i."ownerType" = 'customer' AND i.status <> 'withdrawn'`;

test('Q1c (§IDS.9 v1.116.4) sobre un lote sembrado: tabla por kind, detalle exacto, solo agregados, y su canario muerde', { skip: !URL_DB }, () => {
  const sfx = `${process.pid}${Date.now().toString(36)}`;
  const mutantes = {
    'tabla sin filtro de cliente': arbolMutado(FILTRO, `WHERE i.status <> 'withdrawn'`, 1),
    'tabla sin filtro de portafolio': arbolMutado(FILTRO, `WHERE i."ownerType" = 'customer'`, 1),
    'detalle sin filtro de cliente': arbolMutado(FILTRO, `WHERE i.status <> 'withdrawn'`, 2),
    'detalle sin filtro de portafolio': arbolMutado(FILTRO, `WHERE i."ownerType" = 'customer'`, 2),
  };
  const raiz = join(HERE, '../..');
  const resultado = (summary) => ({
    total: q1cDe(summary),
    promo: filaKind(summary, 'promo'),
    deck: filaKind(summary, 'deck_exclusive'),
    // Solo la parte del detalle de Q1c (Q1b también lista el producto, por la pieza de plataforma).
    detalle: (summary.split('**Q1c por producto y acabado**')[1]?.match(new RegExp(String.raw`^\| promo \| \d+ \| Q1c promo ${sfx} \|.*$`, 'm')) ?? [null])[0],
  });
  const ESPERADO_DETALLE = new RegExp(String.raw`^\| promo \| \d+ \| Q1c promo ${sfx} \| normal \| raw \| 2 \| 1 \| 2 \| MX\$100\.00 \| MX\$50\.00 \| MX\$50\.00 \| 1 \| MX\$30\.00 \| MX\$30\.00 \| MX\$30\.00 \|$`);
  try {
    const antes = correr(raiz);
    assert.equal(antes.rc, 0, antes.log);
    const a = resultado(antes.summary);
    const antesMut = Object.fromEntries(Object.entries(mutantes).map(([k, r]) => [k, resultado(correr(r).summary)]));
    sembrar(sfx);
    const despues = correr(raiz);
    assert.equal(despues.rc, 0, despues.log);
    const d = resultado(despues.summary);
    assert.equal(d.total - a.total, 3, 'Q1c debía subir exactamente 3');
    assert.deepEqual(d.promo.map((x, i) => x - a.promo[i]), [2, 1, 1, 0], 'promo: piezas +2, clientes +1, caso +1, retiro +0');
    assert.deepEqual(d.deck.map((x, i) => x - a.deck[i]), [1, 1, 0, 1], 'deck_exclusive: piezas +1, clientes +1, caso +0, retiro +1');
    assert.equal(q1De(despues.summary) - q1De(antes.summary), 1, 'Q1 (plataforma) debía subir exactamente 1');
    assert.match(d.detalle ?? '', ESPERADO_DETALLE, `fila del detalle:\n${d.detalle}`);
    // Solo agregados: ni el id del cliente, ni su correo, ni ids/folios de pieza, orden o envío (los ids de CATÁLOGO
    // —carta-q1c-…, que Q1b sí lista— no empiezan por «q1c-»).
    for (const t of [despues.summary, despues.log]) {
      assert.ok(!t.includes(`q1c-${sfx}-`), 'un id sembrado aparece');
      assert.ok(!t.includes(`q1c-${sfx}@`), 'el correo del cliente aparece');
      assert.ok(!t.includes(`Q1C-${sfx}-`), 'un folio aparece');
    }
    for (const [k, r] of Object.entries(mutantes)) {
      const m = resultado(correr(r).summary);
      const b = antesMut[k];
      const igual = m.total - b.total === 3 && ESPERADO_DETALLE.test(m.detalle ?? '');
      assert.ok(!igual, `canario «${k}»: la Q1c mutada da los mismos números — la prueba no distingue el filtro`);
    }
  } finally {
    const r = limpiar(sfx);
    for (const m of Object.values(mutantes)) rmSync(m, { recursive: true, force: true });
    assert.equal(r.status, 0, `la limpieza falló: ${r.stderr}`);
  }
});

test('canario: sin READ ONLY la prueba de escritura pone el botón en rojo y no lee', { skip: !URL_DB }, () => {
  const root = mkdtempSync(join(tmpdir(), 'ids-q1-mut-'));
  try {
    mkdirSync(join(root, 'scripts'), { recursive: true });
    cpSync(HERE, join(root, 'scripts/ids'), { recursive: true });
    const f = join(root, 'scripts/ids/ids-q1-boton.sql');
    const sql = readFileSync(f, 'utf8');
    const mut = sql.replace('BEGIN TRANSACTION READ ONLY;', 'BEGIN;');
    assert.notEqual(mut, sql, 'la mutación no cambió nada: el canario no prueba nada');
    writeFileSync(f, mut);
    const { rc, summary } = correr(root);
    assert.equal(rc, 1);
    assert.match(summary, /NO medida/);
    assert.doesNotMatch(summary, /Q1 — piezas/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
