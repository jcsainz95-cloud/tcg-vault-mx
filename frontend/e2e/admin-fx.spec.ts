import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * # M2 › Tipo de cambio en un NAVEGADOR de verdad (`DESIGN_SYSTEM §30`, contrato `§M2-F` v1.63.3)
 *
 * ## Por qué existe este archivo
 * QA lo midió y tenía razón: **ningún spec de `e2e/` tocaba la tarjeta de FX**. `admin.spec.ts`
 * navega a `/es/admin/m2` y sólo asierta los spreads del sellado, así que **el interruptor que
 * reprecia el catálogo entero no tenía ni un smoke**. El gate por work stream de `CLAUDE.md` exige
 * smoke E2E de los flujos que el stream tocó; éste es ese smoke.
 *
 * ## El escenario, y por qué no hace falta ninguna puerta trasera
 * El servidor falso arranca en **el estado REAL de producción** que describe §30: el dueño con
 * **19.0000 fijado a mano**, **ninguna** fila de Banxico (falta `BANXICO_SIE_TOKEN`, `D-OPS-1`) y el
 * modo **deducido** porque nadie ha tocado nunca el interruptor (`MODO HEREDADO`). Desde ahí, **con
 * actos legales de la propia pantalla**, se recorre entero el camino que el dueño reportó:
 *
 *   `Refrescar Banxico` → **no pasó nada, y ahora se dice**  ⟶  mover el interruptor → **el acuse**
 *   ⟶  confirmarlo → **`SIN RESPALDO REAL`**  ⟶  volver a manual → **su número sigue ahí**.
 *
 * ⛔ **Sin fixture mágico, sin `?scenario=`, sin tope configurable por la URL**: la misma
 * disciplina de `admin-bounties.spec.ts` — *un candado que se abre desde fuera no es un candado*.
 *
 * ## Lo que este archivo NO puede medir, y se dice aquí
 * **El desenlace `updated` del refresco** (Banxico devuelve una tasa nueva): en modo mock el plan
 * del refresco es `failed`/`no_token` —el estado real de producción— y cambiarlo desde el test
 * exigiría exactamente la puerta trasera que no se pone. Ese caso vive donde sí es inyectable: en
 * jsdom (`FxRateCard.test.tsx`, FX-UI-3) y en el gate contra el stack real, que es de QA.
 */

