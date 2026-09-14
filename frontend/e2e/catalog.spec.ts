import { test, expect } from '@playwright/test';
import { ivaLabelRe, t } from './utils/i18n';
import { mockOnly, needsSeed, realOnly, MONEY_RE } from './utils/auth';

/**
 * Flujo: "Compra" (antes "Catálogo") — vitrina de inventario publicado CON precio
 * (v1.1: nunca "precio pendiente"), filtros (rareza multi-select, set con año,
 * tipo/sellado), condición NM legible con tooltip, y ficha (valor de mercado vs
 * precio de venta). PROJECT §A / AC 1, 1b, 2, 3b, 3c, 3e; contrato §2. Datos EN.
 */
test.describe('Compra · listado y filtros', () => {
  test('rótulo "Compra" y datos de catálogo en inglés', async ({ page }) => {
    // El rótulo y el nav los cubre el `@real` de abajo contra datos reales; lo que ata este test
    // al fixture son los nombres literales de carta (el seed las llama «E2E …»).
    mockOnly('nombres literales «Charizard»/«Pikachu» del fixture');
    await page.goto('/es/catalog');
    await expect(page.getByRole('heading', { name: t('es', 'catalog.title') })).toBeVisible();
    // "Compra" también en el nav.
    await expect(
      page.getByRole('navigation').first().getByRole('link', { name: t('es', 'nav.shop') }),
    ).toBeVisible();
    await expect(page.getByText('Charizard').first()).toBeVisible();
    await expect(page.getByText('Pikachu').first()).toBeVisible();
  });

  test('filtra por rareza (multi-select buscable) mandando la rareza cruda', async ({ page }) => {
    mockOnly('afirma qué cartas del fixture quedan al filtrar Common (Pikachu sí, Charizard no)');
    await page.goto('/es/catalog');
    // Marca la rareza "Common" en el combobox de rareza (panel lateral en lg).
    await page.getByRole('option', { name: 'Common', exact: true }).click();
    await expect(page.getByText('Pikachu').first()).toBeVisible();
    await expect(page.getByText('Charizard')).toHaveCount(0);
  });

  test('Compra NUNCA muestra "precio pendiente" (v1.1)', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByText('Charizard').first()).toBeVisible();
    await expect(page.getByText(t('es', 'price.pendingLabel'))).toHaveCount(0);
  });

  test('el SELLADO no se filtra desde Compra: vive en su propia pestaña', async ({ page }) => {
    await page.goto('/es/catalog');
    // Compra lista SINGLES (raw/graded); el endpoint jamás emite un grupo sellado (H9, §2-S), así
    // que la casilla «Sellado» del filtro de tipo solo podía devolver «Ninguna carta coincide».
    // Se retiró: el sellado tiene su propia ruta, enlazada desde la sub-navegación de la Tienda.
    await expect(
      page.getByRole('button', { name: t('es', 'shop.type.sealed'), exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: t('es', 'shop.type.raw'), exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('link', { name: t('es', 'storeTabs.sealed') }),
    ).toBeVisible();
  });

  test('tarjeta de SELLADO (en /sellado): nombre del producto + precio «desde» sin IVA', async ({
    page,
  }) => {
    // Verificado contra el stack vivo: `GET /catalog/sealed` → `total: 0`. No hay NADA sellado
    // publicado en el seed, así que ni la teja ni el precio «desde» pueden existir.
    needsSeed('ningún grupo sellado publicado (GET /catalog/sealed → total 0)');
    await page.goto('/es/sellado');
    await expect(page.getByText('Surging Sparks Booster Box').first()).toBeVisible();
    // (B-2) ASSERT CADUCO CON §M10-IVA.3: pedía la convención VIEJA.
    // `PROJECT.md §Q` (tabla de superficies) marca **SÍ** para esta pantalla, y el criterio **190**
    // manda que el rótulo lo diga el DATO (`ivaIncluded`), no la pantalla. Medido: la UI pinta
    // «IVA 16 % incluido». La prueba era la equivocada; el producto hace lo que se le pidió.
    await expect(page.getByText(ivaLabelRe('es', 'common.ivaIncluded')).first()).toBeVisible();
    await expect(page.getByText(t('es', 'price.pendingLabel'))).toHaveCount(0);
  });

  /**
   * SMOKE `@real` — la vitrina contra un backend VIVO. Sin esto, «Compra» solo se verificaba contra
   * fixtures: un catálogo que no publica nada, o que publica sin precio, pasaba en verde.
   * Env-agnóstico: descubre datos y afirma INVARIANTES y FORMATO, nunca montos de fixture.
   */
  test('@real la vitrina publica cartas reales con precio, y ninguna «precio pendiente»', async ({
    page,
  }) => {
    await page.goto('/es/catalog');
    // Esperar a la retícula, no al H1: contra un backend real la query tarda y leer antes deja
    // asserts vacíos (la lección de `pricing-curve.spec.ts`).
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('a[href]')).some((a) =>
          /\/catalog\/[^/]+$/.test(a.getAttribute('href') ?? ''),
        ),
      null,
      { timeout: 30_000 },
    );

    // Money-safe de cara al comprador: lo publicado tiene precio real (§7.3). Una variante sin
    // precio NO se publica — jamás un MX$0 ni un «pendiente» en la vitrina.
    await expect(page.getByText(MONEY_RE).first()).toBeVisible();
    await expect(page.getByText(t('es', 'price.pendingLabel'))).toHaveCount(0);
    await expect(page.getByText('MX$0.00')).toHaveCount(0);

    // El filtro de tipo ofrece SOLO singles: el sellado tiene su propia ruta (H9, §2-S).
    await expect(page.getByRole('button', { name: t('es', 'shop.type.raw'), exact: true })).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'shop.type.sealed'), exact: true }),
    ).toHaveCount(0);
  });

  test('@real la ficha coincide consigo misma: bloque de mercado y nota al pie cuentan lo mismo', async ({
    page,
  }) => {
    await page.goto('/es/catalog');
    await page.waitForFunction(
      () =>
        Array.from(document.querySelectorAll('a[href]')).some((a) =>
          /\/catalog\/[^/]+$/.test(a.getAttribute('href') ?? ''),
        ),
      null,
      { timeout: 30_000 },
    );
    const href = await page
      .locator('a[href]')
      .evaluateAll(
        (els) =>
          els
            .map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? '')
            .filter((h) => /\/catalog\/[^/]+$/.test(h))[0] ?? '',
      );
    expect(href).not.toBe('');

    await page.goto(href);
    await expect(page.getByText(t('es', 'catalog.salePrice'), { exact: true })).toBeVisible();

    // §21.8d — bicondicional: el bloque «Valor de mercado» y la nota al pie tienen que contar la
    // MISMA historia. Con mercado, la nota lo explica; sin mercado, ni lo menciona. Nunca las dos
    // variantes a la vez, nunca ninguna.
    const block = await page.getByText(t('es', 'catalog.marketValue'), { exact: true }).count();
    const withMarket = await page
      .getByText(t('es', 'card.referenceExplainerWithMarket'))
      .count();
    const noMarket = await page.getByText(t('es', 'card.referenceExplainerNoMarket')).count();
    expect(withMarket + noMarket).toBe(1);
    expect(block > 0 ? withMarket : noMarket).toBe(1);
  });

  test('condición NM legible con tooltip del estándar', async ({ page }) => {
    await page.goto('/es/catalog');
    // Filtra a Raw (NM) para ver la ficha técnica de la copia.
    await page.getByRole('button', { name: t('es', 'shop.type.raw'), exact: true }).click();
    // En la retícula la condición se abrevia a NM (renglón `RAW · NM · ACABADO`)
    // y el estándar vive en el title/tooltip (+ aria-label).
    await expect(page.getByText(/Raw · NM/).first()).toBeVisible();
    await expect(page.locator('[title*="Como nueva"]').first()).toBeVisible();
  });

  test('la ficha de detalle pinta la condición con su etiqueta legible', async ({ page }) => {
    // La etiqueta completa ("Casi nueva (NM)") es la que ocupa la celda de
    // Condición en la ficha, donde sí hay hueco para leerla entera.
    mockOnly('id de carta `c-pikachu` del fixture (los del seed son UUID)');
    await page.goto('/es/catalog/c-pikachu');
    await expect(page.getByText(t('es', 'catalog.condition.nm.label')).first()).toBeVisible();
  });
});

