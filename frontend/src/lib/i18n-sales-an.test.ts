import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import es from '../../messages/es.json';
import en from '../../messages/en.json';
import { flatten, P66_3_CODE_RE } from './i18n-p66-3.testkit';

/**
 * **UX-AN-15** (`DESIGN_SYSTEM §AN-UX.14`/.15): cada clave de la tabla de textos existe en `es` y en `en` CON EL TEXTO
 * DE LA NORMA (se lee la tabla del documento, no una copia), sin códigos internos (P66-3 + «AN-n»/«P-AN»), y las
 * claves previas de `admin.m9.*` siguen en su sitio. **UX-AN-20**: `admin.m9.sales.csv.*` no habla de centavos.
 * Determinista (N=1).
 */
const DS = readFileSync(resolve(__dirname, '../../../docs/DESIGN_SYSTEM.md'), 'utf8');
const section = DS.slice(DS.indexOf('### AN-UX.14'), DS.indexOf('### AN-UX.15'));
const ROWS = [...section.matchAll(/^\| `([^`]+)` \| (.*) \| (.*) \|$/gm)].map((m) => ({
  key: m[1].startsWith('sales.') ? `admin.m9.${m[1]}` : m[1],
  es: m[2],
  en: m[3],
}));
const ES = flatten(es);
const EN = flatten(en);

describe('UX-AN-15 · paridad ES/EN con la tabla de §AN-UX.14', () => {
  it('la tabla se leyó (control: ve algo)', () => {
    expect(ROWS.length).toBeGreaterThan(150);
    expect(ROWS.some((r) => r.key === 'admin.dashboard.salesToday.title')).toBe(true);
  });
  it.each(ROWS.map((r) => [r.key, r] as const))('%s', (key, r) => {
    expect(ES[key], `es: ${key}`).toBe(r.es);
    expect(EN[key], `en: ${key}`).toBe(r.en);
  });
  it('sin códigos internos en los textos nuevos', () => {
    const AN_RE = /\b(AN-[0-9]+|P-AN)\b/;
    for (const [k, v] of [...Object.entries(ES), ...Object.entries(EN)]) {
      if (!k.startsWith('admin.m9.sales.') && !k.startsWith('admin.dashboard.salesToday.') && !k.startsWith('admin.m9.tabs.')) continue;
      expect(P66_3_CODE_RE.test(v), `${k}: ${v}`).toBe(false);
      expect(AN_RE.test(v), `${k}: ${v}`).toBe(false);
    }
  });
  it('lo de antes de `admin.m9.*` no cambió', () => {
    expect(es.admin.m9.metrics.title).toBe('Actividad de la tienda');
    expect(es.admin.m9.range.title).toBe('Rango de fechas');
    expect(en.admin.m9.export.pnl).toBe('Export P&L (CSV)');
  });
});

describe('UX-AN-20 · el CSV va en pesos: ningún texto de `admin.m9.sales.csv.*` dice centavos', () => {
  it('es y en', () => {
    const csv = Object.entries({ ...ES, ...Object.fromEntries(Object.entries(EN).map(([k, v]) => [`en:${k}`, v])) }).filter(([k]) =>
      k.replace(/^en:/, '').startsWith('admin.m9.sales.csv.'),
    );
    expect(csv.length).toBeGreaterThanOrEqual(6);
    for (const [k, v] of csv) expect(v, k).not.toMatch(/centavo|cents/i);
  });
});
