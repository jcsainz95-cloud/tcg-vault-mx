import { test, expect, type Page } from '@playwright/test';
import { t, type Locale } from './utils/i18n';

/**
 * N1 (ux-review de marketing 2026-11-03; medido por el orquestador en producción a 390 px, N=1): en el checkout de
 * invitado «Envío a mi domicilio» era un `<div>` sin control. Tras tocar «Guardar en mi bóveda», PAGAR quedaba
 * deshabilitado y tocar «Envío a mi domicilio» no hacía nada; la única salida quedaba ~740 px más abajo y la dirección
 * seguía a la vista. Aquí, a 390 y 1280 contra el bundle de MOCKS (la conducta es de pantalla, no del backend):
 *  - las dos opciones son botones `aria-pressed` de ≥ 44 px;
 *  - bóveda → «Envío a mi domicilio» → PAGAR habilitado;
 *  - el aviso de bloqueo lleva a esa opción («Elegir envío a domicilio»);
 *  - en modo bóveda la dirección de envío no se ve, y al volver conserva lo capturado.
 * Más el menor de las pestañas: a 390 «GRADEADAS» queda cortada y debe haber indicio de desplazamiento.
 */

async function openCheckoutWithCard(page: Page, locale: Locale = 'es') {
  await page.goto(`/${locale}/catalog`);
  await page.getByRole('button', { name: t(locale, 'catalog.addToCart') }).first().click();
  await page.goto(`/${locale}/checkout`);
  await expect(page.getByLabel(t(locale, 'checkout.guest.email.label'), { exact: true })).toBeVisible();
}

