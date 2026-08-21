import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, MONEY_RE } from './utils/auth';

/**
 * Flujo: buylist (PROJECT §E / AC 12, 13, 33, 34; contrato §6).
 * Rediseño grid-protagonista (2026-08-17): el grid de resultados manda (scroll natural
 * de página), cada carta lista sus ACABADOS con estimado server-side y el clic en un
 * acabado agrega DIRECTO al carrito (ya no existe el panel "COTIZACIÓN" ni botón
 * "Cotizar"). La transparencia vive en el detalle expandible de cada línea del carrito.
 * "Mis solicitudes" sin sesión muestra una invitación neutra, nunca error.
 *
 * Cotizador v2 (Stream C, P-16 — DESIGN_SYSTEM §18.4): el carrito YA NO es columna
 * lateral; vive en un DRAWER flotante disparado por el FAB (`sell-cart-fab`). Agregar
 * desde la grilla NO abre el drawer — los asserts sobre líneas/total/CTA de enviar deben
 * abrirlo primero con `openCart(page)`.
 */

/** Busca una carta por texto en la barra de filtros. */
async function searchFor(page: Page, term: string) {
  await page.getByLabel(t('es', 'buylist.searchCards')).fill(term);
  await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
}

/** Agrega una carta al carrito clicando la fila de su acabado (clic = directo al carrito). */
async function addCard(page: Page, term: string, finish = 'Normal') {
  await searchFor(page, term);
  await page
    .getByRole('button', { name: t('es', 'buylist.addFinishAria', { name: term, finish }) })
    .click();
}

/** Abre el DRAWER del carrito con el FAB (P-16, §18.4): el carrito ya no es columna lateral. */
async function openCart(page: Page) {
  await page.getByTestId('sell-cart-fab').click();
}

/**
 * Descubre y agrega la PRIMERA carta del catálogo sin hardcodear nombre/id: filtra por
 * el primer set real (el dropdown se puebla de GET /buylist/sets → mock o backend real)
 * y clica la primera fila de acabado del grid (Playwright espera a que esté habilitada,
 * es decir, a que el batch de estimados haya llegado). Env-agnóstico (mock y real).
 */
async function addFirstSellableCard(page: Page) {
  const setSelect = page.getByLabel(t('es', 'buylist.filterBySet'));
  // option[0] es el placeholder "Todos los sets"; option[1] es el primer set real.
  const firstSet = await setSelect.locator('option').nth(1).getAttribute('value');
  if (firstSet) await setSelect.selectOption(firstSet);
  await page
    .getByRole('list', { name: t('es', 'buylist.searchResults') })
    .getByRole('button')
    .first()
    .click();
}

