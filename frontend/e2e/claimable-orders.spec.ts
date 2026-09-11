import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, IS_REAL } from './utils/auth';

/**
 * Stream A · F7 (DESIGN_SYSTEM §33.9, contrato v1.67 «nota de consumo» de GET /orders/claimable):
 * el aviso de pedidos reclamables NUNCA se pinta vacío ni en error, aparece solo con datos y
 * desaparece al reclamar.
 *
 * ⚠️ En modo MOCK `getClaimableOrders()` devuelve `[]` (rama mock de `lib/api.ts`, zona de A1),
 * así que aquí solo es medible «con [] no hay nodo». El «aparece → vincular → desaparece» se mide
 * contra el stack real cuando el seed tenga un pedido de invitado sin reclamar con el correo del
 * cliente; si no lo tiene, el test se SALTA con la razón (no un rojo que no significa nada). La
 * unidad `ClaimableOrdersNotice.test.tsx` cubre el ciclo completo con el endpoint espiado.
 */
test.describe('pedidos reclamables · aviso (F7)', () => {
  test('con [] (nada que ofrecer) no hay ningún nodo del aviso en /vault ni en /orders', async ({ page }) => {
    test.skip(IS_REAL, 'en real el seed puede tener reclamables: la ausencia no es un hecho medible');
    await loginAs(page, 'customer');

    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'orders.claimable.cta') })).toHaveCount(0);

    await page.goto('/es/orders');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'orders.title') })).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'orders.claimable.cta') })).toHaveCount(0);
  });

  test('@real aparece con pedidos del correo verificado, «Vincular a mi cuenta» lo reclama y desaparece', async ({ page }) => {
    test.skip(!IS_REAL, 'solo-real: la rama mock de GET /orders/claimable devuelve [] (fixture de lib/, zona A1)');
    await loginAs(page, 'customer');
    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();

    const notice = page.getByTestId('claimable-orders-notice');
    // Dato del seed: si no hay reclamables para este cliente, se salta con la razón.
    const present = await notice.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    test.skip(!present, 'falta dato en el seed real: un pedido de invitado SIN reclamar con el correo del cliente');

    // Cuerpo de la bóveda: dice que NO entran a la bóveda (regla 5 de §33.0).
    await expect(notice.getByText(t('es', 'vault.claimable.body'))).toBeVisible();
    await notice.getByRole('button', { name: t('es', 'orders.claimable.cta') }).click();
    await expect(page.getByText(/PEDIDOS? EN TU HISTORIAL/)).toBeVisible();
    await expect(notice).toHaveCount(0);

    // Recarga: la siguiente consulta viene vacía ⇒ no vuelve.
    await page.reload();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
  });
});
