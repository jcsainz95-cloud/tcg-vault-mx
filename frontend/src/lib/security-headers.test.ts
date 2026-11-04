import { describe, expect, it } from 'vitest';
import nextConfig, { TOKEN_PAGE_SOURCES } from '../../next.config.mjs';
import { getPathMatch } from 'next/dist/shared/lib/router/utils/path-match';
import { TOKEN_PAGES } from './token-url';
import { isMeasuredPath } from './measurement/routes';

// SEC-HDR-1 (2026-09-29): la vitrina debe mandar anti-clickjacking en TODAS las rutas.
type Rule = { source: string; headers: { key: string; value: string }[] };
const cfg = nextConfig as { headers?: () => Promise<Rule[]> };

async function servedHeaders(): Promise<Record<string, string>> {
  const rules = await cfg.headers!();
  const all = rules.filter((r) => r.source === '/:path*');
  const out: Record<string, string> = {};
  for (const r of all) for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
  return out;
}

describe('SEC-HDR-1 cabeceras de seguridad', () => {
  it('next.config define headers() para todas las rutas', async () => {
    expect(typeof cfg.headers).toBe('function');
    expect(Object.keys(await servedHeaders()).length).toBeGreaterThan(0);
  });
  it('X-Frame-Options: DENY', async () => {
    expect((await servedHeaders())['x-frame-options']).toBe('DENY');
  });
  it("CSP solo frame-ancestors 'none' (la CSP completa es SEC-HDR-2)", async () => {
    expect((await servedHeaders())['content-security-policy']).toBe("frame-ancestors 'none'");
  });
  it('Referrer-Policy y nosniff', async () => {
    const h = await servedHeaders();
    expect(h['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(h['x-content-type-options']).toBe('nosniff');
  });
});

/**
 * CTA-F8 (API_CONTRACT §CTA.6 regla D-CTA-10 (2) y (3), §CTA.9): las tres páginas con token en la URL
 * (`/account-setup`, `/reset-password`, `/verify-email`), en ES y EN, se sirven con `Referrer-Policy: no-referrer` y sin
 * scripts de medición; el resto del sitio sigue con `strict-origin-when-cross-origin`. Las cabeceras se resuelven como
 * Next: cada regla cuyo `source` casa (con el matcher de Next) pone las suyas y, con la misma clave, gana la última.
 * Mutaciones: quitar una de las tres de la regla o de la exclusión de medición; poner `no-referrer` global.
 */
describe('CTA-F8 · páginas con token: sin Referer y sin medición', () => {
  async function headersFor(pathname: string): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    for (const r of await cfg.headers!()) {
      if (getPathMatch(r.source, { removeUnnamedParams: true })(pathname) === false) continue;
      for (const h of r.headers) out[h.key.toLowerCase()] = h.value;
    }
    return out;
  }
  const TOKEN_PATHS = TOKEN_PAGES.flatMap((p) => [`/es/${p}`, `/en/${p}`, `/${p}`]);

  it('la lista de páginas de next.config es la de lib/token-url (una sola lista)', () => {
    for (const p of TOKEN_PAGES) expect(TOKEN_PAGE_SOURCES.join(' ')).toContain(p);
    expect([...TOKEN_PAGES]).toEqual(['account-setup', 'reset-password', 'verify-email']);
  });

  it.each(TOKEN_PATHS)('%s ⇒ Referrer-Policy: no-referrer (y conserva el resto de cabeceras)', async (p) => {
    const h = await headersFor(p);
    expect(h['referrer-policy']).toBe('no-referrer');
    expect(h['x-frame-options']).toBe('DENY');
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  it.each([
    '/es',
    '/es/catalog',
    '/en/checkout',
    '/es/login',
    '/es/forgot-password',
    '/es/account',
    '/es/account-setupx',
    '/es/catalog/reset-password',
  ])('%s ⇒ sigue strict-origin-when-cross-origin', async (p) => {
    expect((await headersFor(p))['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  it.each(TOKEN_PATHS.filter((p) => /^\/(es|en)\//.test(p)))('%s ⇒ fuera de la lista blanca de medición', (p) => {
    expect(isMeasuredPath(p)).toBe(false);
    expect(isMeasuredPath(`${p}?token=abc`)).toBe(false);
  });
});
