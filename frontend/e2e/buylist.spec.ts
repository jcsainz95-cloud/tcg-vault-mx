import { test, expect, type Locator, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, needsSeed, MONEY_RE } from './utils/auth';

/**
 * Flujo: buylist (PROJECT §E / AC 12, 13, 33, 34; contrato §6).
 *
 * v1.21-cotizador-master-set: en `raw` (default) el grid YA NO es el buscador plano —
 * es el binder COMPARTIDO de Master Set (mode="quoter"): primero se elige un set en
 * «Buscar set» y cada carta pinta UNA teja por acabado real con su estimado y su botón
 * «Agregar … a la venta». El grid plano (set + búsqueda por texto, filas de acabado,
 * bulk) queda para `graded`/`sealed` (sin variantes por acabado).
 *
 * SC-D2 (ronda TL Stream C): los 8 casos que asumían el grid plano en `raw` (pre-v1.21,
 * helpers searchFor/addCard sobre «Buscar carta» del filtro plano) se migraron — los de
 * comportamiento del grid plano/bulk a `graded` (seleccionan tipo de producto primero) y
 * los de acabados raw al binder quoter (mismos fixtures Base Set). Cero rojos de reposo.
 *
 * Cotizador v2 (Stream C, P-16 — DESIGN_SYSTEM §18.4): el carrito vive en un DRAWER
 * flotante disparado por el FAB (`sell-cart-fab`). Agregar desde la grilla NO abre el
 * drawer — los asserts sobre líneas/total/CTA de enviar deben abrirlo con `openCart(page)`.
 */

/** Cambia el tipo de producto a Gradeada (el grid plano solo existe en graded/sealed). */
async function selectGraded(page: Page) {
  await page.getByLabel(t('es', 'buylist.selectType')).selectOption('graded');
}

/** Busca una carta por texto en la barra de filtros del grid plano (requiere graded/sealed). */
async function searchFor(page: Page, term: string) {
  await page.getByLabel(t('es', 'buylist.searchCards')).fill(term);
  await page.getByRole('button', { name: t('es', 'buylist.searchAction') }).click();
}

/** Etiqueta de fila del grid plano en graded (rowLabel = tipo de producto, no acabado). */
const GRADED_LABEL = t('es', 'buylist.productType.graded');

/** Agrega una carta al carrito desde el grid plano GRADED (clic en la fila = directo al carrito). */
async function addGradedCard(page: Page, term: string) {
  await selectGraded(page);
  await searchFor(page, term);
  await page
    .getByRole('button', { name: t('es', 'buylist.addFinishAria', { name: term, finish: GRADED_LABEL }) })
    .click();
}

/** Abre el binder quoter de Base Set (raw default; fixtures Charizard/Pikachu/Zapdos/Eevee). No-op si ya está abierto. */
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
 * v1.51.4 (D43 · criterio 132a): por debajo del MÍNIMO de compra el CTA no procede. El mínimo es
 * un dial del servidor (`GET /buylist/quote-policy`) y cambia por entorno, así que el smoke no lo
 * hardcodea: sube la CANTIDAD de la línea hasta que el faltante desaparece. Si no hay faltante
 * —ya alcanza, o la política no llegó y la degradación es fail-open— no toca nada.
 */
async function ensureMinimumReached(page: Page) {
  const panel = cartPanel(page);
  const shortfall = panel.getByTestId('buylist-minimum-shortfall');
  const qty = panel.getByRole('spinbutton').first();
  for (const n of [1, 2, 5, 12, 30, 80, 200, 500, 999]) {
    if ((await shortfall.count()) === 0) return;
    await qty.fill(String(n));
  }
  await expect(shortfall, 'el carrito no alcanzó el mínimo ni con la cantidad máxima').toHaveCount(0);
}

/**
 * v1.51.3 (D36/D37): `POST /buylist/requests` exige `addressId`. Con libreta, la UI PRESELECCIONA
 * la predeterminada (el recurrente no teclea nada) y el test solo verifica que la elección existe;
 * sin libreta —posible contra el stack real— captura una INLINE, que queda guardada.
 */
