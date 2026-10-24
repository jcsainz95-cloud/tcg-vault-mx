import { describe, expect, it } from 'vitest';
import {
  MEASURED_ROUTE_PATTERNS,
  MEASURED_UNLOCALIZED_PATHS,
  consentForRoute,
  isMeasuredPath,
  measurementPolicyFor,
  sendsPageView,
} from './routes';
import { trackWith, type TrackRuntime } from './track';

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
    '/es/buylist',
    '/en/buylist',
    '/es/buylist/',
    '/card-show',
  ])('medida: %s', (p) => {
    expect(isMeasuredPath(p)).toBe(true);
  });

  it.each([
    '/es/account',
    '/es/account/password',
    '/es/vault',
    '/es/admin',
    '/es/admin/marketing',
    '/es/buylist/solicitud',
    '/es/buylist/requests/abc',
    '/es/buylist/requests',
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
    '/card-show/confirm',
    '/card-show/cancel',
    '/card-show/unsubscribe',
    '/card-show/x',
    '/card-show/',
    '/es/card-show',
    '/card-show-cdmx.ics',
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
    expect(sendsPageView('/es/buylist')).toBe(true);
    expect(sendsPageView('/card-show')).toBe(true);
    expect(sendsPageView('/card-show?utm_source=ig#registro')).toBe(true);
    expect(sendsPageView('/es/account')).toBe(false);
    expect(sendsPageView('/card-show/confirm')).toBe(false);
  });
});

/**
 * C-F9 (API_CONTRACT §MKT.H.11, v1.109): `/es/buylist` y `/card-show` ⇒ sí; `/es/buylist/requests/x`,
 * `/card-show/confirm|cancel|unsubscribe` ⇒ no. En `/card-show` solo `page_view` a GA4 y nunca Meta.
 */
describe('C-F9 · /buylist y /card-show', () => {
  it('la tabla literal del candado', () => {
    expect(isMeasuredPath('/es/buylist')).toBe(true);
    expect(isMeasuredPath('/card-show')).toBe(true);
    for (const p of ['/es/buylist/requests/x', '/card-show/confirm', '/card-show/cancel', '/card-show/unsubscribe']) {
      expect(isMeasuredPath(p), p).toBe(false);
    }
  });

  it('las listas: `/buylist` sin `:seg` debajo; `/card-show` en la lista SIN idioma y exacta', () => {
    expect(MEASURED_ROUTE_PATTERNS).toContain('/buylist');
    expect(MEASURED_ROUTE_PATTERNS.filter((p) => p.startsWith('/buylist/'))).toEqual([]);
    expect(MEASURED_UNLOCALIZED_PATHS).toEqual(['/card-show']);
    expect(MEASURED_UNLOCALIZED_PATHS.some((p) => p.includes(':'))).toBe(false);
  });

  it('política: en /card-show sin píxel y solo page_view; en la tienda, todo', () => {
    expect(measurementPolicyFor('/card-show')).toEqual({ pixel: false, events: 'page_view_only', pageView: true });
    expect(measurementPolicyFor('/es/buylist')).toEqual({ pixel: true, events: 'all', pageView: true });
    expect(measurementPolicyFor('/card-show/confirm')).toBeNull();
  });

  it('consentForRoute: aceptar todo en la tienda NO enciende Meta en /card-show', () => {
    const all = { analytics: true, ads: true };
    expect(consentForRoute(all, '/card-show')).toEqual({ analytics: true, ads: false });
    expect(consentForRoute(all, '/es/catalog')).toEqual(all);
    expect(consentForRoute(all, '/card-show/unsubscribe')).toEqual({ analytics: false, ads: false });
  });

  function runtime(pathname: string, calls: { ga: unknown[][]; fb: unknown[][] }): TrackRuntime {
    return {
      on: true,
      pathname,
      consent: { analytics: true, ads: true },
      gtag: (...a: unknown[]) => calls.ga.push(a),
      fbq: (...a: unknown[]) => calls.fb.push(a),
      jar: { read: () => '', write: () => undefined, hostname: 'tcghunt.mx' },
    };
  }

  it('track en /card-show: page_view sale a GA4; ningún evento de formulario ni de comercio; nada a Meta', () => {
    const calls = { ga: [] as unknown[][], fb: [] as unknown[][] };
    const rt = runtime('/card-show', calls);
    expect(trackWith(rt, 'page_view', { page_location: 'https://tcghunt.mx/card-show?token=x&utm_source=ig' })).not.toBeNull();
    expect(calls.ga).toEqual([['event', 'page_view', { page_location: 'https://tcghunt.mx/card-show?utm_source=ig' }]]);
    for (const ev of ['click_contact', 'add_to_cart', 'view_item', 'select_content', 'search'] as const) {
      expect(trackWith(rt, ev, { contact_channel: 'whatsapp', page_path: '/card-show', items: [], value: 1 }), ev).toBeNull();
    }
    expect(calls.ga).toHaveLength(1);
    expect(calls.fb).toEqual([]);
  });

  it('el mismo evento de contacto en una ruta de la tienda SÍ sale a los dos (la política es por ruta)', () => {
    const calls = { ga: [] as unknown[][], fb: [] as unknown[][] };
    expect(trackWith(runtime('/es/buylist', calls), 'click_contact', { contact_channel: 'whatsapp', page_path: '/es/buylist' })).not.toBeNull();
    expect(calls.ga).toHaveLength(1);
    expect(calls.fb).toHaveLength(1);
  });
});
