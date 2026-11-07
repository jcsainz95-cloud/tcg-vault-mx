import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * P-PROMOS opción C · flujo admin de importación de un grupo de promos TCGCSV (modo MOCKS).
 * Backend real: gate de QA (PROMO-F1).
 */
const P = (key: string, vars?: Record<string, string | number>) =>
  t('es', `admin.m2.tcgcsvPromos.${key}`, vars);

test('importar el grupo 24451 muestra creadas, sin precio y omitidos con motivo', async ({ page }) => {
  mockOnly('grupos y resultado del servidor falso (api/tcgcsv-promos)');
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2');
  await expect(page.getByRole('heading', { name: P('title') })).toBeVisible();
  await page.getByRole('button', { name: P('import', { name: 'ME: Mega Evolution Promo' }) }).click();
  await expect(page.getByTestId('promo-summary')).toContainText('130');
  await expect(page.getByTestId('promo-nopricing')).toContainText('precio pendiente');
  await expect(page.getByTestId('promo-skipped')).toContainText('Paradise Resort 092 [Staff]');
  // Reimportar es idempotente: el grupo queda marcado y el botón cambia.
  await expect(page.getByRole('button', { name: P('reimport', { name: 'ME: Mega Evolution Promo' }) })).toBeVisible();
});