async function choosePickupAddress(scope: Locator) {
  const select = scope.getByLabel(t('es', 'buylist.request.address.label'));
  if ((await select.count()) > 0) {
    await expect(select).not.toHaveValue('');
    return;
  }
  await scope.getByLabel(t('es', 'addresses.line1')).fill('Av. Reforma 222');
  await scope.getByLabel(t('es', 'addresses.city')).fill('Ciudad de México');
  await scope.getByLabel(t('es', 'addresses.state')).fill('CDMX');
  await scope.getByLabel(t('es', 'addresses.postalCode')).fill('06600');
  await scope.getByLabel(t('es', 'addresses.phone')).fill('5555123456');
  await scope.getByRole('button', { name: t('es', 'addresses.save') }).click();
  await expect(scope.getByLabel(t('es', 'buylist.request.address.label'))).toHaveCount(1);
}

/**
 * Descubre y agrega la PRIMERA carta cotizable sin hardcodear nombre/id, vía el grid plano
 * GRADED (env-agnóstico: el binder raw necesita nombres de set del seed; el grid graded
 * solo necesita que exista al menos un set con cartas cotizables): tipo de producto →
 * graded, primer set real del dropdown (GET /buylist/sets → mock o backend real) y clic
 * en la primera fila del grid (Playwright espera a que el batch de estimados la habilite).
 */
async function addFirstSellableCard(page: Page) {
  await selectGraded(page);
  const setSelect = page.getByLabel(t('es', 'buylist.filterBySet'));
  // option[0] es el placeholder "Todos los sets"; option[1] es el primer set real.
  const firstSet = await setSelect.locator('option').nth(1).getAttribute('value');
  if (firstSet) await setSelect.selectOption(firstSet);
  // Primera fila HABILITADA: una carta puede no cotizar en graded (p. ej. fixtures
  // holofoil-only → FINISH_NOT_AVAILABLE por-ítem) y su fila queda deshabilitada sin
  // tumbar el grid — se descubre la primera cotizable, no la primera a secas.
  //
  // ⚠️ Acotado a los botones de AGREGAR por su nombre accesible. Un `getByRole('button',
  // { disabled: false })` a secas también casaba con el «Ver detalle de …» de cada fila (P-43),
  // que está siempre habilitado: el helper abría el pop-up de detalle y NO agregaba nada, y el
  // fallo aparecía después, al buscar el total en un carrito vacío.
  const addPrefix = t('es', 'buylist.addFinishAria', { name: '\u0000', finish: '\u0000' }).split(
    '\u0000',
  )[0];
  const list = page.getByRole('list', { name: t('es', 'buylist.searchResults') });
  const rows = list.getByRole('listitem');
  const addBtn = (row: Locator) =>
    row.getByRole('button', { name: new RegExp(`^${addPrefix}`), disabled: false });

  // ⚠️ Enumerar filas NO auto-espera: `count()`/`innerText()` leen el DOM del instante. El código
  // anterior clicaba `.first()`, que sí auto-espera, y eso TAPABA la ausencia de espera. Se espera
  // explícitamente a que el batch de estimados habilite al menos una fila antes de recorrerlas.
  await expect(addBtn(list).first()).toBeVisible({ timeout: 30_000 });

  // Se elige la fila cotizable MÁS BARATA, no la primera. Motivo money: contra el stack real la
  // curva de compra cotiza de verdad, y una carta cara empuja la solicitud por encima del TOPE AML
  // — la UI entonces exige INE (anverso y reverso) antes de confirmar, que es el guardarraíl
  // AML-1 haciendo su trabajo. El smoke quiere recorrer VENDER de punta a punta, no pelearse con
  // un control de lavado de dinero; la más barata lo deja del lado correcto del tope sin
  // hardcodear ningún monto (sigue siendo descubrimiento puro).
  const count = await rows.count();
  let best: { row: Locator; cents: number } | null = null;
  for (let i = 0; i < count; i += 1) {
    const row = rows.nth(i);
    if ((await addBtn(row).count()) === 0) continue;
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    const m = text.match(/MX\$([\d,]+)\.(\d{2})/);
    const cents = m ? Number(m[1].replace(/,/g, '')) * 100 + Number(m[2]) : Number.MAX_SAFE_INTEGER;
    if (!best || cents < best.cents) best = { row, cents };
  }
  if (!best) throw new Error('No hay ninguna fila cotizable en el grid');
  await addBtn(best.row).first().click();
}

