#!/usr/bin/env node
/**
 * lcp-optimized.mjs <dir .lighthouseci> — ¿la foto líder la sirvió DE VERDAD el optimizador? (DYN-D3) · devops
 *
 * Por cada lhr-*.json de una tanda `d1`, la corrida es buena solo si:
 *   (a) hay petición a `/_next/image?url=…` y TODAS las de la página respondieron 200 `image/webp`;
 *   (b) no hay ninguna petición a la URL original que esas `/_next/image` envuelven (eso es el respaldo de
 *       `CardImage`, ARCHITECTURE §4.DYN (f) 7: caer a la original es ROJO, no verde);
 *   (c) si el elemento LCP es una `<img>`, su `src` es `/_next/image?…` (en escritorio el LCP puede ser el
 *       `<h1>`, y entonces cuentan (a) y (b)).
 * El `currentSrc` no está en el lhr; (a)+(b)+(c) lo cubren: con el respaldo, la `<img>` cambia su `src` a la
 * original y el navegador la pide (b), y si el optimizador falla la `/_next/image` no es 200 webp (a).
 * Imprime `k/N` y, por corrida mala, el motivo. rc 0 si N/N, 1 si no, 2 si no hay informes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
let files = [];
try {
  files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f)).sort();
} catch {
  files = [];
}
if (files.length === 0) {
  process.stdout.write('0/0 (sin lhr-*.json)\n');
  process.exit(2);
}
const malas = [];
for (const f of files) {
  const lhr = JSON.parse(readFileSync(join(dir, f), 'utf8'));
  const reqs = lhr.audits?.['network-requests']?.details?.items ?? [];
  const opt = reqs.filter((r) => /\/_next\/image\?/.test(r.url ?? ''));
  const motivos = [];
  if (opt.length === 0) motivos.push('ninguna petición a /_next/image');
  const origenes = new Set();
  for (const r of opt) {
    if (r.statusCode !== 200 || r.mimeType !== 'image/webp') motivos.push(`/_next/image ${r.statusCode} ${r.mimeType}`);
    try {
      origenes.add(new URL(r.url).searchParams.get('url'));
    } catch {
      /* url ilegible: ya cuenta en (a) si no es 200 webp */
    }
  }
  for (const r of reqs) if (origenes.has(r.url)) motivos.push(`respaldo a la original ${r.url}`);
  const node = lhr.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  const snip = node?.snippet ?? '';
  // Lighthouse escribe el `src` resuelto (absoluto: `http://localhost:3190/_next/image?…`, medido 2026-10-30).
  if (/^<img\b/i.test(snip) && !/\bsrc="(https?:\/\/[^/"]+)?\/_next\/image\?/.test(snip)) motivos.push(`LCP <img> sin /_next/image: ${snip.slice(0, 120)}`);
  if (motivos.length) malas.push(`${f}: ${[...new Set(motivos)].join('; ')}`);
}
const k = files.length - malas.length;
process.stdout.write(`${k}/${files.length}\n${malas.map((m) => `  ✗ ${m}\n`).join('')}`);
process.exit(malas.length ? 1 : 0);
