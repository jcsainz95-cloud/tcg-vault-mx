// @vitest-environment node
/**
 * C7 (BRIEF_MKT §4, 2026-10-31) — `/card-show` es la canónica FUERA del i18n (ARCHITECTURE §4.CARDSHOW.a). Las
 * variantes con prefijo de idioma (`/es/card-show`, `/en/card-show` y sus subrutas públicas) daban 404 (medido por
 * el orquestador con curl contra producción el 2026-10-31). Ahora responden 308 a la canónica conservando la query
 * (UTM de flyers/QR y tokens de confirm/cancel/unsubscribe).
 *
 * Se ejercita el middleware de verdad (con next-intl dentro), no una copia.
 */
import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import middleware from './middleware';

function run(path: string) {
  return middleware(new NextRequest(new URL(path, 'https://tcghunt.mx')));
}

describe('C7 · /{locale}/card-show… ⇒ 308 a /card-show… con la query intacta', () => {
  it.each([
    ['/es/card-show', '/card-show'],
    ['/en/card-show', '/card-show'],
    [
      '/es/card-show?utm_source=instagram&utm_medium=bio&utm_campaign=cardshow-dic26',
      '/card-show?utm_source=instagram&utm_medium=bio&utm_campaign=cardshow-dic26',
    ],
    ['/es/card-show/confirm?token=abc.DEF_123-x', '/card-show/confirm?token=abc.DEF_123-x'],
    ['/en/card-show/cancel?token=t0k%2Fen', '/card-show/cancel?token=t0k%2Fen'],
    ['/es/card-show/unsubscribe?token=u1&utm_source=mail', '/card-show/unsubscribe?token=u1&utm_source=mail'],
  ])('%s ⇒ 308 %s', (from, to) => {
    const res = run(from);
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe(`https://tcghunt.mx${to}`);
    // Sin cookie de idioma: la canónica es un solo idioma (§CARDSHOW.2).
    expect(res.headers.get('set-cookie') ?? '').not.toContain('NEXT_LOCALE');
  });

  it('la canónica /card-show sigue siendo 200 directo (sin redirect)', () => {
    const res = run('/card-show?utm_source=instagram');
    expect(res.status).toBe(200);
    expect(res.headers.get('location')).toBeNull();
  });

  it.each(['/es/admin/card-show', '/en/admin/card-show', '/es/card-shows', '/es/catalog/card-show'])(
    '%s NO se redirige a la canónica (el admin y las rutas parecidas quedan como estaban)',
    (path) => {
      const res = run(path);
      expect(res.headers.get('location') ?? '').not.toMatch(/^https:\/\/tcghunt\.mx\/card-show/);
    },
  );
});
