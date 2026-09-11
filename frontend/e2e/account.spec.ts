import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * Stream A · «Mi cuenta», contraseña y contraseña temporal BLOQUEANTE (contrato v1.67;
 * DESIGN_SYSTEM §33.5–§33.8; ARCHITECTURE §4.47.7). Flujos F11 del encargo:
 *   1. login con temporal → página de contraseña del rol → cambio → aterrizaje por rol / `?next=`
 *   2. el perfil edita el nombre (y el aviso de nombre derivado desaparece al guardar)
 *   3. cuenta solo-Google: la página de contraseña NO tiene campos («Enviarme el enlace»)
 *   4. navegación §33.1/§33.2 y móvil 390 px sin desborde horizontal
 *
 * ⚠ TODO corre contra la rama MOCK de `lib/api.ts` (cuentas `temporal@example.com` /
 * `operador.temporal@example.com`, `changePassword` simulado): el backend de `change-password`
 * se construye en paralelo. Los casos se marcan `mockOnly` con su motivo; contra el stack real
 * hará falta que el seed siembre un usuario con `mustChangePassword=true` (petición a backend).
 */

async function expectNoHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(overflow.scrollWidth, 'sin desborde horizontal').toBeLessThanOrEqual(overflow.clientWidth);
}

async function loginWith(page: Page, email: string, password: string) {
  await page.goto('/es/login');
  await page.getByLabel(t('es', 'auth.email')).fill(email);
  await page.getByLabel(t('es', 'auth.password')).fill(password);
  await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();
}

async function changeTemporaryPassword(page: Page, current: string, next: string) {
  await page.getByLabel(t('es', 'auth.changePassword.temporaryLabel')).fill(current);
  await page.getByLabel(t('es', 'account.password.new'), { exact: true }).fill(next);
  await page.getByLabel(t('es', 'account.password.confirm'), { exact: true }).fill(next);
  await page.getByRole('button', { name: t('es', 'auth.changePassword.submit') }).click();
}

test.describe('cuenta · contraseña temporal bloqueante (§33.8)', () => {
  test('cliente con temporal: login → /account/password (sin «Continuar») → cambio → «Listo» → tienda', async ({ page }) => {
    mockOnly('la cuenta con temporal la sirve la rama mock de login(); el seed real no siembra una');
    await loginWith(page, 'temporal@example.com', 'cualquiera');

    await expect(page).toHaveURL(/\/es\/account\/password$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'auth.changePassword.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'auth.changePassword.body'))).toBeVisible();
    await expect(page.getByRole('button', { name: 'Continuar', exact: true })).toHaveCount(0);
    // Sin «← Mi cuenta» en la PÁGINA (rebotaría). El header del rol sí se ve (§33.8): su «Mi cuenta» no cuenta.
    await expect(page.locator('main').getByRole('link', { name: /Mi cuenta/ })).toHaveCount(0);
    // Única otra salida: cerrar sesión.
    await expect(page.getByRole('button', { name: t('es', 'nav.logout') })).toBeVisible();

    // Temporal por temporal no es cambiarla (422 PASSWORD_SAME_AS_CURRENT del mock).
    await changeTemporaryPassword(page, 'cualquiera', 'cualquiera');
    await expect(page.getByLabel(t('es', 'account.password.new'), { exact: true })).toHaveAttribute('aria-invalid', 'true');

    await changeTemporaryPassword(page, 'cualquiera', 'definitiva-2026');
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.successTitle'));
    const done = page.getByRole('button', { name: t('es', 'auth.changePassword.done') });
    await expect(done).toBeFocused();
    await done.click();
    // Sin `next`, «Listo» aterriza en la cuenta del rol.
    await expect(page).toHaveURL(/\/es\/account$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    // La bandera quedó en false: navegar a la tienda ya no rebota.
    await page.goto('/es/vault');
    await expect(page).toHaveURL(/\/es\/vault$/);
  });

  test('operador con temporal y marcador de /admin/m4: rebote con banner y next → cambio → «Listo» → M4', async ({ page }) => {
    mockOnly('la cuenta de operador con temporal la sirve la rama mock de login()');
    await loginWith(page, 'operador.temporal@example.com', 'temporal-op');
    await expect(page).toHaveURL(/\/es\/admin\/account\/password$/);

    // Paso 3 de §33.8: cualquier módulo rebota a la página de contraseña con next + reason.
    await page.goto('/es/admin/m4');
    await expect(page).toHaveURL(/\/es\/admin\/account\/password\?next=%2Fadmin%2Fm4&reason=required$/);
    // `getByRole('alert')` también resuelve el route announcer de Next (vacío): se filtra por texto.
    await expect(page.getByRole('alert').filter({ hasText: t('es', 'auth.changePassword.requiredNotice') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'auth.changePassword.title') })).toBeVisible();

    await changeTemporaryPassword(page, 'temporal-op', 'definitiva-2026');
    await page.getByRole('button', { name: t('es', 'auth.changePassword.done') }).click();
    await expect(page).toHaveURL(/\/es\/admin\/m4$/);
  });

  test('con la bandera activa, la tienda pública también rebota (paso 3) y «Cerrar sesión» sale a /login', async ({ page }) => {
    mockOnly('bandera inyectada en la sesión local (rama mock)');
    await loginAs(page, 'customer');
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('tcg.user');
      if (raw) window.localStorage.setItem('tcg.user', JSON.stringify({ ...JSON.parse(raw), mustChangePassword: true, hasPassword: true }));
    });
    await page.goto('/es/catalog');
    await expect(page).toHaveURL(/\/es\/account\/password\?next=%2Fcatalog&reason=required$/);
    await page.getByRole('button', { name: t('es', 'nav.logout') }).click();
    await expect(page).toHaveURL(/\/es\/login$/);
  });
});

