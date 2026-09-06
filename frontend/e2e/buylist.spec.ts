import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * Flujo: buylist (PROJECT §E / AC 12, 13, 33, 34; contrato §6).
 *
 * v1.21-cotizador-master-set: el grid del cotizador es el binder COMPARTIDO de Master Set
 * (mode="quoter"): primero se elige un set en «Buscar set» y cada carta pinta UNA teja por
 * acabado real con su estimado y su botón «Agregar … a la venta».
 *
 * ⚠️ v1.53 (MONEY — contrato §6, ARCHITECTURE §4.40): EL COTIZADOR COMPRA RAW Y SOLO RAW.
 * Se retiró el selector «Tipo de producto» y, con él, el grid plano de `graded`/`sealed` (barra de
 * filtros set+texto y bulk) — junto con los dos casos que lo ejercitaban aquí. Motivo, y no es
 * cosmético: ningún DTO de buylist tuvo jamás dónde capturar QUÉ grado es un slab, así que el
 * backend caía a `graded:PSA:10` —el grado más caro— y el cotizador ofrecía ese precio por
 * cualquier graduada. `PROJECT.md` §E, §K LOCKED y el criterio 61 nunca autorizaron esa compra.
 * El smoke @real de VENDER se migró a este mismo binder (ver `addCheapestSellableCard`).
 *
 * Cotizador v2 (Stream C, P-16 — DESIGN_SYSTEM §18.4): el carrito vive en un DRAWER
 * flotante disparado por el FAB (`sell-cart-fab`). Agregar desde la grilla NO abre el
 * drawer — los asserts sobre líneas/total/CTA de enviar deben abrirlo con `openCart(page)`.
 */

/**
 * Abre el binder quoter de Base Set. Env-agnóstico a propósito: «Base» filtra el índice tanto en
 * mock (`Base Set`) como contra el seed real (`E2E Base Set`, §4.22e). No-op si ya está abierto.
 */
async function openBaseSet(page: Page) {
  const searchSet = page.getByLabel(t('es', 'masterSet.searchSet'));
  if ((await searchSet.count()) === 0) return; // binder ya abierto
  await searchSet.fill('Base');
  await page.getByRole('button', { name: /Base Set/ }).first().click();
}

/**
 * Agrega una carta al carrito clicando su teja de acabado en el binder quoter (raw).
 * Playwright espera a que el batch de estimados habilite el botón «Agregar … a la venta».
 */
async function addFromBinder(page: Page, name: string, finish = 'Normal') {
  await openBaseSet(page);
  await page
    .getByRole('button', { name: new RegExp(`^Agregar ${name} \\(${finish}\\) a la venta`) })
    .click();
}

/**
 * Localizador del carrito de venta **agnóstico del layout**. El carrito tiene DOS encarnaciones
 * (`BuylistView`, mitigación H1): en **desktop (≥1024px)** es un `<aside>` fijo siempre visible; en
 * **móvil** es un `role="dialog"` que abre el FAB. Ambos comparten el MISMO `SellCartContents` y el
 * MISMO `aria-label`, así que se localiza por ahí en vez de por rol — que es lo único que cambia.
 */
function cartPanel(page: Page) {
  // El aria-label lleva el conteo («Carrito de venta (2)»), así que se ancla por prefijo.
  const prefix = t('es', 'buylist.cartDrawer.ariaLabel', { count: 0 }).replace(/\s*\(0\)\s*$/, '');
  return page.locator(`[aria-label^="${prefix}"]`);
}

/**
 * Deja el carrito VISIBLE, sea cual sea el viewport. En móvil abre el drawer con el FAB; en
 * desktop no hay nada que abrir (el `<aside>` ya está en pantalla).
 *
 * Antes clicaba el FAB a secas y, con el viewport por defecto de la suite (1280×800), ese FAB
 * **no existe** — el carrito es la columna lateral. De ahí el timeout de ocho specs.
 */
async function openCart(page: Page) {
  const fab = page.getByTestId('sell-cart-fab');
  if ((await fab.count()) > 0) {
    await fab.click();
    return;
  }
  await expect(cartPanel(page)).toBeVisible();
}