test.describe('buylist · grid protagonista (cotización directa al carrito)', () => {
  test('banner persistente "pago tras recepción"', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.payAfterReceipt')).first()).toBeVisible();
  });

  test('el grid lista acabados con su estimado por carta (sin panel COTIZACIÓN)', async ({ page }) => {
    await page.goto('/es/buylist');
    await searchFor(page, 'Charizard');

    // Leyenda del grid + estimado con formato MXN dentro de la lista de resultados,
    // SIN seleccionar nada (el batch cotiza cada acabado de la página).
    await expect(page.getByText(t('es', 'buylist.gridEstimateLegend'))).toBeVisible();
    await expect(
      page.getByRole('list', { name: t('es', 'buylist.searchResults') }).getByText(MONEY_RE).first(),
    ).toBeVisible();
    // Una fila agregable por acabado de la carta (Charizard existe en varios).
    await expect(
      page.getByRole('button', {
        name: t('es', 'buylist.addFinishAria', { name: 'Charizard', finish: 'Normal' }),
      }),
    ).toBeVisible();
  });

  test('clic en un acabado agrega DIRECTO al carrito; el detalle expandible muestra referencia y regla', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    await addCard(page, 'Charizard');

    // La línea entra directo al carrito (anuncio en página); el drawer NO se abre solo —
    // el contador del FAB sube y el carrito se revisa abriéndolo (P-16, §18.4a).
    await expect(page.getByText(t('es', 'buylist.addedLine', { name: 'Charizard', finish: 'Normal' }))).toBeVisible();
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();

    // Transparencia: el detalle expandible trae valor de referencia + regla aplicada.
    await page.getByRole('button', { name: t('es', 'buylist.lineDetailShow') }).click();
    await expect(page.getByText(t('es', 'buylist.referencePrice'), { exact: true })).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.appliedRuleLabel'), { exact: true })).toBeVisible();
    await expect(page.getByText('40% de referencia')).toBeVisible();
  });

  test('la misma carta en DISTINTO acabado entra como línea separada del carrito', async ({ page }) => {
    await page.goto('/es/buylist');
    await addCard(page, 'Charizard');
    await page
      .getByRole('button', {
        name: t('es', 'buylist.addFinishAria', { name: 'Charizard', finish: 'Reverse Holo' }),
      })
      .click();

    // Dos líneas en el carrito (dos botones "Quitar") — dentro del drawer (P-16).
    await openCart(page);
    await expect(page.getByRole('button', { name: t('es', 'buylist.removeLine') })).toHaveCount(2);
  });

  test('bulk: multi-selección en el grid y agregar varias de golpe', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByLabel(t('es', 'buylist.filterBySet')).selectOption('base1');

    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Charizard' }) }).check();
    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Pikachu' }) }).check();
    await page.getByRole('button', { name: t('es', 'buylist.bulkAddCta', { count: 2 }) }).click();

    await expect(page.getByText(t('es', 'buylist.bulkAdded', { count: 2 }))).toBeVisible();
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
  });

  test('agrega varias cartas al carrito y suma un total estimado', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    await addCard(page, 'Charizard');
    await addCard(page, 'Pikachu');
    await openCart(page);

    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.estimateNote'))).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeEnabled();
  });

  test('carta sin referencia entra a "precio pendiente" (estimado pendiente, backend lo fija)', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // Zapdos tiene referencia pendiente en los fixtures: su fila lo dice y sigue agregable.
    await searchFor(page, 'Zapdos');
    await expect(
      page
        .getByRole('list', { name: t('es', 'buylist.searchResults') })
        .getByText(t('es', 'buylist.linePending'))
        .first(),
    ).toBeVisible();

    await page
      .getByRole('button', { name: t('es', 'buylist.addFinishAria', { name: 'Zapdos', finish: 'Normal' }) })
      .click();
    // El detalle expandible (en el drawer) explica el pendiente (el monto lo fija la plataforma).
    await openCart(page);
    await page.getByRole('button', { name: t('es', 'buylist.lineDetailShow') }).click();
    await expect(page.getByText(t('es', 'buylist.pricePendingNotice'))).toBeVisible();
  });

  test('"Mis solicitudes" sin sesión: invitación neutra a iniciar sesión, nunca error', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.requestsLoginInvite'))).toBeVisible();
    // Acotado a #main (wrapper del storefront layout): en `npm run dev` el overlay de
    // Next.js Dev Tools inyecta su propio role="alert" fuera del contenido de la app,
    // y un getByRole('alert') a nivel página daría falso positivo siempre.
    await expect(page.locator('#main').getByRole('alert')).toHaveCount(0);
  });

  test('guía de envío seguro menciona sleeve y top loader', async ({ page }) => {
    await page.goto('/es/buylist');
    await page.getByRole('button', { name: t('es', 'buylist.shippingGuideLink') }).click();

    // El diálogo de la guía debe mencionar explícitamente sleeve y top loader (AC 34).
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('es', 'safeShipping.step1Title')).first()).toBeVisible(); // Sleeve
    await expect(dialog.getByText(t('es', 'safeShipping.step2Title')).first()).toBeVisible(); // Top loader
    await expect(
      dialog.getByRole('button', { name: t('es', 'safeShipping.understood') }),
    ).toBeVisible();
  });
});

