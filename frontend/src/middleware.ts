import createMiddleware from 'next-intl/middleware';
import type { NextRequest } from 'next/server';
import { routing } from './i18n/routing';
import { CSP_MODE, NONCE_HEADER, buildCsp, cspEnvFromProcess, cspHeaderName, generateNonce } from './security/csp';

const intlMiddleware = createMiddleware(routing);

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

  const response = intlMiddleware(request);
  response.headers.set(header, policy);
  return response;
}

export const config = {
  // Match everything except API routes, Next internals and static files.
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
};