test.describe('Compra · ficha de carta', () => {
  test('distingue valor de mercado vs precio de venta (§21.8: el mercado FIJÓ el precio)', async ({ page }) => {
    // La regla §21.8 contra datos REALES la cubre `@real la ficha coincide consigo misma` (arriba)
    // y el `@real` de pricing-curve; lo que ata este test al fixture es el id `c-charizard`.
    mockOnly('id de carta `c-charizard` del fixture');
    await page.goto('/es/catalog/c-charizard');

    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
    // v2.0 (P-48): la nota al pie tiene DOS variantes; con bloque de mercado va la «WithMarket».
    await expect(page.getByText(t('es', 'card.referenceExplainerWithMarket'))).toBeVisible();
    await expect(page.getByText(t('es', 'catalog.marketValue')).first()).toBeVisible();
    // (B-2) ASSERT CADUCO CON §M10-IVA.3: pedía la convención VIEJA.
    // `PROJECT.md §Q` (tabla de superficies) marca **SÍ** para esta pantalla, y el criterio **190**
    // manda que el rótulo lo diga el DATO (`ivaIncluded`), no la pantalla. Medido: la UI pinta
    // «IVA 16 % incluido». La prueba era la equivocada; el producto hace lo que se le pidió.
    await expect(page.getByText(ivaLabelRe('es', 'common.ivaIncluded')).first()).toBeVisible();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first(),
    ).toBeEnabled();
  });

  test('«Comprar» da feedback: toast + CTA «En el carrito»; el segundo clic lleva al carrito', async ({ page }) => {
    mockOnly('id de carta `c-charizard` del fixture');
    await page.goto('/es/catalog/c-charizard');
    await page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first().click();

    // Confirmación efímera (toast §7.5) con enlace al carrito.
    await expect(
      page.getByRole('status').getByText(t('es', 'catalog.addedToCart')),
    ).toBeVisible();

    // El CTA de ESA pieza cambia de estado y, al re-clicar, navega al carrito.
    const inCart = page.getByRole('button', { name: t('es', 'catalog.inCart') }).first();
    await expect(inCart).toBeVisible();
    await inCart.click();
    await page.waitForURL('**/checkout');
  });

  test('pieza ya en el carrito al recargar la ficha → CTA inicial «En el carrito»', async ({ page }) => {
    mockOnly('id de carta `c-charizard` del fixture');
    await page.goto('/es/catalog/c-charizard');
    await page.getByRole('button', { name: t('es', 'catalog.buyNow') }).first().click();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.inCart') }).first(),
    ).toBeVisible();

    // El carrito vive en localStorage: al recargar, el estado se restaura tras montar.
    await page.reload();
    await expect(
      page.getByRole('button', { name: t('es', 'catalog.inCart') }).first(),
    ).toBeVisible();
  });

  test('ficha traducida a inglés mantiene el nombre de carta en inglés', async ({ page }) => {
    mockOnly('id de carta `c-charizard` del fixture');
    await page.goto('/en/catalog/c-charizard');
    await expect(page.getByText(t('en', 'card.referenceExplainerWithMarket'))).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Charizard' })).toBeVisible();
  });
});

