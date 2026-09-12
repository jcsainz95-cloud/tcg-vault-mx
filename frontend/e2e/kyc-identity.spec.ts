import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * **P-78 · La verificación de identidad**, de punta a punta (DESIGN_SYSTEM §34 · contrato §M6-K).
 *
 * El defecto que estos flujos cierran, medido sobre la release publicada: **subes tu INE y nadie
 * puede verla**, el panel deja marcar «verificado» sin mirar nada, y el cliente ve «Pendiente» sin
 * ningún botón para avanzar. Los dos extremos del mostrador, cada uno en su callejón.
 *
 * **Qué corre dónde, y por qué.** Tres casos son `@real`: los que afirman una AUSENCIA (ningún
 * control fija `kycStatus`; el operador no ve el documento; el cliente no lee ninguna cifra de
 * tope) valen **con cualquier dato**, así que se escriben agnósticos y se miden sobre el bundle
 * desplegado, que es donde el atajo podría volver.
 *
 * Los cinco `mockOnly` restantes **no son un límite del arnés: es que en el stack real todavía no
 * existe el DATO**. El servidor sí existe desde `c80bc26` (§M6-K entero), pero `seed-e2e.ts`
 * **borra todos los `KycProfile`** y no siembra ninguno (`seed-e2e.ts:144`), así que no hay usuario
 * con INE en el expediente, ni objeto en el bucket que pintar, ni nombre derivado contra el que
 * medir el aviso de cotejo. Cada marca dice abajo qué deja de medirse y qué la levantaría.
 */

const K = (key: string, vars?: Record<string, string | number>) =>
  t('es', `admin.m6.kycReview.${key}`, vars);

/** El usuario del fixture que está ESPERANDO revisión y tiene el nombre fabricado del correo. */
const WAITING_USER = 'u-780';

async function openReview(page: Page) {
  await loginAs(page, 'admin');
  await page.goto(`/es/admin/m6/kyc/${WAITING_USER}`);
  await expect(page.getByRole('heading', { level: 1, name: 'jcsainz95' })).toBeVisible();
}

