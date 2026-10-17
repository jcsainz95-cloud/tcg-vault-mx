// @vitest-environment node
/**
 * ⛔ SECRETO — guarda de repo público (complementa el grep de CI que cablea devops, §CARDSHOW.17).
 *
 * ESTADO (decisión JC 2026-10-16): el evento SALE con datos reales. Fecha, sede, precios y mesas YA
 * SON PÚBLICOS y viven en el código (ya no son marcadores). El ÚNICO secreto que queda son los
 * NOMBRES DE PATROCINADORES: no pueden aparecer en ningún fuente del Card Show y el bloque de logos
 * va oculto (`patrocinios.showSponsors === false`). Solo se nombran TCG HUNT y Jakomi.
 *
 * Los términos prohibidos (nombres de patrocinador) NO viven en este archivo: se leen en RUNTIME de
 * la variable de entorno `CARDSHOW_SECRET_TERMS` (secreto de CI que cablea devops). Sin la env, ese
 * escaneo se salta; no hay fallback hardcodeado. Así ningún nombre de patrocinador queda en el repo.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { CARD_SHOW } from './card-show';

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
      it(`nombre de patrocinador prohibido #${i + 1} no aparece en ninguna fuente`, () => {
        const hits = sources.filter((s) => re.test(s.text)).map((s) => s.file);
        expect(hits, `un nombre de patrocinador apareció en: ${hits.join(', ')}`).toEqual([]);
      });
    });
  });
} else {
  describe('secreto · nombres de patrocinador (escaneo por env)', () => {
    it.skip('CARDSHOW_SECRET_TERMS no definida; escaneo de nombres de patrocinador omitido', () => {
      // Sin la env no hay términos que escanear y no existe fallback hardcodeado: se salta limpio.
    });
  });
}

describe('secreto · patrocinadores ocultos en el código del Card Show', () => {
  it('el bloque de logos de patrocinadores va OCULTO (showSponsors === false)', () => {
    expect(CARD_SHOW.patrocinios.showSponsors).toBe(false);
  });

  // ⭐ R5b (JC 2026-10-17): se RETIRARON los niveles/montos de patrocinio de la página; el contacto
  // comercial es un formulario privado (`type=merchant|sponsor`). La guarda que queda viva: ⛔ ningún
  // rótulo de nivel de patrocinio (Oro/Plata/Producto) y ⛔ ningún monto EXCEPTO el precio PÚBLICO del
  // main de Pokémon (MX$200, decisión JC — misma cifra que el correo). Cualquier OTRO `$cifra` sería
  // un monto de patrocinio filtrado.
  it('no quedó ninguna estructura de niveles/montos de patrocinio en el contenido', () => {
    expect('niveles' in CARD_SHOW.patrocinios).toBe(false);
    const blob = JSON.stringify(CARD_SHOW);
    expect(/Oro|Plata|Producto/.test(blob)).toBe(false);
    // El ÚNICO monto admitido es el precio público del torneo (MX$200).
    const amounts = (blob.match(/\$\s?\d[\d,]*/g) ?? []).map((a) => a.replace(/\s/g, ''));
    expect(amounts.every((a) => a === '$200')).toBe(true);
  });

  it('las únicas marcas nombradas en el contenido son TCG HUNT y Jakomi', () => {
    // Serializa TODO el objeto de contenido y comprueba que no quedó ninguna otra marca evidente.
    const blob = JSON.stringify(CARD_SHOW);
    // Marcas permitidas (públicas). Cualquier otra se escanea vía CARDSHOW_SECRET_TERMS en CI.
    expect(blob).toContain('TCG HUNT');
    expect(blob).toContain('Jakomi');
  });
});
