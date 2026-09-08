import { test, expect, type Locator, type Page } from '@playwright/test';
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
  /*
   * ⚠️ `:not(button)` NO es cosmético: el **FAB** se rotula «Carrito de venta, 1 carta(s)»
   * (`buylist.cartFab.ariaWithCount`), que empieza por el MISMO prefijo que el panel. Con el
   * drawer abierto el selector resolvía a DOS elementos —el diálogo y el botón que lo abre— y
   * cualquier aserción sobre «el carrito» reventaba por strict mode… o, peor, pasaba mirando el
   * botón en vez del panel. El carrito es un `dialog`/`aside`; el FAB es el mando que lo abre.
   */
  return page.locator(`[aria-label^="${prefix}"]:not(button)`);
}

/**
 * Deja el carrito VISIBLE, sea cual sea el viewport. En móvil abre el drawer con el FAB; en
 * desktop no hay nada que abrir (el `<aside>` ya está en pantalla).
 *
 * Antes clicaba el FAB a secas y, con el viewport por defecto de la suite (1280×800), ese FAB
 * **no existe** — el carrito es la columna lateral. De ahí el timeout de ocho specs.
 */
async function openCart(page: Page) {
  const panel = cartPanel(page);
  const fab = page.getByTestId('sell-cart-fab');
  /*
   * ⚠️ **Se persigue el ESTADO FINAL —el carrito visible—, no una secuencia de clics.**
   * Qué superficie monta el carrito (FAB + drawer en móvil, `<aside>` fijo en escritorio) lo
   * decide una medición del viewport en cliente, así que **durante la hidratación el primer
   * render puede pintar el FAB y sustituirlo por el panel medio segundo después**. La versión
   * anterior leía `fab.count()` en ese instante y clicaba: Playwright encontraba el elemento ya
   * **desprendido del DOM** («element was detached from the DOM, retrying») y agotaba el
   * tiempo esperando a un botón que había dejado de existir.
   *
   * Se espera a que la superficie se decida, se pulsa el FAB **solo si sigue ahí**, y el fallo
   * de ese clic **no es un fallo del test**: si el FAB desapareció es porque el panel fijo tomó
   * su lugar, y el carrito ya está a la vista. Lo que se asevera al final es lo único que los
   * llamadores necesitan.
   */
  await expect(panel.or(fab).first()).toBeVisible();
  if (await fab.isVisible().catch(() => false)) {
    await fab.click({ timeout: 5_000 }).catch(() => {});
  }
  await expect(panel).toBeVisible();
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
  /*
   * ⚠️ El mensaje de fallo NOMBRA LA CAUSA, porque la versión anterior («no alcanzó el mínimo»)
   * se leía como un defecto del cotizador y no lo era: una línea en `precio_pendiente` **no suma
   * al total por diseño** (§23.3h — el front no inventa un precio y no pinta `MX$0.00`), así que
   * `cantidad × 0 = 0` **por muchas veces que se suba la cantidad**. Cuando eso pasa el defecto
   * está en QUÉ CARTA agregó el helper, nunca en la aritmética.
   */
  const money = (await panel.getByTestId('sell-cart-money').innerText()).replace(/\s+/g, ' ');
  await expect(
    shortfall,
    `el carrito no alcanzó el mínimo ni con la cantidad máxima. Bloque de dinero: «${money}». ` +
      'Si el total dice «precio pendiente», la línea NO suma por diseño (§23.3h) y subir la ' +
      'cantidad no puede cruzar el mínimo: revisa qué carta agregó el helper, no el cotizador.',
  ).toHaveCount(0);
}

/**
 * v1.51.3 (D36/D37): `POST /buylist/requests` exige `addressId`. Con libreta, la UI PRESELECCIONA
 * la predeterminada (el recurrente no teclea nada) y el test solo verifica que la elección existe;
 * sin libreta —posible contra el stack real— captura una INLINE, que queda guardada.
 */
