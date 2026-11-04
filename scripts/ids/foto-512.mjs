#!/usr/bin/env node
// scripts/ids/foto-512.mjs — comparador de la foto del criterio 512 (IDS-D3).   · devops
//
//   node scripts/ids/foto-512.mjs compare <antes.jsonl> <despues.jsonl>
//
// Las fotos salen de `scripts/ids/foto-512.sql` (una línea JSON por fila). Reglas (PROJECT 512, API_CONTRACT IDS.0 I-1):
//   · toda fila de «antes» sigue en «después» con las MISMAS columnas y valores (diferencia = 0);
//   · una columna que solo está en «después» tiene que ser de M-95 y valer su DEFAULT (language='en', sin sello);
//   · filas nuevas en «después» no cuentan como diferencia (se informan): lo existente es lo que no puede cambiar.
// Salida: 0 diferencia = 0 · 1 hay diferencias (lista) · 2 NO CONCLUYENTE (foto vacía, ilegible o sin piezas) · 64 uso.
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Columnas nuevas admitidas y el valor que deben tener en filas existentes. */
export const NEW_COLUMN_DEFAULTS = { language: 'en', stampType: null, stampLabel: null };

export function parseFoto(text) {
  const m = new Map();
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s === '') continue;
    const o = JSON.parse(s);
    if (typeof o.t !== 'string' || o.k == null || typeof o.r !== 'object') throw new Error(`línea sin {t,k,r}: ${s.slice(0, 80)}`);
    m.set(`${o.t}:${o.k}`, o.r);
  }
  return m;
}

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function compareFotos(antes, despues) {
  const diffs = [];
  const porTabla = {};
  for (const [key, ra] of antes) {
    const t = key.split(':')[0];
    porTabla[t] ??= { antes: 0, despues: 0, nuevas: 0, diferencias: 0 };
    porTabla[t].antes += 1;
    const rd = despues.get(key);
    if (rd === undefined) { diffs.push(`${key}: desaparece`); porTabla[t].diferencias += 1; continue; }
    let d = 0;
    for (const [col, v] of Object.entries(ra)) {
      if (!(col in rd)) { diffs.push(`${key}.${col}: columna ausente en «después»`); d += 1; } else if (!same(v, rd[col])) { diffs.push(`${key}.${col}: ${JSON.stringify(v)} → ${JSON.stringify(rd[col])}`); d += 1; }
    }
    for (const [col, v] of Object.entries(rd)) {
      if (col in ra) continue;
      if (!(col in NEW_COLUMN_DEFAULTS)) { diffs.push(`${key}.${col}: columna nueva no prevista (${JSON.stringify(v)})`); d += 1; } else if (!same(v, NEW_COLUMN_DEFAULTS[col])) { diffs.push(`${key}.${col}: ${JSON.stringify(v)} (se esperaba ${JSON.stringify(NEW_COLUMN_DEFAULTS[col])})`); d += 1; }
    }
    if (d > 0) porTabla[t].diferencias += 1;
  }
  for (const key of despues.keys()) {
    const t = key.split(':')[0];
    porTabla[t] ??= { antes: 0, despues: 0, nuevas: 0, diferencias: 0 };
    porTabla[t].despues += 1;
    if (!antes.has(key)) porTabla[t].nuevas += 1;
  }
  return { diffs, porTabla };
}

async function main(argv) {
  const [cmd, a, b] = argv;
  if (cmd !== 'compare' || !a || !b) { console.error('uso: foto-512.mjs compare <antes.jsonl> <despues.jsonl>'); return 64; }
  let antes, despues;
  try { antes = parseFoto(readFileSync(a, 'utf8')); despues = parseFoto(readFileSync(b, 'utf8')); } catch (e) { console.error(`NO CONCLUYENTE: ${e.message}`); return 2; }
  const { diffs, porTabla } = compareFotos(antes, despues);
  for (const [t, c] of Object.entries(porTabla)) console.log(`${t}: antes=${c.antes} después=${c.despues} nuevas=${c.nuevas} filas con diferencia=${c.diferencias}`);
  if (!porTabla.InventoryItem || porTabla.InventoryItem.antes === 0) { console.error('NO CONCLUYENTE: la foto «antes» no trae piezas (¿base vacía o foto equivocada?).'); return 2; }
  if (diffs.length > 0) { console.log(`ROJO 512: ${diffs.length} diferencia(s) en lo existente:`); for (const d of diffs.slice(0, 200)) console.log(`  ${d}`); return 1; }
  console.log('VERDE 512: diferencia = 0 en lo existente; toda pieza y línea existente queda en inglés y sin sello.');
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(await main(process.argv.slice(2)));
