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

describe('CSP-1 · cabecera por petición (fase vigente: report-only)', () => {
  it('una página lleva Content-Security-Policy-Report-Only con nonce, distinto en dos peticiones', async () => {
    const mw = await load();
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
    const mw = await load();
    const res = mw(req('/es'));
    const n = nonceOf(res.headers.get('content-security-policy-report-only'));
    expect(n).toBeTruthy();
    expect(forwarded(res, 'x-nonce')).toBe(n);
    expect(nonceOf(forwarded(res, 'content-security-policy-report-only'))).toBe(n);
  });

  it('la redirección de la raíz (/ ⇒ /es) también la lleva', async () => {
    const mw = await load();
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