async function choosePickupAddress(scope: Locator) {
  const select = scope.getByLabel(t('es', 'buylist.request.address.label'));
  const line1 = scope.getByLabel(t('es', 'addresses.line1'));
  /*
   * ⚠️ **Se espera a que el campo SE DECIDA antes de ramificar.** La libreta llega por red
   * (`GET /users/me/addresses`) y `count()` **no auto-espera**: lee el DOM del instante. Con la
   * petición en vuelo devolvía 0, el helper se iba por la rama de «no hay libreta» y tecleaba en
   * un formulario inline que **nunca existió** — el `Select` aparecía medio segundo después. El
   * rojo salía como «no encuentro Calle y número», que no tiene nada que ver con la causa.
   * Las dos ramas son excluyentes por construcción (con direcciones ⇒ `Select`; sin ninguna ⇒
   * alta inline), así que basta con esperar a que asome cualquiera de las dos.
   */
  await expect(select.or(line1).first()).toBeVisible();
  if ((await select.count()) > 0) {
    await expect(select).not.toHaveValue('');
    return;
  }
  await line1.fill('Av. Reforma 222');
  await scope.getByLabel(t('es', 'addresses.city')).fill('Ciudad de México');
  await scope.getByLabel(t('es', 'addresses.state')).fill('CDMX');
  await scope.getByLabel(t('es', 'addresses.postalCode')).fill('06600');
  await scope.getByLabel(t('es', 'addresses.phone')).fill('5555123456');
  await scope.getByRole('button', { name: t('es', 'addresses.save') }).click();
  await expect(scope.getByLabel(t('es', 'buylist.request.address.label'))).toHaveCount(1);
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
 * (pendiente ⇒ lo fija la plataforma al recibir).
 *
 * ⚠️ **Devuelve si la carta agregada TIENE PRECIO**, y el llamador lo necesita desde v1.51.4 (D43):
 * con el mínimo de compra, una línea en `precio_pendiente` **no suma al total por diseño** (§23.3h
 * — no se inventa precio ni se pinta `MX$0.00`), así que `cantidad × 0 = 0` por muchas veces que
 * `ensureMinimumReached` suba la cantidad, el CTA se queda apagado y el rojo aparece nueve pasos
 * más tarde disfrazado de «el cotizador no suma». Falta de DATO ≠ defecto de producto: el smoke se
 * salta cuando no hay ninguna teja con precio, en vez de morir lejos de la causa.
 */
async function addCheapestSellableCard(page: Page): Promise<boolean> {
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
    return false;
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
  return true;
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
  /**
   * §23.14.6-7 (v2.3.8) — **EXACTAMENTE UNA nota visible por pantalla: ni cero, ni dos.**
   *
   * La invariante nueva es más fuerte y más simple de comprobar que la vieja (*al menos una*), y
   * se asevera sobre **nodos VISIBLES**, no presentes: a 1280px el home tiene dos en el DOM y
   * solo una a la vista — medir presencia fue exactamente lo que produjo un diagnóstico falso.
   * El desempate: **gana la instancia más cercana a la decisión**.
   */
  for (const [label, width, height, host] of [
    ['390px · drawer CERRADO', 390, 844, 'buylist-header'],
    ['1280px · panel fijo', 1280, 900, 'cart-money'],
  ] as const) {
    test(`§23.3g-bis · ${label} ⇒ una sola nota, la de «${host}»`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await page.goto('/es/buylist');

      const visible = page.getByTestId('buylist-shipping-note').filter({ visible: true });
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('data-note-surface', host);
      await expect(visible).toHaveText(t('es', 'buylist.quote.shippingNote'));
      // D43 intacta: la regla se dice en palabras; la tarifa solo lleva número en la oferta.
      expect(await visible.innerText()).not.toMatch(/MX\$|%|≈/);

      // §23.14.2b: el eco retirado de `trustShipping` ya no está en el pie.
      await expect(
        page.getByText('Si una carta se rechaza por no estar en NM, la devolución corre por tu cuenta (7 días).'),
      ).toHaveCount(0);
    });
  }

  test('§23.3g-bis · 390px con el DRAWER ABIERTO ⇒ la nota es la del bloque de dinero', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/es/buylist');
    await openCart(page);

    const visible = page.getByTestId('buylist-shipping-note').filter({ visible: true });
    await expect(visible).toHaveCount(1);
    await expect(visible).toHaveAttribute('data-note-surface', 'cart-money');
  });

  /**
   * §23.14.6-6 — el TEASER del home. Los dos montajes del panel son **por diseño** y a cada ancho
   * hay uno oculto; lo que se comprueba es **la instancia visible**, nunca «la primera».
   * *(Este es el caso exacto que confundió al test y acabó documentado como defecto de pantalla.)*
   */
  for (const [label, width, surface] of [
    ['390px', 390, 'home-mobile'],
    ['1280px', 1280, 'home-hero'],
  ] as const) {
    test(`§23.14.6-6 · home ${label}: la nota visible es la del montaje «${surface}»`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/es');
      const visible = page.getByTestId('buylist-shipping-note').filter({ visible: true });
      await expect(visible).toHaveCount(1);
      await expect(visible).toHaveAttribute('data-note-surface', surface);
      // Y el panel al que pertenece también es nombrable, que es la petición de §23.14.7-7.
      await expect(
        page.getByTestId(`home-quoter-${surface === 'home-hero' ? 'hero' : 'mobile'}`),
      ).toBeVisible();
    });
  }
});

