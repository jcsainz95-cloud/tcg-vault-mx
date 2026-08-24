import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, MONEY_RE, loginAs, mockOnly } from './utils/auth';

/**
 * Flujo v2.0 (P-48): **precio puro por valor de mercado**. Cubre los tres frentes de UI de §N
 * (DESIGN_SYSTEM §21): el editor de la curva en M2, la regla de visibilidad del «Valor de mercado»
 * y el retiro sin residuos de la pantalla de tiers **con su texto falso**.
 *
 * Nota de entorno: en modo mock el dry-run (`POST /admin/pricing/curve/preview`) no tiene fixture a
 * propósito — la fórmula de dinero no se reimplementa en el cliente (ARCH §4.36.8a). Por eso los
 * smoke de mock NO afirman cifras del previsualizador: afirman la **estructura** y el **retiro**.
 *
 * Los tres tests **`@real`** de abajo son los que miran P-48 contra un backend VIVO. Existen por una
 * razón concreta: la regla de visibilidad de §21.8 depende de un campo que el servidor tiene que
 * EMITIR (`priceBasis`), y un fixture que lo hornea —como debe hacer un mock— no puede detectar que
 * el servidor no lo manda. Si `priceBasis` llegara `undefined`, `undefined === 'market'` es `false`
 * y el bloque «Valor de mercado» se suprimiría **en todas las fichas**: la regla quedaría invertida
 * y en verde. Eso es exactamente lo que estos tests cazan.
 */
/**
 * Estado de la regla de visibilidad en UNA ficha, leído del DOM. Se devuelve el par completo
 * porque §21.8 es un **bicondicional**: el bloque y la nota al pie tienen que contar la MISMA
 * historia — con mercado, la nota lo explica; sin mercado, ni lo menciona.
 */
async function marketBlockState(page: Page): Promise<{ block: boolean; explainer: 'with' | 'no' | 'none' }> {
  const block = (await page.getByText(t('es', 'catalog.marketValue'), { exact: true }).count()) > 0;
  const withMarket =
    (await page.getByText(t('es', 'card.referenceExplainerWithMarket')).count()) > 0;
  const noMarket = (await page.getByText(t('es', 'card.referenceExplainerNoMarket')).count()) > 0;
  return { block, explainer: withMarket ? 'with' : noMarket ? 'no' : 'none' };
}

/** Href de las primeras `n` fichas de carta de la vitrina (descubrimiento, sin hardcodear ids). */
async function firstCardHrefs(page: Page, n: number): Promise<string[]> {
  await page.goto('/es/catalog');
  // ⚠️ Esperar a que pinte la RETÍCULA, no solo el H1. Contra un backend real la query tarda, y
  // leer el DOM antes devolvía una lista VACÍA: el bucle no se ejecutaba y el test pasaba **en
  // vacío**. Un test que no puede fallar es peor que no tenerlo. (`a[href*="/catalog/"]` casaba
  // con el enlace «Comprar» del header, así que ni siquiera saltaba el `toBeVisible`.)
  await page.waitForFunction(
    () =>
      Array.from(document.querySelectorAll('a[href]')).some((a) =>
        /\/catalog\/[^/]+$/.test(a.getAttribute('href') ?? ''),
      ),
    null,
    { timeout: 30_000 },
  );
  const hrefs = await page
    .locator('a[href]')
    .evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).getAttribute('href') ?? ''));
  return [...new Set(hrefs.filter((h) => /\/catalog\/[^/]+$/.test(h)))].slice(0, n);
}

