import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: panel admin responsive (PROJECT §F / AC 24, 25, 27; contrato §10).
 * Dashboard de 8 tarjetas + enmascarado financiero para vault_operator, M1
 * (alta SIN foto propia + certNumber de gradeada, v1.2), M5 (cherry-pick), M8
 * (disputa por correo a soporte, sin comparador de fotos, v1.2).
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
  test('alta de item es SIN foto propia (imagen de catálogo) y captura certNumber de gradeada', async ({
    page,
  }) => {
    await page.goto('/es/admin/m1');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m1.title') })).toBeVisible();

    await page.getByRole('button', { name: t('es', 'admin.m1.newItem') }).click();
    // v1.2: sin uploader de foto de producto; aviso de imagen de catálogo remota.
    await expect(page.getByText(t('es', 'admin.m1.noPhotoNotice'))).toBeVisible();

    // Al elegir gradeada aparece el campo de número de certificado (requerido).
    await page.getByLabel(t('es', 'admin.m1.productType'), { exact: true }).selectOption('graded');
    await expect(page.getByText(t('es', 'admin.m1.certNumberRequired')).first()).toBeVisible();
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

  test('v1.18: rechazar exige motivo en un diálogo (3–500) antes de enviar la decisión', async ({ page }) => {
    await page.goto('/es/admin/m5');
    await page.getByRole('button', { name: t('es', 'admin.m5.reject') }).first().click();

    // El mini-diálogo pide el motivo; sin él, confirmar está deshabilitado.
    const dialog = page.getByRole('dialog', { name: t('es', 'admin.m5.rejectTitle') });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: t('es', 'admin.m5.rejectConfirm') });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(t('es', 'admin.m5.rejectReasonLabel')).fill('no es NM: esquina doblada');
    await expect(confirm).toBeEnabled();
  });

  test('v1.18: la pestaña Rechazadas existe y NO ofrece convertir a inventario', async ({ page }) => {
    await page.goto('/es/admin/m5');
    await page.getByRole('tab', { name: t('es', 'admin.m5.tabs.rechazadas') }).click();
    // Pestaña transversal informativa: sin acción de conversión (PROJECT criterio 16).
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.convert') })).toHaveCount(0);
  });
});

test.describe('admin · M8 disputas', () => {
  test('disputa por correo a soporte, sin comparador de fotos (v1.2)', async ({ page }) => {
    await page.goto('/es/admin/m8');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m8.title') })).toBeVisible();
    // Panel de contacto de evidencia (correo del contrato, no hardcodeado en la UI).
    await expect(page.getByText(t('es', 'dispute.evidenceTitle')).first()).toBeVisible();
    await expect(page.getByTestId('evidence-email').first()).toBeVisible();
    // Ya no existe comparador de fotos de ingreso/reclamo.
    await expect(page.getByText('Comparador de fotos')).toHaveCount(0);
  });
});
