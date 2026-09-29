import { expect, type Locator, type Page } from '@playwright/test';
import { t } from './i18n';

/**
 * Piezas del arnés para la tarjeta «Para bóveda» (`DESIGN_SYSTEM §36`, contrato `§M4-VAULT`) en
 * modo MOCKS. Las usan `m4-vault-placement.spec.ts` (el recorrido paso a paso) y
 * `m4-preparation.spec.ts` (PV-12: para ver el vacío de la cubeta hay que vaciarla primero).
 *
 * ⚠️ El estado del «servidor» mock vive en el módulo `lib/mock/fixtures` DEL NAVEGADOR: sobrevive a
 * la navegación del cliente y se reinicia con cada carga completa. Cada caso arranca limpio.
 *
 * Semilla (`vaultPlacementSeed`): `vp-8003` (Bruno, ya preparado, dos cajones), `vp-8001` (Ana,
 * una tomada + una por palomear + una bloqueada, su cajón), `vp-8002` (cuenta sin nombre, cliente
 * nuevo, una por palomear).
 */

export const P = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m4.prep.${key}`, vars);
export const V = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m4.prep.vault.${key}`, vars);
/** V3: un cajón se nombra SIEMPRE con su zona. */
export const custody = (label: string) => `${t('es', 'admin.m1.zone.customer_custody')} · ${label}`;

export const card = (page: Page, placementId: string): Locator => page.getByTestId(`prep-order-${placementId}`);
export const footer = (page: Page, placementId: string): Locator => page.getByTestId(`vault-footer-${placementId}`);

/** El `aria-label` de los botones de palomeo: «{acción}: {carta} · {folio}» (§36.12). */
export function markButton(page: Page, placementId: string, action: 'pick' | 'miss' | 'undo', cardName: string, folio: string) {
  return card(page, placementId).getByRole('button', {
    name: V('item.actionAria', { action: V(`item.${action}`), card: cardName, folio }),
    exact: true,
  });
}

export async function openVaultBucket(page: Page) {
  await page.goto('/es/admin/m4');
  await page.getByRole('button', { name: P('filterVault') }).click();
  await expect(card(page, 'vp-8001')).toBeVisible();
}

/** ⛔ Un `toBeVisible()` pasa igual con scroll horizontal: lo que se aserta es que NO lo haya. */
export async function expectNoHorizontalOverflow(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, `la pantalla desborda ${scrollW - clientW}px en horizontal`).toBeLessThanOrEqual(clientW);
}

/**
 * Vacía la cubeta con los tres cierres posibles (sin asertos finos: eso lo hace el spec dedicado).
 * Deja la pantalla con la cubeta «Para bóveda» seleccionada y sin tarjetas.
 */
export async function drainVaultBucket(page: Page) {
  // Ana: palomear la que falta ⇒ preparado ⇒ confirmar en SU cajón.
  await markButton(page, 'vp-8001', 'pick', 'Alakazam', 'INV-000202').click();
  await footer(page, 'vp-8001').getByRole('button', { name: V('prepare.cta') }).click();
  await footer(page, 'vp-8001').getByRole('button', { name: V('place.cta') }).click();
  await expect(card(page, 'vp-8001')).toHaveCount(0);

  // Sin nombre, cliente nuevo: «No la encontré» ⇒ preparado ⇒ cerrar sin cajón.
  await markButton(page, 'vp-8002', 'miss', 'Dragonite', 'INV-000204').click();
  await footer(page, 'vp-8002').getByRole('button', { name: V('prepare.cta') }).click();
  await footer(page, 'vp-8002').getByRole('button', { name: V('place.ctaEmpty') }).click();
  await expect(card(page, 'vp-8002')).toHaveCount(0);

  // Bruno (ya preparado, dos cajones): elegir uno ⇒ confirmar.
  await card(page, 'vp-8003').getByRole('radio', { name: new RegExp(custody('C10-F01-S02')) }).check();
  await footer(page, 'vp-8003').getByRole('button', { name: V('place.cta') }).click();
  await expect(card(page, 'vp-8003')).toHaveCount(0);
}
