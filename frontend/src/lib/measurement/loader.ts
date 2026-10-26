/**
 * ARCHITECTURE §14.2/§14.3/§14.7 — el CARGADOR de las etiquetas, sin GTM, desde código del repo.
 *
 * ⛔ Este módulo es el ÚNICO del frontend que conoce las URL de las etiquetas. Solo se importa con
 * `import()` dentro de `if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE === 'on')`: con el modo `off`
 * el compilador no recorre esa rama y este fichero no llega al artefacto (candado C-F1, grep sobre
 * `.next/static` y `.next/server`).
 *
 * Consent Mode v2 BÁSICO: no se descarga nada antes de la elección. Al cargar Google se fija primero
 * `consent default` con los cuatro `denied` y luego `update` solo de `analytics_storage`
 * (`ad_storage`, `ad_user_data` y `ad_personalization` quedan `denied` para Google SIEMPRE).
 */

import type { MeasurementIds } from './mode';
import type { ConsentChoice } from './consent';
import { neverThrow } from './track';
import { isPixelSafeDocument, sanitizeMeasurementUrl } from './utm';

const GTAG_SRC = 'https://www.googletagmanager.com/gtag/js';
const FBEVENTS_SRC = 'https://connect.facebook.net/en_US/fbevents.js';

type AnyFn = (...args: unknown[]) => void;
interface MeasurementWindow {
  dataLayer?: unknown[];
  gtag?: AnyFn;
  fbq?: AnyFn & { queue?: unknown[]; loaded?: boolean; version?: string; push?: AnyFn; callMethod?: AnyFn; disablePushState?: boolean };
  _fbq?: unknown;
}

function inject(src: string, marker: string): void {
  if (document.querySelector(`script[data-th-measurement="${marker}"]`)) return;
  const s = document.createElement('script');
  s.async = true;
  s.src = src;
  s.dataset.thMeasurement = marker;
  document.head.appendChild(s);
}

function loadGoogle(w: MeasurementWindow, id: string): void {
  if (w.gtag) return;
  w.dataLayer = w.dataLayer || [];
  // Forma documentada de gtag: empuja el objeto `arguments`, no un array.
  w.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    (w.dataLayer as unknown[]).push(arguments);
  };
  w.gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
  });
  w.gtag('consent', 'update', { analytics_storage: 'granted' });
  w.gtag('js', new Date());
  // D-MKT2-11 (SEC-MED-1): sin `page_location` gtag manda la URL del documento (con `?q=`…) ⇒ saneadas aquí,
  // y `track()` las vuelve a poner en cada evento.
  const config: Record<string, unknown> = {
    send_page_view: false,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  };
  const pageLocation = sanitizeMeasurementUrl(window.location.href, 'ga4');
  const pageReferrer = sanitizeMeasurementUrl(document.referrer, 'ga4');
  if (pageLocation) config.page_location = pageLocation;
  if (pageReferrer) config.page_referrer = pageReferrer;
  w.gtag('config', id, config);
  inject(`${GTAG_SRC}?id=${encodeURIComponent(id)}`, 'ga4');
}

function loadMeta(w: MeasurementWindow, pixelId: string): void {
  if (w.fbq) return;
  // D-MKT2-11 (SEC-MED-1): `fbevents.js` lee `location.href` y `document.referrer` por su cuenta y no deja
  // reescribirlos ⇒ en un documento cuya URL (o referente de nuestro origen) lleva algo fuera de la lista
  // del píxel, ni stub, ni `init`, ni `<script>`. El proveedor reintenta en la siguiente ruta medida.
  if (!isPixelSafeDocument(window.location.href, document.referrer)) return;
  // Equivalente del fragmento estándar de Meta, sin `<script>` en línea (CSP con nonce).
  type Fbq = NonNullable<MeasurementWindow['fbq']>;
  const fbq: Fbq = function fbqStub(...args: unknown[]) {
    if (fbq.callMethod) fbq.callMethod(...args);
    else fbq.queue!.push(args);
  } as Fbq;
  fbq.push = fbq;
  fbq.loaded = true;
  fbq.version = '2.0';
  fbq.queue = [];
  w.fbq = fbq;
  if (!w._fbq) w._fbq = fbq;
  // §MKT.H.4: sin historial automático, sin configuración automática (ANTES de `init`), `init` sin
  // segundo argumento (sin coincidencia avanzada manual).
  fbq.disablePushState = true;
  fbq('set', 'autoConfig', false, pixelId);
  fbq('init', pixelId);
  inject(FBEVENTS_SRC, 'meta');
}

/**
 * Carga lo que la elección permite y el ID hace posible. Idempotente. Nunca lanza (barrera R1): un
 * fallo de una etiqueta no tumba la otra ni sube al proveedor.
 */
export function loadMeasurement(ids: MeasurementIds, consent: ConsentChoice): void {
  if (typeof window === 'undefined') return;
  const w = window as unknown as MeasurementWindow;
  if (consent.analytics && ids.ga4) neverThrow(undefined, () => loadGoogle(w, ids.ga4!));
  if (consent.ads && ids.pixel) neverThrow(undefined, () => loadMeta(w, ids.pixel!));
}