/**
 * Descubre y agrega una carta cotizable del BINDER QUOTER sin hardcodear nombre/id ni monto.
 *
 * v1.53 (§4.40): antes esto pasaba por el grid plano GRADED —el único con «Filtrar por set» y
 * filas de una línea—, que era precisamente la superficie que este pase cierra. Ahora recorre el
 * mismo binder raw que usa el resto del cotizador.
 *
 * Se elige la teja cotizable MÁS BARATA, no la primera. Motivo money: contra el stack real la curva
 * de compra cotiza de verdad, y una carta cara empuja la solicitud por encima del TOPE AML — la UI
 * entonces exige INE (anverso y reverso) antes de confirmar, que es el guardarraíl AML-1 haciendo
 * su trabajo. El smoke quiere recorrer VENDER de punta a punta, no pelearse con un control de
 * lavado de dinero; la más barata lo deja del lado correcto del tope SIN hardcodear ningún monto.
 *
 * El precio viaja en el `aria-label` de la teja (`quoterAddAria`: «Agregar X (Normal) a la venta ·
 * MX$…»), así que filtrar por `MX$` deja fuera —sin nombrarlas— las tejas en «Precio pendiente»,
 * que son agregables pero no aportan total. Si el set no tuviera NINGUNA cotizada (posible contra
 * un seed sin referencias de mercado), se cae a la primera teja habilitada: money-safe igual
 * (pendiente ⇒ lo fija la plataforma al recibir), y el flujo de venta se recorre igual.
 */
async function addCheapestSellableCard(page: Page) {
  await openBaseSet(page);

  // `disabled: false` en ambos: una teja sin cotización resuelta queda inhábil y clicarla haría
  // que Playwright esperase a que se habilitara hasta agotar el timeout (mide el arnés, no el
  // producto). El precio va en el `aria-label`, así que el filtro por `MX$` es también el filtro
  // «esta sí cotizó».
  const priced = page.getByRole('button', { name: /a la venta · MX\$/, disabled: false });
  const anyTile = page.getByRole('button', { name: / a la venta · /, disabled: false });
  // El batch de estimados del binder tiene que resolver antes de leer nada: `count()` NO
  // auto-espera (lee el DOM del instante), así que se espera a la primera teja explícitamente.
  await expect(anyTile.first()).toBeVisible({ timeout: 30_000 });

  if ((await priced.count()) === 0) {
    await anyTile.first().click();
    return;
  }

  const labels = await priced.evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label') ?? ''),
  );
  let bestIndex = 0;
  let bestCents = Number.MAX_SAFE_INTEGER;
  labels.forEach((label, i) => {
    const m = label.match(/MX\$([\d,]+)\.(\d{2})/);
    if (!m) return;
    const cents = Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]);
    if (cents < bestCents) {
      bestCents = cents;
      bestIndex = i;
    }
  });
  await priced.nth(bestIndex).click();
}