test.describe('buylist · raw = binder Master Set (mode="quoter") + drawer del carrito', () => {
  test('banner persistente "pago tras recepción"', async ({ page }) => {
    await page.goto('/es/buylist');
    await expect(page.getByText(t('es', 'buylist.payAfterReceipt')).first()).toBeVisible();
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
    await expect(page.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();

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

    await expect(page.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.estimateNote'))).toBeVisible();
    await expect(page.getByRole('button', { name: /Enviar solicitud/ })).toBeEnabled();

    // D43 · el bloque de dinero del cotizador: UN SOLO monto y la nota de servicio en palabras.
    // Ni línea de envío, ni resta, ni neto estimado, ni «≈» — y el faltante, si lo hubiera, jamás
    // se expresa en términos de envío.
    const money = cartPanel(page).getByTestId('sell-cart-money');
    await expect(money.getByTestId('buylist-shipping-note')).toHaveText(
      t('es', 'buylist.quote.shippingNote'),
    );
    expect((await money.innerText()).match(/MX\$/g) ?? []).toHaveLength(1);
    expect(await money.innerText()).not.toMatch(/≈|%|[Rr]ecibir[íi]as|[Nn]eto/);
  });

  test('la nota de servicio del envío se lee con el carrito VACÍO (copy estático, sin cifras)', async ({
    page,
  }) => {
    // Sin fixtures ni sesión: la frase no depende de ningún dato, así que corre en cualquier stack.
    await page.goto('/es/buylist');
    await openCart(page);
    const note = cartPanel(page).getByTestId('buylist-shipping-note');
    await expect(note).toHaveText(t('es', 'buylist.quote.shippingNote'));
    expect(await note.innerText()).not.toMatch(/MX\$|%|≈/);
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

  test('guía de EMPAQUE: sleeve y top loader (AC 34) + el paso 4 dice que la etiqueta la ponemos nosotros', async ({
    page,
  }) => {
    await page.goto('/es/buylist');
    // §23.14.6-5: el enlace ya no dice «guía» — en esta página «guía» significa LA ETIQUETA.
    await page.getByRole('button', { name: t('es', 'buylist.shippingGuideLink') }).click();

    // El diálogo de la guía debe mencionar explícitamente sleeve y top loader (AC 34).
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(t('es', 'safeShipping.step1Title')).first()).toBeVisible(); // Sleeve
    await expect(dialog.getByText(t('es', 'safeShipping.step2Title')).first()).toBeVisible(); // Top loader
    // AC 34 también en el MODAL: el bloque NM-only de la página queda tapado por el diálogo,
    // así que la política viaja en el `intro` (§7.13).
    await expect(dialog.getByText(/Near Mint/)).toBeVisible();

    // §23.14.6-4 · D16/D31 — el paso que costaba dinero. El texto viejo mandaba ASEGURAR una
    // etiqueta que nosotros ponemos: quien lo obedecía pagaba dos veces.
    await expect(dialog.getByText(t('es', 'safeShipping.step4Title'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'safeShipping.step4Body'))).toBeVisible();
    // La resta viaja en la MISMA cadena que el ofrecimiento (§23.14.3): este modal no tiene
    // ningún bloque de dinero al lado del cual leerla.
    expect(await dialog.innerText()).toMatch(/se descuenta de tu pago/);
    // Y en ninguna forma le pide al vendedor comprar o asegurar el envío hacia nosotros.
    expect(await dialog.innerText()).not.toMatch(/[Aa]segura por|[Gg]uía con seguro/);

    await expect(
      dialog.getByRole('button', { name: t('es', 'safeShipping.understood') }),
    ).toBeVisible();
  });

  /**
   * §23.3g fila 1-bis · §23.14.6-7 — /buylist en 390px SIN abrir el drawer.
   *
   * En móvil el carrito es un drawer cerrado: sin la instancia de la cabecera, un vendedor
   * podía recorrer la página entera —hero, bounties, binder, políticas, guía— sin leer nunca
   * quién pone el envío. Este test recorre justamente ese camino.
   */
  test('en 390px, con el carrito CERRADO, la regla del envío se lee en la cabecera', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es/buylist');

    // Sin tocar el FAB: en móvil solo existe la instancia de la cabecera.
    const note = page.getByTestId('buylist-shipping-note');
    await expect(note).toHaveCount(1);
    await expect(note).toHaveText(t('es', 'buylist.quote.shippingNote'));
    // D43 intacta: la regla se dice en palabras; la tarifa solo lleva número en la oferta.
    expect(await note.innerText()).not.toMatch(/MX\$|%|≈/);

    // §23.14.2b: el eco retirado de `trustShipping` ya no está en el pie.
    await expect(
      page.getByText('Si una carta se rechaza por no estar en NM, la devolución corre por tu cuenta (7 días).'),
    ).toHaveCount(0);
  });
});

test.describe('buylist · graded/sealed: grid plano (set + búsqueda + bulk)', () => {
  test('el grid lista cada carta con su estimado (una fila por tipo, sin panel COTIZACIÓN)', async ({ page }) => {
    // Doble dependencia, verificada contra el stack vivo: (a) el botón se llama «Agregar E2E
    // Charizard…» con el seed real; (b) la gradeada del seed NO tiene referencia de mercado, así
    // que el grid pinta «Precio pendiente» — que es el comportamiento money-safe CORRECTO, no un
    // fallo: sin dato no se inventa cifra. Por eso no hay importe que afirmar.
    mockOnly('nombre literal «Charizard» + gradeada sin referencia en el seed (estimado pendiente)');
    await page.goto('/es/buylist');
    await selectGraded(page);
    await searchFor(page, 'Charizard');

    // Leyenda del grid + estimado con formato MXN dentro de la lista de resultados,
    // SIN seleccionar nada (el batch cotiza cada carta de la página).
    //
    // ⚠️ Se afirma el FORMATO (`MONEY_RE`), NO el monto. En modo mock el estimado lo produce
    // `fx.mockDemoBuyQuote` —una aproximación de demo de la curva de compra, sin interpolar ni
    // redondear—, así que un assert de monto exacto aquí NO verificaría el precio del producto:
    // verificaría el mock. Las cifras de la curva se comprueban contra el backend real
    // (`E2E_REAL=1`) y en los unitarios del dry-run.
    await expect(page.getByText(t('es', 'buylist.gridEstimateLegend'))).toBeVisible();
    await expect(
      page.getByRole('list', { name: t('es', 'buylist.searchResults') }).getByText(MONEY_RE).first(),
    ).toBeVisible();
    // Una sola fila agregable por carta (graded no tiene variantes por acabado).
    await expect(
      page.getByRole('button', {
        name: t('es', 'buylist.addFinishAria', { name: 'Charizard', finish: GRADED_LABEL }),
      }),
    ).toBeVisible();
  });

  test('bulk: multi-selección en el grid y agregar varias de golpe', async ({ page }) => {
    mockOnly('set literal `base1` y cartas «Charizard»/«Pikachu» del fixture');
    await page.goto('/es/buylist');
    await selectGraded(page);
    await page.getByLabel(t('es', 'buylist.filterBySet')).selectOption('base1');

    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Charizard' }) }).check();
    await page.getByRole('checkbox', { name: t('es', 'buylist.bulkSelect', { name: 'Pikachu' }) }).check();
    await page.getByRole('button', { name: t('es', 'buylist.bulkAddCta', { count: 2 }) }).click();

    await expect(page.getByText(t('es', 'buylist.bulkAdded', { count: 2 }))).toBeVisible();
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();
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
    await expect(drawer.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();

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
    await expect(dialog.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();
    await expect(dialog.getByText(t('es', 'buylist.trustValidity'))).toBeVisible();
    await expect(dialog.getByLabel(/CLABE/)).toBeVisible();
    await expect(dialog.getByText(t('es', 'ine.front'))).toBeVisible(); // INE anverso
    await expect(dialog.getByText(t('es', 'ine.back'))).toBeVisible(); // INE reverso
    // El uploader solo acepta imágenes (backend endurece kyc_ine a image/*).
    await expect(dialog.getByLabel(t('es', 'ine.front'))).toHaveAttribute('accept', 'image/*');
    await expect(dialog.getByText(t('es', 'ine.privacy'))).toBeVisible();

    // D36/D37 · la dirección de ORIGEN se pide AQUÍ (con la CLABE), con su porqué a la vista.
    await expect(dialog.getByText(t('es', 'buylist.request.address.why'))).toBeVisible();
    await choosePickupAddress(dialog);
    // D43 · la MISMA frase del cotizador, carácter por carácter, antes del botón que compromete.
    await expect(dialog.getByTestId('buylist-shipping-note')).toHaveText(
      t('es', 'buylist.quote.shippingNote'),
    );
  });

  /**
   * SMOKE @real — VENDER: descubre la primera carta cotizable (grid plano GRADED,
   * env-agnóstico), la agrega desde su fila y crea la solicitud (`POST /buylist/requests`):
   *  - real: el cliente del seed suele traer CLABE/INE en archivo → el modal usa el atajo
   *    "usar mi CLABE" y se envía directo. Si el backend pidiera CLABE, se captura una válida.
   *  - mock: los fixtures no traen CLABE en archivo → se captura la CLABE en el modal.
   * Viewport alto para que el CTA del modal quede en pantalla (el modal no scrollea internamente).
   */
  test('@real vender: crea la solicitud de venta y muestra confirmación', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');

    // El clic en la fila del grid agrega DIRECTO al carrito (auto-espera al estimado).
    await addFirstSellableCard(page);

    // Estructura: el carrito (drawer, P-16) suma un total ESTIMADO (no un monto de fixture).
    await openCart(page);
    await expect(page.getByText(t('es', 'buylist.quote.money.cardsValue'))).toBeVisible();

    // 132(a): por debajo del mínimo de compra el CTA no procede y la pantalla dice cuánto falta.
    // El mínimo lo fija el servidor, así que el smoke sube cantidad hasta cruzarlo (sin hardcodear).
    await ensureMinimumReached(page);

    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog', { name: t('es', 'buylist.requestTitle') });
    await expect(dialog.getByText(t('es', 'buylist.summaryTitle'))).toBeVisible();

    // D36/D37: sin dirección de origen no se crea la solicitud (el botón está apagado).
    await choosePickupAddress(dialog);

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

/**
 * §23.3g fila 0 · §23.14.6-6 — EL TEASER DEL HOME es cotizador, y D31 exige la regla ahí.
 *
 * El panel se pinta dos veces con estado compartido: columna del hero (`lg`) y sección propia
 * de móvil (`withTrust={false}`). La nota va en el CUERPO del panel, no en la banda de
 * confianza, precisamente porque esa banda no existe en móvil — y una regla de dinero que
 * solo aparece en escritorio no es una regla. Estos dos tests cubren un ancho cada uno.
 */
test.describe('home · teaser del cotizador: el rótulo y la regla del envío (§23.3g fila 0)', () => {
  for (const [label, width, height] of [
    ['escritorio', 1280, 900],
    ['móvil 390px', 390, 844],
  ] as const) {
    test(`en ${label} el teaser dice la regla del envío, sin cifras y con cero cartas`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/es');

      // Copy estático (§23.3k): se pinta sin haber cotizado nada y sin esperar a ningún dato.
      const note = page.getByTestId('buylist-shipping-note').first();
      await expect(note).toBeVisible();
      await expect(note).toHaveText(t('es', 'buylist.quote.shippingNote'));
      // D43 intacta: en el cotizador el envío se dice EN PALABRAS.
      expect(await note.innerText()).not.toMatch(/MX\$|%|≈/);

      // §23.14.2a: el rótulo retirado no revive. Sobre un bruto del que se descuenta el envío,
      // «Te pagamos» promete un depósito — y el vendedor se queda con el número grande.
      await expect(page.getByText('Te pagamos', { exact: true })).toHaveCount(0);
    });
  }
});
