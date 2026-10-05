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
import { describe, expect, it } from 'vitest';
import { privacyNoticeEs } from './privacidad.es';
import { findLegalMarkers } from './legal-gate';
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

describe.skipIf(run)('criterio 501 · puerta de publicación', () => {
  it.skip('se mide con `npm run check:legal` (hoy ROJO a propósito: faltan P-LEG-1…3)', () => {});
});