/**
 * §23.14.6-8 (v2.3.8) — **el carrito explica su propia aritmética.**
 *
 * > Este describe existe por una razón muy concreta: **un test E2E de este mismo fichero** agregó
 * > cartas de un set sin precios de referencia, vio el total en cero y **concluyó que el cotizador
 * > no sumaba**. No sumaba *porque no debía* — pero **nada en pantalla lo decía**. Si alguien que
 * > conoce el sistema saca esa conclusión, un vendedor con 999 cartas la saca seguro; y el
 * > vendedor no abre un issue: cierra la pestaña.
 *
 * Es R7 aplicada al total: si un conteo ausente no es un número, **un total de cero que significa
 * «todavía no lo he calculado» no es un cero**.
 */
test.describe('buylist · el total sin precios se EXPLICA (§23.3h / §23.3f-bis)', () => {
  test('carrito de puros pendientes: versalita en vez de MX$0.00, explicación UNA vez y consejo útil', async ({
    page,
  }) => {
    mockOnly('«Zapdos» con referencia PENDIENTE es un estado fabricado por el fixture');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Zapdos', 'Holofoil');
    await openCart(page);

    const money = cartPanel(page).getByTestId('sell-cart-money');

    // (8.4) el total NO es un cero que se ve confiable: es la versalita `SIN PRECIO`.
    await expect(money.getByTestId('buylist-pending-label').first()).toBeVisible();
    await expect(money.getByText('MX$0.00')).toHaveCount(0);

    // (8.1) la explicación aparece UNA sola vez, dentro del bloque de dinero, con el conteo.
    const note = page.getByTestId('buylist-pending-note').filter({ visible: true });
    await expect(note).toHaveCount(1);
    await expect(money.getByTestId('buylist-pending-note')).toBeVisible();
    await expect(note).toContainText('1 carta todavía no tiene precio');

    // (8.2) …y dice QUÉ PASA con esas cartas. Sin esta frase «no suman» se lee como «no las
    // queremos» y la reacción racional del vendedor es BORRARLAS — el peor desenlace posible.
    await expect(note).toContainText('Las cotizamos a mano y te las incluimos en la oferta.');

    // (8.3) el consejo del faltante deja de ser una cinta de correr.
    const shortfall = cartPanel(page).getByTestId('buylist-minimum-shortfall');
    if (await shortfall.count()) {
      await expect(shortfall).toContainText(t('es', 'buylist.quote.minimum.addPricedCard'));
      await expect(shortfall).not.toContainText(t('es', 'buylist.quote.minimum.addAnother'));
      // ⛔ Prohibido fundir el faltante con la explicación: la cifra tiene que seguir siendo
      // verificable por sí sola.
      expect(await shortfall.innerText()).not.toMatch(/no tienen? precio|porque/i);
    }

    // (8.5) el conteo de cartas NO introduce un monto: los únicos `MX$` del bloque son los del
    // faltante (faltante + mínimo, §23.3f).
    const inBlock = ((await money.innerText()).match(/MX\$/g) ?? []).length;
    const inShortfall = (await shortfall.count())
      ? ((await shortfall.innerText()).match(/MX\$/g) ?? []).length
      : 0;
    expect(inBlock - inShortfall).toBe(0);
  });

  test('la explicación NO se repite por ítem, ni con la cantidad al máximo', async ({ page }) => {
    mockOnly('«Zapdos» con referencia PENDIENTE es un estado fabricado por el fixture');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Zapdos', 'Holofoil');
    await openCart(page);

    await cartPanel(page).getByRole('spinbutton').first().fill('999');
    const note = page.getByTestId('buylist-pending-note').filter({ visible: true });
    await expect(note).toHaveCount(1);
    await expect(note).toContainText('999 cartas todavía no tienen precio');
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
   * ─────────────────────────────────────────────────────────────────────────────────────
   * EL RECHAZO SE TIENE QUE VER, EN LA PANTALLA QUE EL VENDEDOR ESTÁ MIRANDO (P-4)
   *
   * Defecto reportado por el dueño EN PRODUCCIÓN: *«cuando confirmas enviar solicitud no
   * desaparece el pop up, pueden dar click varias veces»* — y midiéndolo contra la base, **no se
   * creaba nada, ni al primer clic ni al quinto**. La causa no era el botón ni la idempotencia:
   * era la GEOMETRÍA. El diálogo tiene más contenido que alto de ventana (medido: 1207 px en
   * 759 px visibles a 390×844), así que para pulsar «Confirmar y enviar» **hay que bajar hasta el
   * final**, y en esa posición el bloque de la CLABE queda **arriba del borde superior** (y=-183).
   * El rechazo se pintaba donde nadie podía verlo.
   *
   * ⚠️ **Este test corre a 390×844 A PROPÓSITO.** El smoke @real de más abajo usa 1280×2000 —un
   * viewport que no existe en ningún teléfono ni monitor— y con esa altura el defecto es
   * invisible: TODO cabe. Un arnés que elige la ventana donde el producto no falla no está
   * midiendo el producto. Si alguien vuelve a subir esta altura, este candado deja de servir.
   * ─────────────────────────────────────────────────────────────────────────────────────
   */
  test('el motivo del rechazo cae DENTRO de la pantalla al pulsar desde abajo (móvil 390×844)', async ({
    page,
  }) => {
    test.slow();
    // Mock-only por la carta literal del fixture y por asumir KYC sin CLABE en archivo (que es
    // lo que hace que el campo —y su error— existan).
    mockOnly('carta literal «Charizard» del fixture + KYC sin CLABE en archivo');
    await page.setViewportSize({ width: 390, height: 844 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');
    await addFromBinder(page, 'Charizard');
    await openCart(page);
    await ensureMinimumReached(page);
    await page.getByRole('button', { name: /Enviar solicitud/ }).click();

    const dialog = page.getByRole('dialog', { name: t('es', 'buylist.requestTitle') });
    const clabe = dialog.getByLabel(/CLABE/);
    await expect(clabe).toBeVisible();
    await choosePickupAddress(dialog);

    // El usuario baja hasta el botón —no hay otra forma de pulsarlo— y confirma sin CLABE.
    const submit = dialog.getByRole('button', { name: t('es', 'buylist.submit') });
    await expect(submit).toBeEnabled();
    await submit.scrollIntoViewIfNeeded();
    // Anti-vacuidad de la premisa: si el campo siguiera a la vista aquí, este test no estaría
    // midiendo el caso que reventó en producción (y el `toBeInViewport` de abajo sería trivial).
    await expect(clabe).not.toBeInViewport();
    await submit.click();

    // Nada se creó y el diálogo sigue abierto: exactamente el síntoma reportado…
    await expect(page.getByText(t('es', 'buylist.created'))).toHaveCount(0);
    await expect(dialog).toBeVisible();

    // …pero AHORA el motivo está donde el vendedor está mirando, y el foco cayó en el campo que
    // tiene que corregir (P-4: «esto sustituye a hacer scroll a ciegas», §15.4).
    const reason = dialog.getByText(t('es', 'buylist.clabeInvalid'));
    await expect(reason).toHaveCount(1);
    await expect(reason).toBeInViewport();
    await expect(clabe).toBeFocused();
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
    // Descubrir la teja más barata exige esperar a que el batch de estimados del binder resuelva
    // el set entero — ese es el precio de no hardcodear ningún monto, y se paga con presupuesto.
    test.slow();
    await page.setViewportSize({ width: 1280, height: 2000 });
    await loginAs(page, 'customer');
    await page.goto('/es/buylist');

    // El clic en la teja del binder agrega DIRECTO al carrito (auto-espera al estimado).
    // Falta de DATO, no defecto de producto: si ninguna teja del set trae precio de referencia, la
    // línea entra en `precio_pendiente`, NO suma al total por diseño (§23.3h) y el mínimo de D43 no
    // se puede cruzar subiendo la cantidad — este smoke no tiene qué vender y lo dice, en vez de
    // fallar nueve pasos después en el bloque del mínimo, que fue cómo se disfrazó el rojo anterior.
    const priced = await addCheapestSellableCard(page);
    test.skip(!priced, 'ninguna teja del binder tiene precio de referencia que agregar');

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

      /*
       * ⚠️ **SE ASERTA VISIBILIDAD, NO PRESENCIA — y la distinción tiene historia.**
       * El home monta el panel del cotizador DOS VECES: una para escritorio
       * (`<div className="hidden lg:flex">`) y otra para móvil (`<div className="lg:hidden">`),
       * así que `buylist-shipping-note` existe **dos veces en el DOM** y **solo una está
       * visible** en cada ancho. La versión anterior de este test hacía `.first()`, que a
       * 390px resuelve SIEMPRE a la copia de escritorio —la que está en `display:none`— y
       * fallaba **sobre un producto correcto**: medía el arnés, no el teaser.
       *
       * La aserción honesta para una regla de dinero no es «existe en el DOM», es **«hay
       * exactamente UNA visible en este ancho»**: caza el fallo que §23.14.2a vino a impedir
       * (que la nota solo exista en escritorio ⇒ 0 visibles a 390px) y también el duplicado
       * visible que confundiría al vendedor (2 visibles). `toBeInTheDocument()` / `.first()`
       * no distinguen ninguno de los dos.
       */
      const note = page.getByTestId('buylist-shipping-note').filter({ visible: true });
      await expect(note).toHaveCount(1);
      await expect(note).toHaveText(t('es', 'buylist.quote.shippingNote'));
      // D43 intacta: en el cotizador el envío se dice EN PALABRAS.
      expect(await note.innerText()).not.toMatch(/MX\$|%|≈/);

      // §23.14.2a: el rótulo retirado no revive. Sobre un bruto del que se descuenta el envío,
      // «Te pagamos» promete un depósito — y el vendedor se queda con el número grande.
      await expect(page.getByText('Te pagamos', { exact: true })).toHaveCount(0);
    });
  }
});
