import { expect, test, type Page } from '@playwright/test';

/**
 * LIVE-3 · SEC-HDR-2 contra el ARTEFACTO CONSTRUIDO (API_CONTRACT §14.3).
 *
 * Complementa a `src/security/csp.test.ts` (texto de la política) y `src/middleware.test.ts`
 * (CSP-1/CSP-6 en el middleware). Aquí se pregunta al servidor y al navegador:
 *  - CSP-1: cada documento HTML trae la CSP con un nonce distinto por petición.
 *  - CSP-2: TODOS los `<script>` que emite Next llevan ese nonce (si el render fuera estático, no).
 *  - CSP-5 (v1.84.2 §14.15 E2-2): un `<script>` EN LÍNEA inyectado sin nonce en el HTML dispara el evento
 *    `securitypolicyviolation` (`script-src*`, `blockedURI === 'inline'`) con la `disposition` de la
 *    fase; en `enforce`, además, no se ejecuta. Mutación que la pone roja en las dos fases: añadir
 *    `script-src-elem 'unsafe-inline'`. `'unsafe-inline'` DENTRO de `script-src` NO la pone roja: con
 *    nonce, CSP3 lo ignora; esa la caza `csp.test.ts` (lista exacta de directivas y de `script-src`).
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

  /**
   * v1.84.1 (§14.3, §14.14 E-6) — invariante en las dos fases: toda respuesta HTML lleva una
   * `Content-Security-Policy` APLICADA (no `-Report-Only`) con `frame-ancestors 'none'`. En
   * `report-only` la garantiza SOLO la cabecera estática de `next.config.mjs` (el middleware pone la
   * `-Report-Only`); en `enforce` la del middleware sustituye a la estática y la lleva también.
   * Rutas: dentro del `matcher` (páginas, 404 de la app) y FUERA (`.html` excluido por el punto ⇒ el
   * 404 HTML de Next sin middleware). Mutación: quitar `frame-ancestors` de `next.config.mjs` con la
   * fase en `report-only` ⇒ roja.
   */
  for (const path of ['/es', '/es/catalog', '/es/login', '/en/checkout', '/es/no-existe-csp', '/no-existe-csp.html']) {
    test(`CSP-1 · invariante: ${path} lleva frame-ancestors 'none' en una CSP aplicada`, async ({ request }) => {
      const res = await request.get(path);
      expect(res.headers()['content-type'] ?? '', path).toContain('text/html');
      const applied = res
        .headersArray()
        .filter((h) => h.name.toLowerCase() === 'content-security-policy')
        .map((h) => h.value);
      expect(applied.length, `${path}: sin CSP aplicada`).toBeGreaterThan(0);
      // Varias CSP aplicadas se intersecan: basta con que UNA lo prohíba.
      const fa = applied.map((v) => v.match(/(?:^|;)\s*frame-ancestors\s+([^;]*)/i)?.[1]?.trim() ?? null);
      expect(fa, `${path}: ${applied.join(' || ')}`).toContain("'none'");
    });
  }

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

  /**
   * CSP-5 · v1.84.2 (§14.15 E2-2; QA M-1). El oráculo es el evento `securitypolicyviolation` del DOM,
   * NO la consola: en `report-only` el navegador no bloquea nada (el script se ejecuta siempre) y el
   * filtro de consola casaba con avisos de otros recursos (chunks).
   *  1. `addInitScript` registra el oyente antes de navegar y guarda `{effectiveDirective, blockedURI,
   *     disposition}` de cada evento.
   *  2. `antes` = eventos con `effectiveDirective` que empieza por `script-src` y `blockedURI ===
   *     'inline'` en `/es/login` TAL CUAL la sirve el servidor.
   *  3. Se carga `/es/login` con un `<script>` EN LÍNEA (con texto, ⛔ sin `src`) y sin nonce inyectado en
   *     el HTML de la respuesta, que pone `window.__csp5 = true` (el XSS almacenado).
   *  4. Se espera (con tope) `≥ antes + 1`, y algún evento nuevo trae `disposition` `report` en
   *     `report-only` o `enforce` en `enforce`.
   *  5. Solo en `enforce`: `window.__csp5` sigue sin definir.
   *
   * ⚠ Desviación MEDIDA de la letra de E2-2 paso 3 (FRONTEND_NOTES §94.6, solicitud al arquitecto): la
   * inyección es en el HTML (script del parser), no con `createElement` tras la carga. Medido en este
   * Chromium contra `next start`: un `<script>` en línea creado por código (`createElement` +
   * `textContent`, desde `evaluate` o desde un `setTimeout` de la página) **no dispara ningún evento y se
   * ejecuta en las dos fases** — `'strict-dynamic'` le pasa la confianza —, así que la prueba no podría
   * distinguir nada. El del parser sí dispara `script-src-elem inline` (report / enforce).
   * Mutación que la pone roja en LAS DOS fases: añadir `script-src-elem 'unsafe-inline'` (paso 4 no llega).
   */
  test('CSP-5 · un <script> en línea inyectado sin nonce dispara la violación (evento del DOM)', async ({ page }) => {
    type Ev = { effectiveDirective: string; blockedURI: string; disposition: string };
    await page.addInitScript(() => {
      const w = window as unknown as { __cspEvents: Ev[] };
      w.__cspEvents = [];
      document.addEventListener('securitypolicyviolation', (e) => {
        w.__cspEvents.push({ effectiveDirective: e.effectiveDirective, blockedURI: e.blockedURI, disposition: e.disposition });
      });
    });
    const inlineScriptEvents = () =>
      page.evaluate(() =>
        (window as unknown as { __cspEvents: Ev[] }).__cspEvents.filter(
          (e) => e.effectiveDirective.startsWith('script-src') && e.blockedURI === 'inline',
        ),
      );

    // 2 · antes: la página tal cual.
    await page.goto('/es/login');
    await page.waitForLoadState('networkidle');
    const antes = (await inlineScriptEvents()).length;

    // 3 · la misma página con el inline sin nonce en su HTML.
    const seen: { mode?: Csp['mode']; injected: boolean } = { injected: false };
    await page.route('**/es/login', async (route) => {
      const res = await route.fetch();
      seen.mode = cspOf(res.headers()).mode;
      const html = await res.text();
      seen.injected = html.includes('</head>');
      await route.fulfill({ response: res, body: html.replace('</head>', '<script>window.__csp5 = true;</script></head>') });
    });
    await page.goto('/es/login');
    expect(seen.injected, 'el HTML no trae </head>: no se inyectó nada').toBe(true);
    const mode = seen.mode!;

    // 4 · al menos un evento nuevo, con la disposición de la fase.
    await expect
      .poll(async () => (await inlineScriptEvents()).length, { message: `fase ${mode}: el inline sin nonce no produjo violación`, timeout: 5_000 })
      .toBeGreaterThanOrEqual(antes + 1);
    const eventos = await inlineScriptEvents();
    expect(eventos.map((e) => e.disposition)).toContain(mode === 'enforce' ? 'enforce' : 'report');

    // 5 · en enforce, además, no se ejecutó.
    const ran = await page.evaluate(() => (window as unknown as { __csp5?: boolean }).__csp5);
    if (mode === 'enforce') expect(ran).toBeUndefined();
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
