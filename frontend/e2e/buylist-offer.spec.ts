import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, needsSeed, MONEY_RE } from './utils/auth';

/**
 * **PORTAL DEL VENDEDOR — ver la oferta y responderla** (contrato §6 ·
 * `GET /buylist/requests/:id` + `POST …/offer-response`; DESIGN_SYSTEM §23.5).
 *
 * Es el destino del CTA del **correo 1**, así que estos smokes cubren el tramo del ciclo donde
 * el vendedor se compromete: ve los tres montos, ve la condición NM pegada a cada monto, ve el
 * plazo con fecha y hora, y acepta o rechaza **el paquete entero**.
 *
 * **Env-agnóstico por construcción:** ningún test navega a un `sellRequestId` literal ni afirma
 * un monto de fixture. Se descubre la solicitud **desde la propia app** («Mis solicitudes» →
 * «Ver esta solicitud») y los montos se afirman **por FORMATO** (`MONEY_RE`). Lo único que el
 * seed real no puede satisfacer hoy es **tener una solicitud con la oferta emitida**, y por eso
 * los casos que la necesitan se marcan con `needsSeed` en vez de `mockOnly`: el test está bien,
 * falta el dato — una petición accionable a `backend/prisma/seed-e2e.ts`.
 */

/**
 * Espera a que el PORTAL haya resuelto su consulta. «Tus cartas» se pinta en todos los estados
 * (con oferta y sin ella), así que es el ancla estable; sin ella, cualquier `count()` posterior
 * mediría la pantalla a medio cargar y el test se saltaría o pasaría solo.
 */
