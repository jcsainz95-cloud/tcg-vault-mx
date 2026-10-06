import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * 💰 rev BSD-1 — **portal del vendedor**: el cierre «no continuamos» y la descarga de su guía (DESIGN_SYSTEM §BSD-UX.4a/4b,
 * contrato §BSD.4.4 + BSD-1.1 C-1 + BSD-1.4 punto 8). Smoke de los flujos que tocó el stream, en modo MOCK (fixtures
 * `sr-3004` aceptada con guía de entrada viva y `sr-3005` `expirada`+`not_continued`).
 *
 * ⛔ No `@real`: el seed real no tiene una guía de Skydropx de entrada comprada ni una solicitud `not_continued`; el
 * recorrido real (BSD-F9, criterio 550) lo corre QA contra el stack con el doble del proveedor.
 */
test.describe('BSD · portal del vendedor', () => {
  test('`not_continued`: frase espejo de BSD-M1, insignia «No continuó», cero `MX$` y ninguna palabra de culpa', async ({ page }) => {
    mockOnly('sr-3005 (expirada + not_continued) es un fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/buylist/requests/sr-3005');
    await expect(page.getByText(t('es', 'buylist.offer.closedNotContinued'))).toBeVisible();
    await expect(page.getByText(t('es', 'status.sellRequestExpiry.not_continued')).first()).toBeVisible();
    const main = await page.locator('main').innerText();
    expect(main).not.toMatch(/MX\$/);
    expect(main).not.toMatch(/expir|venc|plazo|no enviaste/i);
    await expect(page.getByTestId('seller-label-block')).toHaveCount(0);
  });

  test('«Tu guía» (labelPdfAvailable): descarga el PDF por el proxy, en el portal y desde «Ventas»', async ({ page }) => {
    mockOnly('sr-3004 con guía de entrada viva es un fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/buylist/requests/sr-3004');
    const block = page.getByTestId('seller-label-block');
    await expect(block).toBeVisible();
    await expect(block).toContainText('Paquetexpress');
    await expect(block).toContainText('PQX123456789');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      block.getByRole('button', { name: t('es', 'buylist.offer.label.download') }).click(),
    ]);
    expect(download.suggestedFilename()).toMatch(/^guia-.+\.pdf$/);
    await expect(page.getByTestId('seller-label-error')).toHaveCount(0);

    await page.goto('/es/orders?tab=ventas');
    const link = page.getByTestId('seller-label-link-sr-3004');
    await expect(link).toBeVisible();
    await expect(page.getByTestId('seller-label-link-sr-3005')).toHaveCount(0);
    const [d2] = await Promise.all([page.waitForEvent('download'), link.click()]);
    expect(d2.suggestedFilename()).toMatch(/\.pdf$/);
  });
});
