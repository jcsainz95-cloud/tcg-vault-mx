import { expect, test } from '@playwright/test';

/**
 * LIVE-8 · enlaces al aviso de privacidad contra el ARTEFACTO CONSTRUIDO (API_CONTRACT v1.84.1 §14.14
 * E-9; DESIGN_SYSTEM §80; riesgo F-7 de §80.6).
 *
 * F-7 solo se ve de punta a punta: la decisión se calcula en el servidor (`[locale]/layout.tsx`, con
 * las variables de entorno del servidor) y la usan componentes de CLIENTE ya hidratados. Con el
 * borrador visible (`LEGAL_DRAFT_PREVIEW=1`, el análogo local de la vista previa) la frase del
 * registro y el pie DEBEN enlazar a la vez; sin él (= producción con marcadores), ninguno.
 */
const draft = process.env.LEGAL_DRAFT_PREVIEW === '1';

test.describe('LIVE-8 · enlaces al aviso (sitios 1 y 2)', () => {
  test('registro (2a): la leyenda enlaza si y solo si la página se sirve, igual que el pie de la portada (sitio 1)', async ({ page }) => {
    await page.goto('/es/register');
    const note = page.getByTestId('privacy-site-register');
    await expect(note).toContainText('Al crear tu cuenta aceptas los Términos');
    await expect(note).toContainText('Aviso de privacidad');
    const noteLink = note.locator('a[href$="/privacidad"]');
    if (draft) await expect(noteLink).toHaveAttribute('target', '_blank');
    else await expect(noteLink).toHaveCount(0);
    // El pie de la tienda (sitio 1) vive en `(storefront)`, no en `(auth)`: se mira en la portada.
    await page.goto('/es');
    await expect(page.locator('footer a[href$="/privacidad"]')).toHaveCount(draft ? 1 : 0);
    const res = await page.request.get('/es/privacidad');
    expect(res.status()).toBe(draft ? 200 : 404);
  });

  test('entrar (2b): la leyenda de Google, con la misma decisión', async ({ page }) => {
    await page.goto('/es/login');
    const note = page.getByTestId('privacy-site-googleSignIn');
    await expect(note).toContainText('Si entras con Google por primera vez');
    await expect(note.locator('a[href$="/privacidad"]')).toHaveCount(draft ? 1 : 0);
    await expect(note.locator('a[href$="/terminos"]')).toHaveAttribute('target', '_blank');
  });
});
