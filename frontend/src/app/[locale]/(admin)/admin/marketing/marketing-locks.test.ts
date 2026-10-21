/**
 * Candados estáticos del Panel de Marketing (`DESIGN_SYSTEM §MKT-UX.16`) que se miden sobre el CÓDIGO y los catálogos:
 * - UX-MKT-4: «< 5», «Oculto», «No medido» viven por clave en `es.json` y `en.json` (paridad de claves del espacio).
 * - UX-MKT-14: ⛔ `dangerouslySetInnerHTML` en el módulo (lo de fuera se pinta como texto).
 * - UX-MKT-15: las descargas van por `requestBlob` (fetch + blob); ⛔ ningún enlace/navegación al API con la sesión.
 * - UX-MKT-18: ⛔ códigos internos en los textos de `admin.marketing.*`.
 * Comentarios fuera antes de buscar (`codigoDe` de `strip-comments`): un comentario que NOMBRA lo prohibido no es una infracción.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import es from '../../../../../../messages/es.json';
import en from '../../../../../../messages/en.json';
import { flatten } from '@/lib/i18n-p66-3.testkit';
import { codigoDe } from '@/test/strip-comments';

const DIR = __dirname;
const SRC = join(DIR, '../../../../..');
const moduleFiles = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f));
const code = (rel: string) => codigoDe(join(SRC, rel), rel);
const own = (f: string) => codigoDe(join(DIR, f), f);

const ES = flatten((es as Record<string, unknown>).admin as object, 'admin');
const EN = flatten((en as Record<string, unknown>).admin as object, 'admin');
const mkt = (cat: Record<string, string>) => Object.fromEntries(Object.entries(cat).filter(([k]) => k.startsWith('admin.marketing.')));

describe('UX-MKT-4 · paridad y texto de las celdas', () => {
  it('mismas claves en es y en bajo admin.marketing', () => {
    expect(Object.keys(mkt(ES)).sort()).toEqual(Object.keys(mkt(EN)).sort());
  });
  it('los textos de celda existen y son palabras visibles en ambos idiomas', () => {
    for (const k of ['cells.hidden', 'cells.notMeasured', 'cells.small', 'cells.footnote', 'table.notMeasuredTitle']) {
      expect(ES[`admin.marketing.${k}`], k).toBeTruthy();
      expect(EN[`admin.marketing.${k}`], k).toBeTruthy();
    }
    expect(ES['admin.marketing.cells.hidden']).toBe('Oculto');
    expect(EN['admin.marketing.cells.hidden']).toBe('Hidden');
  });
  it('ningún elemento HTML de la tabla lleva atributo `title` (el significado nunca va solo en un tooltip)', () => {
    // Solo etiquetas en minúscula (DOM); `<NotMeasuredBlock title=…>` es una prop de React, no un tooltip.
    expect(own('MarketingTable.tsx')).not.toMatch(/<[a-z][a-z0-9]*\b[^>]*\stitle=/);
  });
});

describe('UX-MKT-14 · sin HTML crudo en el módulo', () => {
  it.each(moduleFiles)('%s no usa dangerouslySetInnerHTML', (f) => {
    expect(own(f)).not.toMatch(/dangerouslySetInnerHTML/);
  });
});

describe('UX-MKT-15 · descargas por fetch + blob', () => {
  it('las tres descargas del cliente van por `requestBlob`, y ninguna construye una URL', () => {
    const client = code('lib/marketing-api.ts');
    for (const path of ['/admin/marketing/weekly-excel', '/admin/marketing/export']) {
      expect(client).toMatch(new RegExp(`requestBlob\\('${path.replace(/\//g, '\\/')}'`));
    }
    expect(client).not.toMatch(/window\.(open|location)|config\.apiBaseUrl/);
  });
  it.each(moduleFiles)('%s no enlaza al API ni navega para descargar', (f) => {
    const src = own(f);
    expect(src).not.toMatch(/apiBaseUrl|window\.open|location\.(assign|href\s*=)/);
    expect(src).not.toMatch(/href=\{[^}]*(export|excel|weekly)/i);
  });
});

describe('UX-MKT-18 · ningún código interno en pantalla', () => {
  const CODE = /\b(PM-[A-Z]\d|MKT|Fase 0|[a-h][0-9]{1,2})\b/;
  it.each([
    ['es', ES],
    ['en', EN],
  ] as const)('%s: 0 textos de admin.marketing con código', (_l, cat) => {
    const hits = Object.entries(mkt(cat)).filter(([, v]) => CODE.test(v));
    expect(hits).toEqual([]);
  });
});
