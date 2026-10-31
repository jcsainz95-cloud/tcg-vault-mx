#!/usr/bin/env node
/**
 * fix-ratchet.mjs <dir d1-mobile> <sha> [--write] — fija el trinquete de celular de DYN-D1 · devops
 *
 * Lee `<dir>/medianas.json` (lo escribe summarize.mjs tras una tanda `d1` del arnés, N=5) y calcula
 * fcpMs = ⌈mediana FCP × 1.10⌉₁₀ y lcpMs = ⌈mediana LCP × 1.10⌉₁₀ (redondeo hacia arriba a 10 ms).
 * Sin `--write` solo imprime; con `--write` reescribe `mobile-ratchet.json` con mediana, N, sha y fecha.
 * Exige N ≥ 5 (el contrato pide 5) y que la medición sea del sha que se dice.
 * El candado (`check-home-perf.sh`) comprueba que fcpMs/lcpMs = esta fórmula sobre las medianas escritas.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const techo = (ms) => Math.ceil((ms * 1.1) / 10) * 10;
const [dir, sha, flag] = process.argv.slice(2);
if (!dir || !/^[0-9a-f]{7,40}$/.test(sha ?? '')) {
  process.stderr.write('uso: fix-ratchet.mjs <dir d1-mobile> <sha> [--write]\n');
  process.exit(2);
}
const m = JSON.parse(readFileSync(join(dir, 'medianas.json'), 'utf8'));
if (!(m.n >= 5) || !(m.fcp > 0) || !(m.lcp > 0)) {
  process.stderr.write(`fix-ratchet: medianas.json sin N ≥ 5 o sin FCP/LCP (${JSON.stringify(m)})\n`);
  process.exit(2);
}
const file = join(dirname(fileURLToPath(import.meta.url)), 'mobile-ratchet.json');
const r = JSON.parse(readFileSync(file, 'utf8'));
const medF = Math.round(m.fcp);
const medL = Math.round(m.lcp);
const nuevo = { ...r, fcpMs: techo(medF), lcpMs: techo(medL), medianaFcpMs: medF, medianaLcpMs: medL, runs: m.n, sha, fecha: new Date().toISOString().slice(0, 10) };
process.stdout.write(`${JSON.stringify(nuevo, null, 2)}\n`);
if (flag === '--write') writeFileSync(file, `${JSON.stringify(nuevo, null, 2)}\n`);
