import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushPendingEvents, setRuntimeConsent, track, trackWith, type TrackRuntime } from './track';
import type { CookieJar } from './consent';

/**
 * SEC-MED-1 (ARCHITECTURE §14.4 D-MKT2-11; API_CONTRACT §MKT.H.4 v1.112.2) — la URL que sale hacia Google y
 * Meta. GA4: `page_location`/`page_referrer` saneados en `config` y en CADA `gtag('event')`. Píxel: solo en un
 * documento cuya URL (y referente de nuestro origen) pasa `isPixelSafeUrl`, mirado en cada llamada a `fbq`.
 * La mitad de navegador (C-F3 con `?q=`) es `e2e/measurement-on.spec.ts` «C-F3 · ?q=».
 */

const emptyJar: CookieJar = { read: () => '', write: () => undefined, hostname: 'tcghunt.mx' };
const ITEM = { item_id: 'c_xy1-1', item_name: 'Pikachu', item_category: 'card', price: 10 };

function rt(over: Partial<TrackRuntime> = {}) {
  const gtag = vi.fn();
  const fbq = vi.fn();
  const r: TrackRuntime = {
    on: true,
    pathname: '/es/catalog',
    href: 'https://tcghunt.mx/es/catalog?q=pikachu&utm_source=ig#x',
    referrer: '',
    consent: { analytics: true, ads: true },
    gtag,
    fbq,
    jar: emptyJar,
    ...over,
  };
  return { r, gtag, fbq };
}

