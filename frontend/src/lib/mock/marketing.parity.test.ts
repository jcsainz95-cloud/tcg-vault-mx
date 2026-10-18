/**
 * D5 (techlead, 2026-10-18) · paridad del SERVIDOR FALSO del Panel (`mock/marketing.ts`) con el servidor real.
 *
 * Qué pasó: en c7 el mock decía «Pedidos por estado de envío» y «Otros (< 5 c/u)» mientras el servidor decía
 * «Nº de pedidos por estado de envío» y «Otros estados», y sus motivos «NO MEDIDO — …» eran otros. El modo demo y las
 * e2e de mocks enseñaban textos que la pantalla real nunca pinta.
 *
 * Fuentes (una por hecho):
 * - ids y ORDEN de tablas por pantalla: el catálogo normativo `docs/API_CONTRACT.md §MKT.G.4`;
 * - títulos, fuente, etiquetas de columna, motivos «NO MEDIDO — …», nota de cobertura, leyenda y rótulos de fila:
 *   `backend/src/modules/marketing/marketing-analytics.service.ts` (el contrato no fija esos literales; el servidor sí)
 *   y `small-cells.ts` (`OTROS_LABEL`). Se LEEN como texto: el frontend no importa código del backend.
 * Se recorren las 8 pantallas × semana/mes × `exact`/`small_cells`.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { MarketingAggTable, MarketingScreen } from '@/types/contract';
import { mockMarketingPanel, mockMarketingPeriods } from './marketing';

const ROOT = resolve(__dirname, '../../../..');
const read = (rel: string) => readFileSync(resolve(ROOT, rel), 'utf8');
const SERVICE = read('backend/src/modules/marketing/marketing-analytics.service.ts');
const SMALL_CELLS = read('backend/src/modules/marketing/small-cells.ts');
const CONTRACT = read('docs/API_CONTRACT.md');

// ── Lo que dice el servidor ────────────────────────────────────────────────────────────────────────────────────
const CONSTS = new Map([...SERVICE.matchAll(/^const (\w+)\s*=\s*'([^']*)';/gm)].map((m) => [m[1], m[2]]));
const constOf = (name: string) => {
  const v = CONSTS.get(name);
  if (v === undefined) throw new Error(`constante ${name} no encontrada en el servicio`);
  return v;
};

interface ServerTable {
  titles: Set<string>;
  sources: Set<string>;
  reasons: Set<string>;
}
const SERVER = new Map<string, ServerTable>();
const entry = (id: string) => {
  if (!SERVER.has(id)) SERVER.set(id, { titles: new Set(), sources: new Set(), reasons: new Set() });
  return SERVER.get(id)!;
};
for (const m of SERVICE.matchAll(/this\.notMeasured\('(\w+)',\s*'([^']*)',\s*'(\w+)',\s*(\w+)\)/g)) {
  const e = entry(m[1]);
  e.titles.add(m[2]);
  e.sources.add(m[3]);
  e.reasons.add(constOf(m[4]));
}
for (const m of SERVICE.matchAll(/id: '(\w+)',\s*title: '([^']*)',\s*source: '(\w+)'/g)) {
  const e = entry(m[1]);
  e.titles.add(m[2]);
  e.sources.add(m[3]);
}
// c7 por semana: tabla literal con `notMeasuredReason: <CONST>`.
for (const m of SERVICE.matchAll(/id: '(\w+)',[^}]*?notMeasuredReason: (\w+)/gs)) entry(m[1]).reasons.add(constOf(m[2]));

const SERVER_COLUMNS = new Set(
  [...SERVICE.matchAll(/\{ key: '(\w+)', labelEs: '([^']*)'(?:, tech: '([^']*)')?, kind: '(\w+)'/g)].map(
    (m) => `${m[1]}|${m[2]}|${m[3] ?? ''}|${m[4]}`,
  ),
);
const legendBlock = SERVICE.slice(SERVICE.indexOf('const SOURCE_LEGEND'), SERVICE.indexOf('};', SERVICE.indexOf('const SOURCE_LEGEND')));
const SERVER_LEGEND = Object.fromEntries([...legendBlock.matchAll(/^\s+(\w+): '([^']*)',/gm)].map((m) => [m[1], m[2]]));
const SERVER_COVERAGE = /export const COVERAGE_NOTE = '([^']*)'/.exec(SERVICE)?.[1];
const SERVER_OTROS = /export const OTROS_LABEL = '([^']*)'/.exec(SMALL_CELLS)?.[1];

// ── Lo que dice el contrato (§MKT.G.4) ─────────────────────────────────────────────────────────────────────────
const g4 = CONTRACT.slice(CONTRACT.indexOf('#### MKT.G.4'), CONTRACT.indexOf('#### MKT.G.5'));
const CATALOG = new Map<string, string[]>();
for (const m of g4.matchAll(/^\| ([a-h]) \| `(\w+)` \|/gm)) CATALOG.set(m[1], [...(CATALOG.get(m[1]) ?? []), m[2]]);

// ── Lo que sirve el mock ───────────────────────────────────────────────────────────────────────────────────────
const SCREENS: MarketingScreen[] = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
type Variant = { kind: 'week' | 'month'; privacy: 'exact' | 'small_cells' };
const VARIANTS: Variant[] = [
  { kind: 'week', privacy: 'exact' },
  { kind: 'week', privacy: 'small_cells' },
  { kind: 'month', privacy: 'exact' },
  { kind: 'month', privacy: 'small_cells' },
];
function mockPayload(screen: MarketingScreen, v: Variant) {
  window.localStorage.removeItem('tcg.mktPrivacy');
  if (v.privacy === 'small_cells') window.localStorage.setItem('tcg.mktPrivacy', 'small_cells');
  const q = v.kind === 'month' ? { month: mockMarketingPeriods().closedMonths[0].month } : {};
  return mockMarketingPanel(screen, q);
}
const CASES = SCREENS.flatMap((screen) => VARIANTS.map((v) => [`${screen} · ${v.kind} · ${v.privacy}`, screen, v] as const));

/**
 * Rótulos ESTRUCTURALES de fila (no datos de demo) y de DÓNDE salen en el servidor. c7 agrupa con su propio
 * literal («Otros estados», PM-B2); d1 con el de la supresión complementaria (`small-cells.ts OTROS_LABEL`):
 * confundirlos fue justo la deriva de c7. Desde 2026-10-18 c7 pasa también por `safeRows` → `applySmallCells`
 * (`marketing-analytics.service.ts c7ByState`), así que en `small_cells` puede emitir legítimamente `OTROS_LABEL`
 * además de sus propios literales: c7 acepta los dos y ninguno más.
 */
