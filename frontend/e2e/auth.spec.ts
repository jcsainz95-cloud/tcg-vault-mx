import { test, expect } from '@playwright/test';
import { LOCALES, t } from './utils/i18n';
import { credentialsFor, IS_REAL, mockOnly, reserveLoginSlot } from './utils/auth';

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

      // IMPORTANTE-2 (QA): contra el stack real hay que teclear credenciales QUE EXISTAN
      // (seed determinista). Con un par inventado el backend responde 401 y el test medía el
      // arnés en vez del producto; con las del seed, este smoke SÍ ejerce POST /auth/login
      // de punta a punta. En mock sigue valiendo cualquier par (la rama mock no valida).
      const creds = credentialsFor('customer');
      await page.getByLabel(t(locale, 'auth.email')).fill(creds.email);
      await page.getByLabel(t(locale, 'auth.password')).fill(creds.password);
      // B-2: contra un backend real este formulario gasta cupo de `POST /auth/login`
      // (`{ttl:60_000, limit:5}` por IP). Son dos locales ⇒ dos logins; sin pedir ranura, dejan
      // el cupo a uno del límite y el siguiente caso de otro worker se queda 60 s en blanco.
      if (IS_REAL) await reserveLoginSlot(`auth.spec · login por formulario [${locale}]`);
      await page.getByRole('button', { name: t(locale, 'auth.loginCta') }).click();

      // Sesión creada (local en mock, JWT real contra el backend); redirige al home del locale.
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

  test('Google con correo NUEVO (mock): sin sesión hasta «Completa tu cuenta»; celular falso no pasa; con celular válido entra (§CELULAR-ALTA)', async ({ page }) => {
    // MOTIVO (censo e2e-skip): solo-mock. El canje del idToken de Google (correo nuevo ⇒ `pendingSignup`) lo finge la rama mock de
    // `api.ts`; un E2E no puede fabricar un idToken real. Lo real lo cubren `CelularAlta.test.tsx`, `api.test.ts` y la integración de backend.
    mockOnly('el canje del idToken de Google solo lo simula la rama mock de api.ts');
    await page.goto('/es/login');
    await page.getByRole('button', { name: t('es', 'auth.google.cta') }).click();
    await expect(page).toHaveURL(/\/es\/completa-cuenta/);
    // Sin sesión todavía y el token NO va en la URL.
    expect(await page.evaluate(() => window.localStorage.getItem('tcg.user'))).toBeNull();
    expect(page.url()).not.toContain('mock-signup-token');
    await expect(page.getByRole('heading', { name: t('es', 'auth.phoneSignup.title') })).toBeVisible();
    const create = page.getByRole('button', { name: t('es', 'auth.phoneSignup.button') });
    const field = page.getByLabel(t('es', 'auth.phoneSignup.label'));
    await field.fill('0000000000');
    await expect(create).toBeDisabled();
    await field.fill('+52 55 1234 5678');
    await expect(field).toHaveValue('5512345678');
    await expect(create).toBeEnabled();
    await create.click();
    await expect(page).toHaveURL(/\/es(\/|$)/);
    const user = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tcg.user') ?? '{}'));
    expect(user.phone).toBe('5512345678');
    expect(user.phoneRequired).toBe(false);
  });

  test('login con Google (mock, cuenta existente sin celular) deja sesión, redirige al home y la puerta del celular (§CELULAR) guarda sin navegar', async ({ page }) => {
    // El canje del idToken lo finge la rama mock de `api.ts`: contra el stack real haría falta
    // un idToken de Google de verdad (Identity Services), que un E2E no puede fabricar.
    mockOnly('el canje del idToken de Google solo lo simula la rama mock de api.ts');
    await page.addInitScript(() => window.localStorage.setItem('tcg.mock.googleExisting', '1'));
    await page.goto('/es/login');
    // Email/contraseña sigue siendo la acción primaria; Google es alternativa (§6.7).
    const googleBtn = page.getByRole('button', { name: t('es', 'auth.google.cta') });
    await expect(googleBtn).toBeVisible();
    await googleBtn.click();
    // MOCK: simula el canje del idToken y redirige al home del locale.
    await expect(page).toHaveURL(/\/es(\/|$)/);

    // Google nace sin celular (`phoneRequired:true`): la puerta B aparece SOBRE la página, sin cambiar la URL.
    const dialog = page.getByRole('dialog', { name: t('es', 'common.phoneGate.title') });
    await expect(dialog).toBeVisible();
    const url = page.url();
    await page.screenshot({ path: process.env.PHONE_GATE_SHOT_DIR ? `${process.env.PHONE_GATE_SHOT_DIR}/e2e-google-modal.png` : undefined });

    // Sin celular válido no se puede continuar; con uno (pegado con +52) se guarda y el modal desaparece.
    const save = dialog.getByRole('button', { name: t('es', 'common.phoneGate.save') });
    const field = dialog.getByLabel(t('es', 'common.phoneGate.label'));
    // La libreta mock trae un celular válido en la dirección predeterminada: llega prellenado.
    await expect(field).toHaveValue('5555123456');
    await field.fill('');
    await expect(save).toBeDisabled();
    await field.fill('+52 55 1234 5678');
    await expect(field).toHaveValue('5512345678');
    await expect(save).toBeEnabled();
    await save.click();
    await expect(dialog).toBeHidden();
    expect(page.url()).toBe(url);
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