const FX = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m2.fx.${key}`, vars);

async function openM2(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2');
  await expect(page.getByRole('heading', { name: FX('title'), level: 2 })).toBeVisible();
  // La tarjeta ha resuelto su `GET` cuando la cifra que rige deja de ser el guion de carga.
  await expect(page.getByTestId('fx-current')).not.toHaveText('—');
}

test.describe('admin · M2 tipo de cambio (§30)', () => {
  test('el estado de producción se lee entero: 19.0000 MANUAL, sin tasa de Banxico y MODO HEREDADO', async ({
    page,
  }) => {
    mockOnly('el estado inicial del FX es dato del servidor falso');
    await openM2(page);

    // Pieza 1: la única pregunta que se hace todo el mundo al abrir.
    await expect(page.getByTestId('fx-current')).toHaveText('19.0000');
    await expect(page.getByTestId('fx-source')).toHaveText(FX('source.manual'));

    // Pieza 2: las dos tasas, lado a lado. La que rige lleva la marca; la otra NO existe todavía.
    await expect(page.getByTestId('fx-manual')).toContainText(FX('ruling.mark'));
    await expect(page.getByTestId('fx-automatic')).toContainText(FX('auto.missing'));
    await expect(page.getByTestId('fx-automatic')).not.toContainText(FX('ruling.mark'));

    // Pieza 3: sin segunda tasa no hay salto, y se dice por qué (⛔ no se inventa contra el 18).
    await expect(page.getByTestId('fx-jump')).toContainText(FX('jump.unavailable'));

    // Pieza 4: el colchón, de solo lectura, y dónde se edita.
    await expect(page.getByText('3.0 %')).toBeVisible();
    await expect(page.getByText(FX('buffer.hint'))).toBeVisible();

    // La única traza visible del riesgo residual: se dice SIEMPRE, y en muted.
    await expect(page.getByText(FX('mode.legacyLabel'))).toBeVisible();
  });

  test('⭐ «pulsé Refrescar y no pasó nada»: ahora lo dice, en rojo y sin desaparecer', async ({ page }) => {
    mockOnly('el desenlace del refresco lo decide el plan del servidor falso');
    await openM2(page);

    await page.getByRole('button', { name: FX('refresh.cta') }).click();

    // El `role="alert"` de la TARJETA (Next monta su propio anunciador de ruta, también `alert`).
    const alert = page.getByRole('region', { name: FX('title') }).getByRole('alert');
    await expect(alert).toContainText(FX('refresh.failedTitle'));
    // El motivo REAL de producción, traducido a lo que el dueño puede hacer (D-OPS-1 / P-63).
    await expect(alert).toContainText(FX('refresh.reason.no_token'));
    await expect(alert).toContainText('Sigue rigiendo 19.0000');

    // ⛔ Ni una frase de éxito sobre un `200`: ésa fue la mitad exacta de la queja del dueño.
    await expect(page.getByText('Banxico devolvió', { exact: false })).toHaveCount(0);

    // ⛔ Y no es un toast: sigue ahí pasados 10 s y tras otra interacción de la tarjeta.
    await page.waitForTimeout(10_000);
    await page.getByRole('button', { name: FX('manual.edit') }).click();
    await expect(alert).toContainText(FX('refresh.failedTitle'));
  });

  test('⭐⭐ el interruptor: acuse antes de saltar al valor de respaldo, y vuelta con el número intacto', async ({
    page,
  }) => {
    mockOnly('el estado inicial del FX es dato del servidor falso');
    await openM2(page);

    const manualSegment = page.getByRole('radio', { name: FX('toggle.manual') });
    const autoSegment = page.getByRole('radio', { name: FX('toggle.auto') });
    await expect(manualSegment).toHaveAttribute('aria-checked', 'true');

    // ── 1 · Mover el interruptor abre EL ACUSE (§30.8), no un «¿seguro?» genérico ────────────
    await autoSegment.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toContainText(FX('ack.title'));
    await expect(dialog).toContainText('19.0000');
    await expect(dialog).toContainText('18.0000');
    // El párrafo por el que existe el diálogo, COMPLETO y sin «ver más».
    await expect(dialog).toContainText(FX('ack.whereFrom'));
    // La consecuencia EN DINERO, no un genérico.
    await expect(dialog).toContainText('−5.26 %');
    await expect(dialog).toContainText(FX('confirm.untouched'));
    // ⛔ Nada de códigos ni de «error» en superficie.
    await expect(dialog).not.toContainText('FX_NO_AUTOMATIC_RATE');
    await expect(dialog).not.toContainText('422');

    // ── 2 · Cancelar no mueve NADA: la selección sigue donde estaba y la cifra tampoco ───────
    await page.getByRole('button', { name: t('es', 'common.cancel') }).click();
    await expect(dialog).toHaveCount(0);
    await expect(manualSegment).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText('19.0000');

    // ── 3 · Confirmarlo SÍ mueve el dinero, y la pantalla lo declara ─────────────────────────
    await autoSegment.click();
    await page.getByRole('button', { name: FX('ack.cta', { fallback: '18.0000' }) }).click();

    await expect(autoSegment).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText('18.0000');
    // ⭐ El peor estado del sistema, por fin visible: un número que nadie tecleó, con su nombre.
    await expect(page.getByTestId('fx-source')).toHaveText(FX('source.fallback'));
    await expect(page.getByText(FX('source.fallbackBody'))).toBeVisible();
    // ⛔ Y NINGUNA de las dos columnas rige: quien manda no es ninguna de ellas.
    await expect(page.getByText(FX('ruling.mark'), { exact: true })).toHaveCount(0);
    // El interruptor ya no se deduce de nada: se movió una vez.
    await expect(page.getByText(FX('mode.legacyLabel'))).toHaveCount(0);
    // ⛔ Se ofrece VOLVER, nunca «Deshacer».
    await expect(page.getByText('Deshacer')).toHaveCount(0);
    await expect(page.getByText('Ahora rige 18.0000', { exact: false })).toBeVisible();

    // ── 4 · El manual se CONSERVA: sigue completo, en pantalla y sin marca de que rige ───────
    const manualColumn = page.getByTestId('fx-manual');
    await expect(manualColumn).toContainText('19.0000');
    await expect(manualColumn).not.toContainText(FX('ruling.mark'));

    // ── 5 · Y volver a manual NO exige reteclear el número (el encargo del dueño, entero) ────
    await manualSegment.click();
    const back = page.getByRole('dialog');
    await expect(back).toContainText(FX('confirm.title'));
    await expect(back).not.toContainText(FX('ack.title'));
    await page.getByRole('button', { name: FX('confirm.cta', { rate: '19.0000' }) }).click();

    await expect(manualSegment).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText('19.0000');
    await expect(page.getByTestId('fx-source')).toHaveText(FX('source.manual'));
  });
});
