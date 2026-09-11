import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, IS_REAL, skipIfSeedMissing } from './utils/auth';

/**
 * Stream A · F7 (DESIGN_SYSTEM §33.9, contrato v1.67 «nota de consumo» de GET /orders/claimable):
 * el aviso de pedidos reclamables NUNCA se pinta vacío ni en error, aparece solo con datos y
 * desaparece al reclamar.
 *
 * Segundo caso AGNÓSTICO (techlead F2-1): en mock los reclamables del fixture se sirven solo con
 * `localStorage['tcg.mock.claimable']='1'` (§67.6 de FRONTEND_NOTES: el default sigue `[]` porque el
 * primer caso mide precisamente «con [] no hay nodo»); contra el backend real el dato es el pedido de
 * invitado SIN reclamar con el correo del cliente que siembra `seed-e2e.ts` — si no está, se salta con
 * la razón. La unidad `ClaimableOrdersNotice.test.tsx` cubre el ciclo con el endpoint espiado.
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
    await loginAs(page, 'customer');
    if (!IS_REAL) {
      // Rama mock: enciende el pool de reclamables del fixture (los reclamados se anotan en
      // `tcg.mock.claimed` y no vuelven tras recargar, como el backend).
      await page.addInitScript(() => window.localStorage.setItem('tcg.mock.claimable', '1'));
    }
    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();

    const notice = page.getByTestId('claimable-orders-notice');
    // Dato del seed (real): si no hay reclamables para este cliente, se salta con la razón.
    const present = await notice.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    skipIfSeedMissing(!present, 'un pedido de invitado SIN reclamar con el correo del customer (seed-e2e.ts)');

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