describe('SEC-MED-1 · trackWith', () => {
  it('todo gtag(event) lleva page_location saneado (sin q) aunque el llamador no lo pase', () => {
    const { r, gtag } = rt();
    for (const ev of ['view_item', 'add_to_cart', 'search', 'click_contact'] as const) {
      trackWith(r, ev, { items: [ITEM], value: 10, results_count: 3, contact_channel: 'whatsapp', page_location: 'https://tcghunt.mx/x?q=pikachu' });
    }
    expect(gtag).toHaveBeenCalledTimes(4);
    for (const [, , params] of gtag.mock.calls) {
      expect(params.page_location).toBe('https://tcghunt.mx/es/catalog?utm_source=ig');
    }
    expect(JSON.stringify(gtag.mock.calls)).not.toContain('pikachu');
  });

  it('page_referrer: el del último page_view si lo hay; si no, document.referrer; siempre saneado', () => {
    const a = rt({ referrer: 'https://www.google.com/search?q=pikachu' });
    trackWith(a.r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(a.gtag.mock.calls[0][2].page_referrer).toBe('https://www.google.com/search');
    const b = rt({ referrer: 'https://www.google.com/search?q=pikachu', lastPageReferrer: 'https://tcghunt.mx/es?utm_source=ig&q=x' });
    trackWith(b.r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(b.gtag.mock.calls[0][2].page_referrer).toBe('https://tcghunt.mx/es?utm_source=ig');
  });

  it('URL con q ⇒ el evento va a GA4 y NO a fbq', () => {
    const { r, gtag, fbq } = rt({ href: 'https://tcghunt.mx/es/catalog?q=pikachu' });
    const out = trackWith(r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(gtag).toHaveBeenCalledTimes(1);
    expect(fbq).not.toHaveBeenCalled();
    expect(out?.pixel).toBeUndefined();
  });

  it('URL limpia ⇒ fbq sí; con referente de nuestro origen con q ⇒ no; de otro origen con q ⇒ sí', () => {
    const clean = 'https://tcghunt.mx/es/catalog/xy1-1?utm_source=ig&fbclid=AbC';
    const a = rt({ href: clean });
    trackWith(a.r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(a.fbq).toHaveBeenCalledTimes(1);
    const b = rt({ href: clean, referrer: 'https://tcghunt.mx/es/catalog?q=pikachu' });
    trackWith(b.r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(b.fbq).not.toHaveBeenCalled();
    const c = rt({ href: clean, referrer: 'https://www.google.com/search?q=pikachu' });
    trackWith(c.r, 'add_to_cart', { items: [ITEM], value: 10 });
    expect(c.fbq).toHaveBeenCalledTimes(1);
  });
});

type W = { gtag?: unknown; fbq?: unknown; dataLayer?: unknown[]; _fbq?: unknown };

function setReferrer(v: string) {
  Object.defineProperty(document, 'referrer', { configurable: true, get: () => v });
}

describe('SEC-MED-1 · track() público y loadMeasurement en el documento', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    const w = window as unknown as W;
    delete w.gtag;
    delete w.fbq;
    delete w._fbq;
    delete w.dataLayer;
    document.querySelectorAll('script[data-th-measurement]').forEach((s) => s.remove());
    setReferrer('');
    setRuntimeConsent(null);
  });

  it('el siguiente evento usa el page_referrer del último page_view', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    window.history.replaceState(null, '', '/es/catalog/xy1-1');
    setRuntimeConsent({ analytics: true, ads: false });
    const gtag = vi.fn();
    (window as unknown as W).gtag = gtag;
    track('page_view', { page_location: window.location.href, page_referrer: `${window.location.origin}/es?utm_source=ig&q=x` });
    setReferrer('https://otro.example/x?q=pikachu');
    track('view_item', { value: 1 });
    expect(gtag.mock.calls[1][2].page_referrer).toBe(`${window.location.origin}/es?utm_source=ig`);
    flushPendingEvents();
  });

  it('el píxel se mira en CADA llamada: q añadido después de cargar ⇒ ese evento solo a GA4', () => {
    vi.stubEnv('NEXT_PUBLIC_MEASUREMENT_MODE', 'on');
    window.history.replaceState(null, '', '/es/catalog/xy1-1');
    setRuntimeConsent({ analytics: true, ads: true });
    const gtag = vi.fn();
    const fbq = vi.fn();
    Object.assign(window as unknown as W, { gtag, fbq });
    track('add_to_cart', { items: [ITEM], value: 10 });
    expect(fbq).toHaveBeenCalledTimes(1);
    window.history.replaceState(null, '', '/es/catalog/xy1-1?q=pikachu');
    track('add_to_cart', { items: [ITEM], value: 10 });
    expect(fbq).toHaveBeenCalledTimes(1);
    expect(gtag).toHaveBeenCalledTimes(2);
    expect(gtag.mock.calls[1][2].page_location).toBe(`${window.location.origin}/es/catalog/xy1-1`);
  });

  it('loadMeasurement con ?q= en la URL: gtag con config saneado; Meta ni stub, ni init, ni <script>', async () => {
    const { loadMeasurement } = await import('./loader');
    window.history.replaceState(null, '', '/es/catalog?q=pikachu&utm_source=ig');
    setReferrer('https://www.google.com/search?q=pikachu');
    loadMeasurement({ ga4: 'G-TEST123', pixel: '123456789012345' }, { analytics: true, ads: true });
    const w = window as unknown as W;
    expect(typeof w.gtag).toBe('function');
    expect(w.fbq).toBeUndefined();
    expect(document.querySelector('script[data-th-measurement="meta"]')).toBeNull();
    const config = (w.dataLayer as ArrayLike<unknown>[]).map((a) => Array.from(a)).find((a) => a[0] === 'config');
    expect(config?.[2]).toMatchObject({
      page_location: `${window.location.origin}/es/catalog?utm_source=ig`,
      page_referrer: 'https://www.google.com/search',
      send_page_view: false,
    });
    expect(JSON.stringify((w.dataLayer as ArrayLike<unknown>[]).map((a) => Array.from(a)))).not.toContain('pikachu');
  });

  it('loadMeasurement con URL limpia pero referente de nuestro origen con q ⇒ sin Meta; limpio del todo ⇒ Meta', async () => {
    const { loadMeasurement } = await import('./loader');
    window.history.replaceState(null, '', '/es/catalog/xy1-1');
    setReferrer(`${window.location.origin}/es/catalog?q=pikachu`);
    loadMeasurement({ ga4: null, pixel: '123456789012345' }, { analytics: false, ads: true });
    expect((window as unknown as W).fbq).toBeUndefined();
    setReferrer('');
    loadMeasurement({ ga4: null, pixel: '123456789012345' }, { analytics: false, ads: true });
    expect(typeof (window as unknown as W).fbq).toBe('function');
    expect(document.querySelector('script[data-th-measurement="meta"]')).not.toBeNull();
  });
});