const inService = (v: string) => SERVICE.includes(`'${v}'`);
const STRUCTURAL_TEXT: Record<string, { applies: (value: string) => boolean; ok: (value: string) => boolean }> = {
  a1: { applies: () => true, ok: inService },
  a2: { applies: () => true, ok: inService },
  a3: { applies: () => true, ok: inService },
  c7: { applies: (v) => /^(Otros|Recogida)/.test(v), ok: (v) => inService(v) || v === SERVER_OTROS },
  d1: { applies: (v) => v.startsWith('Otros'), ok: (v) => v === SERVER_OTROS },
};

afterEach(() => window.localStorage.removeItem('tcg.mktPrivacy'));

describe('D5 · las fuentes se leyeron (si no, la paridad sería vacía)', () => {
  it('catálogo §MKT.G.4 con las 8 pantallas; servidor con título para cada id del catálogo', () => {
    expect([...CATALOG.keys()]).toEqual(SCREENS);
    const missing = [...CATALOG.values()].flat().filter((id) => !SERVER.get(id)?.titles.size);
    expect(missing).toEqual([]);
    expect(SERVER_COLUMNS.size).toBeGreaterThan(10);
    expect(Object.keys(SERVER_LEGEND).sort()).toEqual(['BD', 'GA4', 'SC', 'Srv']);
    expect(SERVER_COVERAGE).toBeTruthy();
    expect(SERVER_OTROS).toBeTruthy();
    for (const [id, e] of SERVER) expect(e.titles.size, `${id} con un solo título en el servidor`).toBe(1);
  });
});

describe('D5 · rótulos estructurales de c7', () => {
  it('c7 acepta «Otros estados», «Recogida en persona» y OTROS_LABEL; rechaza cualquier otro «Otros …»', () => {
    const c7 = STRUCTURAL_TEXT.c7;
    for (const v of ['Otros estados', 'Recogida en persona', SERVER_OTROS!]) {
      expect(c7.applies(v), v).toBe(true);
      expect(c7.ok(v), v).toBe(true);
    }
    expect(c7.ok('Otros (< 3 c/u)')).toBe(false);
    expect(c7.ok('Otros')).toBe(false);
  });
});

describe('D5 · mock ↔ servidor ↔ §MKT.G.4', () => {
  it.each(CASES)('%s', (_name, screen, v) => {
    const p = mockPayload(screen, v);
    expect(p.tables.map((t) => t.id), 'ids y orden = §MKT.G.4').toEqual(CATALOG.get(screen));
    expect(p.notes).toEqual([SERVER_COVERAGE]);
    expect(p.sourceLegend).toEqual(SERVER_LEGEND);
    for (const t of p.tables as MarketingAggTable[]) {
      const srv = SERVER.get(t.id)!;
      expect([...srv.titles], `${t.id} título`).toEqual([t.title]);
      expect(srv.sources.has(t.source), `${t.id} fuente ${t.source}`).toBe(true);
      if (!t.measured) {
        expect(srv.reasons.has(t.notMeasuredReason ?? ''), `${t.id} motivo «${t.notMeasuredReason}»`).toBe(true);
      } else {
        expect(t.columns.length, `${t.id} medida sin columnas`).toBeGreaterThan(0);
      }
      for (const c of t.columns) {
        expect(SERVER_COLUMNS.has(`${c.key}|${c.labelEs}|${c.tech ?? ''}|${c.kind}`), `${t.id} columna ${c.key} «${c.labelEs}»`).toBe(true);
      }
      const structural = STRUCTURAL_TEXT[t.id];
      if (!structural) continue;
      const textKeys = t.columns.filter((c) => c.kind === 'text').map((c) => c.key);
      for (const row of t.rows) {
        for (const k of textKeys) {
          const value = row[k];
          if (typeof value !== 'string' || !structural.applies(value)) continue;
          expect(structural.ok(value),`${t.id} rótulo de fila «${value}» no es del servidor`).toBe(true);
        }
      }
    }
  });
});