test.describe('buylist · cotizador v2: FAB + drawer del carrito (Stream C, P-14/P-16 — §18.11.3)', () => {
  test('smoke: agregar desde la teja → badge del FAB sube → drawer con FinishMark → cerrar regresa el foco', async ({
    page,
  }) => {
    await page.goto('/es/buylist');

    // Binder quoter (raw, default): elegir Base Set desde su propio índice «Buscar set».
    await page.getByLabel(t('es', 'masterSet.searchSet')).fill('Base');
    await page.getByRole('button', { name: /Base Set/ }).first().click();

    // Teja de la variante Reverse Holo: banda de acabado (P-14, §18.3) + botón Agregar
    // propio (Playwright espera a que el batch de estimados lo habilite).
    await page
      .getByRole('button', { name: /^Agregar Charizard \(Reverse Holo\) a la venta/ })
      .click();

    // §18.4a: el contador del FAB sube (aria-label) SIN abrir el drawer.
    const fab = page.getByTestId('sell-cart-fab');
    await expect(fab).toHaveAttribute(
      'aria-label',
      t('es', 'buylist.cartFab.ariaWithCount', { count: 1 }),
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Abrir el drawer: la línea trae su FinishMark (banda reverse + etiqueta mono) y el total.
    await openCart(page);
    const drawer = page.getByRole('dialog', {
      name: t('es', 'buylist.cartDrawer.ariaLabel', { count: 1 }),
    });
    await expect(drawer.getByTestId('finish-band')).toHaveAttribute('data-finish', 'reverse_holo');
    await expect(drawer.getByText('Reverse', { exact: true })).toBeVisible();
    await expect(drawer.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();

    // Cerrar (botón 44px): el diálogo desaparece y el foco REGRESA al FAB (§18.4b).
    await drawer.getByRole('button', { name: t('es', 'buylist.cartDrawer.close') }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(fab).toBeFocused();
  });
});

test.describe('buylist · solicitud con KYC/INE (AC 14; contrato §6/§8)', () => {
  test('el paso de solicitud muestra RESUMEN + CLABE + INE (anverso/reverso) con aviso de privacidad', async ({
    page,
  }) => {
    // Mock-only: asume KYC sin CLABE/INE en archivo (fixtures) para mostrar ambos uploaders.
    // El seed real puede traer CLABE/INE en archivo → el modal usa atajos (cubierto por @real).
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    // Charizard tiene referencia → su fila trae estimado y el clic la agrega al carrito.
    await addCard(page, 'Charizard');
    // Enviar desde el DRAWER del carrito (P-16) abre el resumen + KYC/CLABE una sola vez
    // (abrir el modal cierra el drawer: un solo focus trap activo, §18.4b).
    await openCart(page);
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog');
    // Resumen de la venta antes de confirmar (cartas + total + vigencia).
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'buylist.trustValidity'))).toBeVisible();
    await expect(dialog.getByLabel(/CLABE/)).toBeVisible();
    await expect(dialog.getByText(t('es', 'ine.front'))).toBeVisible(); // INE anverso
    await expect(dialog.getByText(t('es', 'ine.back'))).toBeVisible(); // INE reverso
    // El uploader solo acepta imágenes (backend endurece kyc_ine a image/*).
    await expect(dialog.getByLabel(t('es', 'ine.front'))).toHaveAttribute('accept', 'image/*');
    await expect(dialog.getByText(t('es', 'ine.privacy'))).toBeVisible();
  });

  /**
   * SMOKE @real — VENDER: descubre la primera carta, la agrega desde su fila de acabado
   * y crea la solicitud (`POST /buylist/requests`). Env-agnóstico:
   *  - real: el cliente del seed suele traer CLABE/INE en archivo → el modal usa el atajo
   *    "usar mi CLABE" y se envía directo. Si el backend pidiera CLABE, se captura una válida.
   *  - mock: los fixtures no traen CLABE en archivo → se captura la CLABE en el modal.
   * Viewport alto para que el CTA del modal quede en pantalla (el modal no scrollea internamente).
   */
  test('@real vender: crea la solicitud de venta y muestra confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');

    // El clic en la fila de acabado agrega DIRECTO al carrito (auto-espera al estimado).
    await addFirstSellableCard(page);

    // Estructura: el carrito (drawer, P-16) suma un total ESTIMADO (no un monto de fixture).
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();

    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog', { name: t('es', 'buylist.requestTitle') });
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();

    // CLABE: si el modal pide capturarla (sin CLABE en archivo), se llena una válida.
    const clabeInput = dialog.getByLabel(/CLABE/);
    if (await clabeInput.count()) {
      await clabeInput.first().fill('002010077777777771');
    }

    await dialog.getByRole('button', { name: t('es', 'buylist.submit') }).click();
    await expect(page.getByText(t('es', 'buylist.created'))).toBeVisible();
  });
});
