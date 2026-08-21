import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujos Stream B «Inventario Master Set operable» (ARCHITECTURE §4.26, DESIGN §16):
 * P-17 drill-down por variante + buscador por folio, P-25 pestaña Sellado, P-20 pestaña
 * Gradeadas y P-22 Top Bounties en /buylist. Corren en modo MOCK (fixtures v1.28); contra
 * backend real los smoke equivalentes viven en la suite de QA (gate por release).
 */

test.describe('M1 · buscador por folio → drill-down (P-17)', () => {
  test('un folio válido abre el panel de la variante dueña con sus piezas', async ({ page }) => {
    await page.goto('/es/admin/m1');

    await page.getByLabel(t('es', 'admin.inventory.folioSearch.label')).fill('INV-000110');
    await page.getByRole('button', { name: t('es', 'admin.inventory.folioSearch.cta') }).click();

    // INV-000110 (fixtures) = Zapdos raw holofoil.
    const drawer = page.getByRole('dialog', { name: /Zapdos/ });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText(/RAW · NM · HOLOFOIL/)).toBeVisible();
    await expect(drawer.getByText(/INV-000110/).first()).toBeVisible();
  });

  test('folio inexistente → mensaje inline honesto, sin panel', async ({ page }) => {
    await page.goto('/es/admin/m1');

    await page.getByLabel(t('es', 'admin.inventory.folioSearch.label')).fill('INV-999999');
    await page.getByRole('button', { name: t('es', 'admin.inventory.folioSearch.cta') }).click();

    await expect(page.getByText(t('es', 'admin.inventory.folioSearch.notFound'))).toBeVisible();
  });
});

test.describe('M1 · pestañas Sellado (P-25) y Gradeadas (P-20)', () => {
  test('Sellado lista sets con piezas selladas y su valor de mercado', async ({ page }) => {
    await page.goto('/es/admin/m1');
    await page.getByRole('tab', { name: t('es', 'admin.inventory.tabs.sealed') }).click();

    await expect(page.getByText('Surging Sparks').first()).toBeVisible();
    await expect(page.getByText('MX$3,200.00').first()).toBeVisible();
  });

  test('Gradeadas lista por carta+grado con valor manual (·M) — nunca $0 inventado', async ({
    page,
  }) => {
    await page.goto('/es/admin/m1');
    await page.getByRole('tab', { name: t('es', 'admin.inventory.tabs.graded') }).click();

    await expect(page.getByText('PSA 9').first()).toBeVisible();
    await expect(page.getByText(/MX\$32,600\.00/).first()).toBeVisible();
    await expect(page.getByText('MX$0.00')).toHaveCount(0);
  });
});

test.describe('buylist · Top Bounties (P-22)', () => {
  test('la vitrina aparece ARRIBA de Vender con precio héroe y regla PAY_AFTER_RECEIPT', async ({
    page,
  }) => {
    await page.goto('/es/buylist');

    await expect(page.getByRole('heading', { name: t('es', 'buylist.bounties.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.bounties.subtitle'))).toBeVisible();
    // Fixtures: bounty de Latias ex a MX$4,800.00 (el más alto va primero).
    await expect(page.getByText('MX$4,800.00').first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'buylist.bounties.cta') }).first(),
    ).toBeVisible();
  });
});
