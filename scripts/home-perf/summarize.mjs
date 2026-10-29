#!/usr/bin/env node
/**
 * summarize.mjs <dir .lighthouseci> — mediana y peor corrida de FCP, LCP y CLS de los lhr-*.json · devops
 *
 * Imprime una fila de tabla Markdown (sin los extremos): `FCP med / peor | LCP med / peor | CLS med / peor | N`.
 * Escribe además `<dir>/../detalle.txt` con, por corrida, las tres cifras y el elemento LCP (para ver si el
 * LCP fue la imagen de la teja líder o cayó al texto). La mediana es la de Lighthouse CI (`median`): con N
 * impar, el valor central; con N par, la media de los dos centrales. Lo pide el criterio 936 (mediana, peor y N).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

const dir = process.argv[2];
const lhrs = readdirSync(dir)
  .filter((f) => /^lhr-.*\.json$/.test(f))
  .sort()
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
if (lhrs.length === 0) {
  process.stderr.write(`summarize: no hay lhr-*.json en ${dir}\n`);
  process.exit(2);
}
const val = (lhr, id) => lhr.audits?.[id]?.numericValue;
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ms = (v) => `${(v / 1000).toFixed(2)} s`;
const cls = (v) => v.toFixed(3);
const col = (id, fmt) => {
  const xs = lhrs.map((l) => val(l, id)).filter((v) => typeof v === 'number');
  if (xs.length !== lhrs.length) return `? (${xs.length}/${lhrs.length} con dato)`;
  return `${fmt(median(xs))} / ${fmt(Math.max(...xs))}`;
};
const detalle = lhrs.map((l, i) => {
  const el = l.audits?.['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  const lcpEl = el ? `${el.nodeLabel ?? ''} ⟨${(el.snippet ?? '').slice(0, 120)}⟩` : '?';
  return `#${i + 1} FCP ${ms(val(l, 'first-contentful-paint') ?? NaN)} · LCP ${ms(val(l, 'largest-contentful-paint') ?? NaN)} · CLS ${cls(val(l, 'cumulative-layout-shift') ?? NaN)} · LCP=${lcpEl}`;
});
writeFileSync(join(dirname(dir), 'detalle.txt'), `${detalle.join('\n')}\n`);
// Medianas en ms (CLS sin unidad) para que run.sh compare el canario con la línea base de la misma corrida.
const med = (id) => median(lhrs.map((l) => val(l, id)).filter((v) => typeof v === 'number'));
writeFileSync(
  join(dirname(dir), 'medianas.json'),
  JSON.stringify({ fcp: med('first-contentful-paint'), lcp: med('largest-contentful-paint'), cls: med('cumulative-layout-shift'), n: lhrs.length }),
);
process.stdout.write(
  `${col('first-contentful-paint', ms)} | ${col('largest-contentful-paint', ms)} | ${col('cumulative-layout-shift', cls)} | ${lhrs.length}`,
);