async function confirmEmail(page: Page) {
  await page.getByLabel(t('es', 'checkout.guest.email.label'), { exact: true }).fill('invitado@dominio.com');
  await page.getByRole('checkbox', { name: /Confirmo que/ }).check();
  // Sin foco en un campo de texto: con el teclado «abierto» la barra móvil no se pinta (L2).
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

const PAY_RE = new RegExp(`^${t('es', 'checkout.payNoAmount')}$`);

for (const vp of [
  { width: 390, height: 844 },
  { width: 1280, height: 900 },
] as const) {
  test.describe(`N1 · destino del checkout · ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test(`bóveda → «Envío a mi domicilio» → PAGAR habilitado (${vp.width})`, async ({ page }) => {
      await openCheckoutWithCard(page);
      await confirmEmail(page);
      const region = page.getByRole('region', { name: t('es', 'checkout.destination.eyebrow') });
      const ship = region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.ship')) });
      const vault = region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) });
      const pay = page.getByRole('button', { name: PAY_RE });

      // Objetivos táctiles ≥ 44 px en las dos opciones.
      for (const opt of [ship, vault]) {
        const box = await opt.boundingBox();
        expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      }
      await expect(ship).toHaveAttribute('aria-pressed', 'true');
      await expect(pay).toBeEnabled();
      const recipient = page.getByLabel(t('es', 'checkout.guest.recipientName'));
      await recipient.fill('Ana Pérez');
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());

      await vault.click();
      await expect(vault).toHaveAttribute('aria-pressed', 'true');
      await expect(pay).toBeDisabled();
      await expect(page.getByTestId('vault-upsell')).toBeVisible();
      // En modo bóveda la dirección no se ve.
      await expect(recipient).toBeHidden();

      await ship.click();
      await expect(page.getByTestId('vault-upsell')).toBeHidden();
      await expect(ship).toHaveAttribute('aria-pressed', 'true');
      await expect(vault).toHaveAttribute('aria-pressed', 'false');
      await expect(pay).toBeEnabled();
      // Al volver, lo capturado sigue ahí (el grupo va `hidden`, no se desmonta).
      await expect(recipient).toBeVisible();
      await expect(recipient).toHaveValue('Ana Pérez');
    });

    test(`el aviso de bloqueo lleva a envío a domicilio (${vp.width})`, async ({ page }) => {
      await openCheckoutWithCard(page);
      await confirmEmail(page);
      const region = page.getByRole('region', { name: t('es', 'checkout.destination.eyebrow') });
      await region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) }).click();
      const pay = page.getByRole('button', { name: PAY_RE });
      await expect(pay).toBeDisabled();
      const action = page.getByRole('button', { name: t('es', 'checkout.guest.payBlocked.vaultAction') });
      await expect(action).toBeVisible();
      const box = await action.boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
      if (vp.width < 1024) {
        // La salida va DENTRO de la barra fija, que no crece (≤ 120 px, CHK-MOVIL.2.4).
        const barBox = await page.getByTestId('checkout-pay-bar').boundingBox();
        expect(barBox?.height ?? 999).toBeLessThanOrEqual(120);
      }
      await action.click();
      await expect(pay).toBeEnabled();
      await expect(region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.ship')) })).toBeFocused();
    });
  });
}

/** Luminancia relativa WCAG de un `rgb(a)` ya compuesto sobre `bg` (ambos como [r,g,b,a] de 0–255 / 0–1). */
const CONTRAST_FN = `
  (() => {
    const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); const v = m[1].split(',').map((x) => parseFloat(x));
      return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; };
    const over = (fg, bg) => [0, 1, 2].map((i) => fg[i] * fg[3] + bg[i] * (1 - fg[3])).concat(1);
    const lum = (c) => { const [r, g, b] = c.slice(0, 3).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const bgOf = (el) => { for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c[3] > 0) return c; }
      return [255, 255, 255, 1]; };
    const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    return { parse, over, bgOf, ratio };
  })()`;

/**
 * Cierre de lo que ux-ui encontró en 6b01d17a (2026-11-03, DESIGN_SYSTEM §15.9 / CHK-MOVIL.2.3–2.4), candados que eran
 * NO MEDIDOS. Contra el bundle de MOCKS: es conducta de pantalla.
 */
test.describe('N1b · opción no elegida: un tratamiento y AA (390)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('envío no elegida = bóveda no elegida (color y subrayado), contraste ≥ 4.5:1', async ({ page }) => {
    await openCheckoutWithCard(page);
    const region = page.getByRole('region', { name: t('es', 'checkout.destination.eyebrow') });
    const style = (text: string) =>
      region.getByText(text, { exact: true }).evaluate((el, fn) => {
        // eslint-disable-next-line no-new-func
        const c = new Function(`return (${fn});`)();
        const cs = getComputedStyle(el);
        const bg = c.bgOf(el);
        return { color: cs.color, deco: cs.textDecorationLine, ratio: c.ratio(c.over(c.parse(cs.color), bg), bg) };
      }, CONTRAST_FN);
    const vaultUnchosen = await style(t('es', 'checkout.destination.vault'));
    await region.getByRole('button', { name: new RegExp(t('es', 'checkout.destination.vault')) }).click();
    const shipUnchosen = await style(t('es', 'checkout.destination.ship'));
    expect(shipUnchosen.color, 'mismo color').toBe(vaultUnchosen.color);
    expect(shipUnchosen.deco, 'mismo subrayado').toBe(vaultUnchosen.deco);
    expect(vaultUnchosen.deco).toContain('underline');
    test.info().annotations.push({ type: 'medida', description: `no elegida ${vaultUnchosen.color} ${vaultUnchosen.ratio.toFixed(2)}:1` });
    for (const s of [vaultUnchosen, shipUnchosen]) expect(s.ratio, `contraste ${s.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

for (const locale of ['es', 'en'] as const) {
  for (const width of [320, 360] as const) {
    test.describe(`N1b · barra móvil en bloqueo · ${locale.toUpperCase()} · ${width}`, () => {
      test.use({ viewport: { width, height: 640 } });

      test(`≤ 120 px, salida en ≤ 2 renglones, desglose a un toque y PAGAR con borde discontinuo visible (${locale} ${width})`, async ({ page }) => {
        await openCheckoutWithCard(page, locale);
        const region = page.getByRole('region', { name: t(locale, 'checkout.destination.eyebrow') });
        await region.getByRole('button', { name: new RegExp(t(locale, 'checkout.destination.vault')) }).click();
        const bar = page.getByTestId('checkout-pay-bar');
        const pay = bar.getByRole('button', { name: new RegExp(`^${t(locale, 'checkout.payNoAmount')}$`) });
        await expect(pay).toBeDisabled();

        // Alto ≤ 120 (CHK-MOVIL.2.4) y la salida y la explicación en ≤ 2 renglones.
        expect((await bar.boundingBox())?.height ?? 999).toBeLessThanOrEqual(120);
        const action = bar.getByRole('button', { name: t(locale, 'checkout.guest.payBlocked.vaultAction') });
        const lines = (loc: ReturnType<Page['locator']>) =>
          loc.evaluate((el) => {
            const r = document.createRange();
            r.selectNodeContents(el);
            return new Set([...r.getClientRects()].map((q) => Math.round(q.top))).size;
          });
        expect(await lines(action), 'salida ≤ 2 renglones').toBeLessThanOrEqual(2);
        expect(await lines(bar.getByText(t(locale, 'checkout.guest.payBlocked.vault'), { exact: true })), 'explicación ≤ 2 renglones').toBeLessThanOrEqual(2);
        expect((await action.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);

        // PAGAR apagado: regla discontinua de ≥ 1 px cuyo color, compuesto sobre el fondo, difiere del fondo.
        const border = await pay.evaluate(async (el, fn) => {
          // eslint-disable-next-line no-new-func
          const c = new Function(`return (${fn});`)();
          // `transition-colors`: se mide el estado final, no un fotograma de la transición al apagarse.
          await Promise.all(el.getAnimations().map((a) => a.finished));
          const cs = getComputedStyle(el);
          const bg = c.bgOf(el);
          return {
            style: cs.borderTopStyle,
            width: parseFloat(cs.borderTopWidth),
            ratio: c.ratio(c.over(c.parse(cs.borderTopColor), bg), bg),
          };
        }, CONTRAST_FN);
        const barH = (await bar.boundingBox())?.height;
        test.info().annotations.push({ type: 'medida', description: `barra ${barH} px · borde/fondo ${border.ratio.toFixed(2)}:1` });
        expect(border.style).toBe('dashed');
        expect(border.width).toBeGreaterThanOrEqual(1);
        expect(border.ratio, `borde vs fondo ${border.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(1.5);

        // El desglose sigue a un toque con PAGAR bloqueado, sin hacer crecer la barra.
        const toggle = bar.getByTestId('checkout-pay-bar-total-toggle');
        await expect(toggle).toHaveAccessibleName(new RegExp(t(locale, 'checkout.bar.showBreakdown')));
        expect((await toggle.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-expanded', 'true');
        await expect(bar.getByTestId('checkout-pay-bar-breakdown').getByTestId('amount-breakdown')).toBeVisible();
        expect((await bar.boundingBox())?.height ?? 999).toBeLessThanOrEqual(120);
        await page.keyboard.press('Escape');
        await expect(bar.getByTestId('checkout-pay-bar-breakdown')).toHaveCount(0);
        if (width === 320) await bar.screenshot({ path: test.info().outputPath(`barra-bloqueo-${locale}-320.png`) });
      });
    });
  }
}

test.describe('N1 menor · pestañas de la tienda a 390', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('si la fila no cabe hay indicio de desplazamiento; en «Gradeadas» la pestaña activa se ve entera', async ({ page }) => {
    await page.goto('/es/catalog');
    const nav = page.getByRole('navigation', { name: t('es', 'storeTabs.label') });
    await expect(nav).toBeVisible();
    const overflows = await nav.evaluate((n) => n.scrollWidth > n.clientWidth);
    expect(overflows, 'a 390 las cuatro pestañas no caben (premisa del defecto)').toBe(true);
    await expect(page.getByTestId('store-tabs-more')).toBeVisible();

    await page.goto('/es/catalog?productType=graded');
    const graded = nav.getByRole('link', { name: t('es', 'storeTabs.graded') });
    await expect(graded).toHaveAttribute('aria-current', 'page');
    // El desplazamiento a la activa lo hace un `useEffect` de `StoreTabs` tras hidratar: una lectura única justo tras
    // `goto` corre contra él (QA, release-1103: rojo 10/10 con CPU ×6/×12). Se sondea hasta que la condición se cumpla;
    // lo medido no cambia (entera dentro de la fila y del viewport) y, sin el desplazamiento, nunca se cumple.
    await expect
      .poll(
        () =>
          graded.evaluate((el) => {
            const n = el.parentElement!.getBoundingClientRect();
            const b = el.getBoundingClientRect();
            return b.left >= n.left - 0.5 && b.right <= Math.min(n.right, window.innerWidth) + 0.5;
          }),
        { message: '«Gradeadas» activa entera dentro de la fila' },
      )
      .toBe(true);
  });
});
