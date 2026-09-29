import { test, expect, type Page, type Response } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, realOnly, skipIfSeedMissing } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';

/**
 * **Cubeta «Reembolsos manuales (SPEI)» contra el STACK REAL** — P-REL-3 · contrato §M4-SHIP.15.13 y §M4-SHIP.17.3
 * (v1.80.8: `outcome` `paid|already_paid` / `cancelled|already_cancelled`) · `DESIGN_SYSTEM §37.9b`.
 *
 * Por qué existe: `m4-ship.spec.ts` corre 100 % contra mocks (el servidor con estado de `lib/mock/m4-ship`), y el
 * bloqueante BLOQ-1 de QA vivió justo en esta cubeta. Un mock no puede decir si la pantalla y la API real
 * concuerdan: aquí se conduce la UI horneada contra el backend y se asevera **la respuesta real** interceptada
 * (`waitForResponse`) y **lo que la pantalla pinta** con ella.
 *
 * Semilla: `backend/prisma/seed-e2e.ts` (dd6fb1d7) — `E2E_SPEI_FIXTURE` en `backend/prisma/e2e-fixtures.ts:544`:
 * cliente `spei.refund@e2e.local` y dos filas `pending` (`e2e:mr-pay` MX$535.00 folio `E2E-SPEI-0001`;
 * `e2e:mr-cancel` MX$315.00 folio `E2E-SPEI-0002`). La CLABE NO se siembra (clave PII del proceso): la registra el
 * propio cliente por `PUT /users/me/kyc`. Eso sella `clabeUpdatedAt = now` ⇒ `clabeChangedRecently: true` ⇒ el
 * primer `paid` DEBE volver `422 MANUAL_REFUND_CONFIRMATION_REQUIRED` y la pantalla debe pedir la casilla
 * reforzada. **Consume las filas**: cada corrida necesita re-sembrar (`stack-native.sh up --seed`); sin fila
 * `pending` el caso se salta con esa frase (salto por dato del seed), no pinta un rojo que no habla del producto.
 *
 * Solo contra el backend real: afirma PETICIONES HTTP y en mock el cliente resuelve en proceso (cero red).
 */

const MR = (key: string, vars?: Record<string, string | number>) => t('es', `admin.manualRefunds.${key}`, vars);

// Espejo de `E2E_SPEI_FIXTURE` (backend/prisma/e2e-fixtures.ts:544). Se copian las constantes, no se importan:
// el frontend no depende del árbol de backend.
const SPEI = {
  email: 'spei.refund@e2e.local',
  name: 'Ana Transferencia E2E',
  pay: { folio: 'E2E-SPEI-0001', amountCents: 53500, amount: 'MX$535.00' },
  cancel: { folio: 'E2E-SPEI-0002', amountCents: 31500, amount: 'MX$315.00' },
} as const;
/** CLABE de prueba (18 dígitos; la validación del contrato es estructural). */
const CLABE = '646180110400000007';
const EIGHTEEN_DIGITS = /\d{18}/;

interface MrRow {
  id: string;
  status: string;
  amountCents: number;
  customer: { email: string };
  case: { folio: string };
  speiReference: string | null;
  cancelNote: string | null;
  clabeMasked: string | null;
}
type MrOutcome = MrRow & { outcome?: string };
interface ApiErrorBody<D = Record<string, unknown>> {
  error: { code: string; message?: string; details?: D };
}

async function findPending(folio: string): Promise<MrRow | null> {
  const res = await apiAsOk<{ data: MrRow[] }>(
    'admin',
    'GET',
    `/admin/manual-refunds?status=pending&q=${encodeURIComponent(SPEI.email)}`,
  );
  return res.data.find((r) => r.case.folio === folio && r.customer.email === SPEI.email) ?? null;
}

/** El cliente registra su CLABE (idempotente: la misma CLABE no reescribe nada, §M4-SHIP.17.3 punto 1). */
async function ensureClabe(): Promise<void> {
  await apiAsOk('speiCustomer', 'PUT', '/users/me/kyc', { clabe: CLABE });
}

function waitApi(page: Page, method: string, re: RegExp): Promise<Response> {
  return page.waitForResponse((r) => r.request().method() === method && re.test(new URL(r.url()).pathname));
}

/** Lista → buscar por correo → «Ver» → detalle. Asevera que la CLABE no está en el HTML en ningún paso. */
async function openFromBucket(page: Page, id: string): Promise<void> {
  await page.goto('/es/admin/manual-refunds');
  await page.getByRole('searchbox', { name: MR('search') }).fill(SPEI.email);
  const row = page.getByTestId(`mr-row-${id}`);
  await expect(row).toBeVisible();
  expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);
  await row.getByRole('link', { name: MR('view') }).click();
  await expect(page).toHaveURL(new RegExp(`/admin/manual-refunds/${id}`));
  await expect(page.getByTestId('mr-reveal')).toBeVisible();
  expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);
}

