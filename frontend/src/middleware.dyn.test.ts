// @vitest-environment node
/**
 * DYN-F7 / D-DYN-1 (API_CONTRACT §DYN.6.4, §DYN.8) — el nonce tiene que llegar a TODO `<script>` en línea.
 *
 * Causa medida (frontend, 2026-10-29, `next start` local sobre `b4213dff`): Next saca el nonce de la cabecera de
 * PETICIÓN `content-security-policy` y, SOLO si no existe, de `content-security-policy-report-only`
 * (`next/dist/server/app-render/app-render.js:108`, `getScriptNonceFromHeader`). En fase `report-only` el middleware solo
 * fijaba la segunda; si la petición llega ya con una `content-security-policy` sin `script-src` (la estática de
 * `next.config.mjs` es `frame-ancestors 'none'`), Next elige ESA, no encuentra nonce y emite los scripts sin él.
 * Reproducido: `curl -H "content-security-policy: frame-ancestors 'none'" /es` ⇒ 16/16 scripts en línea SIN nonce
 * (sin la cabecera: 16/16 con nonce). Es la firma de producción: `data-csp="nonce"` presente (el `x-nonce` llega) y
 * 28/28 scripts sin nonce. Por qué la petición trae esa cabecera en Vercel: NO MEDIDO (no hay vista previa de ramas).
 *
 * Arreglo: el middleware fija SIEMPRE la cabecera de petición `content-security-policy` con la política del nonce
 * (pisa la que traiga), en las dos fases. Es cabecera de PETICIÓN: no cambia la fase que ve el navegador (la respuesta
 * sigue en `-Report-Only` mientras CL-1 no cambie).
 *
 * Mutación que lo pone rojo: quitar esa línea del middleware (en `report-only`).
 */
import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { getScriptNonceFromHeader } from 'next/dist/server/app-render/get-script-nonce-from-header';

async function load(mode?: 'report-only' | 'enforce') {
  vi.resetModules();
  if (mode) {
    vi.doMock('./security/csp', async (orig) => ({
      ...(await orig<typeof import('./security/csp')>()),
      CSP_MODE: mode,
    }));
  } else {
    vi.doUnmock('./security/csp');
  }
  return (await import('./middleware')).default;
}

function req(path: string, headers: Record<string, string> = {}) {
  return new NextRequest(new URL(path, 'http://localhost:3000'), { headers });
}

const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);
const nonceOf = (policy: string | null) => policy?.match(/'nonce-([^']+)'/)?.[1] ?? null;

/** Lo que hace Next con las cabeceras que le llegan al render (`app-render.js:108`). */
function nonceNextWouldUse(res: Response): string | undefined {
  const csp = forwarded(res, 'content-security-policy') || forwarded(res, 'content-security-policy-report-only');
  return typeof csp === 'string' ? getScriptNonceFromHeader(csp) : undefined;
}

const INCOMING = [
  ['sin CSP en la petición', {}],
  ["con la estática `frame-ancestors 'none'` en la petición", { 'content-security-policy': "frame-ancestors 'none'" }],
  ['con un nonce ajeno en la petición', { 'content-security-policy': "script-src 'nonce-AAAAAAAAAAAAAAAAAAAAAA=='" }],
] as const;

describe.each(['report-only', 'enforce', undefined] as const)('DYN-F7 · el nonce que usa Next es el de la respuesta (fase %s)', (mode) => {
  for (const [label, headers] of INCOMING) {
    it(label, async () => {
      const mw = await load(mode);
      // `/` es la redirección a `/es`: no renderiza, así que no reenvía cabeceras al render.
      for (const path of ['/es', '/en', '/es/catalog', '/es/checkout']) {
        const res = mw(req(path, headers));
        const header = res.headers.get('content-security-policy-report-only') ?? res.headers.get('content-security-policy');
        const n = nonceOf(header);
        expect(n, path).toBeTruthy();
        expect(nonceNextWouldUse(res), `${path} · ${label}`).toBe(n);
        expect(forwarded(res, 'x-nonce'), path).toBe(n);
      }
    });
  }

  it('la fase que ve el navegador NO cambia (CL-1): en report-only la respuesta no lleva CSP aplicada del middleware', async () => {
    const mw = await load(mode);
    const res = mw(req('/es', { 'content-security-policy': "frame-ancestors 'none'" }));
    const { CSP_MODE } = await import('./security/csp');
    if ((mode ?? CSP_MODE) === 'report-only') {
      expect(res.headers.get('content-security-policy')).toBeNull();
      expect(res.headers.get('content-security-policy-report-only')).toContain("'nonce-");
    } else {
      expect(res.headers.get('content-security-policy')).toContain("'nonce-");
    }
  });
});
