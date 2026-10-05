/**
 * LIVE-8 · criterio 501 de PROJECT.md — «Una prueba automatizada falla si [un marcador] aparece.
 * Mientras falte un dato del dueño, el criterio está ROJO y no se pasa a modo real».
 *
 * Es una puerta de PUBLICACIÓN, no de construcción: hoy el borrador tiene marcadores a propósito
 * (faltan P-LEG-1…3), así que en la suite normal se salta (y lo dice). La corre quien va a pasar a
 * `sk_live_` (§14.10, lista de lo que bloquea):
 *
 *     npm run check:legal      # LEGAL_PUBLISH_CHECK=1 ⇒ rojo mientras quede un marcador
 *
 * La conducta que protege a producción mientras tanto NO depende de que alguien corra esto: la
 * página da 404 y el pie no la enlaza (`legal-gate.ts`, `legal-gate.test.ts`).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { stripComments } from '@/test/strip-comments';
import { privacyNoticeEs } from './privacidad.es';
import { findLegalMarkers } from './legal-gate';
import { PRIVACY_NOTICE_SITES, missingUses } from './privacy-sites';
import es from '../../../messages/es.json';
import en from '../../../messages/en.json';

const run = process.env.LEGAL_PUBLISH_CHECK === '1';

describe.runIf(run)('criterio 501 · listo para publicar (LEGAL_PUBLISH_CHECK=1)', () => {
  it('el aviso de privacidad no tiene marcadores', () => {
    expect(findLegalMarkers(privacyNoticeEs)).toEqual([]);
  });

  it('la razón social del pie está cargada en los dos idiomas (no es marcador)', () => {
    for (const [loc, m] of [['es', es], ['en', en]] as const) {
      const v = (m as { common: { footer: { legalEntity: string } } }).common.footer.legalEntity;
      expect(v.trim(), loc).not.toMatch(/^\[.*\]$|^$/);
    }
  });
});

/**
 * LEG-5 (API_CONTRACT v1.84.1 §14.14 E-9): los SIETE sitios usan el componente del aviso. Un caso por
 * sitio, para que el rojo NOMBRE el sitio que falta. Los de lotes 2 y 3 (tras F-SKY / F-PNL) están
 * rojos aquí hasta construirse: así ningún lote se queda olvidado antes de `sk_live_`.
 */
describe.runIf(run)('criterio 501 · LEG-5 — los siete sitios enlazan el aviso', () => {
  for (const site of PRIVACY_NOTICE_SITES) {
    it(`sitio ${site.id} · ${site.name} (${site.file}, lote ${site.lote})`, () => {
      const src = stripComments(readFileSync(join(__dirname, '../../..', site.file), 'utf8'), site.file);
      expect(missingUses(site, src), `sitio ${site.id} · ${site.name}: falta el componente del aviso`).toEqual([]);
    });
  }
});

describe.skipIf(run)('criterio 501 · puerta de publicación', () => {
  it.skip('se mide con `npm run check:legal` (hoy ROJO a propósito: faltan P-LEG-1…3)', () => {});
});
