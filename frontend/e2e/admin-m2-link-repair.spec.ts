import { test, expect } from '@playwright/test';
import { loginAs, mockOnly } from './utils/auth';

/**
 * # M2 › «Actualizar este set» (§AUTO-ENLACE fase 1)
 * Modo MOCKS: `sync-status.unlinkedPrice` (con grupo y motivo) y `link-repair` salen de `lib/mock/link-repair.ts`.
 * Comprueba: grupo y motivo visibles sin `link-exceptions`; el resultado queda en la fila pulsada; y mientras un
 * botón corre, el de la tabla general y el de la lista no corren a la vez.
 */
test.describe('admin · M2 · Actualizar este set', () => {
  test('lista de sin ligar: grupo/motivo, resultado en la fila y «Disponible de nuevo a las»', async ({ page }) => {
    mockOnly('`sync-status` y `link-repair` de `lib/mock/link-repair.ts`');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    const notice = page.getByRole('status').filter({ hasText: 'sin precio ligado' });
    await expect(notice).toBeVisible();
    await expect(notice.getByText(/Grupo de precios: Classic Collection/)).toBeVisible();
    await expect(notice.getByText(/es un set de promos y sigue su propia ruta/)).toBeVisible();

    await notice.getByRole('button', { name: /Actualizar este set: 30th Celebration/ }).click();
    const result = notice.getByTestId('unlinked-result');
    await expect(result).toContainText('Se ligaron 6 cartas');
    await expect(result).toContainText('Disponible de nuevo a las');
    await expect(result).not.toContainText('reintenta solo');
    // V3: con enlaces y precios, el aviso de acabado sigue visible.
    await expect(result).toContainText('un acabado que la fuente no da para ese producto');
  });

  test('M-3: mientras un botón corre, los demás «Actualizar este set» quedan deshabilitados', async ({ page }) => {
    mockOnly('`link-repair` de `lib/mock/link-repair.ts` con 400 ms de latencia simulada');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    const notice = page.getByRole('status').filter({ hasText: 'sin precio ligado' });
    const classic = notice.getByRole('button', { name: /Actualizar este set: 30th Celebration/ });
    const sv = notice.getByRole('button', { name: /Actualizar este set: Scarlet & Violet(?! Promos)/ });
    await classic.click();
    await expect(sv).toBeDisabled();
    await expect(notice.getByTestId('unlinked-result')).toBeVisible();
    await expect(sv).toBeEnabled();
  });

  test('429: el set SV simula el límite y el aviso dice cuántos minutos esperar', async ({ page }) => {
    mockOnly('`link-repair` del set SV responde 429 en `lib/mock/link-repair.ts`');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    const notice = page.getByRole('status').filter({ hasText: 'sin precio ligado' });
    await notice.getByRole('button', { name: /Actualizar este set: Scarlet & Violet(?! Promos)/ }).click();
    await expect(notice.getByTestId('unlinked-error')).toContainText('5');
  });

  test('F2/F3: contador, dial Encendida y «Confirmar» con resultado junto al caso, sin desborde a 390 px', async ({ page }) => {
    mockOnly('`link-exceptions` y `confirm` de `lib/mock/link-repair.ts` (dial encendido por defecto)');
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    await expect(page.getByTestId('auto-link-counter')).toContainText('Quedan 14 cartas sin precio · ayer se repararon 87 (87 con precio)');
    await expect(page.getByTestId('auto-link-job')).toContainText('Reparación automática encendida');
    const notice = page.getByRole('status').filter({ hasText: 'sin precio ligado' });
    await expect(notice.getByText(/Mejor candidato: Classic Collection/)).toBeVisible();
    await notice.getByRole('button', { name: /Confirmar el grupo Classic Collection para 30th/ }).click();
    const res = notice.getByTestId('confirm-result');
    await expect(res).toContainText('Confirmado en 30th Celebration Classic Collection: 9 cartas ligadas y 18 precios actualizados.');
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });

  test('§8a/§8b: apagar pide confirmación; piezas antiguas se deciden junto a la pieza', async ({ page }) => {
    mockOnly('`link-exceptions`, `finish-review` y el dial salen de `lib/mock/link-repair.ts`');
    await page.setViewportSize({ width: 390, height: 800 });
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    await page.getByTestId('auto-link-toggle').click();
    await page.getByTestId('auto-link-confirm-off').click();
    await expect(page.getByTestId('auto-link-job')).toContainText('Reparación automática apagada');
    const review = page.getByTestId('finish-review');
    await expect(review).toContainText('piezas antiguas por confirmar');
    await review.getByRole('button', { name: /Marcar Rocket's Snorlax como 1\.ª edición/ }).click();
    // Con precio manual: el servidor lo conserva (MX$1,131.00) y la UI avisa; no muestra el precio destino.
    await expect(review.getByTestId('finish-review-item').filter({ hasText: "Rocket's Snorlax" }).getByTestId('finish-review-result')).toContainText('Se conservó tu precio manual (MX$1,131.00)');
    // Sin precio manual: toma el precio de la 1.ª edición que manda el servidor.
    await review.getByRole('button', { name: /Marcar Blaine's Vulpix como 1\.ª edición/ }).click();
    await expect(review.getByTestId('finish-review-item').filter({ hasText: "Blaine's Vulpix" }).getByTestId('finish-review-result')).toContainText('ahora es 1.ª edición, precio MX$215.00');
    expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(false);
  });
});
