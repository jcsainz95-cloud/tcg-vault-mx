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
 * «Ver esta solicitud») y los montos se afirman **por FORMATO** (`MONEY_RE`).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * **v1.51.20 — estos casos ENTRAN al gate real (`@real`).** Hasta ahora no los corría nadie: en
 * modo real `playwright.config.ts` filtra por `grep: /@real/` y **ninguno llevaba el tag**, así
 * que el «verde» de este archivo se medía **solo contra los fixtures del propio front**. Y aunque
 * hubieran estado tagueados, `needsSeed` los habría saltado: la semilla no creaba **ninguna**
 * `SellRequest`. Con el seed de v1.51.20 (una `cotizada` y una `ofertada` con la oferta emitida)
 * el dato existe, así que **se quita `needsSeed` y se pone `@real`** en los que el seed satisface.
 *
 * **Dos decisiones de arnés que van juntas y conviene leer antes de tocar nada:**
 *
 * 1. **Se busca la solicitud, no se asume su POSICIÓN.** Los helpers recorren «Mis solicitudes»
 *    hasta encontrar la que está en el estado que el caso necesita. Antes, el caso de «sin oferta
 *    todavía» abría **la primera fila** y se saltaba si traía oferta, lo que obligaba a que el
 *    orden de creación del seed fuera normativo: *una suite que depende del orden del seed mide el
 *    seed, no el producto*, y cualquier solicitud nueva en el entorno la apagaba en silencio.
 * 2. **No encontrar el dato es ROJO, no `skip`.** El seed ya lo garantiza, así que un `skip` aquí
 *    solo podría significar que el dato se perdió — exactamente lo que el gate tiene que gritar.
 *    Los helpers lanzan con un mensaje que dice **qué falta y quién lo siembra**.
 *
 * **Lo que NO entra al subset real, y por qué:** *«aceptar la oferta»* **consume** la única oferta
 * viva del seed (`ofertada` → `aceptada`), así que tagueárlo dejaría a los otros dos casos sin
 * dato **en la misma corrida** —a merced de qué worker gane la carrera— y sin dato en **todas las
 * corridas siguientes**. Se queda con `needsSeed` y con la petición escrita al lado.
 * ─────────────────────────────────────────────────────────────────────────────────────
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

/**
 * Recorre «Mis solicitudes» abriendo el portal de cada fila hasta que `matches` diga que ésa es
 * la que el caso necesita. **Deja la página EN esa solicitud.**
 *
 * ⚠️ **Se busca por ESTADO, nunca por posición ni por badge.** Dos trampas que este helper evita:
 *  - **Por posición:** «la primera fila» depende del orden de creación del seed (`listMine` ordena
 *    `createdAt desc`). Una solicitud nueva en el entorno —de otra suite, de una prueba manual—
 *    cambia quién es la primera y apaga el caso **sin que el producto haya cambiado**.
 *  - **Por badge:** el rótulo «Ofertada» aparece TAMBIÉN como **paso 02 del stepper de cada fila**,
 *    así que un `getByText('Ofertada')` engancha la primera fila sea cual sea su estado — falso
 *    positivo que navega a la solicitud equivocada.
 *
 * Si ninguna encaja, **lanza** (no se salta): el seed lo garantiza, así que la ausencia del dato
 * es justo el hallazgo que el gate tiene que enseñar. El mensaje dice quién lo siembra.
 */
async function openRequestWhere(
  page: Page,
  what: string,
  matches: (page: Page) => Promise<boolean>,
): Promise<void> {
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
    if (await matches(page)) return;
  }
  throw new Error(
    `Ninguna de las ${total} solicitudes del vendedor está ${what}. ` +
      `En modo real lo siembra \`backend/prisma/seed-e2e.ts\` (una \`cotizada\` y una \`ofertada\` ` +
      `con la oferta emitida); en modo mock, \`src/lib/mock/fixtures.ts\`.`,
  );
}

/**
 * Abre la solicitud con una **oferta viva que responder**. El discriminador honesto es **lo que el
 * portal ofrece hacer**: si hay botón de aceptar, hay oferta viva y renderizable.
 */
