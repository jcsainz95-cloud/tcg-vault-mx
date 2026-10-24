import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_PARAMS,
  filterParams,
  flushPendingEvents,
  setRuntimeConsent,
  track,
  trackWith,
  type TrackRuntime,
} from './track';
import type { CookieJar } from './consent';

const emptyJar: CookieJar = { read: () => '', write: () => undefined, hostname: 'tcghunt.mx' };

function rt(over: Partial<TrackRuntime> = {}): TrackRuntime & { gtag: ReturnType<typeof vi.fn>; fbq: ReturnType<typeof vi.fn> } {
  const gtag = vi.fn();
  const fbq = vi.fn();
  return { on: true, pathname: '/es/catalog/xy1-1', consent: { analytics: true, ads: true }, gtag, fbq, jar: emptyJar, ...over } as never;
}

const ITEM = { item_id: 'card-1', item_name: 'Pikachu', item_category: 'card', price: 120.5 };

/** C-F6 (API_CONTRACT §MKT.H.11) — lista cerrada de parámetros y lista blanca de rutas. */
describe('C-F6 · track() descarta lo que no está en la lista de §MKT.H.4', () => {
  it('un parámetro fuera de la lista (email) se descarta; los de la lista pasan', () => {
    const r = rt();
    trackWith(r, 'view_item', { items: [ITEM], value: 120.5, currency: 'MXN', email: 'a@b.com', user_id: 'u1' });
    expect(r.gtag).toHaveBeenCalledTimes(1);
    const [, name, params] = r.gtag.mock.calls[0];
    expect(name).toBe('view_item');
    expect(params).toEqual({ items: [ITEM], value: 120.5, currency: 'MXN' });
    expect(JSON.stringify(params)).not.toMatch(/email|user_id|a@b\.com/);
  });

  it('claves de items fuera de la lista (correo dentro del item) se descartan', () => {
    const f = filterParams('add_to_cart', { items: [{ ...ITEM, email: 'x@y.z', orderNumber: 'TCG-000123' }], value: 1 });
    expect(f.items).toEqual([ITEM]);
  });

  it('search nunca lleva el término', () => {
    expect(filterParams('search', { results_count: 4, search_term: 'charizard' })).toEqual({ results_count: 4 });
  });

  it('page_location/page_referrer se sanean (C-F4 aplicado)', () => {
    const f = filterParams('page_view', {
      page_location: 'https://tcghunt.mx/es?token=x&utm_source=ig#a',
      page_referrer: 'https://tcghunt.mx/es/pedido?token=secreto',
    });
    expect(f).toEqual({ page_location: 'https://tcghunt.mx/es?utm_source=ig', page_referrer: 'https://tcghunt.mx/es/pedido' });
  });

  it('en ruta fuera de la lista blanca no envía nada', () => {
    for (const pathname of ['/es/account', '/es/buylist/solicitud', '/es/admin/m3', '/es/pedido', '/es/orders/o1']) {
      const r = rt({ pathname });
      expect(trackWith(r, 'view_item', { items: [ITEM], value: 1 })).toBeNull();
      expect(r.gtag).not.toHaveBeenCalled();
      expect(r.fbq).not.toHaveBeenCalled();
    }
  });

  it('sin elección o con modo off no envía nada', () => {
    const a = rt({ consent: null });
    expect(trackWith(a, 'view_item', { value: 1 })).toBeNull();
    const b = rt({ on: false });
    expect(trackWith(b, 'view_item', { value: 1 })).toBeNull();
    expect(a.gtag).not.toHaveBeenCalled();
    expect(b.gtag).not.toHaveBeenCalled();
  });

  it('solo analítica ⇒ Google sí, Meta no; solo publicidad ⇒ al revés', () => {
    const a = rt({ consent: { analytics: true, ads: false } });
    trackWith(a, 'add_to_cart', { items: [ITEM], value: 1 });
    expect(a.gtag).toHaveBeenCalled();
    expect(a.fbq).not.toHaveBeenCalled();
    const m = rt({ consent: { analytics: false, ads: true } });
    trackWith(m, 'add_to_cart', { items: [ITEM], value: 1 });
    expect(m.gtag).not.toHaveBeenCalled();
    expect(m.fbq).toHaveBeenCalledWith('track', 'AddToCart', { value: 1, currency: 'MXN', content_ids: ['card-1'], content_type: 'product', num_items: 1 });
  });

  it('purchase: transaction_id = Order.id y el píxel con eventID p_<Order.id> (dedupe con CAPI)', () => {
    const r = rt();
    trackWith(r, 'purchase', { transaction_id: 'ord-1', items: [ITEM], value: 120.5, shipping_cents: 9900, orderNumber: 'TCG-000123' });
    const [, , params] = r.gtag.mock.calls[0];
    expect(params).toEqual({ transaction_id: 'ord-1', items: [ITEM], value: 120.5, currency: 'MXN', shipping_cents: 9900 });
    expect(r.fbq).toHaveBeenCalledWith('track', 'Purchase', expect.any(Object), { eventID: 'p_ord-1' });
  });

  it('page_view no va al píxel (no está en la lista de nombres estándar de §MKT.H.4)', () => {
    const r = rt({ pathname: '/es' });
    trackWith(r, 'page_view', { page_location: 'https://tcghunt.mx/es' });
    expect(r.fbq).not.toHaveBeenCalled();
  });

  it('first_utm_* solo con analítica y cookie th_first_utm', () => {
    const jar: CookieJar = {
      read: () => `th_first_utm=${encodeURIComponent(JSON.stringify({ source: 'ig', medium: 'bio', t: '2026-10-19T00:00:00Z' }))}`,
      write: () => undefined,
      hostname: 'tcghunt.mx',
    };
    const r = rt({ jar });
    trackWith(r, 'view_item', { value: 1 });
    expect(r.gtag.mock.calls[0][2]).toMatchObject({ first_utm_source: 'ig', first_utm_medium: 'bio' });
  });

  it('generate_lead no existe en el navegador (solo servidor)', () => {
    expect(Object.keys(EVENT_PARAMS)).not.toContain('generate_lead');
  });
});

