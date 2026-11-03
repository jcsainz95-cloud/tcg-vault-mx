#!/usr/bin/env node
// scripts/ids/ids-dry-run.mjs — corrida EN SECO de IDS-D1 / IDS-D2 contra fuentes PÚBLICAS.   · devops
//
//   NODE_USE_ENV_PROXY=1 node scripts/ids/ids-dry-run.mjs --cache <dir> [--json <fichero>]
//   (NODE_USE_ENV_PROXY solo hace falta detrás de un proxy; fuera de él, sin la variable.)
//
// Solo GET públicos: https://tcgcsv.com/tcgplayer/3/… y la lista de sets de pokemontcg.io en su repositorio
// público de datos. Sin credenciales, sin BD, nada contra producción ni Railway.
// Dos universos de carta base (productos set_base|other, como IDS.3):
//   A = TODOS los grupos de la categoría 3 salvo 22880/1539 (cota: ambiguos por arriba, sinPareja por abajo);
//   B = solo los grupos que la escalera del backend empata con un set de pokemontcg.io (lo más parecido al
//       catálogo; qué sets tiene cargados producción: NO MEDIDO, requiere BD).
// La caché guarda solo {productId, name, number}, precios y la lista de sets. Lectura: DEVOPS_NOTES §108.
import { mkdirSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  STAMPED_SOURCE_GROUPS, PROMO_STAMP_GROUPS, buildBaseIndex, dryRunGroup, isCosmos, percentile, rowsPerBase,
  finishOf, stampTypeOf, tagsOf, matchGroupForSet,
} from './ids-lib.mjs';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const CACHE = opt('--cache');
if (!CACHE) { console.error('uso: ids-dry-run.mjs --cache <dir> [--json <fichero>]'); process.exit(64); }
mkdirSync(CACHE, { recursive: true });
const BASE = 'https://tcgcsv.com/tcgplayer/3';
const PTCG_SETS = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master/sets/en.json';
// TCGCSV bloquea el User-Agent por defecto de Node (su guía de uso pide identificarse).
const HEADERS = { 'User-Agent': 'tcghunt-ids-dry-run/1.0 (+https://tcghunt.mx)' };

async function getJson(url) {
  for (let i = 0; i < 3; i++) {
    const r = await fetch(url, { headers: HEADERS }).catch(() => null);
    if (r?.ok) return r.json();
    await new Promise((s) => setTimeout(s, 1000 * (i + 1)));
  }
  throw new Error(`GET ${url} falló 3 veces`);
}
async function cached(name, fn) {
  const f = join(CACHE, name);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const v = await fn();
  writeFileSync(f, JSON.stringify(v));
  await new Promise((s) => setTimeout(s, 150)); // cortesía con TCGCSV
  return v;
}
const products = (g) => cached(`p_${g}.json`, async () => (await getJson(`${BASE}/${g}/products`)).results.map((p) => ({
  productId: p.productId, name: p.name,
  number: (p.extendedData ?? []).find((e) => e.name === 'Number')?.value ?? null,
})));
const prices = (g) => cached(`pr_${g}.json`, async () => (await getJson(`${BASE}/${g}/prices`)).results.map((r) => ({
  productId: r.productId, subTypeName: r.subTypeName, marketPrice: r.marketPrice,
})));
const byProduct = (rows) => { const m = new Map(); for (const r of rows) m.set(r.productId, [...(m.get(r.productId) ?? []), r]); return m; };
const count = (arr, f) => arr.reduce((m, x) => { const k = f(x); m[k] = (m[k] ?? 0) + 1; return m; }, {});

const lastUpdated = await fetch('https://tcgcsv.com/last-updated.txt', { headers: HEADERS }).then((r) => r.text()).catch(() => 'NO LEÍDO');
const groups = await cached('groups.json', async () => (await getJson(`${BASE}/groups`)).results.map((g) => ({ groupId: g.groupId, name: g.name })));
const ptcgSets = await cached('ptcg-sets.json', async () => (await getJson(PTCG_SETS)).map((s) => ({ id: s.id, name: s.name })));
const groupName = new Map(groups.map((g) => [g.groupId, g.name]));
const baseGroups = [];
for (const g of groups) {
  if (STAMPED_SOURCE_GROUPS.includes(g.groupId)) continue;
  baseGroups.push({ groupId: g.groupId, name: g.name, products: await products(g.groupId) });
}
const setToGroup = new Map(ptcgSets.map((s) => [s.id, matchGroupForSet(s.name, groups)]));
const catalogGroupIds = new Set([...setToGroup.values()].filter((g) => g != null && !STAMPED_SOURCE_GROUPS.includes(g)));
const universes = {
  A: buildBaseIndex(baseGroups),
  B: buildBaseIndex(baseGroups.filter((g) => catalogGroupIds.has(g.groupId))),
};
const report = {
  tcgcsvLastUpdated: lastUpdated.trim(), grupos: groups.length, gruposBaseA: baseGroups.length,
  setsPokemontcgio: ptcgSets.length, setsConGrupo: [...setToGroup.values()].filter((g) => g != null).length, gruposBaseB: catalogGroupIds.size,
  promosEnCatalogoB: Object.fromEntries(PROMO_STAMP_GROUPS.map((g) => [g, [...setToGroup.entries()].filter(([, v]) => v === g).map(([k]) => k)])),
  universos: {},
};

