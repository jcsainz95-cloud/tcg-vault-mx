import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, IS_REAL, skipIfSeedMissing } from './utils/auth';
import { seedGuestOrderAlreadyClaimed } from './utils/orders';

/**
 * Stream A · F7 (DESIGN_SYSTEM §33.9, contrato v1.67 «nota de consumo» de GET /orders/claimable):
 * el aviso de pedidos reclamables NUNCA se pinta vacío ni en error, aparece solo con datos y
 * desaparece al reclamar.
 *
 * Segundo caso AGNÓSTICO (techlead F2-1): en mock los reclamables del fixture se sirven solo con
 * `localStorage['tcg.mock.claimable']='1'` (§67.6 de FRONTEND_NOTES: el default sigue `[]` porque el
 * primer caso mide precisamente «con [] no hay nodo»); contra el backend real el dato es el pedido de
 * invitado SIN reclamar con el correo del cliente que siembra `seed-e2e.ts` — si no está, se salta con
 * la razón. La unidad `ClaimableOrdersNotice.test.tsx` cubre el ciclo con el endpoint espiado.
 *
 * ⚠️ **ESTE CASO CONSUME SU FIXTURE, y ése es el salto que baila (QA, 2ª pasada, 2026-09-14).**
 * `seed-e2e.ts` siembra **UN** pedido de invitado sin reclamar (`TCG-E2E-GUEST-0001`) y reclamarlo es
 * justo lo que el caso mide ⇒ primera corrida tras `--seed`: mide; segunda y siguientes: se salta.
 * Junto con los cuatro de `account.spec.ts` ésa era la diferencia de CINCO casos entre `55/3/1` y
 * `50/3/6`.
 *
 * ⛔ **Por qué NO se fabrica el pedido desde el test, aunque se pueda.** `POST /checkout/guest/session`
 * crearía uno (medido en el backend: `listClaimable` filtra por `guestEmail/userId/claimedAt` y **no**
 * por estado, así que hasta el `failed` del 503 sin Stripe valdría). Pero ese endpoint está limitado a
 * **5 por hora y por IP** (contrato §4-G.2) y la suite ya gasta 1 en `guest-checkout.spec.ts`: a 2 por
 * corrida, la **tercera corrida de la misma hora** se comería el cupo y devolvería `429`. Sería cambiar
 * un salto que se explica por un **flake nuevo en un flujo de dinero** — la misma avería que la
 * inanición del cupo de login (§75.5). Se deja el salto, se dice su causa EXACTA, y el censo dinámico
 * (`e2e/reporters/not-measured.ts`) lo declara en el informe en vez de esconderlo tras un «3 fallos».
 */

/**
 * La razón del salto, MEDIDA en vez de supuesta: distingue «la suite ya se lo comió» de «el seed no
 * lo sembró». Hasta hoy las dos salían con el mismo texto, que además acusaba al seed en el caso en
 * que el seed no tenía culpa.
 */
async function missingClaimableReason(): Promise<string> {
  if (!IS_REAL) return 'el pool de reclamables del fixture no se encendió';
  return (await seedGuestOrderAlreadyClaimed())
    ? 'el ÚNICO pedido de invitado del seed (TCG-E2E-GUEST-0001) ya está RECLAMADO: se lo comió una ' +
        'corrida anterior de ESTE mismo caso, que es lo que el caso mide. El seed hizo su trabajo; el ' +
        'fixture es de un solo uso. Se repone con `./scripts/stack-native.sh up --seed` (⚠ purga evidencia)'
    : 'un pedido de invitado SIN reclamar con el correo del customer: no está ni sin reclamar ni ' +
        'reclamado en el historial ⇒ `seed-e2e.ts` no lo sembró en este stack';
}
test.describe('pedidos reclamables · aviso (F7)', () => {
  test('con [] (nada que ofrecer) no hay ningún nodo del aviso en /vault ni en /orders', async ({ page }) => {
    test.skip(IS_REAL, 'en real el seed puede tener reclamables: la ausencia no es un hecho medible');
    await loginAs(page, 'customer');

    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'orders.claimable.cta') })).toHaveCount(0);

    await page.goto('/es/orders');
    await expect(page.getByRole('heading', { level: 1, name: t('es', 'orders.title') })).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'orders.claimable.cta') })).toHaveCount(0);
  });

  test('@real aparece con pedidos del correo verificado, «Vincular a mi cuenta» lo reclama y desaparece', async ({ page }) => {
    await loginAs(page, 'customer');
    if (!IS_REAL) {
      // Rama mock: enciende el pool de reclamables del fixture (los reclamados se anotan en
      // `tcg.mock.claimed` y no vuelven tras recargar, como el backend).
      await page.addInitScript(() => window.localStorage.setItem('tcg.mock.claimable', '1'));
    }
    await page.goto('/es/vault');
    await expect(page.getByRole('heading', { name: t('es', 'vault.title') })).toBeVisible();

    const notice = page.getByTestId('claimable-orders-notice');
    // Dato del seed (real): si no hay reclamables para este cliente, se salta con la razón.
    const present = await notice.waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false);
    skipIfSeedMissing(!present, await missingClaimableReason());

    // Cuerpo de la bóveda: dice que NO entran a la bóveda (regla 5 de §33.0).
    await expect(notice.getByText(t('es', 'vault.claimable.body'))).toBeVisible();
    await notice.getByRole('button', { name: t('es', 'orders.claimable.cta') }).click();
    await expect(page.getByText(/PEDIDOS? EN TU HISTORIAL/)).toBeVisible();
    await expect(notice).toHaveCount(0);

    // Recarga: la siguiente consulta viene vacía ⇒ no vuelve.
    await page.reload();
    await expect(page.getByText(t('es', 'vault.portfolioValue'))).toBeVisible();
    await expect(page.getByTestId('claimable-orders-notice')).toHaveCount(0);
  });
});