test.describe('M2 · editor de la curva de precio (P-48)', () => {
  test('la pantalla de tiers SE RETIRÓ con su texto falso; en su lugar está la curva', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    await expect(
      page.getByRole('heading', { name: t('es', 'admin.m2.curve.title'), level: 2 }),
    ).toBeVisible();

    // El texto que causó P-48 no puede quedar en ningún sitio: el código NUNCA heredó la regla del
    // tier de la rareza, y esa promesa fue la razón de que el dueño creyera tener un piso.
    await expect(page.getByText(/hereda la del tier de su rareza/i)).toHaveCount(0);
    await expect(page.getByText(/Hereda tier/i)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Precios por tier/ })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Asignación de rarezas a tiers/ })).toHaveCount(0);
    // Con la pantalla se van los modos excluyentes fijo/porcentaje.
    await expect(page.getByText('Fijo (MX$)')).toHaveCount(0);
  });

  test('las constantes describen su COMPORTAMIENTO y el guardarraíl se enuncia junto al piso', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    // «Piso» tiene que significar piso: la ayuda describe qué HACE el número.
    await expect(page.getByText(t('es', 'admin.m2.curve.constants.floorHint'))).toBeVisible();
    await expect(page.getByText(t('es', 'admin.m2.curve.constants.binHint'))).toBeVisible();
    await expect(
      page.getByText(t('es', 'admin.m2.curve.constants.floorGuardrailHint')),
    ).toBeVisible();
  });

  test('la tabla de puntos habla en pesos, × y % — nunca en centavos ni puntos base', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    await expect(page.getByLabel('Mercado del punto 1 de venta')).toHaveValue('25.00');
    await expect(page.getByLabel('Multiplicador del punto 1')).toHaveValue('1.60');
    await expect(page.getByLabel('Pago del punto 1')).toHaveValue('30');
    // Las unidades del contrato no se filtran a la pantalla.
    await expect(page.getByText('16000')).toHaveCount(0);
    await expect(page.getByText('3000')).toHaveCount(0);
  });

  test('mover un punto reordena AL BLUR (no hay arrastrar y soltar) y el borrador queda sucio', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const first = page.getByLabel('Mercado del punto 1 de venta');
    await first.fill('900');
    // Mientras se teclea el orden NO cambia.
    await expect(page.getByLabel('Mercado del punto 1 de venta')).toHaveValue('900');
    await first.blur();
    await expect(page.getByLabel('Mercado del punto 2 de venta')).toHaveValue('900');
    await expect(page.getByText(t('es', 'admin.m2.curve.save.fieldErrors'))).toHaveCount(0);
  });
});

/**
 * SMOKE `@real` — P-48 contra el backend VIVO. Corren también en mock (la suite no filtra sin
 * `E2E_REAL`), así que **descubren datos y afirman invariantes**, nunca montos de fixture.
 */
test.describe('@real P-48 contra el stack vivo', () => {
  test('@real la regla de §21.8 no está invertida: alguna ficha SÍ publica el valor de mercado', async ({
    page,
  }) => {
    // ⚠️ Este es el test que caza «el servidor no emite `priceBasis`». No comprueba una ficha
    // concreta —eso lo acoplaría al seed—: recorre las primeras fichas de la vitrina y exige que
    // **al menos una** muestre el bloque. Con `priceBasis` ausente, `undefined === 'market'` es
    // false en TODAS y el bloque desaparece del sitio entero: aquí se pone en rojo.
    const hrefs = await firstCardHrefs(page, 4);
    expect(hrefs.length).toBeGreaterThan(0);

    const states: { href: string; block: boolean; explainer: string }[] = [];
    // El assert final es sobre `states`: si el descubrimiento fallara, `states` quedaría vacío y
    // `some()` sería `false` ⇒ rojo. No hay forma de que este test pase sin haber mirado fichas.
    for (const href of hrefs) {
      await page.goto(href);
      await expect(page.getByText(t('es', 'catalog.salePrice'), { exact: true })).toBeVisible();
      const st = await marketBlockState(page);
      states.push({ href, ...st });

      // §21.8d — bicondicional: el bloque y la nota al pie cuentan la MISMA historia. La variante
      // «sin mercado» ni lo menciona; la «con mercado» lo explica. Nunca las dos, nunca ninguna.
      expect(st.explainer).toBe(st.block ? 'with' : 'no');
    }

    expect(
      states.some((s) => s.block),
      `Ninguna de las ${states.length} fichas visitadas publicó el valor de mercado. Si el backend ` +
        'dejó de emitir `priceBasis`, la regla de §21.8 queda INVERTIDA y el bloque se suprime siempre.',
    ).toBe(true);
  });

  test('@real la vitrina y la ficha publican dinero con formato MXN, nunca «precio pendiente»', async ({
    page,
  }) => {
    // Money-safe de cara al comprador (§7.3 + criterio de Compra): lo que se publica tiene precio
    // real; una variante sin precio NO se publica. Se afirma FORMATO, no monto.
    await page.goto('/es/catalog');
    await expect(page.getByText(MONEY_RE).first()).toBeVisible();
    await expect(page.getByText(t('es', 'price.pendingLabel'))).toHaveCount(0);

    const [href] = await firstCardHrefs(page, 1);
    await page.goto(href);
    await expect(page.getByText(t('es', 'catalog.salePrice'), { exact: true })).toBeVisible();
    await expect(page.getByText(MONEY_RE).first()).toBeVisible();
    await expect(page.getByText(t('es', 'common.withoutIva')).first()).toBeVisible();
  });

  test('@real el editor de la curva carga del servidor y el dry-run responde', async ({ page }) => {
    // El editor es `super_admin`: contra el stack real necesita sesión de verdad.
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    // La curva viene de `GET /admin/pricing/curve`: los puntos se pintan en unidades de PANTALLA.
    const market = page.getByLabel('Mercado del punto 1 de venta');
    await expect(market).toBeVisible();
    await expect(market).toHaveValue(/^\d+(\.\d{2})?$/);
    await expect(page.getByLabel('Multiplicador del punto 1')).toHaveValue(/^\d+\.\d{2}$/);

    // La tabla de referencia pide el dry-run con los diez mercados de la prueba de mesa (§4.36.1).
    const referenceRows = page.getByTestId('curve-reference-row');

    if (IS_REAL) {
      // Contra el backend vivo el previsualizador SÍ resuelve: la columna derivada y la tabla de
      // referencia traen importes. Se afirma que hay cifras y su FORMATO — las cifras exactas de la
      // prueba de mesa las fija el unitario del backend, no un E2E acoplado a los diales del día.
      await expect(referenceRows.first()).toBeVisible();
      await expect(referenceRows).toHaveCount(10, { timeout: 20_000 });
      await expect(referenceRows.first().getByText(MONEY_RE).first()).toBeVisible();
      // La probeta arranca en MX$50.00 y describe su cálculo con el multiplicador aplicado.
      await expect(page.getByText(t('es', 'admin.m2.curve.preview.probeTitle'))).toBeVisible();
      await expect(page.getByText(/^Venta: .+ × .+ = /)).toBeVisible();
    } else {
      // En mock el dry-run NO se finge a propósito (F-P48-2): la pantalla dice que no puede
      // mostrar precios en vez de inventar uno. Eso también es un contrato de UI que vale afirmar.
      await expect(
        page.getByText(t('es', 'admin.m2.curve.preview.unavailableTitle')),
      ).toBeVisible();
      await expect(referenceRows).toHaveCount(0);
    }
  });
});

