import { test, expect, type Locator, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * §M5-S (contrato v1.68, cierre de P-58) · candado S-3 de punta a punta contra el bundle de mocks:
 * «Marcar recibida» se ofrece SOLO en `en_transito`; «Verificar» SOLO en `recibida`. Y el ciclo
 * completo del clic correcto: `en_transito` → receive → `recibida` (aparece «Verificar») → verify →
 * `verificacion` (ya no hay verbo de transición).
 *
 * Mock-only por DATOS: depende de las filas de `src/lib/mock/fixtures.ts` (`sr-3007` en_transito,
 * `sr-3002` recibida, `sr-3004` cotizada, `sr-3003` aprobada). Contra el stack real el seed no
 * garantiza una `en_transito`; la matriz de los 11 estados vive en `M5View.transitions.test.tsx`.
 */
const RECEIVE = t('es', 'admin.m5.receive');
const VERIFY = t('es', 'admin.m5.verify');

/** La tarjeta de una solicitud, anclada por su id (el contenedor `rounded-lg` más cercano). */
function card(page: Page, id: string): Locator {
  return page.getByText(id, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
}

async function openStage(page: Page, tabKey: string) {
  await page.getByRole('tab', { name: new RegExp(`^${t('es', `admin.m5.tabs.${tabKey}`)}`) }).click();
}

test.describe('admin · M5 · §M5-S: el paso correcto, no solo «fila viva»', () => {
  test.beforeEach(async ({ page }) => {
    mockOnly('depende de sr-3007 (en_transito) / sr-3002 (recibida) / sr-3004 (cotizada) de las fixtures');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();
  });

  test('«Marcar recibida» solo en en_transito; ni en cotizada, ni en ofertada, ni en recibida', async ({ page }) => {
    await openStage(page, 'con_vendedor');
    await expect(card(page, 'sr-3007').getByRole('button', { name: RECEIVE })).toBeVisible();
    await expect(card(page, 'sr-3007').getByRole('button', { name: VERIFY })).toHaveCount(0);
    // `ofertada` (sr-3003 del portal es otra tabla; aquí la ofertada admin es la que espere al vendedor).
    const others = page.getByRole('button', { name: RECEIVE });
    await expect(others).toHaveCount(1);

    await openStage(page, 'por_ofertar');
    await expect(card(page, 'sr-3004').getByRole('button', { name: RECEIVE })).toHaveCount(0);
    await expect(card(page, 'sr-3004').getByRole('button', { name: t('es', 'admin.m5.desk.open') })).toBeVisible();

    await openStage(page, 'verificando');
    await expect(card(page, 'sr-3002').getByRole('button', { name: VERIFY })).toBeVisible();
    await expect(card(page, 'sr-3002').getByRole('button', { name: RECEIVE })).toHaveCount(0);
    await expect(card(page, 'sr-3001').getByRole('button', { name: VERIFY })).toHaveCount(0);
  });

  test('ciclo: receive desde en_transito ⇒ recibida (aparece «Verificar») ⇒ verify ⇒ verificacion', async ({ page }) => {
    await openStage(page, 'con_vendedor');
    await card(page, 'sr-3007').getByRole('button', { name: RECEIVE }).click();
    // El feedback de M5 va anclado a la TARJETA y la fila cambia de pestaña al recibirse, así que
    // aquí se asevera por el estado: la pestaña «Con el vendedor» la pierde y «Verificando» la gana.
    await expect(card(page, 'sr-3007')).toHaveCount(0);

    // Ahora vive en «Verificando» con el badge Recibida y el verbo siguiente.
    await openStage(page, 'verificando');
    const moved = card(page, 'sr-3007');
    // `.first()`: el PipelineStepper de la tarjeta también rotula el paso «Recibida»; basta con que el badge exista.
    await expect(moved.getByText(t('es', 'status.sellRequest.recibida'), { exact: true }).first()).toBeVisible();
    await expect(moved.getByRole('button', { name: RECEIVE })).toHaveCount(0);
    await moved.getByRole('button', { name: VERIFY }).click();
    await expect(page.getByText(t('es', 'admin.m5.feedback.verified'))).toBeVisible();
    await expect(card(page, 'sr-3007').getByRole('button', { name: VERIFY })).toHaveCount(0);
    await expect(card(page, 'sr-3007').getByRole('button', { name: RECEIVE })).toHaveCount(0);
  });
});
