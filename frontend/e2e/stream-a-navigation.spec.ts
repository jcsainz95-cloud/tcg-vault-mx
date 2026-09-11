import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs } from './utils/auth';

/**
 * Stream A · «La cuenta del cliente» (DESIGN_SYSTEM §33.3 / §33.4, agente frontend A2).
 * Navegación por URL de las pestañas: «Compras y ventas» (/orders, pestañas-ENLACE) y «Retiros»
 * dentro de la bóveda (/vault?tab=retiros, pestaña de ESTADO direccionable). /shipments queda
 * solo para solicitar. Copy/i18n/navegación: NO es mock-only (§utils/auth.mockOnly).
 */

/** Sin desborde horizontal: lo que hay que medir a 390px, no «se ve bien». */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'scrollWidth > innerWidth = desborde horizontal').toBeLessThanOrEqual(innerWidth);
}

test.describe('Compras y ventas · pestañas-enlace (§33.3)', () => {
  test('/orders abre en «Compras» (aria-current) y /orders?tab=ventas en «Ventas»; no es un tablist', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/orders');

    await expect(page.getByRole('heading', { level: 1, name: t('es', 'orders.title') })).toBeVisible();
    const nav = page.getByRole('navigation', { name: t('es', 'orders.tabs.label') });
    await expect(nav.getByRole('link', { name: t('es', 'orders.tabs.purchases') })).toHaveAttribute('aria-current', 'page');
    await expect(nav.getByRole('link', { name: t('es', 'orders.tabs.sales') })).not.toHaveAttribute('aria-current', 'page');
    expect(await nav.locator('[role="tablist"]').count()).toBe(0);

    // Clic en la pestaña = cambio de URL (es un enlace), y la sección de ventas se monta.
    await nav.getByRole('link', { name: t('es', 'orders.tabs.sales') }).click();
    await expect(page).toHaveURL(/\/es\/orders\?tab=ventas$/);
    await expect(nav.getByRole('link', { name: t('es', 'orders.tabs.sales') })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'buylist.myRequests') })).toBeVisible();

    // Entrada DIRECTA por URL (la enlazan el portal de la solicitud y /buylist).
    await page.goto('/es/orders?tab=ventas');
    await expect(nav.getByRole('link', { name: t('es', 'orders.tabs.sales') })).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('heading', { level: 2, name: t('es', 'buylist.myRequests') })).toBeVisible();
  });

  test('en /buylist con sesión «Mis solicitudes» es UNA línea que enlaza a /orders?tab=ventas', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    const link = page.getByRole('link', { name: new RegExp(t('es', 'buylist.viewMyRequests')) });
    await expect(link).toHaveAttribute('href', /\/es\/orders\?tab=ventas$/);
    await expect(page.getByRole('heading', { name: t('es', 'buylist.myRequests') })).toHaveCount(0);
  });

  test('móvil 390px: /orders y sus dos pestañas caben sin desborde horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'customer');
    await page.goto('/es/orders');
    await expect(page.getByRole('link', { name: t('es', 'orders.tabs.sales') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});

test.describe('Bóveda · pestaña «Retiros» direccionable (§33.4)', () => {
  test('/vault?tab=retiros arranca en «Retiros» con el FOCO en el tab y la lista de retiros', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/vault?tab=retiros');

    const tab = page.getByRole('tab', { name: t('es', 'vault.tabs.withdrawals') });
    await expect(tab).toHaveAttribute('aria-selected', 'true');
    await expect(tab).toBeFocused();
    await expect(page.getByRole('heading', { name: t('es', 'shipments.myShipments') })).toBeVisible();
    await expect(page.getByRole('heading', { name: t('es', 'shipments.dispute.myDisputes') })).toBeVisible();
    // El CTA de solicitar vive aquí (y en la cabecera) → /shipments.
    await expect(page.getByRole('link', { name: t('es', 'vault.requestWithdrawal') }).first()).toHaveAttribute(
      'href',
      /\/es\/shipments$/,
    );
  });

  test('las pestañas son un tablist operable con teclado y el clic sincroniza la URL', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/vault');
    const tablist = page.getByRole('tablist', { name: t('es', 'vault.title') });
    await expect(tablist.getByRole('tab')).toHaveCount(4);
    const pieces = tablist.getByRole('tab', { name: t('es', 'vault.tabs.pieces') });
    await expect(pieces).toHaveAttribute('aria-selected', 'true');

    // Teclado: → mueve selección y foco; End va a «Retiros».
    await pieces.focus();
    await page.keyboard.press('ArrowRight');
    await expect(tablist.getByRole('tab', { name: t('es', 'vault.tabs.masterSet') })).toHaveAttribute('aria-selected', 'true');
    await expect(tablist.getByRole('tab', { name: t('es', 'vault.tabs.masterSet') })).toBeFocused();
    await page.keyboard.press('End');
    await expect(tablist.getByRole('tab', { name: t('es', 'vault.tabs.withdrawals') })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveURL(/\/es\/vault\?tab=retiros$/);

    // Volver a «Piezas» limpia el parámetro.
    await pieces.click();
    await expect(page).toHaveURL(/\/es\/vault$/);
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
  });

  test('/shipments es solo «Solicitar retiro»: vuelta «← Mi bóveda» y sin listas', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/shipments');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'shipments.title') })).toBeVisible();
    // «← Mi bóveda» (el header también tiene «Mi bóveda»: se pide el nombre exacto con la flecha).
    await expect(page.getByRole('link', { name: `← ${t('es', 'shipments.backToVault')}`, exact: true })).toHaveAttribute(
      'href',
      /\/es\/vault\?tab=retiros$/,
    );
    await expect(page.getByRole('heading', { name: t('es', 'shipments.myShipments') })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: t('es', 'shipments.dispute.myDisputes') })).toHaveCount(0);
  });

  test('móvil 390px: la bóveda con cuatro pestañas y la pestaña «Retiros» no desbordan', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'customer');
    await page.goto('/es/vault');
    await expect(page.getByRole('tab', { name: t('es', 'vault.tabs.withdrawals') })).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.goto('/es/vault?tab=retiros');
    await expect(page.getByRole('heading', { name: t('es', 'shipments.myShipments') })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
});
