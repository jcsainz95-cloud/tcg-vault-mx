import createMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { CSP_MODE, NONCE_HEADER, buildCsp, cspEnvFromProcess, cspHeaderName, generateNonce } from './security/csp';

const intlMiddleware = createMiddleware(routing);

/**
 * §CARDSHOW.2 / ARCHITECTURE §4.CARDSHOW.a — `/card-show` es canónica FUERA del i18n: la ruta
 * existe sin prefijo de idioma y NO se redirige a `/es` (un salto de redirección menos = link
 * limpio para flyers/QR). Entra al matcher SOLO para que se le aplique la CSP con nonce; se
 * cortocircuita antes del redirect de locale de next-intl. Los endpoints `/api/v1/card-show/*` ya
 * están fuera del matcher (`api` excluido) y se llaman directo, sin `/es`.
 */
function isCardShowPath(pathname: string): boolean {
  return pathname === '/card-show' || pathname.startsWith('/card-show/');
}

/**
 * i18n (next-intl) + LIVE-3 · CSP con nonce por petición (API_CONTRACT §14.3).
 *
 * El nonce viaja en DOS sentidos:
 *  - hacia el render, en las cabeceras de la PETICIÓN: Next lo saca de la CSP de la petición
 *    (`content-security-policy` o `-report-only`, `app-render.js`) y lo pone en todos sus
 *    `<script>`; `x-nonce` lo deja a mano para el layout. next-intl copia `request.headers` al
 *    `NextResponse.next/rewrite({ request: { headers } })`, así que basta con fijarlas antes.
 *  - hacia el navegador, en la cabecera de la RESPUESTA (`cspHeaderName(CSP_MODE)`).
 *
 * La cabecera estática `frame-ancestors 'none'` de `next.config.mjs` se queda como red para lo que
 * no pasa por aquí (`matcher` excluye `_next`, `api` y ficheros).
 */
export default function middleware(request: NextRequest) {
  const nonce = generateNonce();
  const policy = buildCsp(nonce, cspEnvFromProcess());
  const header = cspHeaderName(CSP_MODE);

  request.headers.set(NONCE_HEADER, nonce);
  request.headers.set(header, policy);

  // §CARDSHOW.2: `/card-show` se sirve con la CSP pero SIN el redirect de locale (200 directo, sin
  // `Set-Cookie: NEXT_LOCALE`, query intacta). Se copia la petición (con el nonce ya fijado) para
  // que el render lea el nonce igual que en el resto del sitio.
  if (isCardShowPath(request.nextUrl.pathname)) {
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.headers.set(header, policy);
    return response;
  }

  const response = intlMiddleware(request);
  response.headers.set(header, policy);
  return response;
}

export const config = {
  // Match everything except API routes, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
