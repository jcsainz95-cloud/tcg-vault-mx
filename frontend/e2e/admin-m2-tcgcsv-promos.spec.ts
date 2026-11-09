import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * P-PROMOS · panel de promos TCGCSV (modo MOCKS). Desde PMS-F2 el panel es de SOLO LECTURA: los grupos
 * se descargan solos con «Importar sets nuevos» / «Sincronizar todo»; ya no hay botón de importar.
 * Backend real: gate de QA (PROMO-F1).
 */
const P = (key: string, vars?: Record<string, string | number>) =>
  t('es', `admin.m2.tcgcsvPromos.${key}`, vars);

test('el panel de promos es de solo lectura: lista el grupo, sin botón de importar', async ({ page }) => {
  mockOnly('grupos del servidor falso (api/tcgcsv-promos)');
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2');
  const heading = page.getByRole('heading', { name: P('title') });
  await expect(heading).toBeVisible();
  const panel = page.locator('section', { has: heading });

  // El grupo se lista con su meta (id, productos de la fuente, cartas importadas).
  await expect(panel.getByText('ME: Mega Evolution Promo')).toBeVisible();
  await expect(panel.getByText('24451', { exact: false }).first()).toBeVisible();
  // Solo lectura: ni importar ni reimportar, ni resumen de una importación manual.
  await expect(panel.getByRole('button')).toHaveCount(0);
  await expect(panel.getByTestId('promo-summary')).toHaveCount(0);
  await expect(panel.getByTestId('promo-nopricing')).toHaveCount(0);
});
