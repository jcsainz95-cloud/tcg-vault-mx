// @vitest-environment node
/**
 * LIVE-8 · puerta de publicación del aviso de privacidad (criterio 501; API_CONTRACT §14.17 E4-3).
 *
 * Es una puerta de PUBLICACIÓN, no de construcción: en la suite normal se salta (y lo dice). Dos modos:
 *
 *     npm run check:legal:provisional   # LEGAL_PUBLISH_CHECK=provisional — la puerta para salir hoy
 *                                       # (HECHOS 2026-10-05 sesión 6: sin datos fiscales)
 *     npm run check:legal               # LEGAL_PUBLISH_CHECK=1 — modo FINAL: rojo hasta P-LEG-1…3
 *                                       # y la razón social del pie (regularización)
 *
 * Las reglas viven en `publish-check.ts` (puras, probadas en `provisional.test.ts`, LEG-P1…P7). Aquí
 * se le pasan los datos REALES: el aviso, `messages/*.json` y el fuente de los siete sitios. Un caso
 * por regla para que el rojo NOMBRE lo que falta. La conducta que protege a producción NO depende de
 * que alguien corra esto: con marcadores o incoherencias la página da 404 y nadie la enlaza.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test/strip-comments';
import { privacyNoticeEs } from './privacidad.es';
import { legalPublishProblems, type LegalMessages, type LegalPublishMode } from './publish-check';
import { PRIVACY_NOTICE_SITES } from './privacy-sites';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

const flag = process.env.LEGAL_PUBLISH_CHECK;
const mode: LegalPublishMode | null = flag === '1' ? 'final' : flag === 'provisional' ? 'provisional' : null;

function readSite(file: string): string | undefined {
  try {
    return stripComments(readFileSync(join(__dirname, '../../..', file), 'utf8'), file);
  } catch {
    return undefined;
  }
}

describe.runIf(mode !== null)(`criterio 501 · listo para publicar (modo ${mode})`, () => {
  const problems = mode
    ? legalPublishProblems(mode, {
        doc: privacyNoticeEs,
        messages: { es, en } as unknown as LegalMessages,
        siteSources: Object.fromEntries(PRIVACY_NOTICE_SITES.map((s) => [s.id, readSite(s.file)])),
      })
    : [];

  it('el aviso no tiene marcadores ni incoherencias del modo provisional', () => {
    expect(problems.filter((p) => !p.startsWith('sitio ') && !/^faltan P-LEG|legalEntity/.test(p))).toEqual([]);
  });

  for (const site of PRIVACY_NOTICE_SITES) {
    it(`LEG-5 · sitio ${site.id} · ${site.name} (${site.file}, lote ${site.lote})`, () => {
      expect(problems.filter((p) => p.startsWith(`sitio ${site.id} · `))).toEqual([]);
    });
  }

  if (mode === 'final') {
    it('modo final · datos fiscales del responsable cargados (P-LEG-1…3)', () => {
      expect(problems.filter((p) => p.startsWith('faltan P-LEG'))).toEqual([]);
    });
    it('modo final · razón social del pie cargada en los dos idiomas (common.footer.legalEntity)', () => {
      expect(problems.filter((p) => p.includes('legalEntity'))).toEqual([]);
    });
  }

  it('legalPublishProblems = [] (todo junto)', () => {
    expect(problems).toEqual([]);
  });
});

describe.skipIf(mode !== null)('criterio 501 · puerta de publicación', () => {
  it.skip('se mide con `npm run check:legal:provisional` (salir hoy) y `npm run check:legal` (final; ROJO hasta P-LEG-1…3)', () => {});
});