test.describe('cuenta · perfil y contraseña (§33.6, §33.7)', () => {
  test('el perfil edita el nombre: con nombre derivado el aviso existe y desaparece al guardar', async ({ page }) => {
    mockOnly('nameSource=derived inyectado en la sesión local; PATCH /users/me simulado');
    await loginAs(page, 'customer');
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('tcg.user');
      if (raw) {
        window.localStorage.setItem(
          'tcg.user',
          JSON.stringify({ ...JSON.parse(raw), name: 'jcsainz95', authProvider: 'google', nameSource: 'derived', hasPassword: true }),
        );
      }
    });
    await page.goto('/es/account');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    const note = page.getByTestId('name-derived-note');
    await expect(note).toHaveText(t('es', 'account.profile.name.derivedFromEmail'));
    const name = page.getByLabel(t('es', 'account.profile.name.label'));
    await expect(name).toHaveValue('jcsainz95');
    await name.fill('Juan Carlos Sainz');
    await page.getByRole('button', { name: t('es', 'account.save') }).first().click();
    await expect(page.getByRole('status').filter({ hasText: t('es', 'account.saved') })).toBeVisible();
    await expect(note).toHaveCount(0);
    // Persistió en la sesión local (el mock espeja el 200 del contrato).
    const stored = await page.evaluate(() => JSON.parse(window.localStorage.getItem('tcg.user') ?? '{}'));
    expect(stored.name).toBe('Juan Carlos Sainz');
    expect(stored.nameSource).toBe('user');
  });

  test('cuenta solo-Google: sin formulario de crear; «Enviarme el enlace» y ENLACE ENVIADO', async ({ page }) => {
    mockOnly('hasPassword=false inyectado en la sesión local; forgot-password simulado');
    await loginAs(page, 'customer');
    await page.addInitScript(() => {
      const raw = window.localStorage.getItem('tcg.user');
      if (raw) window.localStorage.setItem('tcg.user', JSON.stringify({ ...JSON.parse(raw), authProvider: 'google', hasPassword: false }));
    });
    await page.goto('/es/account');
    await expect(page.getByText(t('es', 'account.password.summaryNone'))).toBeVisible();
    await page.getByRole('link', { name: t('es', 'account.password.goCreate') }).click();
    await expect(page).toHaveURL(/\/es\/account\/password$/);
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.password.createTitle') })).toBeVisible();
    await expect(page.getByLabel(t('es', 'account.password.current'))).toHaveCount(0);
    await expect(page.getByLabel(t('es', 'account.password.new'), { exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: t('es', 'account.password.createSend') }).click();
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.createSentTitle'));
  });

  test('cuenta con contraseña: /account/password cambia y ofrece «Cambiar otra vez» sin redirigir', async ({ page }) => {
    mockOnly('changePassword simulado por la rama mock');
    await loginAs(page, 'customer');
    await page.goto('/es/account/password');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.password.changeTitle') })).toBeVisible();
    await page.getByLabel(t('es', 'account.password.current')).fill('actual-larga');
    await page.getByLabel(t('es', 'account.password.new'), { exact: true }).fill('nueva-larga-2026');
    await page.getByLabel(t('es', 'account.password.confirm'), { exact: true }).fill('nueva-larga-2026');
    await page.getByRole('button', { name: t('es', 'account.password.submit') }).click();
    await expect(page.getByRole('status')).toHaveText(t('es', 'account.password.successTitle'));
    await expect(page.getByRole('button', { name: t('es', 'account.password.changeAgain') })).toBeVisible();
    await expect(page).toHaveURL(/\/es\/account\/password$/);
  });
});

test.describe('cuenta · navegación (§33.1, §33.2) y móvil', () => {
  test('header con sesión: cinco entradas, sin nombre ni «Cerrar sesión»; «Mi cuenta» → /account', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/catalog');
    const header = page.locator('header');
    const nav = header.getByRole('navigation').first();
    await expect(nav.getByRole('link')).toHaveText([
      t('es', 'nav.buy'),
      t('es', 'nav.buylist'),
      t('es', 'nav.vault'),
      t('es', 'nav.ordersAndSales'),
      t('es', 'nav.myAccount'),
    ]);
    await expect(header.getByRole('button', { name: t('es', 'nav.logout') })).toHaveCount(0);
    await nav.getByRole('link', { name: t('es', 'nav.myAccount') }).click();
    await expect(page).toHaveURL(/\/es\/account$/);
    // «Cerrar sesión» vive en la última sección de la cuenta.
    await expect(page.getByRole('button', { name: t('es', 'nav.logout') })).toBeVisible();
  });

  test('topbar del panel: «Mi cuenta» → /admin/account con perfil, correo, contraseña y sesión (sin libreta/CFDI/KYC)', async ({ page }) => {
    await loginAs(page, 'operator');
    await page.goto('/es/admin');
    await page.getByRole('link', { name: t('es', 'nav.myAccount') }).click();
    await expect(page).toHaveURL(/\/es\/admin\/account$/);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.profile.title') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.password.title') })).toBeVisible();
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.addresses.title') })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.billing.title') })).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'account.kyc.title') })).toHaveCount(0);
  });

  test('móvil 390×844: /account y /account/password sin desborde horizontal; inputs a 16px', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'customer');
    await page.goto('/es/account');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'account.title') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    const fontSize = await page.getByLabel(t('es', 'account.profile.name.label')).evaluate((el) => getComputedStyle(el).fontSize);
    expect(parseFloat(fontSize)).toBeGreaterThanOrEqual(16);
    await page.goto('/es/account/password');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