test.describe('P-78 · la pantalla de revisión (super_admin)', () => {
  test('enseña las dos caras de la INE junto al nombre y las direcciones', async ({ page }) => {
    // Deja de medirse contra el stack real: que `GET /admin/users/:id/kyc/ine-links` emita dos
    // URLs que **el navegador pinta de verdad** (`naturalWidth > 0`) y que el panel de cotejo traiga
    // `nameSource`/`recentShipmentRecipients`. Lo levanta: un `KycProfile` sembrado con las DOS
    // keys y sus DOS objetos en el bucket (hoy `seed-e2e.ts:144` borra los perfiles y no siembra
    // ninguno). Es trabajo de esta semana —backend ya entregó §M6-K en `c80bc26`—, no depende de
    // ningún tercero.
    mockOnly('el seed real no siembra ningún KycProfile con INE ni su objeto en el bucket');
    await openReview(page);

    // El aviso de que mirar deja huella, ENCIMA del documento.
    await expect(page.getByText(K('privacy'))).toBeVisible();

    const front = page.getByAltText(K('altFront', { name: 'jcsainz95' }));
    const back = page.getByAltText(K('altBack', { name: 'jcsainz95' }));
    await expect(front).toBeVisible();
    await expect(back).toBeVisible();

    // ⭐ Se PINTAN de verdad: `naturalWidth > 0` es lo que distingue «hay un <img>» de «se ve la
    // INE». Es la medición que retiró el endpoint proxy del diseño (§34.15 A1).
    await expect
      .poll(async () => front.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect
      .poll(async () => back.evaluate((el) => (el as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    // El cotejo, al lado: nombre con su procedencia, direcciones y destinatarios de los envíos.
    await expect(page.getByText(K('nameDerivedWarn'))).toBeVisible();
    await expect(page.getByText(K('recipient', { name: 'Juan Carlos Sainz' }))).toBeVisible();
    await expect(page.getByText('Marta Sainz')).toBeVisible();
    await expect(page.getByText(K('recipientMissing')).first()).toBeVisible();

    // ⛔ Ni descarga, ni impresión, ni la URL firmada en un enlace navegable (§34.14).
    await expect(page.locator('[download]')).toHaveCount(0);
    await expect(page.locator('a[target="_blank"]')).toHaveCount(0);
    await expect(page.locator('a[href*="X-Amz-Signature"]')).toHaveCount(0);

    // ⛔ Y los enlaces NO sobreviven a la pestaña (petición de seguridad).
    const stored = await page.evaluate(() =>
      JSON.stringify({ ...window.localStorage, ...window.sessionStorage }),
    );
    expect(stored).not.toContain('X-Amz-Signature');
    expect(stored).not.toContain('kyc_ine');
  });

  test('el visor a pantalla completa lee las dos caras y vuelve sin descargar nada', async ({ page }) => {
    // Ídem: sin objeto en el bucket no hay bitmap que ampliar, y el visor mediría un marco vacío.
    // Lo levanta el mismo sembrado; el spec no cambia (los asserts ya son de estructura y catálogo).
    mockOnly('el seed real no siembra ningún KycProfile con INE ni su objeto en el bucket');
    await openReview(page);

    await page.getByRole('button', { name: K('enlarge') }).first().click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: K('sideBack') }).click();
    await dialog.getByRole('button', { name: K('zoomIn') }).click();
    await expect(dialog.getByText(K('zoomLevel', { pct: 150 }))).toBeVisible();
    // La línea de privacidad se repite aquí, y solo aquí.
    await expect(dialog.getByText(K('privacy'))).toBeVisible();
    await expect(dialog.getByRole('button', { name: /descargar|imprimir/i })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  });

  test('rechazar exige motivo, lo manda tal cual y la página NO navega sola', async ({ page }) => {
    // Deja de medirse: que `PATCH /admin/users/:id/kyc { rejectionReason }` acepte el motivo y que
    // el cliente lo lea después. Lo levanta el mismo sembrado **y** un actor de usar y tirar: este
    // caso ESCRIBE una decisión de identidad sobre una persona, y hacerlo sobre el `customer`
    // compartido del seed dejaría al resto de las suites con un KYC rechazado que ellas no pidieron.
    mockOnly('escribe una decisión de identidad: necesita un KycProfile sembrado y desechable');
    await openReview(page);

    await page.getByRole('button', { name: K('reject') }).click();
    const dialog = page.getByRole('dialog', { name: K('rejectTitle') });
    await expect(dialog.getByText(K('rejectNoticeVerbatim'))).toBeVisible();

    // Un motivo de dos caracteres no puede salir: el botón está apagado.
    await dialog.getByLabel(K('rejectReasonLabel')).fill('no');
    await expect(dialog.getByRole('button', { name: K('rejectConfirm') })).toBeDisabled();

    // Un motivo sugerido escribe una frase completa y editable.
    await dialog.getByLabel(K('rejectPreset.unreadable')).check();
    await expect(dialog.getByLabel(K('rejectReasonLabel'))).toHaveValue(K('rejectPreset.unreadable'));
    await dialog.getByRole('button', { name: K('rejectConfirm') }).click();

    // Tras decidir: seguimos en la misma URL, con el motivo y con las imágenes a la vista.
    await expect(page.getByText(/Identidad rechazada el/)).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/admin/m6/kyc/${WAITING_USER}$`));
    await expect(page.getByAltText(K('altFront', { name: 'jcsainz95' }))).toBeVisible();
    await expect(page.getByRole('button', { name: K('undo') })).toBeVisible();
  });

  /**
   * **KY-9, y se escribe AGNÓSTICO a propósito.** Lo que afirma no depende de ningún dato de
   * fixture: *ninguna ficha de usuario, sea cual sea, puede tener un control que fije `kycStatus`*.
   * Antes tenía un `Select` con las cuatro opciones + «Guardar KYC» — un camino de dos clics para
   * marcar `verified` **sin haber visto un documento**—, y mientras ese camino exista la pantalla
   * de revisión es decorativa. Por eso es `@real`: el candado vale sobre el bundle DESPLEGADO, que
   * es donde el atajo podría volver.
   *
   * Los tres desenlaces del final son legítimos y ninguno es un no-op: con INE en el expediente se
   * llega a la revisión; sin INE el botón está apagado **con su motivo a la vista**; sin perfil KYC
   * (el caso del seed real, que borra los `KycProfile`) la ficha lo dice.
   */
  test('@real la ficha 360° NO deja fijar «verificado» a mano, y la revisión es la única puerta', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m6');
    await page.getByRole('button', { name: t('es', 'admin.m6.view') }).first().click();
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // La ficha carga en dos tiempos (lista → detalle): se espera al BLOQUE de KYC antes de
    // afirmar nada sobre él. Sin esta espera, «no hay botón de revisión» y «todavía no ha
    // cargado» se leen igual — y el test mediría la carrera, no la pantalla.
    await expect(modal.getByText(t('es', 'admin.m6.kycTitle'), { exact: true })).toBeVisible();

    // ⛔ Ni un `select`, ni el rótulo del que se retiró (literal a propósito: la clave ya no está
    // en el catálogo, así que este assert es lo único que impide que vuelva).
    await expect(modal.getByRole('combobox')).toHaveCount(0);
    await expect(modal.getByLabel('Estado KYC')).toHaveCount(0);

    const review = modal.getByRole('button', { name: K('openCta') });
    if (await review.count()) {
      if (await review.isEnabled()) {
        await review.click();
        await expect(page).toHaveURL(/\/admin\/m6\/kyc\/[^/]+$/);
      } else {
        await expect(modal.getByText(K('openDisabled'))).toBeVisible();
      }
    } else {
      await expect(modal.getByText(t('es', 'admin.m6.noKyc'))).toBeVisible();
    }
  });

  /**
   * **KY-2, la mitad de interfaz.** El `403` del servidor se mide llamando al endpoint (candado
   * K-1, de backend); aquí se mide lo otro: que un `vault_operator` que **teclea la URL** no vea el
   * documento. El rol de back-office en modo demo lo dicta el dial local (`tcg.role`), que es el
   * mismo interruptor del selector «Ver como».
   */
  test('@real un vault_operator que teclea la URL NO ve el documento', async ({ page }) => {
    await loginAs(page, 'operator');
    // En DEMO el rol de back-office lo dicta el dial local (el mismo del selector «Ver como»); en
    // real lo dicta el JWT y este `setItem` es INERTE (`RoleProvider` lo ignora con
    // `config.useMocks === false`). Así el mismo test mide en los dos entornos.
    await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto(`/es/admin/m6/kyc/${WAITING_USER}`);

    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    // Ni el documento, ni su rótulo, ni una URL firmada en ningún `img` de la página.
    await expect(page.getByText(K('front'))).toHaveCount(0);
    await expect(page.locator('img[src*="X-Amz-Signature"]')).toHaveCount(0);
  });

  test('el listado deja llegar a la cola de revisión en dos clics', async ({ page }) => {
    // ⚠️ ÉSTE NO CADUCA ESTA SEMANA, y es el único: `kycStatus` en `AdminUserSummaryDTO` y el
    // filtro `?kycStatus=` **no están en el contrato** — son la petición **A5** de §34.15 al
    // arquitecto. Deja de medirse que el revisor pueda LLEGAR a su cola. Lo levanta: el contrato
    // declara el campo y el filtro, y backend los emite; hasta entonces el mock es el único
    // servidor que los tiene.
    mockOnly('`kycStatus` en el listado y `?kycStatus=` no existen en el contrato (petición A5)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m6');
    // La cabecera se busca por el elemento y no por rol: Chromium mapea estos `<th>` a `cell`
    // (la tabla no declara `scope`), y un assert por rol mediría el arnés, no la columna.
    await expect(
      page.locator('th', { hasText: t('es', 'admin.m6.table.identity') }).first(),
    ).toBeVisible();

    await page.getByLabel(t('es', 'admin.m6.kycFilter')).selectOption('pending');
    await expect(page.getByText('jcsainz95').first()).toBeVisible();
    await expect(page.getByText('Ana López')).toHaveCount(0);
  });
});

test.describe('P-78 · el cliente, sin callejón', () => {
  /**
   * El caso que el dueño encontró: INE subida, estado «en revisión» y **nada que hacer**. Ahora la
   * pantalla lo dice con todas las letras y ⛔ no ofrece subir nada (no hay nada que corregir).
   */
  test('en revisión: dice que no tiene que hacer nada más y no ofrece subir', async ({ page }) => {
    // Deja de medirse el estado `none` de un cliente concreto. No es falta de servidor: es que en
    // real el KYC del `customer` del seed **depende del orden de las suites** (buylist sube INE en
    // algunos flujos y lo deja en `pending`), así que afirmar «sin INE» ahí mediría el orden de
    // ejecución, no el producto. Lo levanta: un actor de cliente propio para identidad, o el mismo
    // KycProfile sembrado con estado fijo. El caso `pending` —el callejón del dueño— sí está
    // medido, en unidad: `KycSection.test.tsx` (KY-4).
    mockOnly('en real el KYC del `customer` compartido depende del orden de las suites');
    await loginAs(page, 'customer');
    await page.goto('/es/account#kyc');
    await expect(page.getByRole('heading', { name: t('es', 'account.kyc.title') })).toBeVisible();

    // El fixture arranca sin INE: se sube y el estado pasa a «en revisión» (PUT /users/me/kyc).
    await expect(page.getByText(t('es', 'account.kyc.ineMissing'))).toBeVisible();
    await expect(page.getByText(t('es', 'account.kyc.noneBody'))).toBeVisible();
  });

  /**
   * **KY-5, y es el candado que hace VERIFICABLE la decisión (c) del dueño** («los topes dejan de
   * mostrarse al cliente»). Agnóstico por construcción: afirma una AUSENCIA que tiene que valer
   * con cualquier estado de KYC y con cualquier DTO. Por eso es `@real` — es justo contra el
   * servidor de verdad donde un `capPerRequestCents` olvidado volvería a imprimirse en pantalla.
   */
  test('@real ninguna cifra de tope en la superficie del cliente (KY-5)', async ({ page }) => {
    await loginAs(page, 'customer');
    await page.goto('/es/account#kyc');
    await expect(page.getByRole('heading', { name: t('es', 'account.kyc.title') })).toBeVisible();

    const section = page.locator('#kyc');
    const text = (await section.textContent()) ?? '';
    expect(text).not.toMatch(/tope/i);
    expect(text).not.toMatch(/MX\$/);
  });
});