for (const [U, index] of Object.entries(universes)) {
  const runs = {};
  for (const g of [...STAMPED_SOURCE_GROUPS, ...PROMO_STAMP_GROUPS]) {
    const ps = await products(g);
    const pm = byProduct(await prices(g));
    // IDS-D2: en 22872/24451 solo cuentan los productos con tipo (Prerelease/Staff…); el resto ES la promo base,
    // que vive en el MISMO grupo y entra al índice como set_base si el grupo está en el universo.
    const universe = PROMO_STAMP_GROUPS.includes(g) ? ps.filter((p) => stampTypeOf(g, p.name) != null) : ps;
    const { summary, detail } = dryRunGroup(g, universe, pm, index);
    runs[g] = {
      nombre: groupName.get(g), ...summary,
      unicoSobreConTipoYNumero: `${summary.colgados}/${summary.colgados + summary.ambiguos + summary.sinPareja}`,
      tipos: count(detail.filter((d) => d.type), (d) => d.type),
      sinTipoEtiquetas: count(detail.filter((d) => d.result === 'sinTipo'), (d) => tagsOf(d.name).join(' | ') || '<sin etiqueta>'),
      ambiguosPorGrupos: count(detail.filter((d) => d.result === 'ambiguo'), (d) => [...new Set(d.cands.map((c) => groupName.get(c.groupId)))].sort().join(' + ')),
      colgadosPorTipo: count(detail.filter((d) => d.result === 'colgado'), (d) => d.type),
      ejemplosSinPareja: detail.filter((d) => d.result === 'sinPareja').slice(0, 12).map((d) => `${d.productId} ${d.name}`),
      _detail: detail,
    };
  }
  // Filas de liga (producto stamped × acabado) por carta base, 22880 + 1539 (lo que pinta la ficha, D-IDS-O).
  const all = [...runs[22880]._detail, ...runs[1539]._detail];
  const per = rowsPerBase(all);
  const vals = [...per.values()];
  const filas = {
    cartasConLiga: vals.length, max: Math.max(...vals), p90: percentile(vals, 90), p50: percentile(vals, 50),
    masDe4: vals.filter((v) => v > 4).length, distribucion: count(vals, (v) => v),
    peores: [...per.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([b, n]) => ({
      baseProductId: b, filas: n,
      productos: all.filter((d) => d.result === 'colgado' && d.baseProductId === b).map((d) => `${d.productId} ${d.name} [${d.finishes.join(',')}]`),
    })),
  };
  report.universos[U] = { runs, filasLigaPorCarta: filas };
}

// Cosmos Holo de 22880: subTypeName de cada producto «(Cosmos Holo)».
const pp = byProduct(await prices(22880));
const cosmos = (await products(22880)).filter((p) => isCosmos(p.name));
report.cosmos22880 = {
  productos: cosmos.length,
  subTypeName: count(cosmos, (p) => (pp.get(p.productId) ?? []).map((r) => r.subTypeName).sort().join('+') || '<sin fila de precio>'),
};
// subTypeName que finishOf no reconoce en las fuentes: esa fila no existiría como acabado.
const unmapped = {};
for (const g of STAMPED_SOURCE_GROUPS) for (const r of await prices(g)) if (!finishOf(r.subTypeName)) unmapped[`${g}:${r.subTypeName}`] = (unmapped[`${g}:${r.subTypeName}`] ?? 0) + 1;
report.subTypeSinMapeo = unmapped;

const jsonOut = opt('--json');
if (jsonOut) writeFileSync(jsonOut, JSON.stringify(report, null, 1));
for (const u of Object.values(report.universos)) for (const r of Object.values(u.runs)) delete r._detail;
console.log(JSON.stringify(report, null, 1));