async function waitForPortal(page: Page) {
  await expect(page).toHaveURL(/\/es\/buylist\/requests\//);
  await expect(page.getByText(t('es', 'buylist.offer.cardsTitle'))).toBeVisible();
}

/** Enlaces «Ver esta solicitud» de «Mis solicitudes», ya pintados. */
function requestLinks(page: Page) {
  return page.getByRole('link', { name: t('es', 'buylist.offer.viewRequestCta') });
}

/** Abre el portal de la PRIMERA solicitud del vendedor desde «Mis solicitudes». */
async function openFirstRequest(page: Page) {
  await page.goto('/es/buylist');
  const link = requestLinks(page).first();
  await expect(link).toBeVisible();
  await link.click();
  await waitForPortal(page);
}

/**
 * Abre el portal de la solicitud que tiene una **oferta viva que responder**, recorriendo las
 * filas del vendedor. Devuelve `false` si no hay ninguna: contra el seed real es el caso de hoy.
 *
 * ⚠️ **No se busca el badge `OFERTADA` en la lista**, y la razón vale escribirla: el rótulo
 * «Ofertada» aparece TAMBIÉN como **paso 02 del stepper de cada fila**, así que un
 * `getByText('Ofertada')` engancha la primera fila cualquiera que sea su estado — falso
 * positivo que navega a la solicitud equivocada. El discriminador honesto es **lo que el portal
 * ofrece hacer**: si hay botón de aceptar, hay oferta viva.
 */
async function openOfferedRequest(page: Page): Promise<boolean> {
  await page.goto('/es/buylist');
  await expect(requestLinks(page).first()).toBeVisible();
  const total = await requestLinks(page).count();
  for (let i = 0; i < total; i++) {
    if (i > 0) {
      await page.goto('/es/buylist');
      await expect(requestLinks(page).first()).toBeVisible();
    }
    await requestLinks(page).nth(i).click();
    await waitForPortal(page);
    if ((await page.getByRole('button', { name: t('es', 'buylist.offer.accept') }).count()) > 0) {
      return true;
    }
  }
  return false;
}

test.describe('buylist · portal del vendedor (la oferta)', () => {
  /**
   * Los TRES montos, la condición NM y el plazo. R1 (§23.0): el bruto **nunca** aparece sin el
   * envío y el neto al lado — este smoke falla si alguien «simplifica» el bloque al neto solo.
   */
  test('muestra los tres montos, la condición NM y el plazo con fecha y hora', async ({ page }) => {
    needsSeed('no hay ninguna solicitud con la oferta EMITIDA (`offerState=sent`) en el seed');
    await loginAs(page, 'customer');
    test.skip(!(await openOfferedRequest(page)), 'sin solicitud ofertada en este entorno');

    const amounts = page.getByTestId('offer-amounts');
    await expect(amounts).toBeVisible();
    // Tres renglones de dinero: bruto, envío (con su signo menos) y neto.
    await expect(amounts.getByText(t('es', 'buylist.offer.shippingLabel'))).toBeVisible();
    await expect(amounts.getByText(t('es', 'buylist.offer.netLabel'))).toBeVisible();
    await expect(amounts.getByText(/−\s*MX\$/)).toBeVisible();
    await expect(page.getByTestId('offer-net')).toHaveText(MONEY_RE);

    // La condición NM viaja pegada al dinero (R2) y es DATO del servidor (`offer.terms`), así
    // que se afirma por su forma —«Near Mint» aparece en la línea— y no por una clave del front.
    await expect(page.getByText(/Near Mint/i).first()).toBeVisible();

    // Plazo con FECHA (criterio 154). Jamás una duración relativa.
    await expect(page.getByText(/Tienes hasta el/)).toBeVisible();
    await expect(page.getByText(/en \d+ días/)).toHaveCount(0);
  });

  /** Todo-o-nada (D1): se demuestra por lo que NO está — ni casillas, ni «quitar esta carta». */
  test('no ofrece elegir líneas ni contraofertar', async ({ page }) => {
    needsSeed('no hay ninguna solicitud con la oferta EMITIDA en el seed');
    await loginAs(page, 'customer');
    test.skip(!(await openOfferedRequest(page)), 'sin solicitud ofertada en este entorno');

    await expect(page.getByTestId('offer-amounts')).toBeVisible();
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'buylist.offer.accept') })).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'buylist.offer.reject') })).toBeVisible();
  });

  /**
   * ACEPTAR: pasa por confirmación (es dinero, §7.6) y el desenlace **sustituye** al bloque de
   * acciones. No se afirma el estado siguiente en la BD: eso es del E2E de backend; aquí se
   * afirma que el vendedor ve un desenlace y deja de tener botones que pulsar.
   */
  test('aceptar la oferta confirma con el neto y sustituye las acciones por el desenlace', async ({
    page,
  }) => {
    needsSeed('aceptar CONSUME la oferta: necesita una solicitud ofertada propia y desechable');
    await loginAs(page, 'customer');
    test.skip(!(await openOfferedRequest(page)), 'sin solicitud ofertada en este entorno');

    await page.getByRole('button', { name: t('es', 'buylist.offer.accept') }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByText(MONEY_RE)).toBeVisible();
    await dialog.getByRole('button', { name: t('es', 'buylist.offer.confirmAcceptCta') }).click();

    await expect(page.getByText(t('es', 'buylist.offer.acceptedNow'))).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'buylist.offer.accept') })).toHaveCount(0);
  });

  /**
   * ANTES de la oferta (criterio 114): la pantalla dice que no mande nada, enseña la nota de
   * servicio del envío **sin cifras** y **no** ofrece guía, ni nuestra dirección, ni aceptar.
   * Este caso sí lo satisface cualquier entorno con una solicitud `cotizada`.
   */
  test('sin oferta todavía: «no mandes nada», nota de envío y ninguna acción de dinero', async ({
    page,
  }) => {
    needsSeed('necesita al menos una solicitud propia del vendedor');
    await loginAs(page, 'customer');
    await openFirstRequest(page);

    const hasOffer = (await page.getByTestId('offer-amounts').count()) > 0;
    test.skip(hasOffer, 'la primera solicitud ya tiene oferta; este caso mira el estado previo');

    await expect(page.getByText(t('es', 'buylist.offer.preOfferBody'))).toBeVisible();
    await expect(page.getByTestId('buylist-shipping-note')).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'buylist.offer.accept') })).toHaveCount(0);
  });

  /**
   * Una solicitud AJENA responde `404` (el contrato no usa `403`, para no confirmar que existe)
   * y la pantalla lo dice sin insinuar de quién es. Env-agnóstico: el id no existe en ningún
   * entorno, así que la respuesta es la misma contra mocks y contra el backend real.
   */
  test('una solicitud que no es tuya no se confirma ni se niega: mensaje neutro', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/buylist/requests/sr-que-no-existe-0000');
    await expect(page.getByText(t('es', 'buylist.offer.notFoundTitle'))).toBeVisible();
    await expect(page.getByText(/no es tuya|otro usuario|sin permiso/i)).toHaveCount(0);
  });

  /** El CTA del correo puede caer en una sesión cerrada: se invita a entrar, no se muestra error. */
  test('sin sesión invita a entrar y dice que la oferta no se acepta desde el correo', async ({
    page,
  }) => {
    await page.goto('/es/buylist/requests/sr-cualquiera');
    await expect(page.getByText(t('es', 'buylist.offer.loginTitle'))).toBeVisible();
    await expect(page.getByText(t('es', 'buylist.offer.loginBody'))).toBeVisible();
    await expect(page.getByRole('link', { name: t('es', 'buylist.loginCta') })).toHaveAttribute(
      'href',
      /next=/,
    );
  });
});
