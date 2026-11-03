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
  const pass = new globalThis.URL(URL_DB).password;
  for (const t of [sinMascaras(log), summary]) {
    assert.ok(!t.includes(URL_DB), 'la URL aparece');
    if (pass) assert.ok(!t.includes(decodeURIComponent(pass)), 'la contraseña aparece');
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