test.describe('buylist · raw = binder Master Set (mode="quoter") + drawer del carrito', () => {
  test('banner persistente "pago tras recepción"', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.payAfterReceipt')).first()).toBeVisible();
  });

  /**
   * v1.53 (§4.40) — CANDADO de la superficie cerrada, medido en el navegador y no en jsdom.
   * La página de venta NO ofrece elegir tipo de producto: no hay selector, ni opción «Gradeada»
   * ni «Sellado». Si alguien lo remonta, este test se pone rojo antes de que el cotizador vuelva
   * a prometer un precio de PSA 10 por un slab cuyo grado nunca preguntamos.
   */
  test('v1.53: la página de venta NO ofrece gradeada ni sellado (superficie raw-only)', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // El binder (la única búsqueda del cotizador) ya está en pantalla…
    await expect(page.getByLabel(t('es', 'masterSet.searchSet'))).toBeVisible();
    // …y el selector de tipo, con sus dos opciones prohibidas, no existe en ninguna forma.
    await expect(page.getByLabel('Tipo de producto')).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Gradeada' })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Sellado' })).toHaveCount(0);
  });

  test('clic en una teja de acabado agrega DIRECTO al carrito; el detalle expandible muestra la referencia', async ({
    page,
  }) => {
    mockOnly('carta literal «Charizard» del fixture (el seed real la llama «E2E Charizard»)');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard');

    // La línea entra directo al carrito (anuncio en página); el drawer NO se abre solo —
    // el contador del FAB sube y el carrito se revisa abriéndolo (P-16, §18.4a).
    await expect(page.getByText(t('es', 'buylist.addedLine', { name: 'Charizard', finish: 'Normal' }))).toBeVisible();
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();

    // Transparencia: el detalle expandible trae el valor de referencia y el acabado.
    // v2.0 (P-48): la fila «Regla aplicada» SE RETIRÓ — no hay reglas por rareza/acabado, hay una
    // curva; dejar el rótulo habría sido, otra vez, texto que promete lo que el sistema no hace.
    await page.getByRole('button', { name: t('es', 'buylist.lineDetailShow') }).click();
    await expect(page.getByText(t('es', 'buylist.referencePrice'), { exact: true })).toBeVisible();
    await expect(page.getByText('Regla aplicada')).toHaveCount(0);
  });

  test('la misma carta en DISTINTO acabado entra como línea separada del carrito', async ({ page }) => {
    mockOnly('carta literal «Charizard» del fixture con normal + reverse holo');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard', 'Normal');
    await addFromBinder(page, 'Charizard', 'Reverse Holo');

    // Dos líneas en el carrito (dos botones "Quitar") — dentro del drawer (P-16).
    await openCart(page);
    await expect(page.getByRole('button', { name: t('es', 'buylist.removeLine') })).toHaveCount(2);
  });

  test('agrega varias cartas al carrito y suma un total estimado', async ({ page }) => {
    mockOnly('cartas literales «Charizard» y «Pikachu» del fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard');
    await addFromBinder(page, 'Pikachu');
    await openCart(page);

    await expect(page.getByText(t('es', 'buylist.totalEstimated'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.estimateNote'))).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeEnabled();
  });

  test('carta sin referencia entra a "precio pendiente" (estimado pendiente, backend lo fija)', async ({
    page,
  }) => {
    mockOnly('«Zapdos» con referencia PENDIENTE es un estado fabricado por el fixture');
    await page.goto('/es/buylist');
    // Zapdos tiene referencia pendiente en los fixtures: su teja lo dice y sigue agregable.
    await openBaseSet(page);
    await expect(page.getByText(t('es', 'masterSet.quoterPending')).first()).toBeVisible();

    await addFromBinder(page, 'Zapdos', 'Holofoil');
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
  // El FAB + drawer es la encarnación MÓVIL del carrito: arriba de 1024px el carrito es el
  // `<aside>` fijo y el FAB ni se monta (`isDesktopCart`, mitigación H1). Este bloque describe
  // literalmente «badge del FAB» y «cerrar regresa el foco al FAB», así que corre en el viewport
  // donde ese comportamiento existe — el 390px de los patrones móviles de §20.11.
  test.use({ viewport: { width: 390, height: 844 } });

  test('smoke: agregar desde la teja → badge del FAB sube → drawer con FinishMark → cerrar regresa el foco', async ({
    page,
  }) => {
    mockOnly('teja literal «Charizard (Reverse Holo)» del fixture');
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
    // Y además arranca agregando la carta literal «Charizard» del fixture.
    mockOnly('KYC vacío + carta literal «Charizard» del fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    // Charizard tiene referencia → su teja del binder trae estimado y el clic la agrega al carrito.
    await addFromBinder(page, 'Charizard');
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
   * SMOKE @real — VENDER: descubre la carta cotizable más barata del binder quoter (raw,
   * env-agnóstico), la agrega desde su teja y crea la solicitud (`POST /buylist/requests`):
   *  - real: el cliente del seed suele traer CLABE/INE en archivo → el modal usa el atajo
   *    "usar mi CLABE" y se envía directo. Si el backend pidiera CLABE, se captura una válida.
   *  - mock: los fixtures no traen CLABE en archivo → se captura la CLABE en el modal.
   * Viewport alto para que el CTA del modal quede en pantalla (el modal no scrollea internamente).
   */
  test('@real vender: crea la solicitud de venta y muestra confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');

    // El clic en la teja del binder agrega DIRECTO al carrito (auto-espera al estimado).
    await addCheapestSellableCard(page);

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

    // Dos desenlaces LEGÍTIMOS, y el test afirma en ambos (ninguno es un no-op):
    //  (a) la solicitud se crea → confirmación;
    //  (b) el estimado cruzó el TOPE AML y la UI exige INE antes de confirmar (AML-1). Eso NO es
    //      un fallo del producto: es el guardarraíl de dinero saliente funcionando. Lo que el test
    //      exige entonces es que el bloqueo sea HONESTO — mensaje accionable, la sección de INE
    //      ofrecida, y NINGUNA confirmación de solicitud creada.
    const created = page.getByText(t('es', 'buylist.created'));
    const ineRequired = dialog.getByText(t('es', 'buylist.ineRequiredError'));
    await expect(created.or(ineRequired).first()).toBeVisible();

    if (await ineRequired.count()) {
      await expect(dialog.getByText(t('es', 'buylist.ineSectionTitle'))).toBeVisible();
      await expect(dialog.getByText(t('es', 'ine.front'))).toBeVisible();
      await expect(dialog.getByText(t('es', 'ine.back'))).toBeVisible();
      // Money-safe: sin INE la solicitud NO se creó.
      await expect(created).toHaveCount(0);
    } else {
      await expect(created).toBeVisible();
    }
  });
});
