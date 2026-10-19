/**
 * API_CONTRACT §MKT.H.2 — el objeto `measurement` opcional de `POST /checkout/session`,
 * `POST /checkout/guest/session` y `POST /buylist/requests`, y §MKT.H.3 `banner-response`.
 *
 * Reglas del lado del navegador:
 *  - modo `off` horneado ⇒ `undefined` (ARCHITECTURE §14.1: «no se envía el objeto `measurement` en
 *    ninguna petición»);
 *  - visitante que NO respondió al banner ⇒ `undefined` (decisión de frontend, FRONTEND_NOTES §MKT2:
 *    sin elección no hay `noticeVersion` que declarar; el pedido queda `NULL` = «nada» en §14.6);
 *  - sin `measurementDisclosure` ⇒ `undefined` (no hay aviso que citar);
 *  - `gaClientId` solo con analítica; `fbp`/`fbc` solo con publicidad; `firstUtm` solo con analítica.
 * El backend vuelve a sanear campo a campo (§MKT.H.2): esto no es la barrera, es no mandar de más.
 */

import { MEASUREMENT_DISCLOSURE } from '@/content/legal/measurement-disclosure';
import { config } from '@/lib/config';
import { documentCookieJar, parseCookies, readFirstUtm, type ConsentChoice, type CookieJar } from './consent';
import { getRuntimeConsent } from './track';

export interface MeasurementInput {
  consent: { analytics: boolean; ads: boolean };
  noticeVersion: string;
  firstUtm?: { source?: string; medium?: string; campaign?: string; content?: string; landedAt?: string };
  gaClientId?: string;
  fbp?: string;
  fbc?: string;
}

const GA_CLIENT_ID_RE = /^\d{1,10}\.\d{1,10}$/;
const FBP_RE = /^fb\.\d\.\d{10,13}\.\d{1,20}$/;
const FBC_RE = /^fb\.\d\.\d{10,13}\.[A-Za-z0-9_-]{1,500}$/;

/** `_ga` = `GA1.1.<random>.<timestamp>` ⇒ `client_id` = `<random>.<timestamp>`. */
export function gaClientIdFromCookie(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parts = raw.split('.');
  if (parts.length < 4) return undefined;
  const id = `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
  return GA_CLIENT_ID_RE.test(id) ? id : undefined;
}

/** Pura (pruebas): arma el objeto a partir de la elección, el aviso y las cookies. */
export function buildMeasurementInput(
  consent: ConsentChoice | null,
  noticeVersion: string | null,
  jar: CookieJar,
): MeasurementInput | undefined {
  if (!consent || !noticeVersion) return undefined;
  const out: MeasurementInput = { consent: { analytics: consent.analytics, ads: consent.ads }, noticeVersion };
  const cookies = parseCookies(jar.read());
  if (consent.analytics) {
    const utm = readFirstUtm(jar);
    if (utm) {
      const { landedAt, ...rest } = utm;
      out.firstUtm = { ...rest, ...(landedAt ? { landedAt } : {}) };
    }
    const ga = gaClientIdFromCookie(cookies.get('_ga'));
    if (ga) out.gaClientId = ga;
  }
  if (consent.ads) {
    const fbp = cookies.get('_fbp');
    const fbc = cookies.get('_fbc');
    if (fbp && FBP_RE.test(fbp)) out.fbp = fbp;
    if (fbc && FBC_RE.test(fbc)) out.fbc = fbc;
  }
  return out;
}

/** Para las tres peticiones. Con `off` horneado devuelve `undefined` sin leer nada. */
export function measurementForRequest(): MeasurementInput | undefined {
  if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on') return undefined;
  if (typeof document === 'undefined') return undefined;
  return buildMeasurementInput(getRuntimeConsent(), MEASUREMENT_DISCLOSURE?.version ?? null, documentCookieJar());
}

export type BannerResponse = 'accept' | 'necessary_only' | 'custom' | 'no_response';

/** Medios que el servidor guarda (§MKT.H.3); cualquier otro viaja igual y allá queda `null`. */
export function bannerResponseBody(response: BannerResponse, utmMedium?: string): { response: BannerResponse; utmMedium?: string } {
  return utmMedium ? { response, utmMedium } : { response };
}

/**
 * `POST /measurement/banner-response` — best-effort: no espera, no reintenta, no avisa al visitante
 * (MKT2-UX.3). `keepalive` para que sobreviva a ocultar la pestaña (`no_response`). Sin credenciales.
 */
export function sendBannerResponse(response: BannerResponse, utmMedium?: string): void {
  if (process.env.NEXT_PUBLIC_MEASUREMENT_MODE !== 'on') return;
  // También en modo mocks: los E2E con `on` interceptan esta ruta y cuentan las llamadas (C-F13).
  if (typeof fetch === 'undefined') return;
  try {
    void fetch(`${config.apiBaseUrl.replace(/\/+$/, '')}/measurement/banner-response`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(bannerResponseBody(response, utmMedium)),
      keepalive: true,
      credentials: 'omit',
    }).catch(() => undefined);
  } catch {
    /* best-effort */
  }
}
