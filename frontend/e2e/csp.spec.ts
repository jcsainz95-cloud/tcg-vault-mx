import { expect, test, type Page } from '@playwright/test';

/**
 * LIVE-3 · SEC-HDR-2 contra el ARTEFACTO CONSTRUIDO (API_CONTRACT §14.3).
 *
 * Complementa a `src/security/csp.test.ts` (texto de la política) y `src/middleware.test.ts`
 * (CSP-1/CSP-6 en el middleware). Aquí se pregunta al servidor y al navegador:
 *  - CSP-1: cada documento HTML trae la CSP con un nonce distinto por petición.
 *  - CSP-2: TODOS los `<script>` que emite Next llevan ese nonce (si el render fuera estático, no).
 *  - CSP-5: un `<script>` inyectado en el HTML SIN nonce viola la política (en `enforce`, además, no
 *    se ejecuta). Simula el XSS almacenado: se reescribe la respuesta HTML, no se usa `evaluate`
 *    (con `'strict-dynamic'` un script creado por código no es lo que la CSP mira).
 *  - Recorrido sin violaciones: portada, catálogo, login, registro, checkout, vender.
 *
 * CSP-3 (pago con 3DS) y CSP-4 (botón de Google) necesitan Stripe y Google reales: son el
 * recorrido §14.9 fase A en la vista previa/tienda con permiso del dueño, no este spec de mocks.
 */

type Csp = { header: string; policy: string; nonce: string; mode: 'report-only' | 'enforce' };

function cspOf(headers: Record<string, string>): Csp {
  const ro = headers['content-security-policy-report-only'];
  const enf = headers['content-security-policy'];
  const pick =
    ro && ro.includes("'nonce-")
      ? { header: 'content-security-policy-report-only', policy: ro, mode: 'report-only' as const }
      : { header: 'content-security-policy', policy: enf ?? '', mode: 'enforce' as const };
  const nonce = pick.policy.match(/'nonce-([^']+)'/)?.[1] ?? '';
  return { ...pick, nonce };
}

/** Recoge las violaciones CSP que ve la página (evento DOM + consola). */
async function watchViolations(page: Page) {
  const violations: string[] = [];
  page.on('console', (m) => {
    const t = m.text();
    if (/Content Security Policy/i.test(t)) violations.push(`console: ${t.slice(0, 300)}`);
  });
  await page.exposeFunction('__cspViolation', (v: string) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (e) => {
      // @ts-expect-error expuesto por exposeFunction
      window.__cspViolation(`${e.disposition} ${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
  return violations;
}

test.describe('LIVE-3 · CSP con nonce', () => {
  test('CSP-1 · nonce distinto por petición, y la red de frame-ancestors sigue', async ({ request }) => {
    const a = await request.get('/es');
    const b = await request.get('/es');
    expect(a.status()).toBe(200);
    const ca = cspOf(a.headers());
    const cb = cspOf(b.headers());
    expect(ca.nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(cb.nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(ca.nonce).not.toBe(cb.nonce);
    expect(ca.policy).toContain("'strict-dynamic'");
    expect(ca.policy).toContain("object-src 'none'");
    // La cabecera estática de next.config.mjs (frame-ancestors) no desaparece.
    expect(a.headers()['content-security-policy'] ?? '').toContain("frame-ancestors 'none'");
  });

  for (const path of ['/es', '/es/catalog', '/es/login', '/en/checkout']) {
    test(`CSP-2 · todos los <script> de ${path} llevan el nonce de su respuesta`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.status()).toBe(200);
      const { nonce } = cspOf(res.headers());
      expect(nonce).not.toBe('');
      const html = await res.text();
      const tags = html.match(/<script\b[^>]*>/g) ?? [];
      expect(tags.length).toBeGreaterThan(0);
      const sinNonce = tags.filter((t) => !t.includes(`nonce="${nonce}"`));
      expect(sinNonce, sinNonce.slice(0, 3).join('\n')).toEqual([]);
    });
  }

  test('CSP-5 · un <script> inyectado en el HTML sin nonce viola la política', async ({ page }) => {
    const violations = await watchViolations(page);
    const seen: { mode: Csp['mode'] } = { mode: 'report-only' };
    await page.route('**/es/login', async (route) => {
      const res = await route.fetch();
      seen.mode = cspOf(res.headers()).mode;
      const body = (await res.text()).replace('</head>', '<script>window.__pwned = 1</script></head>');
      await route.fulfill({ response: res, body });
    });
    await page.goto('/es/login');
    await expect.poll(() => violations.filter((v) => /script-src/.test(v) && /inline/.test(v)).length).toBeGreaterThan(0);
    const pwned = await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned);
    if (seen.mode === 'enforce') expect(pwned).toBeUndefined();
    else expect(violations.some((v) => v.startsWith('report script-src'))).toBe(true);
  });

  test('recorrido sin violaciones: portada, catálogo, login, registro, checkout, vender', async ({ page }) => {
    const violations = await watchViolations(page);
    for (const path of ['/es', '/es/catalog', '/es/login', '/es/register', '/es/checkout', '/es/buylist']) {
      await page.goto(path);
      await page.waitForLoadState('networkidle');
    }
    expect(violations).toEqual([]);
  });
});

test.describe('LIVE-8 · /privacidad con marcadores', () => {
  test('fuera de la vista previa responde 404 (el borrador no se publica)', async ({ request }) => {
    test.skip(process.env.LEGAL_DRAFT_PREVIEW === '1', 'el servidor se levantó con el borrador visible');
    const res = await request.get('/es/privacidad');
    expect(res.status()).toBe(404);
  });
});