async function openOfferedRequest(page: Page): Promise<void> {
  await openRequestWhere(page, 'OFERTADA (con oferta viva que responder)', async (p) =>
    (await p.getByRole('button', { name: t('es', 'buylist.offer.accept') }).count()) > 0,
  );
}

/**
 * Abre una solicitud **anterior a la oferta**: sin montos que enseñar **y no terminal**.
 *
 * ⚠️ Las dos condiciones hacen falta. «Sin `offer-amounts`» sola también la cumple una solicitud
 * **cerrada** (`pagada`, `expirada`…), que pinta `ClosedNotice` en vez del cuerpo previo a la
 * oferta — el caso se caería por haber abierto la solicitud equivocada, no por un defecto. El
 * `quoteAgainCta` («cotiza de nuevo») es el marcador que el portal pinta **solo** cuando la
 * solicitud es terminal, así que su AUSENCIA es el segundo filtro.
 */
async function openPreOfferRequest(page: Page): Promise<void> {
  await openRequestWhere(page, 'antes de la oferta (sin montos y no terminal)', async (p) => {
    const hasOffer = (await p.getByTestId('offer-amounts').count()) > 0;
    const isTerminal =
      (await p.getByRole('link', { name: t('es', 'buylist.offer.quoteAgainCta') }).count()) > 0;
    return !hasOffer && !isTerminal;
  });
}

test.describe('buylist · portal del vendedor (la oferta)', () => {
  /**
   * Los TRES montos, la condición NM y el plazo. R1 (§23.0): el bruto **nunca** aparece sin el
   * envío y el neto al lado — este smoke falla si alguien «simplifica» el bloque al neto solo.
   */
  test('@real muestra los tres montos, la condición NM y el plazo con fecha y hora', async ({
    page,
  }) => {
    await loginAs(page, 'customer');
    await openOfferedRequest(page);

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
  test('@real no ofrece elegir líneas ni contraofertar', async ({ page }) => {
    await loginAs(page, 'customer');
    await openOfferedRequest(page);

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
    // ⚠️ SIN `@real` A PROPÓSITO, y no es un olvido: aceptar **consume** la oferta
    // (`ofertada` → `aceptada`). El seed real siembra UNA sola, compartida con los dos casos de
    // arriba y con todas las corridas siguientes; tagueárlo los dejaría verdes-por-`skip` según
    // qué worker llegue primero. Para que entre al gate hace falta **una solicitud ofertada
    // DESECHABLE por corrida** (petición abierta a `backend/prisma/seed-e2e.ts`) o un endpoint de
    // reset. Mientras tanto el caso sigue vivo contra los fixtures, que sí son reponibles.
    needsSeed('aceptar CONSUME la oferta: necesita una solicitud ofertada propia y DESECHABLE');
    await loginAs(page, 'customer');
    await openOfferedRequest(page);

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
  test('@real sin oferta todavía: «no mandes nada», nota de envío y ninguna acción de dinero', async ({
    page,
  }) => {
    await loginAs(page, 'customer');
    await openPreOfferRequest(page);

    await expect(page.getByText(t('es', 'buylist.offer.preOfferBody'))).toBeVisible();
    await expect(page.getByTestId('buylist-shipping-note')).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'buylist.offer.accept') })).toHaveCount(0);
  });

  /**
   * Una solicitud AJENA responde `404` (el contrato no usa `403`, para no confirmar que existe)
   * y la pantalla lo dice sin insinuar de quién es. Env-agnóstico: el id no existe en ningún
   * entorno, así que la respuesta es la misma contra mocks y contra el backend real.
   */
  test('@real una solicitud que no es tuya no se confirma ni se niega: mensaje neutro', async ({
    page,
  }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/buylist/requests/sr-que-no-existe-0000');
    await expect(page.getByText(t('es', 'buylist.offer.notFoundTitle'))).toBeVisible();
    await expect(page.getByText(/no es tuya|otro usuario|sin permiso/i)).toHaveCount(0);
  });

  /** El CTA del correo puede caer en una sesión cerrada: se invita a entrar, no se muestra error. */
  test('@real sin sesión invita a entrar y dice que la oferta no se acepta desde el correo', async ({
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
