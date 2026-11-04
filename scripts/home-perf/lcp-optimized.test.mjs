// scripts/home-perf/lcp-optimized.test.mjs — canario de `lcp-optimized.mjs` (DYN-D3) con lhr sintéticos (sin red). · devops
//   node --test scripts/home-perf/lcp-optimized.test.mjs
// Lo corre `scripts/check-home-perf.sh` (paso 6) en `ci.yml`. Los casos reproducen el run 41870766214 (2026-11-04):
// las tejas de Destacadas van por /_next/image (59db08b) y la estantería de gradeadas pide crudas (DYN-F8) las MISMAS
// cartas del seed ⇒ el criterio (b) viejo lo leía como «respaldo» y daba 0/5 con la líder en 200 webp.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluar, evaluarDir, originalDeLaLider } from './lcp-optimized.mjs';

const H = 'http://localhost:3190';
const X = 'https://images.scrydex.com/e2e/e2e-ac-deck-spark_hires.png'; // la líder
const Y = 'https://images.scrydex.com/e2e/e2e-graded.png'; // una teja que la estantería también pide cruda
const opt = (o, w = 384) => `${H}/_next/image?url=${encodeURIComponent(o)}&w=${w}&q=${75}`;
const webp = (o, w) => ({ url: opt(o, w), statusCode: 200, mimeType: 'image/webp' });
const e500 = (o, w) => ({ url: opt(o, w), statusCode: 500, mimeType: 'text/plain' });
const png = (o) => ({ url: o, statusCode: 200, mimeType: 'image/png' });
// Snippet como lo escribe Lighthouse 12.6.1 (medido): `src` absoluto y RECORTADO con «…».
const snipImgOpt = `<img srcset="/_next/image?url=https%3A%2F%2Fimages.scrydex.com%2Fe2e%2Fe2e-ac-deck-spar…" src="${H}/_next/image?url=https%3A%2F%2Fimages.scrydex.com%2Fe…" alt="E2E Deck Spark">`;
const snipH1 = '<h1 class="mt-4 max-w-[660px] font-serif">';
function lhr(items, snippet, lcpImageUrl) {
  const audits = {
    'network-requests': { details: { items } },
    'largest-contentful-paint-element': { details: { items: [{ items: [{ node: { snippet } }] }] } },
  };
  if (lcpImageUrl) audits['prioritize-lcp-image'] = { details: { debugData: { initiatorPath: [{ url: lcpImageUrl, initiatorType: 'parser' }] } } };
  return { audits };
}

test('(i) /_next/image 200 webp de X e Y, Y cruda desde otra superficie ⇒ verde (run 41870766214)', () => {
  const r = evaluar(lhr([webp(X), webp(Y), png(Y), png('https://images.scrydex.com/e2e/e2e-third-raw.png')], snipImgOpt, opt(X)));
  assert.deepEqual(r.motivos, []);
  assert.equal(r.notas.length, 1);
  assert.match(r.notas[0], /e2e-graded\.png pedida cruda por otra superficie/);
});

test('(i-bis) escritorio: LCP <h1>, tejas 200 webp y crudas de la estantería ⇒ verde', () => {
  const r = evaluar(lhr([webp(X), webp(Y), png(Y)], snipH1));
  assert.deepEqual(r.motivos, []);
});

test('(ii) /_next/image 500 de Y y luego Y cruda ⇒ rojo «respaldo» con la url y el estado', () => {
  const r = evaluar(lhr([webp(X), e500(Y), png(Y)], snipImgOpt, opt(X)));
  assert.ok(r.motivos.some((m) => m === `respaldo a la original ${Y} (su /_next/image respondió 500 text/plain)`), r.motivos.join('|'));
  assert.ok(r.motivos.some((m) => m.startsWith('/_next/image 500 text/plain de ')), r.motivos.join('|'));
});

test('(iii) LCP <img> sin /_next/image ⇒ rojo', () => {
  const r = evaluar(lhr([png(X)], `<img src="${X}" alt="x">`));
  assert.ok(r.motivos.some((m) => m.startsWith('LCP <img> sin /_next/image')), r.motivos.join('|'));
  assert.ok(r.motivos.includes('ninguna petición a /_next/image'));
});

test('(iv) la LÍDER 200 webp y ADEMÁS cruda ⇒ rojo (respaldo o precarga de la original)', () => {
  const r = evaluar(lhr([webp(X), png(X)], snipImgOpt, opt(X)));
  assert.equal(r.motivos.length, 1);
  assert.match(r.motivos[0], /^la LÍDER se pidió cruda además de por \/_next\/image: https:\/\/images\.scrydex\.com\/e2e\/e2e-ac-deck-spark_hires\.png/);
});

test('(v) la líder se identifica por prioritize-lcp-image, y si falta, por un src completo del snippet; recortado ⇒ null', () => {
  assert.equal(originalDeLaLider(lhr([], snipImgOpt, opt(X))), X);
  assert.equal(originalDeLaLider(lhr([], `<img src="${H}/_next/image?url=${encodeURIComponent(X)}&amp;w=640&amp;q=75">`)), X);
  assert.equal(originalDeLaLider(lhr([], snipImgOpt)), null);
  assert.equal(originalDeLaLider(lhr([], snipH1)), null);
});

test('(vi) evaluarDir: k/N, motivos por corrida, rc 1 con una mala y 0 con todas buenas; 2 sin informes', () => {
  const d = mkdtempSync(join(tmpdir(), 'lcp-opt-test-'));
  try {
    writeFileSync(join(d, 'lhr-1.json'), JSON.stringify(lhr([webp(X), webp(Y), png(Y)], snipImgOpt, opt(X))));
    writeFileSync(join(d, 'lhr-2.json'), JSON.stringify(lhr([webp(X), e500(Y), png(Y)], snipImgOpt, opt(X))));
    const r = evaluarDir(d);
    assert.equal(r.rc, 1);
    assert.match(r.texto, /^1\/2\n/);
    assert.match(r.texto, /\n  ✗ lhr-2\.json: .*respaldo a la original https:\/\/images\.scrydex\.com\/e2e\/e2e-graded\.png \(su \/_next\/image respondió 500 text\/plain\)/);
    assert.match(r.texto, /\n  · lhr-1\.json: .*no es respaldo\n/);
    rmSync(join(d, 'lhr-2.json'));
    assert.deepEqual(evaluarDir(d).rc, 0);
    assert.match(evaluarDir(d).texto, /^1\/1\n/);
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
  assert.equal(evaluarDir(join(d, 'no-existe')).rc, 2);
});
