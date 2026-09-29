import { describe, expect, it } from 'vitest';
import nextConfig from '../../next.config.mjs';

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
