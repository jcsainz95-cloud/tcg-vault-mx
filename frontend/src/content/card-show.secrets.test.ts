// @vitest-environment node
/**
 * ⛔ SECRETO — guarda de repo público (complementa el grep de CI que cablea devops, §CARDSHOW.17).
 * Ningún valor real del evento puede vivir en el código del Card Show: fecha, sede/dirección,
 * precios ni las palabras clave del anuncio. Todo va como MARCADOR hasta el día del anuncio.
 * «Jakomi» sí se permite. Las MEDIDAS de mesa NO son secreto (decisión JC) y sí se muestran.
 *
 * Los términos prohibidos del anuncio NO viven en este archivo: se leen en RUNTIME de la variable
 * de entorno `CARDSHOW_SECRET_TERMS` (secreto de CI que cablea devops). Sin la env, ese escaneo se
 * salta; no hay fallback hardcodeado. Así ningún valor real del evento queda en el repo público.
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

/**
 * Términos prohibidos del anuncio, leídos en RUNTIME de `CARDSHOW_SECRET_TERMS` (lista separada por
 * comas; secreto de CI). ⛔ Ningún valor real vive en este repo. Cada término se compila a un RegExp
 * case-insensitive ESCAPANDO los metacaracteres de regex, de modo que se busca como SUBCADENA
 * LITERAL (robusto ante acentos, dígitos o signos en el valor; nunca rompe la compilación).
 */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function forbiddenTermsFromEnv(): RegExp[] {
  const raw = process.env.CARDSHOW_SECRET_TERMS;
  if (!raw || raw.trim() === '') return [];
  return raw
    .split(',')
    .map((t) => t.trim())
    .filter((t) => t.length > 0)
    .map((t) => new RegExp(escapeRegex(t), 'i'));
}

const FORBIDDEN = forbiddenTermsFromEnv();

// ⛔ Mensajes y nombres de prueba GENÉRICOS: nunca imprimen el valor del término (solo ficheros).
if (FORBIDDEN.length > 0) {
  describe('secreto · términos del anuncio no aparecen en el código del Card Show', () => {
    const sources = cardShowSources();
    FORBIDDEN.forEach((re, i) => {
      it(`término prohibido del anuncio #${i + 1} no aparece en ninguna fuente`, () => {
        const hits = sources.filter((s) => re.test(s.text)).map((s) => s.file);
        expect(hits, `un término prohibido del anuncio apareció en: ${hits.join(', ')}`).toEqual([]);
      });
    });
  });
} else {
  describe('secreto · términos del anuncio (escaneo por env)', () => {
    it.skip('CARDSHOW_SECRET_TERMS no definida; escaneo de términos del anuncio omitido', () => {
      // Sin la env no hay términos que escanear y no existe fallback hardcodeado: se salta limpio.
    });
  });
}

describe('secreto · marcadores del evento en el código del Card Show', () => {
  it('los datos del evento están como marcadores (fecha, sede, precio)', () => {
    expect(CARD_SHOW.hero.fecha).toBe(TBD.fecha);
    expect(CARD_SHOW.hero.sede).toBe(TBD.sede);
    for (const t of CARD_SHOW.mesas.tipos) expect(t.precio).toBe(TBD.precio);
    for (const n of CARD_SHOW.patrocinios.niveles) expect(n.precio).toBe(TBD.precio);
  });

  it('las medidas de mesa SÍ se muestran (decisión JC: no son secreto)', () => {
    const medidas = CARD_SHOW.mesas.tipos.map((t) => t.medida);
    expect(medidas.length).toBeGreaterThan(0);
    for (const m of medidas) {
      expect(m).not.toBeNull();
      expect(typeof m).toBe('string');
      expect((m as string).length).toBeGreaterThan(0);
    }
  });

  it('no hay patrocinador nombrado en la sección de patrocinios (solo niveles genéricos)', () => {
    const nombres = CARD_SHOW.patrocinios.niveles.map((n) => n.nombre).join(' ');
    expect(nombres).toBe('Bronce Plata Oro');
  });
});