describe('track() público', () => {
  beforeEach(() => {
    window.history.replaceState(null, '', '/es/catalog/xy1-1');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { gtag?: unknown }).gtag;
    setRuntimeConsent(null);
  });

  it('con el modo off (sin variable) no llama a nada', () => {
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    setRuntimeConsent({ analytics: true, ads: false });
    track('view_item', { value: 1 });
    expect(gtag).not.toHaveBeenCalled();
  });

  it('con on: un evento que llega antes del cargador espera y sale al vaciar (misma ruta)', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    setRuntimeConsent({ analytics: true, ads: false });
    track('view_item', { value: 1 });
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    flushPendingEvents();
    expect(gtag).toHaveBeenCalledWith('event', 'view_item', { value: 1, currency: 'MXN' });
  });

  it('con on y sin elección (null) lo que esperaba se tira', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    setRuntimeConsent({ analytics: true, ads: false });
    track('view_item', { value: 1 });
    setRuntimeConsent(null);
    const gtag = vi.fn();
    (window as unknown as { gtag: unknown }).gtag = gtag;
    flushPendingEvents();
    expect(gtag).not.toHaveBeenCalled();
  });
});

/** TL R1 (2026-10-19): gtag/fbq son código de terceros; si lanzan, la medición se lo traga. */
describe('barrera: la medición nunca lanza', () => {
  const boom = () => {
    throw new Error('tercero roto');
  };
  type W = { gtag?: unknown; fbq?: unknown; dataLayer?: unknown };
  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as W).gtag;
    delete (window as unknown as W).fbq;
    delete (window as unknown as W).dataLayer;
    setRuntimeConsent(null);
  });

  it('trackWith: gtag lanza ⇒ no sube y Meta igual recibe el evento', () => {
    const r = rt({ gtag: vi.fn(boom) as never });
    let out: ReturnType<typeof trackWith> | undefined;
    expect(() => {
      out = trackWith(r, 'purchase', { transaction_id: 'ord-1', value: 1 });
    }).not.toThrow();
    expect(r.fbq).toHaveBeenCalledWith('track', 'Purchase', expect.any(Object), { eventID: 'p_ord-1' });
    expect(out?.ga4).toBeUndefined();
    expect(out?.pixel?.name).toBe('Purchase');
  });

  it('trackWith: las dos lanzan ⇒ devuelve null, sin excepción', () => {
    const r = rt({ gtag: vi.fn(boom) as never, fbq: vi.fn(boom) as never });
    expect(trackWith(r, 'add_to_cart', { value: 1 })).toBeNull();
  });

  it('track() y flushPendingEvents() públicos con on: etiquetas que lanzan no suben', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    window.history.replaceState(null, '', '/es/catalog/xy1-1');
    setRuntimeConsent({ analytics: true, ads: true });
    track('view_item', { value: 1 }); // espera: aún no hay etiquetas
    (window as unknown as W).gtag = vi.fn(boom);
    (window as unknown as W).fbq = vi.fn(boom);
    expect(() => flushPendingEvents()).not.toThrow();
    expect(() => track('purchase', { transaction_id: 'o', value: 1 })).not.toThrow();
  });

  it('loadMeasurement: un fallo al montar Google no sube y Meta se carga igual', async () => {
    const { loadMeasurement } = await import('./loader');
    // `dataLayer` congelado ⇒ el `push` del stub de gtag lanza dentro de `loadGoogle`.
    (window as unknown as W).dataLayer = Object.freeze([]);
    expect(() => loadMeasurement({ ga4: 'G-TEST123', pixel: '123456789012345' }, { analytics: true, ads: true })).not.toThrow();
    expect(typeof (window as unknown as W).fbq).toBe('function');
    document.querySelectorAll('script[data-th-measurement]').forEach((s) => s.remove());
  });
});
