// scripts/ids/foto-512.test.mjs — el comparador del 512 sabe ponerse ROJO (canario) y solo verde con diferencia = 0.   · devops
//   node --test scripts/ids/foto-512.test.mjs
// Con IDS_FOTO_TEST_DATABASE_URL (una base DESECHABLE, nunca producción) además corre foto-512.sql de verdad.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFoto, compareFotos } from './foto-512.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const L = (t, k, r) => JSON.stringify({ t, k, r });
const ANTES = [
  L('InventoryItem', 'i1', { id: 'i1', status: 'listed', finish: 'holofoil', cardProductId: null, listPriceCents: 1500 }),
  L('ListingPrice', 'i1', { inventoryItemId: 'i1', variantKey: 'c1|raw|raw:NM|holofoil', status: 'priced', unitPriceCents: 1500 }),
  L('OrderItem', 'o1', { id: 'o1', orderId: 'O', unitPriceCents: 1500, finish: 'holofoil' }),
].join('\n');
const DESPUES_OK = [
  L('InventoryItem', 'i1', { id: 'i1', status: 'listed', finish: 'holofoil', cardProductId: null, listPriceCents: 1500, language: 'en' }),
  L('ListingPrice', 'i1', { inventoryItemId: 'i1', variantKey: 'c1|raw|raw:NM|holofoil', status: 'priced', unitPriceCents: 1500 }),
  L('OrderItem', 'o1', { id: 'o1', orderId: 'O', unitPriceCents: 1500, finish: 'holofoil', language: 'en', stampType: null, stampLabel: null }),
  L('InventoryItem', 'i2', { id: 'i2', status: 'in_stock', language: 'es' }), // nueva: no cuenta
].join('\n');

test('verde: misma foto + columnas M-95 en su default + filas nuevas', () => {
  const { diffs, porTabla } = compareFotos(parseFoto(ANTES), parseFoto(DESPUES_OK));
  assert.deepEqual(diffs, []);
  assert.equal(porTabla.InventoryItem.nuevas, 1);
});

for (const [nombre, mutar, esperado] of [
  ['precio movido', (s) => s.replace('"unitPriceCents":1500}', '"unitPriceCents":1501}'), /unitPriceCents: 1500 → 1501/],
  ['variantKey movido', (s) => s.replace('holofoil","status":"priced"', 'holofoil|v:es","status":"priced"'), /variantKey/],
  ['pieza existente pasa a español', (s) => s.replace('"listPriceCents":1500,"language":"en"', '"listPriceCents":1500,"language":"es"'), /language: "es" \(se esperaba "en"\)/],
  ['línea de pedido con sello', (s) => s.replace('"stampType":null', '"stampType":"league"'), /stampType/],
  ['fila desaparece', (s) => s.split('\n').filter((l) => !l.includes('"OrderItem"')).join('\n'), /desaparece/],
  ['columna nueva no prevista', (s) => s.replace('"language":"en"}', '"language":"en","nuevo":1}'), /no prevista/],
]) {
  test(`canario: ${nombre} ⇒ rojo`, () => {
    const mutado = mutar(DESPUES_OK);
    assert.notEqual(mutado, DESPUES_OK, 'la mutación no cambió nada: el canario no prueba nada');
    const { diffs } = compareFotos(parseFoto(ANTES), parseFoto(mutado));
    assert.ok(diffs.some((d) => esperado.test(d)), `esperaba ${esperado} en ${JSON.stringify(diffs)}`);
  });
}

test('CLI: rc 0 / 1 / 2', () => {
  const dir = mkdtempSync(join(tmpdir(), 'foto512-'));
  try {
    const a = join(dir, 'a.jsonl'), b = join(dir, 'b.jsonl'), bad = join(dir, 'bad.jsonl'), vacia = join(dir, 'v.jsonl');
    writeFileSync(a, ANTES); writeFileSync(b, DESPUES_OK); writeFileSync(bad, DESPUES_OK.replace('1500,"language"', '9,"language"')); writeFileSync(vacia, '');
    const run = (x, y) => spawnSync(process.execPath, [join(HERE, 'foto-512.mjs'), 'compare', x, y], { encoding: 'utf8' }).status;
    assert.equal(run(a, b), 0);
    assert.equal(run(a, bad), 1);
    assert.equal(run(vacia, b), 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('SQL real contra base desechable (solo con IDS_FOTO_TEST_DATABASE_URL)', { skip: !process.env.IDS_FOTO_TEST_DATABASE_URL }, () => {
  const out = execFileSync('psql', [process.env.IDS_FOTO_TEST_DATABASE_URL, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(HERE, 'foto-512.sql')], { encoding: 'utf8' });
  // En CI la base está migrada y puede estar vacía: lo que se prueba es que las 7 tablas existen (si no, psql
  // falla con ON_ERROR_STOP), que la salida es JSON línea a línea y que ninguna columna personal pasa el filtro.
  const foto = parseFoto(out);
  for (const r of foto.values()) for (const k of Object.keys(r)) assert.doesNotMatch(k, /email|name|address|phone|stripe|rfc|clabe/i, `columna personal en la foto: ${k}`);
});

test('ids-d1-produccion.sql corre contra el esquema real (solo con IDS_FOTO_TEST_DATABASE_URL)', { skip: !process.env.IDS_FOTO_TEST_DATABASE_URL }, () => {
  // Misma base desechable: la consulta que correrá el dueño no puede fallar por una columna mal escrita.
  const out = execFileSync('psql', [process.env.IDS_FOTO_TEST_DATABASE_URL, '-X', '-v', 'ON_ERROR_STOP=1', '-f', join(HERE, 'ids-d1-produccion.sql')], { encoding: 'utf8' });
  for (const q of ['Q1 ', 'Q1b', 'Q1c', 'Q2 ', 'Q3 ']) assert.ok(out.includes(`== ${q}`), `falta la sección ${q}`);
});
