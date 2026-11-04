#!/usr/bin/env node
/**
 * lcp-optimized.mjs <dir .lighthouseci> — ¿la foto líder (y las tejas) las sirvió DE VERDAD el optimizador? (DYN-D3) · devops
 *
 * Por cada lhr-*.json de una tanda `d1`, la corrida es buena solo si:
 *   (a) hay petición a `/_next/image?url=…` y TODAS las de la página respondieron 200 `image/webp`;
 *   (b) ninguna petición CRUDA a una URL original cuenta como respaldo de `CardImage` (ARCHITECTURE §4.DYN (f) 7:
 *       caer a la original es ROJO, no verde). Es respaldo si la `/_next/image` de ESA url no respondió 200 webp,
 *       o si la original es la de la LÍDER (el elemento LCP): la líder se pide una sola vez, por el optimizador.
 *       Una original cuya `/_next/image` sí fue 200 webp y la pide OTRA superficie (la estantería de gradeadas lleva
 *       `<img>` cruda por diseño, DYN-F8, para las mismas cartas del seed) NO es respaldo: medido en el run
 *       41870766214 (2026-11-04): 0/5 falsos con «respaldo» a `e2e-slab-raw.png` / `e2e-graded.png`, las 6
 *       `/_next/image` 200 webp y la líder `e2e-ac-deck-spark_hires.png` sin petición cruda.
 *   (c) si el elemento LCP es una `<img>`, su `src` es `/_next/image?…` (en escritorio el LCP puede ser el
 *       `<h1>`, y entonces cuentan (a) y (b)).
 * La original de la líder sale de `prioritize-lcp-image.details.debugData.initiatorPath[0].url` (Lighthouse 12) o,
 * si falta, del `src` del snippet del LCP cuando Lighthouse no lo recortó («…»). El `currentSrc` no está en el lhr;
 * (a)+(b)+(c) lo cubren: con el respaldo, la `<img>` cambia su `src` a la original y el navegador la pide (b), y si
 * el optimizador falla la `/_next/image` no es 200 webp (a).
 * Imprime `k/N`; por corrida mala, `  ✗ <lhr>: <motivos>` (qué url y por qué); por original cruda admitida, una
 * nota `  · …`. rc 0 si N/N, 1 si no, 2 si no hay informes.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ES_OPT = /\/_next\/image\?/;
const BASE = 'http://localhost';

/** URL original que envuelve una `/_next/image?url=…` (o null si no es del optimizador / ilegible). */
export function originalDe(url) {
  if (!ES_OPT.test(url ?? '')) return null;
  try {
    return new URL(url, BASE).searchParams.get('url');
  } catch {
    return null;
  }
}

/** La original de la líder (elemento LCP) o null si el LCP no es una imagen o no se puede saber. */
export function originalDeLaLider(lhr) {
  const ini = lhr.audits?.['prioritize-lcp-image']?.details?.debugData?.initiatorPath?.[0]?.url;
  if (ini) return originalDe(ini);
  const snip = lhr.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node?.snippet ?? '';
  const m = /^<img\b[^>]*\bsrc="([^"]*)"/i.exec(snip);
  if (!m || m[1].includes('…')) return null;
  return originalDe(m[1].replace(/&amp;/g, '&'));
}

/** Evalúa un lhr. Devuelve { motivos: string[], notas: string[] }; motivos vacío ⇒ corrida buena. */
export function evaluar(lhr) {
  const reqs = lhr.audits?.['network-requests']?.details?.items ?? [];
  const motivos = [];
  const notas = [];
  // (a) todas las /_next/image 200 webp; por original, el estado de SU /_next/image.
  const estado = new Map(); // original → 'ok' | '<status> <mime>'
  let nOpt = 0;
  for (const r of reqs) {
    const orig = originalDe(r.url);
    if (orig === null) continue;
    nOpt += 1;
    const bien = r.statusCode === 200 && r.mimeType === 'image/webp';
    if (!bien) motivos.push(`/_next/image ${r.statusCode} ${r.mimeType} de ${orig}`);
    const prev = estado.get(orig);
    if (prev === undefined || prev === 'ok') estado.set(orig, bien ? 'ok' : `${r.statusCode} ${r.mimeType}`);
  }
  if (nOpt === 0) motivos.push('ninguna petición a /_next/image');
  // (b) originales pedidas crudas.
  const lider = originalDeLaLider(lhr);
  for (const r of reqs) {
    const url = r.url ?? '';
    if (!estado.has(url)) continue; // no la envuelve ninguna /_next/image: no es nuestra (p. ej. la estantería sola)
    const st = estado.get(url);
    if (url === lider) motivos.push(`la LÍDER se pidió cruda además de por /_next/image: ${url} (respaldo o precarga de la original)`);
    else if (st !== 'ok') motivos.push(`respaldo a la original ${url} (su /_next/image respondió ${st})`);
    else notas.push(`${url} pedida cruda por otra superficie (su /_next/image fue 200 webp): no es respaldo`);
  }
  // (c) el LCP, si es <img>, lleva /_next/image en el src.
  const node = lhr.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  const snip = node?.snippet ?? '';
  // Lighthouse escribe el `src` resuelto (absoluto: `http://localhost:3190/_next/image?…`, medido 2026-10-30).
  if (/^<img\b/i.test(snip) && !/\bsrc="(https?:\/\/[^/"]+)?\/_next\/image\?/.test(snip)) motivos.push(`LCP <img> sin /_next/image: ${snip.slice(0, 120)}`);
  return { motivos: [...new Set(motivos)], notas: [...new Set(notas)] };
}

export function evaluarDir(dir) {
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => /^lhr-.*\.json$/.test(f)).sort();
  } catch {
    files = [];
  }
  if (files.length === 0) return { rc: 2, texto: '0/0 (sin lhr-*.json)\n' };
  const malas = [];
  const notas = [];
  for (const f of files) {
    const r = evaluar(JSON.parse(readFileSync(join(dir, f), 'utf8')));
    if (r.motivos.length) malas.push(`${f}: ${r.motivos.join('; ')}`);
    for (const n of r.notas) notas.push(`${f}: ${n}`);
  }
  const k = files.length - malas.length;
  const texto = `${k}/${files.length}\n${malas.map((m) => `  ✗ ${m}\n`).join('')}${notas.map((n) => `  · ${n}\n`).join('')}`;
  return { rc: malas.length ? 1 : 0, texto };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const { rc, texto } = evaluarDir(process.argv[2]);
  process.stdout.write(texto);
  process.exit(rc);
}
