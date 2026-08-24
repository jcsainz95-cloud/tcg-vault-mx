import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo v2.0 (P-48): **precio puro por valor de mercado**. Cubre los tres frentes de UI de §N
 * (DESIGN_SYSTEM §21): el editor de la curva en M2, la regla de visibilidad del «Valor de mercado»
 * y el retiro sin residuos de la pantalla de tiers **con su texto falso**.
 *
 * Nota de entorno: en modo mock el dry-run (`POST /admin/pricing/curve/preview`) no tiene fixture a
 * propósito — la fórmula de dinero no se reimplementa en el cliente (ARCH §4.36.8a). Por eso estos
 * smoke NO afirman cifras del previsualizador: afirman la **estructura** y el **retiro**. Las cifras
 * de la prueba de mesa se verifican contra el stack real (§21.13.5g).
 */
test.describe('M2 · editor de la curva de precio (P-48)', () => {
  test('la pantalla de tiers SE RETIRÓ con su texto falso; en su lugar está la curva', async ({
    page,
  }) => {
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

test.describe('§21.8 · «Valor de mercado» que desaparece', () => {
  test('ficha de sellado con OVERRIDE manual: el bloque no está y no deja hueco', async ({ page }) => {
    // inv-1020 se vende por override (sin mercado TCGCSV) ⇒ priceBasis="override".
    await page.goto('/es/sellado/inv-1020');

    await expect(page.getByText(t('es', 'sealed.fromPrice'))).toBeVisible();
    // No se muestra: no aparece. Ni en cero, ni tachado, ni atenuado, ni «—».
    await expect(page.getByText(t('es', 'sealed.detail.marketValue'))).toHaveCount(0);
  });

  test('ficha de sellado con precio por SPREAD: el bloque sí se muestra', async ({ page }) => {
    await page.goto('/es/sellado/inv-1008');
    await expect(page.getByText(t('es', 'sealed.detail.marketValue'))).toBeVisible();
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
