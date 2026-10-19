import type { BrowserContext, Page, Request } from '@playwright/test';

/**
 * ARCHITECTURE §14.8 — hosts de MEDICIÓN (los que vigilan C-F1/C-F2/C-F3/C-F5). `accounts.google.com`
 * (botón de Google en login y checkout) y `www.google.com` (mapa del Card Show) NO son de medición y
 * se excluyen a propósito.
 */
const MEASUREMENT_HOST_SUFFIXES = [
  'googletagmanager.com',
  'google-analytics.com',
  'analytics.google.com',
  'doubleclick.net',
  'connect.facebook.net',
  'facebook.com',
  'facebook.net',
];
const ALLOWED_GOOGLE = new Set(['accounts.google.com', 'www.google.com']);

export type HostKind = 'google' | 'meta' | null;

export function measurementHostKind(url: string): HostKind {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  const isUnder = (suffix: string) => host === suffix || host.endsWith(`.${suffix}`);
  if (['connect.facebook.net', 'facebook.com', 'facebook.net'].some(isUnder)) return 'meta';
  if (['googletagmanager.com', 'google-analytics.com', 'analytics.google.com', 'doubleclick.net'].some(isUnder)) return 'google';
  // C-F2: «ninguna petición a *.google.com … fuera de accounts.google.com y www.google.com».
  if (isUnder('google.com') && !ALLOWED_GOOGLE.has(host)) return 'google';
  return null;
}

export const MEASUREMENT_COOKIE_RE = /^(_ga|_ga_.*|_gid|_fbp|_fbc|th_first_utm|th_consent)$/;

export interface RequestLog {
  all: string[];
  measurement: Array<{ url: string; kind: Exclude<HostKind, null> }>;
  bannerResponses: Array<{ url: string; body: unknown }>;
}

/** Registra TODA petición de la página (y de sus iframes/workers del contexto). */
export function recordRequests(target: Page | BrowserContext): RequestLog {
  const log: RequestLog = { all: [], measurement: [], bannerResponses: [] };
  target.on('request', (req: Request) => {
    const url = req.url();
    log.all.push(url);
    const kind = measurementHostKind(url);
    if (kind) log.measurement.push({ url, kind });
    if (url.includes('/measurement/banner-response')) {
      let body: unknown = null;
      try {
        body = req.postDataJSON();
      } catch {
        body = req.postData();
      }
      log.bannerResponses.push({ url, body });
    }
  });
  return log;
}

export async function measurementCookies(context: BrowserContext): Promise<string[]> {
  return (await context.cookies()).map((c) => c.name).filter((n) => MEASUREMENT_COOKIE_RE.test(n));
}

/** Grep de C-F1 sobre un artefacto de build (`.next/static` + `.next/server`). */
export const C_F1_ARTIFACT_RE = /googletagmanager\.com|google-analytics\.com|connect\.facebook\.net|fbevents|gtag\/js/;
