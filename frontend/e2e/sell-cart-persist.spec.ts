import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { credentialsFor, mockOnly, MONEY_RE } from './utils/auth';

/**
 * Stream A · P-55 (DESIGN_SYSTEM §33.11, ARCHITECTURE §4.47.6): el carrito de venta sobrevive
 * al login. Flujo completo del usuario: arma la lista SIN sesión → «Iniciar sesión» del carrito
 * (`?next=/buylist`) → entra → vuelve a /buylist con las MISMAS líneas, RE-COTIZADAS.
 *
 * Helpers copiados de `buylist.spec.ts` (allí son locales al módulo).
 */
async function openBaseSet(page: Page) {
  const searchSet = page.getByLabel(t('es', 'masterSet.searchSet'));
  if ((await searchSet.count()) === 0) return;
  await searchSet.fill('Base');
  await page.getByRole('button', { name: /Base Set/ }).first().click();
}
async function addFromBinder(page: Page, name: string, finish = 'Normal') {
  await openBaseSet(page);
  await page.getByRole('button', { name: new RegExp(`^Agregar ${name} \\(${finish}\\) a la venta`) }).click();
}
function cartPanel(page: Page) {
  const prefix = t('es', 'buylist.cartDrawer.ariaLabel', { count: 0 }).replace(/\s*\(0\)\s*$/, '');
  return page.locator(`[aria-label^="${prefix}"]:not(button)`);
}
async function openCart(page: Page) {
  const panel = cartPanel(page);
  const fab = page.getByTestId('sell-cart-fab');
  await expect(panel.or(fab).first()).toBeVisible();
  if (await fab.isVisible().catch(() => false)) {
    await fab.click({ timeout: 5_000 }).catch(() => {});
  }
  await expect(panel).toBeVisible();
}

test.describe('carrito de venta · sobrevive al inicio de sesión (P-55)', () => {
  test('armar sin sesión → login desde el carrito (?next=/buylist) → mismas líneas, recotizadas', async ({ page }) => {
    mockOnly('carta literal «Charizard» del fixture (el flujo es genérico; el nombre no)');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard');
    await openCart(page);
    const panel = cartPanel(page);
    await expect(panel.getByText('Charizard')).toBeVisible();

    // El CTA sin sesión del carrito (bloque de tinta bajo el total) lleva `?next=/buylist`.
    // ⚠ El panel de requisitos (`SellRequirementsPanel`, zona de A1) pinta OTRO «Iniciar sesión»
    // todavía sin `?next=` — se localiza el CTA por su href para no medir ese enlace aquí.
    const login = panel.locator('a[href$="/login?next=/buylist"]', { hasText: t('es', 'buylist.loginCta') });
    await expect(login).toHaveCount(1);
    await login.click();
    await expect(page).toHaveURL(/\/es\/login\?next=(\/|%2F)buylist$/);

    const creds = credentialsFor('customer');
    await page.getByLabel(t('es', 'auth.email')).fill(creds.email);
    await page.getByLabel(t('es', 'auth.password')).fill(creds.password);
    await page.getByRole('button', { name: t('es', 'auth.loginCta') }).click();

    // Vuelve al cotizador con la lista conservada y RE-COTIZADA (el CTA de enviar vive).
    await expect(page).toHaveURL(/\/es\/buylist$/);
    await expect(page.getByText(t('es', 'sellCart.restored', { count: 1 }))).toBeVisible();
    await openCart(page);
    await expect(panel.getByText('Charizard')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Enviar solicitud \(1\)/ })).toBeEnabled();
    await expect(panel.getByTestId('sell-cart-money').getByText(MONEY_RE).first()).toBeVisible();
    // Y el storage tiene la lista (clave del contrato de UX, §33.11).
    const stored = await page.evaluate(() => window.localStorage.getItem('tcg.sellCart'));
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).lines).toHaveLength(1);
  });

  test('«Vaciar la lista» borra la clave persistida', async ({ page }) => {
    mockOnly('carta literal «Charizard» del fixture');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard');
    await openCart(page);
    await cartPanel(page).getByRole('button', { name: t('es', 'buylist.clearCart') }).click();
    const stored = await page.evaluate(() => window.localStorage.getItem('tcg.sellCart'));
    expect(JSON.parse(stored ?? '{"lines":[1]}').lines).toHaveLength(0);
  });
});
