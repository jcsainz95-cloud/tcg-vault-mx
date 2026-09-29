import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * # M2 › cola de precio pendiente › SELLADO SIN MAPEAR, en un navegador de verdad (`API_CONTRACT §M2-SK`)
 *
 * La tabla «Qué ofrece M2 en la fila de un pendiente de sellado» es normativa: una fila con
 * `productType='sealed'` y `gradeKey==='sealed'` (la constante legada = clave de COLA, nunca de PRECIO)
 * ofrece DOS salidas reales —«Ligar a su presentación» y «Fijar el precio de esta pieza»— y ⛔ NO el
 * «Fijar precio» de mercado, que el servidor rechaza con `422 SEALED_MARKET_KEY_REQUIRED` (SK-3).
 *
 * Corre en modo MOCKS (`mockOnly`): la fila sale de la semilla del servidor falso (`ppe-sealed-unmapped`,
 * pieza `inv-1009`, sv06 ETB sin `tcgplayerProductId`) y el mock de `overridePrice` replica SK-3, así que
 * si la pantalla volviera a ofrecer el botón equivocado, aquí se vería el mismo 422 que en producción.
 * Contra el stack real la misma fila depende de sembrar un sellado sin mapeo: es del gate de QA.
 */

const P = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m2.pending.${key}`, vars);

/** La fila de la semilla: sellado sv06 ETB SIN mapeo (`gradeKey: 'sealed'`). */
const UNMAPPED = 'Twilight Masquerade ETB';
/** Una fila sellada MAPEADA (`sealed:tcg:590413`): conserva el «Fijar precio» de mercado. */
const MAPPED = 'Surging Sparks Booster Bundle';

async function openQueue(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2');
  await expect(page.getByRole('heading', { name: P('title') })).toBeVisible();
}

function rowOf(page: Page, name: string) {
  return page.getByRole('row').filter({ hasText: name });
}

test.describe('admin · M2 cola de pendientes · sellado sin mapear (§M2-SK)', () => {
  test('la fila sin mapear ofrece las DOS salidas y NUNCA el «Fijar precio» de mercado; la mapeada sí lo conserva', async ({
    page,
  }) => {
    mockOnly('fila `ppe-sealed-unmapped` de la semilla del servidor falso');
    await openQueue(page);

    const unmapped = rowOf(page, UNMAPPED);
    await expect(unmapped).toBeVisible();
    await expect(unmapped.getByRole('button', { name: P('sealedUnmapped.link') })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: P('sealedUnmapped.pricePiece') })).toBeVisible();
    await expect(unmapped.getByRole('button', { name: P('setPrice'), exact: true })).toHaveCount(0);

    const mapped = rowOf(page, MAPPED);
    await expect(mapped.getByRole('button', { name: P('setPrice'), exact: true })).toBeVisible();
    await expect(mapped.getByRole('button', { name: P('sealedUnmapped.link') })).toHaveCount(0);
  });

  test('«Ligar a su presentación»: elige la presentación del catálogo y liga la(s) pieza(s) sin mapeo', async ({
    page,
  }) => {
    mockOnly('pieza `inv-1009` y catálogo sellado `sv06` de la semilla');
    await openQueue(page);

    await rowOf(page, UNMAPPED).getByRole('button', { name: P('sealedUnmapped.link') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: P('sealedUnmapped.linkTitle') })).toBeVisible();

    // El picker del alta: una teja `option` por presentación; se elige la ETB del set.
    const confirm = dialog.getByRole('button', { name: /^Ligar \d+ pieza/ });
    await expect(confirm).toBeDisabled();
    await dialog.getByRole('option', { name: /Elite Trainer Box/ }).click();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    // Confirmación honesta: cuántas piezas quedaron ligadas y a qué producto. Mapear NO fija precio.
    const status = dialog.getByRole('status');
    await expect(status).toContainText(/pieza(s)? ligada(s)?/);
    await expect(status).toContainText('Elite Trainer Box');
    await dialog.getByRole('button', { name: t('es', 'common.close') }).click();
    await expect(dialog).toHaveCount(0);
  });

  test('«Fijar el precio de esta pieza»: lista las piezas por folio y fija listPriceCents (no un override de mercado)', async ({
    page,
  }) => {
    mockOnly('pieza `inv-1009` (folio INV-000109) de la semilla');
    await openQueue(page);

    await rowOf(page, UNMAPPED).getByRole('button', { name: P('sealedUnmapped.pricePiece') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: P('sealedUnmapped.priceTitle') })).toBeVisible();
    await expect(dialog.getByText('INV-000109')).toBeVisible();

    const confirm = dialog.getByRole('button', { name: /^Fijar en \d+ pieza/ });
    // S-L1 money-safe: vacío ⇒ bloqueado.
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(P('sealedUnmapped.priceLabel')).fill('1800');
    await expect(dialog.getByText('= MX$1,800.00')).toBeVisible();
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(dialog.getByRole('status')).toContainText('MX$1,800.00');
    await dialog.getByRole('button', { name: t('es', 'common.close') }).click();
    await expect(dialog).toHaveCount(0);
  });
});
