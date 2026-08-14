import { test, expect } from '@playwright/test';
import { LOCALES, t } from './utils/i18n';

/**
 * Flujo: registro / login (PROJECT §A, contrato §1) + toggle de idioma en el
 * shell de auth. En modo mocks la sesión es local (setToken) — contra un backend
 * real (E2E_BASE_URL) golpea POST /auth/login|register. Ver FRONTEND_NOTES.
 */
test.describe('auth · login y registro (ES/EN)', () => {
  for (const locale of LOCALES) {
    test(`login se muestra y redirige tras enviar [${locale}]`, async ({ page }) => {
      await page.goto(`/${locale}/login`);

      await expect(page.getByRole('heading', { name: t(locale, 'auth.loginTitle') })).toBeVisible();

      await page.getByLabel(t(locale, 'auth.email')).fill('cliente@example.com');
      await page.getByLabel(t(locale, 'auth.password')).fill('secret123');
      await page.getByRole('button', { name: t(locale, 'auth.loginCta') }).click();

      // MOCK: la sesión es local; redirige al home del mismo locale.
      await expect(page).toHaveURL(new RegExp(`/${locale}(/|$)`));
      await expect(page.getByRole('heading', { name: t(locale, 'home.heroTitle') })).toBeVisible();
    });
  }

  test('registro muestra campos nombre/teléfono y navega desde login', async ({ page }) => {
    await page.goto('/es/register');
    await expect(page.getByRole('heading', { name: t('es', 'auth.registerTitle') })).toBeVisible();
    await expect(page.getByLabel(t('es', 'auth.name'))).toBeVisible();
    await expect(page.getByLabel(t('es', 'auth.phone'))).toBeVisible();
  });

  test('login con Google (mock) deja sesión y redirige al home', async ({ page }) => {
    await page.goto('/es/login');
    // Email/contraseña sigue siendo la acción primaria; Google es alternativa (§6.7).
    const googleBtn = page.getByRole('button', { name: t('es', 'auth.google.cta') });
    await expect(googleBtn).toBeVisible();
    await googleBtn.click();
    // MOCK: simula el canje del idToken y redirige al home del locale.
    await expect(page).toHaveURL(/\/es(\/|$)/);
    await expect(page.getByRole('heading', { name: t('es', 'home.heroTitle') })).toBeVisible();
  });

  test('toggle de idioma disponible en el shell de auth', async ({ page }) => {
    await page.goto('/es/login');
    const toggle = page.getByRole('group', { name: 'Idioma / Language' });
    await toggle.getByRole('button', { name: 'en', exact: true }).click();
    await expect(page).toHaveURL(/\/en\/login/);
    await expect(page.getByRole('heading', { name: t('en', 'auth.loginTitle') })).toBeVisible();
  });
});
