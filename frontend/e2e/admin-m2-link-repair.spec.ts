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
  });
});
