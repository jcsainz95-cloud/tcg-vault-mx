import { expect, test } from '@playwright/test';

/**
 * LIVE-8 · enlaces al aviso de privacidad contra el ARTEFACTO CONSTRUIDO (API_CONTRACT v1.84.1 §14.14
 * E-9; DESIGN_SYSTEM §80; riesgo F-7 de §80.6) y aviso en modo PROVISIONAL (§14.17, errata v1.84.4;
 * HECHOS 2026-10-05 sesión 6: se sale sin datos fiscales).
 *
 * El aviso real ya no tiene marcadores: se publica en cualquier entorno (también con
 * `LEGAL_DRAFT_PREVIEW` apagado = producción). La decisión se calcula en el servidor
 * (`[locale]/layout.tsx`) y la usan componentes de CLIENTE ya hidratados (F-7): la frase del registro
 * y el pie DEBEN enlazar a la vez. El caso «con marcadores ⇒ 404 y sin enlaces» se cubre con fixtures
 * en la suite unitaria (LEG-4, F-7), porque el árbol ya no tiene un aviso con marcadores que servir.
 */
test.describe('LIVE-8 · enlaces al aviso (sitios 1 y 2)', () => {
  test('registro (2a): la leyenda enlaza, igual que el pie de la portada (sitio 1)', async ({ page }) => {
    await page.goto('/es/register');
    const note = page.getByTestId('privacy-site-register');
    await expect(note).toContainText('Al crear tu cuenta aceptas los Términos');
    await expect(note).toContainText('Aviso de privacidad');
    await expect(note.locator('a[href$="/privacidad"]')).toHaveAttribute('target', '_blank');
    // El pie de la tienda (sitio 1) vive en `(storefront)`, no en `(auth)`: se mira en la portada.
    await page.goto('/es');
    await expect(page.locator('footer a[href$="/privacidad"]')).toHaveCount(1);
  });

  test('entrar (2b): la leyenda de Google, con la misma decisión', async ({ page }) => {
    await page.goto('/es/login');
    const note = page.getByTestId('privacy-site-googleSignIn');
    await expect(note).toContainText('Si entras con Google por primera vez');
    await expect(note.locator('a[href$="/privacidad"]')).toHaveCount(1);
    await expect(note.locator('a[href$="/terminos"]')).toHaveAttribute('target', '_blank');
  });
});

test.describe('LIVE-8 · §14.17 aviso provisional publicado', () => {
  test('/es/privacidad responde 200 con la frase fija, el contacto y sin corchetes ni aviso de borrador', async ({ page }) => {
    const res = await page.goto('/es/privacidad');
    expect(res?.status()).toBe(200);
    await expect(page.getByRole('heading', { level: 1, name: 'Aviso de privacidad' })).toBeVisible();
    const article = page.locator('article');
    await expect(article).toContainText(
      'Nombre o razón social, RFC y domicilio del responsable: todavía no están publicados en este aviso.',
    );
    await expect(article).toContainText('soporte@tcghunt.mx');
    await expect(page.getByText('Borrador — no publicado')).toHaveCount(0);
    await expect(page.locator('mark[data-legal-marker]')).toHaveCount(0);
    expect(await article.innerText()).not.toMatch(/[[\]]/);
    await expect(page.locator('meta[name="robots"][content*="noindex"]')).toHaveCount(0);
  });
});
