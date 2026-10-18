import { expect, test } from '@playwright/test';

/**
 * §13 (ruta/accesibilidad/CSP) del Card Show, contra el ARTEFACTO CONSTRUIDO (API_CONTRACT
 * §CARDSHOW.2/.14, ARCHITECTURE §4.CARDSHOW.a). Complementa a los unitarios de componente
 * (`src/app/card-show/**`).
 *
 * Se corre en modo mocks (sin backend): la landing no depende del backend para pintarse; los POST
 * de formulario sí lo necesitan y se prueban en los unitarios con la API mockeada.
 */

const UTM = 'utm_source=instagram&utm_medium=bio&utm_campaign=cardshow-dic26';

test.describe('Card Show · ruta fuera del i18n', () => {
  test('GET /card-show?utm… ⇒ 200 directo, sin 307 ni Set-Cookie NEXT_LOCALE, query intacta', async ({ request }) => {
    const res = await request.get(`/card-show?${UTM}`, { maxRedirects: 0 });
    expect(res.status()).toBe(200);
    expect(res.url()).toContain(`/card-show?${UTM}`); // sin redirect, query intacta
    const setCookie = res.headers()['set-cookie'] ?? '';
    expect(setCookie).not.toMatch(/NEXT_LOCALE/);
    const body = await res.text();
    expect(body).toContain('<link rel="canonical" href="https://tcghunt.mx/card-show"/>');
    expect(body).toMatch(/<html[^>]*lang="es-MX"/);
  });

  test('ningún redirect de locale: /es/card-show NO es el canónico', async ({ page }) => {
    await page.goto(`/card-show?${UTM}`);
    expect(new URL(page.url()).pathname).toBe('/card-show');
  });
});

test.describe('Card Show · CSP sin Turnstile (§CARDSHOW.14)', () => {
  test('la CSP de la landing no trae challenges.cloudflare.com ni origen nuevo', async ({ request }) => {
    const res = await request.get('/card-show', { maxRedirects: 0 });
    const csp = (res.headers()['content-security-policy-report-only'] ?? res.headers()['content-security-policy'] ?? '');
    expect(csp).not.toContain('challenges.cloudflare.com');
    expect(csp).not.toContain('turnstile');
  });
});

test.describe('Card Show · hero y formulario sin JS', () => {
  test.use({ javaScriptEnabled: false });

  test('con JS deshabilitado el hero y el formulario se pintan (nada de opacity:0 hasta hidratar)', async ({ page }) => {
    await page.goto('/card-show');
    await expect(page.getByRole('heading', { level: 1, name: 'Card Show' })).toBeVisible();
    // Pivote JC 2026-10-17: el CTA del formulario de asistente es «Registrarme gratis»
    // (antes «Avísame»). Existe y se ve en el HTML inicial.
    await expect(page.getByRole('button', { name: 'Registrarme gratis' }).first()).toBeVisible();
    await expect(page.getByLabel('Correo').first()).toBeVisible();
  });
});

test.describe('Card Show · honeypot oculto', () => {
  test('el señuelo no se ve, no está en el orden de foco y no lo autollena el navegador', async ({ page }) => {
    await page.goto('/card-show');
    const hp = page.locator('input[name="website"]').first();
    await expect(hp).toHaveCount(1);
    // El señuelo NO está en display:none (debe enviarse en el POST para que el bot lo llene),
    // sino FUERA de la pantalla (form-shared.tsx: `left:-9999px`, 1×1). Playwright lo considera
    // «visible» ⇒ `toBeHidden()` no aplica; medimos que su caja quede fuera del viewport.
    const box = await hp.boundingBox();
    expect(box).not.toBeNull();
    expect((box!.x + box!.width)).toBeLessThanOrEqual(0); // completamente a la izquierda del viewport
    await expect(hp).toHaveAttribute('tabindex', '-1');
    await expect(hp).toHaveAttribute('autocomplete', 'off');
    // Envuelto por un contenedor aria-hidden ⇒ el lector no lo anuncia.
    await expect(page.locator('[aria-hidden="true"] input[name="website"]').first()).toHaveCount(1);
  });
});

test.describe('Card Show · prefers-reduced-motion', () => {
  // `reducedMotion` es opción del CONTEXTO del navegador (no opción de test directa en Playwright
  // 1.56): se pasa vía `contextOptions` (BrowserContextOptions).
  test.use({ contextOptions: { reducedMotion: 'reduce' } });

  test('con reduced-motion las animaciones quedan neutralizadas (globals.css)', async ({ page }) => {
    await page.goto('/card-show');
    // La regla global pone animation/transition-duration ~0 bajo reduced-motion: se comprueba en un
    // elemento de prueba con animación para no depender de que la landing tenga una.
    const duration = await page.evaluate(() => {
      const el = document.createElement('div');
      el.className = 'animate-spin';
      document.body.appendChild(el);
      const d = getComputedStyle(el).animationDuration;
      el.remove();
      return d;
    });
    expect(['0s', '0.001ms', '1e-06s']).toContain(duration);
  });
});

// Pivote JC 2026-10-17: la landing ya NO expone el modelo de negocio (plano de mesas, enlaces
// «Mesa N» a WhatsApp). El describe «plano de mesas» se retira con el pivote; la captura de
// vendedores vive ahora en el formulario «Vendedor / Patrocinador» (sin precios ni mesas).
