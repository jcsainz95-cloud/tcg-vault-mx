import { describe, expect, it } from 'vitest';
import { isMeasuredPath, sendsPageView } from './routes';

/** ARCHITECTURE §14.4 — lista blanca: toda ruta nueva nace excluida. */
describe('lista blanca de medición', () => {
  it.each([
    '/es',
    '/en',
    '/es/',
    '/es/catalog',
    '/es/compra',
    '/es/catalog/sv3pt5-199',
    '/es/sellado',
    '/es/sellado/inv-1',
    '/es/checkout',
    '/es/guias',
    '/es/guias/que-es-nm',
    '/es/preguntas',
    '/es/como-funciona',
    '/en/catalog/xy1-1',
  ])('medida: %s', (p) => {
    expect(isMeasuredPath(p)).toBe(true);
  });

  it.each([
    '/es/account',
    '/es/account/password',
    '/es/vault',
    '/es/admin',
    '/es/admin/marketing',
    '/es/buylist',
    '/es/buylist/requests/abc',
    '/es/login',
    '/es/register',
    '/es/reset-password',
    '/es/verify-email',
    '/es/forgot-password',
    '/es/pedido',
    '/es/orders',
    '/es/orders/o1',
    '/es/shipments',
    '/es/privacidad',
    '/es/terminos',
    '/es/accesorios',
    '/es/decks-meta',
    '/es/lista-de-deseos/aviso',
    '/card-show',
    '/card-show/confirm',
    '/',
    '/fr/catalog',
    '/es/catalog/a/b',
    '/es/ruta-nueva',
  ])('excluida: %s', (p) => {
    expect(isMeasuredPath(p)).toBe(false);
  });

  it('page_view: no en checkout (§MKT.H.4), sí en el resto de lo medido', () => {
    expect(sendsPageView('/es/checkout')).toBe(false);
    expect(sendsPageView('/es/catalog')).toBe(true);
    expect(sendsPageView('/es')).toBe(true);
    expect(sendsPageView('/es/account')).toBe(false);
  });
});