/**
 * ═══════════════════════════════════════════════════════════════════════════════════
 * D-EQ-3 · EL ENLACE DE SELLADO GUARDADO EN FAVORITOS
 * ═══════════════════════════════════════════════════════════════════════════════════
 * MEDIDO (2026-09-13, stack nativo real, con UN sellado `box` publicado):
 *   · `GET /catalog/sealed`                   ⇒ `total: 1`
 *   · `GET /catalog/cards?productType=sealed` ⇒ `total: 0`   (guardarraíl H9)
 *   · `GET /catalog/cards?sealedSubtype=box`  ⇒ `total: 0`
 *   · navegador en `/es/compra?productType=sealed` ⇒ «Ninguna carta coincide».
 * El contrato v1.73 (§2) retira los dos parámetros ⇒ cuando backend empiece a responder
 * `400`, ese mismo enlace pasaría de «rejilla vacía» a «pantalla rota». Este test es el
 * que sostiene que no: el front no manda esos parámetros a ninguna parte, y el enlace
 * sigue llevando a sellado — a la vitrina que sí lo sirve (§2-S).
 */
test.describe('Compra · D-EQ-3: un enlace de sellado lleva a la vitrina de sellado', () => {
  // `@real` porque este test es AGNÓSTICO al entorno (no afirma ningún dato de fixture: solo la
  // ruta de aterrizaje, el aviso y el filtro aplicado) y porque lo que hay que demostrar es
  // justamente que el enlace funciona **contra el servidor**, que es donde moría.
  test('@real ?productType=sealed&sealedSubtype=box aterriza en /sellado con su presentación', async ({
    page,
  }) => {
    await page.goto('/es/compra?productType=sealed&sealedSubtype=box');

    await page.waitForURL(/\/es\/sellado\?.*sealedSubtype=box/, { timeout: 15_000 });
    // ⚠️ `exact: true` NO es cosmético. Sin él, `name: 'Sellado'` casa por SUBCADENA y engancha
    // DOS encabezados cuando la vitrina está vacía —el `h1` «Sellado» y el `h3` «Aún no hay
    // **sellado** en stock»—, y el modo estricto de Playwright tumba el test. Medido en este
    // entorno: `GET /catalog/sealed` ⇒ `total: 0`, así que el estado vacío SIEMPRE está ahí. El
    // localizador era el defectuoso; la pantalla es correcta (el vacío es dato del seed, no un
    // fallo — `sealed.emptyTitle` existe justo para eso).
    await expect(page.getByRole('heading', { name: t('es', 'sealed.title'), exact: true })).toBeVisible();
    // Se explica el salto de pantalla: cambiar la URL del usuario sin decir nada parece un fallo.
    await expect(page.getByRole('status')).toContainText(t('es', 'sealed.fromCatalog.body'));
    // El filtro llegó APLICADO y VISIBLE (nada de filtros fantasma).
    await expect(page.getByLabel(t('es', 'sealed.filters.subtype'))).toHaveValue('box');
    // Y en ningún momento el callejón sin salida de Compra.
    await expect(page.getByText(t('es', 'catalog.emptyTitle'))).toHaveCount(0);
  });

  test('@real ninguna petición a /catalog/cards lleva `sealed` ni `sealedSubtype`', async ({
    page,
  }) => {
    // (B-2) SOLO-REAL, y no por comodidad: EN MOCK ESTE TEST NO PUEDE MEDIR NADA.
    //
    // Lo que afirma es TRÁFICO DE RED («ninguna petición lleva estos parámetros» / «la consulta
    // acaba en /catalog/sealed»), y en modo mock `src/lib/api.ts` resuelve contra los fixtures
    // EN PROCESO: no sale una sola petición HTTP. Medido en la corrida de mocks del 2026-09-14:
    // `sealed.length` = 0 ⇒ rojo permanente, y —peor— el primer assert pasaba **en vacío** (una
    // lista vacía no contiene nada prohibido). Un test que no puede fallar por el motivo correcto
    // y sí falla por el incorrecto no gatea: clasifica mal en las dos direcciones.
    realOnly('afirma PETICIONES HTTP y en mock el cliente resuelve en proceso (cero red)');
    const cards: string[] = [];
    const sealed: string[] = [];
    page.on('request', (r) => {
      const u = r.url();
      if (u.includes('/catalog/cards')) cards.push(u);
      if (/\/catalog\/sealed(\?|$)/.test(u)) sealed.push(u);
    });

    await page.goto('/es/compra?productType=sealed&sealedSubtype=box');
    await page.waitForURL(/\/es\/sellado/, { timeout: 15_000 });
    // Mismo motivo que arriba: `exact: true` o el `h3` del estado vacío entra en el localizador.
    await expect(page.getByRole('heading', { name: t('es', 'sealed.title'), exact: true })).toBeVisible();

    // v1.73 §2: los dos parámetros SALEN del contrato de `/catalog/cards`.
    expect(cards.filter((u) => /productType=sealed|sealedSubtype=/.test(u))).toEqual([]);
    // Y la consulta acaba donde el contrato dice que vive el sellado (§2-S).
    expect(sealed.length).toBeGreaterThan(0);
  });
});
