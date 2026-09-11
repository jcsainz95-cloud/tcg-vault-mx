import { test, expect, type Locator, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { IS_REAL, loginAs, skipIfSeedMissing } from './utils/auth';
import { M5SeedUnavailable, m5Scenario, type M5Scenario } from './utils/m5-scenario';

/**
 * §M5-S (contrato v1.68, cierre de P-58) · candado S-3 de punta a punta: «Marcar recibida» se
 * ofrece SOLO en `en_transito`; «Verificar» SOLO en `recibida`. Y el ciclo completo del clic
 * correcto: `en_transito` → receive → `recibida` (aparece «Verificar») → verify → `verificacion`
 * (ya no hay verbo de transición).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * ⚠️ **ESTE SPEC YA NO ES `mockOnly`** (hallazgo **H-4** de QA). Decía *«depende de sr-3007 /
 * sr-3002 / sr-3004 de las fixtures»*, y era verdad de los **ids**, no del **escenario**: QA lo
 * refutó midiendo —sembró una `en_transito` y una `recibida` reales y condujo la UI horneada contra
 * el backend: «Marcar recibida»=1 / «Iniciar verificación»=0 en `en_transito`, y 0/1 en `recibida`—.
 * Marcar mock-only algo verificable contra el stack **deja el gate vacío**, que es exactamente lo
 * que `utils/auth.mockOnly` prohíbe en su propio comentario.
 *
 * Lo que cambia: los tres ids salen de `utils/m5-scenario`, que en mock devuelve los del fixture y
 * en real **siembra tres solicitudes desechables por la API del contrato** (crear → ofertar →
 * aceptar → confirmar envío → recibir). Ningún assert depende ya de un id literal, de un nombre de
 * carta ni de cuántas filas haya en el entorno.
 *
 * La matriz de los 11 estados sigue viviendo en `M5View.transitions.test.tsx` (unitario): aquí se
 * mide el ciclo contra el backend de verdad, no la tabla.
 * ─────────────────────────────────────────────────────────────────────────────────────
 */
const RECEIVE = t('es', 'admin.m5.receive');
const VERIFY = t('es', 'admin.m5.verify');

/** La tarjeta de una solicitud, anclada por su id (el contenedor `rounded-lg` más cercano). */
function card(page: Page, id: string): Locator {
  return page.getByText(id, { exact: true }).locator('xpath=ancestor::div[contains(@class,"rounded-lg")][1]');
}

async function openStage(page: Page, tabKey: string) {
  await page.getByRole('tab', { name: new RegExp(`^${t('es', `admin.m5.tabs.${tabKey}`)}`) }).click();
}

/**
 * Deja la pantalla de M5 abierta con el escenario sembrado. Se siembra POR TEST (no en un
 * `beforeAll` compartido): el segundo caso **consume** su `en_transito` al recibirla y verificarla,
 * y un escenario compartido dejaría al primero dependiendo de quién corriera antes.
 */
async function openM5(page: Page): Promise<M5Scenario> {
  let scenario: M5Scenario;
  try {
    scenario = await m5Scenario();
  } catch (e) {
    // Razón de ENTORNO ⇒ se salta con el motivo impreso. Cualquier otro fallo se propaga (rojo).
    skipIfSeedMissing(e instanceof M5SeedUnavailable, e instanceof Error ? e.message : String(e));
    throw e;
  }
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m5');
  await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();
  return scenario;
}

test.describe('admin · M5 · §M5-S: el paso correcto, no solo «fila viva»', () => {
  test('@real «Marcar recibida» solo en en_transito; ni en cotizada, ni en recibida', async ({ page }) => {
    const sr = await openM5(page);

    await openStage(page, 'con_vendedor');
    await expect(card(page, sr.inTransit).getByRole('button', { name: RECEIVE })).toBeVisible();
    await expect(card(page, sr.inTransit).getByRole('button', { name: VERIFY })).toHaveCount(0);
    if (!IS_REAL) {
      // Con el fixture se puede afirmar el CONJUNTO entero: una sola `en_transito` en la pestaña.
      // Contra el stack real el entorno puede traer más filas vivas, y contarlas mediría el
      // entorno, no el producto — la regla se afirma tarjeta por tarjeta, que es donde vive.
      await expect(page.getByRole('button', { name: RECEIVE })).toHaveCount(1);
    }

    await openStage(page, 'por_ofertar');
    await expect(card(page, sr.quoted).getByRole('button', { name: RECEIVE })).toHaveCount(0);
    await expect(card(page, sr.quoted).getByRole('button', { name: VERIFY })).toHaveCount(0);
    // Lo que una `cotizada` SÍ ofrece es la mesa de decisión (§23.6).
    await expect(card(page, sr.quoted).getByRole('button', { name: t('es', 'admin.m5.desk.open') })).toBeVisible();

    await openStage(page, 'verificando');
    await expect(card(page, sr.received).getByRole('button', { name: VERIFY })).toBeVisible();
    await expect(card(page, sr.received).getByRole('button', { name: RECEIVE })).toHaveCount(0);
  });

  test('@real ciclo: receive desde en_transito ⇒ recibida (aparece «Verificar») ⇒ verify ⇒ verificacion', async ({
    page,
  }) => {
    const sr = await openM5(page);

    await openStage(page, 'con_vendedor');
    await card(page, sr.inTransit).getByRole('button', { name: RECEIVE }).click();
    // El feedback de M5 va anclado a la TARJETA y la fila cambia de pestaña al recibirse, así que
    // aquí se asevera por el estado: la pestaña «Con el vendedor» la pierde y «Verificando» la gana.
    await expect(card(page, sr.inTransit)).toHaveCount(0);

    // Ahora vive en «Verificando» con el badge Recibida y el verbo siguiente.
    await openStage(page, 'verificando');
    const moved = card(page, sr.inTransit);
    // `.first()`: el PipelineStepper de la tarjeta también rotula el paso «Recibida»; basta con que el badge exista.
    await expect(moved.getByText(t('es', 'status.sellRequest.recibida'), { exact: true }).first()).toBeVisible();
    await expect(moved.getByRole('button', { name: RECEIVE })).toHaveCount(0);
    await moved.getByRole('button', { name: VERIFY }).click();
    await expect(page.getByText(t('es', 'admin.m5.feedback.verified'))).toBeVisible();
    await expect(card(page, sr.inTransit).getByRole('button', { name: VERIFY })).toHaveCount(0);
    await expect(card(page, sr.inTransit).getByRole('button', { name: RECEIVE })).toHaveCount(0);
  });
});
