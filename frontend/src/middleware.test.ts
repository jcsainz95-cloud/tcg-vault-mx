// @vitest-environment node
/**
 * LIVE-3 · CSP-1 (API_CONTRACT §14.3): toda respuesta HTML lleva la cabecera CSP con un nonce
 * DISTINTO por petición, y el mismo nonce viaja en la petición hacia el render (Next lo lee de la
 * cabecera CSP de la petición para ponerlo en sus `<script>`; nosotros también en `x-nonce`).
 *
 * Se ejercita el middleware de verdad (con el de next-intl dentro), no una copia.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import nextConfig from '../next.config.mjs';
import { parseCsp } from './security/csp';

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

function req(path: string) {
  return new NextRequest(new URL(path, 'http://localhost:3000'));
}

/** Cabeceras de petición que Next reenvía al render (`x-middleware-request-*`). */
function forwarded(res: Response, name: string) {
  return res.headers.get(`x-middleware-request-${name}`);
}

function nonceOf(policy: string | null) {
  return policy?.match(/'nonce-([^']+)'/)?.[1] ?? null;
}

beforeEach(() => {
  vi.doUnmock('./security/csp');
});

describe('CSP-1 · fase vigente (enforce desde CL-1): la cabecera aplicada lleva el nonce', () => {
  it('sin forzar fase: Content-Security-Policy con nonce y SIN -Report-Only; el render recibe el mismo nonce', async () => {
    const mw = await load();
    const res = mw(req('/es/checkout'));
    const p = res.headers.get('content-security-policy');
    expect(p).toContain("'strict-dynamic'");
    expect(nonceOf(p)).toBeTruthy();
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
    expect(forwarded(res, 'x-nonce')).toBe(nonceOf(p));
  });
});

describe('CSP-1 · cabecera por petición (fase report-only, forzada: es la vuelta atrás de §14.3)', () => {
  it('una página lleva Content-Security-Policy-Report-Only con nonce, distinto en dos peticiones', async () => {
    const mw = await load('report-only');
    const a = mw(req('/es/catalog'));
    const b = mw(req('/es/catalog'));
    const pa = a.headers.get('content-security-policy-report-only');
    const pb = b.headers.get('content-security-policy-report-only');
    expect(pa).toContain("'strict-dynamic'");
    expect(nonceOf(pa)).toBeTruthy();
    expect(nonceOf(pb)).toBeTruthy();
    expect(nonceOf(pa)).not.toBe(nonceOf(pb));
    // En report-only el middleware NO pone la cabecera que bloquea (la de frame-ancestors sigue
    // viniendo de next.config.mjs).
    expect(a.headers.get('content-security-policy')).toBeNull();
  });

  it('el nonce de la respuesta es el que viaja hacia el render (x-nonce y la CSP de la petición)', async () => {
    const mw = await load('report-only');
    const res = mw(req('/es'));
    const n = nonceOf(res.headers.get('content-security-policy-report-only'));
    expect(n).toBeTruthy();
    expect(forwarded(res, 'x-nonce')).toBe(n);
    expect(nonceOf(forwarded(res, 'content-security-policy-report-only'))).toBe(n);
  });

  it('la redirección de la raíz (/ ⇒ /es) también la lleva', async () => {
    const mw = await load('report-only');
    const res = mw(req('/'));
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get('content-security-policy-report-only')).toContain("'nonce-");
  });
});

describe('CSP-6 · en enforce la cabecera es la que bloquea', () => {
  it('Content-Security-Policy (no -Report-Only), y el render recibe el nonce por ella', async () => {
    const mw = await load('enforce');
    const res = mw(req('/es/checkout'));
    const p = res.headers.get('content-security-policy');
    expect(nonceOf(p)).toBeTruthy();
    expect(res.headers.get('content-security-policy-report-only')).toBeNull();
    expect(forwarded(res, 'x-nonce')).toBe(nonceOf(p));
    expect(nonceOf(forwarded(res, 'content-security-policy'))).toBe(nonceOf(p));
  });
});

/**
 * v1.84.1 (§14.3, §14.14 E-6) — INVARIANTE de las dos fases: toda respuesta HTML lleva una
 * `Content-Security-Policy` APLICADA (no `-Report-Only`) con `frame-ancestors 'none'`.
 *
 * Medido con `next start` (FRONTEND_NOTES §103.1): en las rutas del `matcher` la cabecera del
 * middleware SUSTITUYE a la estática de `next.config.mjs`; fuera, queda solo la estática. Aquí se
 * compone igual: la aplicada efectiva = la del middleware si la pone, si no la estática. En
 * `report-only` el middleware no pone ninguna aplicada ⇒ la ÚNICA que garantiza el invariante es
 * la de `next.config.mjs`. La comprobación contra el servidor de verdad está en `e2e/csp.spec.ts`
 * (CSP-1 · invariante). Mutación: quitar `frame-ancestors` de `next.config.mjs` ⇒ roja.
 */
type Rule = { source: string; headers: { key: string; value: string }[] };

async function staticApplied(): Promise<string | null> {
  const rules = await (nextConfig as { headers: () => Promise<Rule[]> }).headers();
  const h = rules
    .filter((r) => r.source === '/:path*')
    .flatMap((r) => r.headers)
    .find((x) => x.key.toLowerCase() === 'content-security-policy');
  return h?.value ?? null;
}

describe("CSP-1 · invariante frame-ancestors 'none' aplicada en las dos fases (v1.84.1, E-6)", () => {
  for (const mode of ['report-only', 'enforce'] as const) {
    it(`${mode}: la CSP aplicada efectiva (middleware si la pone; si no, next.config) lleva frame-ancestors 'none'`, async () => {
      const mw = await load(mode);
      for (const path of ['/es', '/es/catalog', '/en/checkout', '/']) {
        const res = mw(req(path));
        const applied = res.headers.get('content-security-policy') ?? (await staticApplied());
        expect(applied, `${mode} ${path}`).not.toBeNull();
        expect(parseCsp(applied!)['frame-ancestors'], `${mode} ${path}`).toEqual(["'none'"]);
      }
    });
  }

  it('report-only: la del middleware NO es aplicada ⇒ la estática de next.config.mjs es la única red', async () => {
    const mw = await load('report-only');
    expect(mw(req('/es')).headers.get('content-security-policy')).toBeNull();
    expect(parseCsp((await staticApplied()) ?? '')['frame-ancestors']).toEqual(["'none'"]);
  });
});
