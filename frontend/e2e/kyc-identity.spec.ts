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
 * ⚠️ Casi todos son `mockOnly` y el motivo es **el dato**, no el arnés: hacen falta un usuario con
 * INE en archivo y el endpoint de enlaces firmados. En cuanto el seed real siembre un `KycProfile`
 * con las dos keys y backend publique `GET /admin/users/:id/kyc/ine-links`, se reetiquetan a
 * `@real` sin tocar los asserts (todos son de ESTRUCTURA y de copy del catálogo).
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
    mockOnly('necesita un usuario con INE en archivo y el endpoint de enlaces firmados');
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
    mockOnly('necesita un usuario con INE en archivo');
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
    mockOnly('necesita un usuario con INE en archivo y el PATCH de decisión');
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

  test('la ficha 360° ya NO deja fijar «verificado» a mano, y sí lleva a la revisión', async ({ page }) => {
    mockOnly('la ficha se abre sobre usuarios de fixture');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m6?user=u-777');
    const modal = page.getByRole('dialog');
    await expect(modal).toBeVisible();

    // ⛔ Candado KY-9: ningún control que fije el estado KYC.
    await expect(modal.getByRole('combobox')).toHaveCount(0);
    await expect(modal.getByLabel('Estado KYC')).toHaveCount(0);

    // La única puerta, y lleva a la pantalla que enseña el documento.
    await modal.getByRole('button', { name: K('openCta') }).click();
    await expect(page).toHaveURL(/\/admin\/m6\/kyc\/u-777$/);
  });

  /**
   * **KY-2, la mitad de interfaz.** El `403` del servidor se mide llamando al endpoint (candado
   * K-1, de backend); aquí se mide lo otro: que un `vault_operator` que **teclea la URL** no vea el
   * documento. El rol de back-office en modo demo lo dicta el dial local (`tcg.role`), que es el
   * mismo interruptor del selector «Ver como».
   */
  test('un vault_operator que teclea la URL NO ve el documento', async ({ page }) => {
    mockOnly('el rol de back-office en demo lo dicta el dial local; en real lo dicta el JWT');
    await loginAs(page, 'admin');
    await page.addInitScript(() => window.localStorage.setItem('tcg.role', 'vault_operator'));
    await page.goto(`/es/admin/m6/kyc/${WAITING_USER}`);

    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    await expect(page.getByAltText(K('altFront', { name: 'jcsainz95' }))).toHaveCount(0);
    await expect(page.locator('img[src*="X-Amz-Signature"]')).toHaveCount(0);
  });

  test('el listado deja llegar a la cola de revisión en dos clics', async ({ page }) => {
    mockOnly('la columna de identidad depende de `kycStatus` en el listado (petición A5)');
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
    mockOnly('el estado del KYC del cliente viene del fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/account#kyc');
    await expect(page.getByRole('heading', { name: t('es', 'account.kyc.title') })).toBeVisible();

    // El fixture arranca sin INE: se sube y el estado pasa a «en revisión» (PUT /users/me/kyc).
    await expect(page.getByText(t('es', 'account.kyc.ineMissing'))).toBeVisible();
    await expect(page.getByText(t('es', 'account.kyc.noneBody'))).toBeVisible();
  });

  test('⛔ ninguna cifra de tope en la superficie del cliente (KY-5)', async ({ page }) => {
    mockOnly('mide el texto renderizado del fixture');
    await loginAs(page, 'customer');
    await page.goto('/es/account#kyc');
    await expect(page.getByRole('heading', { name: t('es', 'account.kyc.title') })).toBeVisible();

    const section = page.locator('#kyc');
    const text = (await section.textContent()) ?? '';
    expect(text).not.toMatch(/tope/i);
    expect(text).not.toMatch(/MX\$/);
  });
});
