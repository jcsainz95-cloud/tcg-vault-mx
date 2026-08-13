import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: panel admin responsive (PROJECT §F / AC 24, 25, 27; contrato §10).
 * Dashboard de 8 tarjetas + enmascarado financiero para vault_operator, M1
 * (PhotoUploader anverso/reverso), M5 (cherry-pick), M8 (comparador de fotos).
 */
test.describe('admin · dashboard', () => {
  test('muestra las 8 tarjetas del dashboard', async ({ page }) => {
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { name: t('es', 'admin.modules.dashboard') })).toBeVisible();

    for (const key of [
      'profit',
      'sales',
      'workQueue',
      'inventoryValue',
      'custodyValue',
      'buylist',
      'dataHealth',
      'launch',
    ] as const) {
      await expect(page.getByText(t('es', `admin.dashboard.${key}`)).first()).toBeVisible();
    }
  });

  test('enmascara cifras financieras para vault_operator', async ({ page }) => {
    await page.goto('/es/admin');
    // Como super_admin (default) no hay enmascarado.
    await expect(page.getByText(t('es', 'admin.masked'))).toHaveCount(0);

    // Cambia el rol a operador de bóveda → tarjetas de dinero enmascaradas.
    await page.getByLabel(t('es', 'admin.roleLabel')).selectOption('vault_operator');
    await expect(page.getByText(t('es', 'admin.masked')).first()).toBeVisible();
  });
});

test.describe('admin · M1 inventario', () => {
  test('alta de item abre PhotoUploader anverso/reverso', async ({ page }) => {
    await page.goto('/es/admin/m1');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m1.title') })).toBeVisible();

    await page.getByRole('button', { name: t('es', 'admin.m1.newItem') }).click();
    await expect(page.getByText(t('es', 'admin.m1.photosFront')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'admin.m1.photosBack')).first()).toBeVisible();
  });
});

test.describe('admin · M5 buylist (cherry-pick)', () => {
  test('permite decisión carta por carta y respeta dinero saliente', async ({ page }) => {
    await page.goto('/es/admin/m5');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();

    // Acciones cherry-pick por item.
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.approve') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.adjust') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.reject') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.convert') }).first()).toBeVisible();
    // Nota de dinero saliente (solo súper-admin, queda en bitácora).
    await expect(page.getByText(t('es', 'admin.moneyOutNote')).first()).toBeVisible();
  });
});

test.describe('admin · M8 disputas', () => {
  test('muestra comparador de fotos ingreso vs reclamo', async ({ page }) => {
    await page.goto('/es/admin/m8');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m8.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'admin.m8.compareTitle'))).toBeVisible();
    await expect(page.getByText(t('es', 'admin.m8.ingressPhotos'))).toBeVisible();
    await expect(page.getByText(t('es', 'admin.m8.claimPhotos'))).toBeVisible();
  });
});
