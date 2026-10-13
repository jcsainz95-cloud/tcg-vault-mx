// @vitest-environment node
/**
 * ⛔ SECRETO — guarda de repo público (complementa el grep de CI que cablea devops, §CARDSHOW.17).
 * Ningún valor real del evento puede vivir en el código del Card Show: fecha, sede/dirección,
 * precios, medidas ni las palabras clave del anuncio. Todo va como MARCADOR hasta el día del
 * anuncio. «Jakomi» sí se permite.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_SHOW, TBD } from './card-show';

const ROOT = join(__dirname, '../..');

/** Todos los ficheros fuente del Card Show (contenido, cliente y componentes). */
function cardShowSources(): { file: string; text: string }[] {
  const files: string[] = [
    'src/content/card-show.ts',
    'src/lib/card-show-api.ts',
    'src/lib/card-show-clicks.ts',
  ];
  const walk = (dir: string) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
    }
  };
  walk('src/app/card-show');
  return files.map((f) => ({ file: f, text: readFileSync(join(ROOT, f), 'utf8') }));
}

// Términos prohibidos del anuncio (encargo). ⛔ No escribir el valor real; se buscan como patrón.
const FORBIDDEN: RegExp[] = [
  /alianza/i,
  /revoluci[óo]n/i,
  /castillo/i,
  /insurgentes/i,
  /mixcoac/i,
  /san jos[ée]/i,
  /\b5\s*(o|y)\s*6\s*de\s*diciembre/i,
  /\b3000\b/,
  /\b2500\b/,
  /\b1800\b/,
  /\b25000\b/,
  /\b8500\b/,
];

describe('secreto · ningún dato real del evento en el código del Card Show', () => {
  const sources = cardShowSources();

  for (const re of FORBIDDEN) {
    it(`no aparece el patrón prohibido ${re}`, () => {
      const hits = sources.filter((s) => re.test(s.text)).map((s) => s.file);
      expect(hits, `patrón ${re} encontrado en: ${hits.join(', ')}`).toEqual([]);
    });
  }

  it('los datos del evento están como marcadores (fecha, sede, precio)', () => {
    expect(CARD_SHOW.hero.fecha).toBe(TBD.fecha);
    expect(CARD_SHOW.hero.sede).toBe(TBD.sede);
    for (const t of CARD_SHOW.mesas.tipos) expect(t.precio).toBe(TBD.precio);
    for (const n of CARD_SHOW.patrocinios.niveles) expect(n.precio).toBe(TBD.precio);
  });

  it('ninguna medida de mesa se muestra todavía (decisión JC: sin medidas)', () => {
    for (const t of CARD_SHOW.mesas.tipos) expect(t.medida).toBeNull();
  });

  it('no hay patrocinador nombrado en la sección de patrocinios (solo niveles genéricos)', () => {
    const nombres = CARD_SHOW.patrocinios.niveles.map((n) => n.nombre).join(' ');
    expect(nombres).toBe('Bronce Plata Oro');
  });
});