/** «Revelar CLABE» — asevera la respuesta real de `GET …/reveal-clabe` y la pantalla que la pinta. */
async function revealAndCheck(page: Page, id: string): Promise<string> {
  const revealRes = waitApi(page, 'GET', new RegExp(`/admin/manual-refunds/${id}/reveal-clabe$`));
  await page.getByTestId('mr-reveal').click();
  const res = await revealRes;
  expect(res.status()).toBe(200);
  const body = (await res.json()) as {
    clabe: string;
    beneficiaryName: string | null;
    clabeChangedRecently: boolean;
    revealToken: string;
  };
  expect(body.clabe).toBe(CLABE);
  expect(body.beneficiaryName).toBe(SPEI.name);
  expect(body.clabeChangedRecently).toBe(true);
  expect(typeof body.revealToken).toBe('string');
  expect(body.revealToken.length).toBeGreaterThan(0);

  await expect(page.getByTestId('mr-clabe')).toHaveText(CLABE);
  await expect(page.getByText(MR('reveal.beneficiary', { name: SPEI.name }))).toBeVisible();
  await expect(page.getByText(MR('reveal.changedRecently'))).toBeVisible();
  return body.revealToken;
}

test.describe('admin · cubeta SPEI contra el stack real (§M4-SHIP.15.13 / .17.3)', () => {
  test.describe.configure({ mode: 'serial' });
  test.use({ viewport: { width: 1280, height: 800 } });

  test.beforeEach(async ({ page }) => {
    realOnly('afirma PETICIONES HTTP y en mock el cliente resuelve en proceso (cero red)');
    await loginAs(page, 'admin');
  });

  test('@real revelar CLABE → «Marcar pagada» (422 reforzado → casilla → outcome paid); repetir ⇒ already_paid', async ({ page }) => {
    const row = await findPending(SPEI.pay.folio);
    skipIfSeedMissing(!row, `ninguna ManualRefund pending ${SPEI.pay.folio} de ${SPEI.email} (re-siembra: stack-native.sh up --seed)`);
    const id = row!.id;
    expect(row!.amountCents).toBe(SPEI.pay.amountCents);
    await ensureClabe();

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openFromBucket(page, id);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.getByTestId('mr-paid-cta')).toHaveCount(0);

    const revealToken = await revealAndCheck(page, id);

    const ref = `E2E${Date.now().toString(36).toUpperCase()}`;
    await page.getByTestId('mr-spei-ref').fill(ref);
    await expect(page.getByTestId('mr-paid-cta')).toHaveText(MR('paid.cta', { amount: SPEI.pay.amount }));

    // 1.er intento: la CLABE se registró hace segundos ⇒ el servidor exige la confirmación reforzada.
    await page.getByTestId('mr-paid-cta').click();
    let dialog = page.getByRole('dialog', { name: MR('paid.title') });
    await expect(dialog.getByRole('button', { name: t('es', 'common.cancel') })).toBeFocused();
    const first = waitApi(page, 'POST', new RegExp(`/admin/manual-refunds/${id}/paid$`));
    await dialog.getByTestId('mr-paid-confirm').click();
    const firstRes = await first;
    expect(firstRes.status()).toBe(422);
    // Sobre del contrato: `{ error: { code, message, details } }`.
    const firstBody = (await firstRes.json()) as ApiErrorBody<{ required?: string[] }>;
    expect(firstBody.error.code).toBe('MANUAL_REFUND_CONFIRMATION_REQUIRED');
    expect(firstBody.error.details?.required).toContain('recent_clabe_change');
    expect(JSON.parse(firstRes.request().postData() ?? '{}')).toMatchObject({ revealToken, speiReference: ref });
    await expect(page.getByTestId('mr-error')).toContainText(MR('error.confirmMissing'));

    // 2.º intento con la casilla: 200 y `outcome: 'paid'` (v1.80.8, aditivo al DTO).
    await page.getByTestId('mr-confirm-clabe').check();
    await page.getByTestId('mr-paid-cta').click();
    dialog = page.getByRole('dialog', { name: MR('paid.title') });
    const second = waitApi(page, 'POST', new RegExp(`/admin/manual-refunds/${id}/paid$`));
    await dialog.getByTestId('mr-paid-confirm').click();
    const secondRes = await second;
    expect(secondRes.status()).toBe(200);
    expect(JSON.parse(secondRes.request().postData() ?? '{}')).toMatchObject({
      revealToken,
      speiReference: ref,
      confirmRecentClabeChange: true,
    });
    const paid = (await secondRes.json()) as MrOutcome;
    expect(paid.outcome).toBe('paid');
    expect(paid.id).toBe(id);
    expect(paid.status).toBe('paid');
    expect(paid.speiReference).toBe(ref);
    expect(JSON.stringify(paid)).not.toMatch(EIGHTEEN_DIGITS);

    // La pantalla pinta lo que devolvió el servidor, y la CLABE ya no está.
    await expect(page.getByTestId('mr-paid')).toContainText(MR('trackingKey', { ref }));
    await expect(page.getByTestId('mr-notice')).toContainText(MR('paid.done', { date: '' }).split('·')[0].trim());
    await expect(page.getByTestId('mr-clabe')).toHaveCount(0);
    await expect(page.getByTestId('mr-reveal')).toHaveCount(0);
    expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);

    // Repetir con la MISMA clave ⇒ `200 already_paid`, sin escribir (contrato §M4-SHIP.17.3 paso 3).
    const again = await apiAs<MrOutcome>('admin', 'POST', `/admin/manual-refunds/${id}/paid`, {
      revealToken,
      speiReference: ref,
      confirmRecentClabeChange: true,
    });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('already_paid');
    expect(again.body.status).toBe('paid');
    expect(again.body.speiReference).toBe(ref);

    // Y la CLABE ya no se puede revelar: `409 MANUAL_REFUND_NOT_PENDING`.
    const reveal = await apiAs<ApiErrorBody>('admin', 'GET', `/admin/manual-refunds/${id}/reveal-clabe`);
    expect(reveal.status).toBe(409);
    expect(reveal.body.error.code).toBe('MANUAL_REFUND_NOT_PENDING');

    // Recarga: el estado persistió (lo lee del servidor, no de la caché de la vista).
    await page.reload();
    await expect(page.getByTestId('mr-paid')).toContainText(MR('trackingKey', { ref }));
    expect(errors).toEqual([]);
  });

  test('@real revelar CLABE → «Cancelar» con nota (outcome cancelled); repetir ⇒ already_cancelled', async ({ page }) => {
    const row = await findPending(SPEI.cancel.folio);
    skipIfSeedMissing(!row, `ninguna ManualRefund pending ${SPEI.cancel.folio} de ${SPEI.email} (re-siembra: stack-native.sh up --seed)`);
    const id = row!.id;
    expect(row!.amountCents).toBe(SPEI.cancel.amountCents);
    await ensureClabe();

    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await openFromBucket(page, id);
    await revealAndCheck(page, id);

    const note = `E2E P-REL-3 se resolvió en efectivo ${Date.now()}`;
    await page.getByRole('button', { name: MR('cancel.cta'), exact: true }).click();
    const dialog = page.getByRole('dialog', { name: MR('cancel.title') });
    // `exact`: «Cancelar» (cerrar) vs «Cancelar transferencia» (el verbo) comparten prefijo.
    await expect(dialog.getByRole('button', { name: t('es', 'common.cancel'), exact: true })).toBeFocused();
    const confirm = dialog.getByRole('button', { name: MR('cancel.confirm') });
    await expect(confirm).toBeDisabled(); // nota obligatoria (3–500)
    await dialog.getByLabel(MR('cancel.reason')).fill(note);
    const cancelRes = waitApi(page, 'POST', new RegExp(`/admin/manual-refunds/${id}/cancel$`));
    await confirm.click();
    const res = await cancelRes;
    expect(res.status()).toBe(200);
    expect(JSON.parse(res.request().postData() ?? '{}')).toEqual({ note });
    const cancelled = (await res.json()) as MrOutcome;
    expect(cancelled.outcome).toBe('cancelled');
    expect(cancelled.id).toBe(id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.cancelNote).toBe(note);
    expect(JSON.stringify(cancelled)).not.toMatch(EIGHTEEN_DIGITS);

    await expect(page.getByTestId('mr-notice')).toHaveText(MR('cancel.done'));
    await expect(page.getByTestId('mr-cancelled')).toContainText(note);
    await expect(page.getByTestId('mr-cancelled').getByRole('button', { name: MR('reissue.cta') })).toBeVisible();
    await expect(page.getByTestId('mr-clabe')).toHaveCount(0);
    expect(await page.content()).not.toMatch(EIGHTEEN_DIGITS);

    // Repetir ⇒ `200 already_cancelled`, sin escribir.
    const again = await apiAs<MrOutcome>('admin', 'POST', `/admin/manual-refunds/${id}/cancel`, { note });
    expect(again.status).toBe(200);
    expect(again.body.outcome).toBe('already_cancelled');
    expect(again.body.status).toBe('cancelled');

    // Una cancelada no se paga: `409 MANUAL_REFUND_NOT_PENDING`.
    const pay = await apiAs<ApiErrorBody>('admin', 'POST', `/admin/manual-refunds/${id}/paid`, { revealToken: 'x' });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe('MANUAL_REFUND_NOT_PENDING');

    await page.reload();
    await expect(page.getByTestId('mr-cancelled')).toContainText(note);
    expect(errors).toEqual([]);
  });
});