test.describe('§21.8 · «Valor de mercado» que desaparece', () => {
  test('ficha de sellado con OVERRIDE manual: la ficha NO publica el mercado en NINGUNA parte', async ({
    page,
  }) => {
    // inv-1020 se vende por override (sin mercado TCGCSV) ⇒ priceBasis="override".
    mockOnly('pieza `inv-1020` del fixture (sellado con override manual)');
    await page.goto('/es/sellado/inv-1020');
    await expect(page.getByText(t('es', 'sealed.fromPrice'))).toBeVisible();

    // El objeto de la regla no es UNA CELDA: es no publicar el valor de mercado cuando el mercado
    // no fijó el precio. Se afirma sobre la PÁGINA ENTERA a propósito — el defecto que esto cierra
    // era que la celda desaparecía y «Tendencia de valor» volvía a publicar la cifra 200px abajo,
    // rotulada «valor de mercado de referencia».
    await expect(page.getByText(/valor de mercado/i)).toHaveCount(0);
    await expect(page.getByText(t('es', 'sealed.trend.title'))).toHaveCount(0);
    await expect(page.getByText(t('es', 'sealed.trend.marketRefNote'))).toHaveCount(0);
  });

  test('ficha de sellado con precio por SPREAD: el bloque y la tendencia SÍ se muestran', async ({
    page,
  }) => {
    // Asimetría legítima: con precio derivado por spread SÍ hay mercado, y el mercado es justo lo
    // que explica el precio. `exact` acota al rótulo de la celda (la nota de la tendencia es otra
    // frase que también contiene «Valor de mercado»).
    mockOnly('pieza `inv-1008` del fixture (sellado con precio por spread)');
    await page.goto('/es/sellado/inv-1008');
    await expect(
      page.getByText(t('es', 'sealed.detail.marketValue'), { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(t('es', 'sealed.trend.title'))).toBeVisible();
  });

  test('§21.8f: las tejas de Compra NO muestran valor de mercado en ningún estado', async ({
    page,
  }) => {
    await page.goto('/es/catalog');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    // El mercado vive EXCLUSIVAMENTE en la ficha, y solo bajo la regla de `priceBasis`.
    await expect(page.getByText(t('es', 'catalog.marketValue'))).toHaveCount(0);
  });
});
