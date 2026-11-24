import { describe, it, expect } from 'vitest';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

/**
 * M-9 · candado de textos: ningún mensaje de la sección de reportes trae un porcentaje LITERAL con 0 o 2+ decimales
 * («42%», «12.34 %»). Los porcentajes dinámicos van por `fmtPct` (placeholder ya formateado) y se miden en los renders.
 */
const SCOPES: [string, (m: Record<string, unknown>) => unknown][] = [
  ['admin.reports', (m) => (m.admin as Record<string, unknown>).reports],
  ['admin.m7', (m) => (m.admin as Record<string, unknown>).m7],
  ['admin.m9.sales', (m) => ((m.admin as Record<string, Record<string, unknown>>).m9).sales],
];
function strings(node: unknown, path: string, out: [string, string][]) {
  if (typeof node === 'string') out.push([path, node]);
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) strings(v, `${path}.${k}`, out);
}
describe('M-9 · porcentajes en los mensajes de reportes', () => {
  for (const [lang, msgs] of [['es', es], ['en', en]] as const) {
    it(`${lang}: sin «N%» / «N.NN %» literales con 0 o 2+ decimales`, () => {
      const all: [string, string][] = [];
      for (const [p, pick] of SCOPES) strings(pick(msgs as unknown as Record<string, unknown>), p, all);
      expect(all.length).toBeGreaterThan(100);
      const bad = all.filter(([, v]) => [...v.matchAll(/(\d+)([.,]\d+)?\s?%/g)].some((m) => (m[2] ? m[2].length - 1 : 0) !== 1));
      expect(bad).toEqual([]);
    });
  }
});
