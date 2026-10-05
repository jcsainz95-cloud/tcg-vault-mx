import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, needsSeed } from './utils/auth';

/**
 * **«Pedidos por preparar» en el CELULAR** — `DESIGN_SYSTEM §60.9`, candados MOB-1…MOB-5 (§60.13), decisión del
 * dueño `HECHOS.md` (2026-10-05 (1)): es la ÚNICA pantalla del panel pensada para ≤ 390 px.
 *
 * Por qué Playwright y no jsdom: los cinco candados son de LAYOUT (desborde, alto medido de cada control, pie
 * pegajoso a la vista, aviso visible solo bajo `lg`). jsdom no tiene viewport. Las clases que deciden esto las
 * vigila además `ShipPreparationCard.mobile.test.tsx` (vitest), que corre en cada PR sin navegador.
 *
 * El dato que se necesita es UN pedido de envío en `picking` (cubeta «ship»): en mocks son las filas de
 * `mockPreparationQueue`; contra el stack real, `needsSeed` — mismo motivo que `m4-preparation.spec.ts`.
 */

const PHONES = [
  { name: '360×740', size: { width: 360, height: 740 } },
  { name: '390×844', size: { width: 390, height: 844 } },
] as const;

const PREPARE_CTA = t('es', 'admin.m4.prep.ship.prepare.cta');

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, `la pantalla desborda ${scrollW - clientW}px en horizontal`).toBeLessThanOrEqual(clientW);
}

/** La primera tarjeta de ENVÍO de la cola (las de bóveda tienen su propio pie). */
async function firstShipCard(page: Page) {
  const card = page.locator('[data-testid^="prep-order-"][data-kind]').first();
  await expect(card).toBeVisible();
  return card;
}

for (const vp of PHONES) {
  test.describe(`admin · Pedidos por preparar en el celular · ${vp.name}`, () => {
    test.use({ viewport: vp.size });

    test.beforeEach(async ({ page }) => {
      needsSeed('la cola de preparación exige un ShipmentRequest en `picking`');
      await loginAs(page, 'admin');
      await page.goto('/es/admin/m4');
      await expect(page.getByRole('heading', { name: t('es', 'admin.m4.prep.title'), level: 2 })).toBeVisible();
    });

    test('MOB-1 · en «Preparar» nada desborda en horizontal', async ({ page }) => {
      await firstShipCard(page);
      await expectNoHorizontalOverflow(page);
    });

    test('MOB-2 · todo botón y enlace de la tarjeta mide ≥ 44 px de alto', async ({ page }) => {
      const card = await firstShipCard(page);
      const controls = card.locator('button:visible, a:visible');
      const n = await controls.count();
      expect(n, 'la tarjeta no tiene controles: la prueba no mediría nada').toBeGreaterThan(0);
      const short: string[] = [];
      for (let i = 0; i < n; i += 1) {
        const c = controls.nth(i);
        const box = await c.boundingBox();
        if (box && box.height < 44) short.push(`${(await c.innerText()).trim() || (await c.getAttribute('aria-label'))} = ${box.height}px`);
      }
      expect(short, `controles por debajo de 44 px: ${short.join('; ')}`).toEqual([]);
    });

    test('MOB-3 · con la tarjeta en pantalla, «Pedido preparado» se ve sin desplazar (pie pegajoso)', async ({ page }) => {
      // Una tarjeta en el paso 1 (la que tiene «Pedido preparado» en su pie).
      const card = page
        .locator('[data-testid^="prep-order-"][data-kind]')
        .filter({ has: page.getByRole('button', { name: PREPARE_CTA }) })
        .first();
      await expect(card).toBeVisible();
      await card.evaluate((el) => el.scrollIntoView({ block: 'start' }));
      const cta = card.getByRole('button', { name: PREPARE_CTA });
      const box = await cta.boundingBox();
      expect(box, '«Pedido preparado» no tiene caja').not.toBeNull();
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, 'el pie quedó debajo del borde de la pantalla').toBeLessThanOrEqual(vp.size.height);
    });

    test('MOB-4 · la foto abre el visor y se cierra con «Cerrar» y con Esc; sin foto no hay disparador', async ({ page }) => {
      const trigger = page.getByRole('button', { name: /^Ver foto de / }).first();
      await expect(trigger).toBeVisible();
      const name = ((await trigger.getAttribute('aria-label')) ?? '').replace(/^Ver foto de /, '');
      await trigger.click();
      const viewer = page.getByRole('dialog', { name });
      await expect(viewer).toBeVisible();
      await viewer.getByRole('button', { name: t('es', 'admin.m4.prep.photo.close') }).click();
      await expect(viewer).toHaveCount(0);
      await trigger.click();
      await expect(viewer).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(viewer).toHaveCount(0);

      // Una carta sin `imageSmallUrl` (fixture «Machamp») no ofrece disparador.
      await expect(page.getByRole('button', { name: 'Ver foto de Machamp' })).toHaveCount(0);
    });

    test('MOB-5 · /admin/m3 muestra el aviso «pensada para computadora» y /admin/m4 no', async ({ page }) => {
      await expect(page.getByTestId('admin-desktop-only')).toHaveCount(0);
      await page.goto('/es/admin/m3');
      const notice = page.getByTestId('admin-desktop-only');
      await expect(notice).toBeVisible();
      await expect(notice.getByRole('link')).toHaveAttribute('href', /\/admin\/m4$/);
    });
  });
}

test.describe('admin · el aviso de celular NO se ve en escritorio', () => {
  test.use({ viewport: { width: 1280, height: 800 } });
  test('MOB-5 · a 1280 px /admin/m3 no muestra el aviso (lg:hidden)', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m3');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('admin-desktop-only')).toBeHidden();
  });
});
