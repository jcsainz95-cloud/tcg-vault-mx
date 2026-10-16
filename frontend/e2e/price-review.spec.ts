import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, realOnly } from './utils/auth';

/**
 * # §PRE · «Precios por revisar» (la cola del candado anti-inflado) en un NAVEGADOR de verdad
 *
 * QA lo pidió (criterio 889): no existía ningún click-through de navegador para esta pantalla. Es el
 * smoke del flujo del DUEÑO (`super_admin`): entrar a `/admin/m10` → sección «Precios por revisar» →
 * ver un caso con sus datos delante (propuesto, base, salto ×N, lo que dijo cada fuente) → **paginar**
 * (llegar a un caso más allá del 50) → **resolver** (Aceptar / Conservar / Precio a mano) → y el **409**
 * de doble resolución.
 *
 * ## El reparto mock ↔ real, y por qué
 * - **El smoke completo es `mockOnly`.** La cola, el salto ×55, los 51 casos que hacen falta para que
 *   haya una segunda página y las tres resoluciones viven en `src/lib/mock/fixtures.ts`. Contra el stack
 *   real, además, «Aceptar»/«Conservar»/«Precio a mano» **escribirían precios de verdad** en la tienda:
 *   un smoke no mueve dinero (misma regla que `admin-fx.spec.ts`).
 * - **El `409` va aparte, bajo `realOnly`,** y por el mismo motivo que `m4-preparation.spec.ts` (`PR-11..16`):
 *   la corrida de mocks **no emite red**, así que no hay respuesta que interceptar para forzar el conflicto.
 *   Contra el stack se intercepta el `POST …/resolve` con `page.route` y se afirma el aviso «ya se resolvió».
 *   La forma del `409` también está cubierta de forma determinista en el test de componente
 *   (`PriceReviewSection.test.tsx`).
 *
 * El «servidor» de mocks se reinicia con cada carga completa: dentro de un caso se navega por la APP
 * (clics), no con `goto`, para que el estado sobreviva.
 */

const PR = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m10.priceReview.${key}`, vars);

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}

test.describe('§PRE · Precios por revisar (navegador)', () => {
  test('smoke del dueño: ve un caso con sus datos, pagina más allá del 50 y resuelve (modo mocks)', async ({
    page,
  }) => {
    mockOnly(
      'la cola, el ×55, los 51 casos de relleno y las tres resoluciones son datos de `src/lib/mock/fixtures.ts`; en real las resoluciones escribirían precios',
    );
    const errors = collectPageErrors(page);
    await loginAs(page, 'admin'); // `admin` = super_admin (único rol que ve esta cola, §PRE.E)
    await page.goto('/es/admin/m10');

    const sec = page.getByTestId('m10-price-review');
    await sec.scrollIntoViewIfNeeded();
    await expect(sec.getByRole('heading', { name: PR('title') })).toBeVisible();

    // ── Un caso sembrado, con los datos para decidir delante (criterio 876) ──────────────────────
    const gengar = sec.getByTestId('price-review-case-prc-1');
    await expect(gengar).toBeVisible();
    await expect(gengar).toContainText('Gengar VMAX'); // la carta
    await expect(gengar).toContainText('MX$5,500.00'); // el precio propuesto
    await expect(gengar).toContainText('MX$100.00'); // el precio base (actual)
    await expect(gengar).toContainText('×55'); // el salto, legible
    await expect(gengar).toContainText('cardmarket'); // lo que dijo una fuente
    await expect(gengar).toContainText(PR('quote.stale')); // una cotización vieja que no votó

    // ── Defensa de la condición E: un caso con propuesto $0 tiene «Aceptar» deshabilitado ────────
    const zero = sec.getByTestId('price-review-case-prc-f-zero');
    await zero.scrollIntoViewIfNeeded();
    await expect(zero.getByTestId('price-review-accept-prc-f-zero')).toBeDisabled();
    // Pero sus salidas sensatas siguen vivas.
    await expect(zero.getByRole('button', { name: new RegExp(PR('actions.keep')) })).toBeEnabled();

    // ── Paginar: llegar a un caso MÁS ALLÁ del 50 (prc-f-49, en la página 2) ──────────────────────
    await expect(sec.getByTestId('price-review-page-info')).toContainText(
      PR('page.showing', { from: 1, to: 50, total: 51 }),
    );
    await sec.getByRole('button', { name: PR('page.next') }).click();
    await expect(sec.getByTestId('price-review-case-prc-f-49')).toBeVisible();
    await expect(sec.getByTestId('price-review-page-info')).toContainText(
      PR('page.showing', { from: 51, to: 51, total: 51 }),
    );
    // Volver a la página 1 para resolver sobre los casos curados.
    await sec.getByRole('button', { name: PR('page.prev') }).click();
    await expect(sec.getByTestId('price-review-case-prc-1')).toBeVisible();

    // ── Resolver: ACEPTAR un caso con propuesto > 0 ⇒ sale de la cola abierta ─────────────────────
    const charizard = sec.getByTestId('price-review-case-prc-2');
    await charizard.getByTestId('price-review-accept-prc-2').click();
    await expect(sec.getByTestId('price-review-case-prc-2')).toHaveCount(0);

    // ── Resolver: CONSERVAR (prc-1) ⇒ sale de la cola ─────────────────────────────────────────────
    await gengar.getByRole('button', { name: new RegExp(PR('actions.keep')) }).click();
    await expect(sec.getByTestId('price-review-case-prc-1')).toHaveCount(0);

    // ── Resolver: PRECIO A MANO (un relleno) con un monto > 0 ─────────────────────────────────────
    const filler = sec.getByTestId('price-review-case-prc-f-1');
    await filler.getByRole('button', { name: new RegExp(PR('actions.manual')) }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: PR('manual.title') })).toBeVisible();
    await dialog.getByLabel(new RegExp(PR('manual.priceLabel'))).fill('150');
    await dialog.getByRole('button', { name: PR('manual.save') }).click();
    await expect(sec.getByTestId('price-review-case-prc-f-1')).toHaveCount(0);

    expect(errors, 'la pantalla no debe lanzar errores de runtime').toEqual([]);
  });

  test('@real el 409 de doble resolución se lee como «ya se resolvió» (intercepta la respuesta)', async ({
    page,
  }) => {
    realOnly('intercepta la respuesta del `POST …/resolve`; en mock el cliente resuelve en proceso (cero red)');
    await loginAs(page, 'admin');

    // Se inyecta UNA cola con un caso `open` (no se depende del seed) y el `resolve` se fuerza a 409,
    // como si otra pestaña o el barrido ya lo hubieran cerrado (§PRE.F). No llega nada al backend ⇒ no
    // mueve dinero.
    const seededCase = {
      id: 'prc-real-1',
      card: { id: 'c-real', name: 'Umbreon VMAX', setName: 'Evolving Skies', number: '215' },
      finish: 'holofoil',
      productType: 'raw',
      gradeKey: 'raw:NM',
      cardProductId: 'cp-real',
      axis: 'sell',
      proposedMxnCents: 900000,
      baselineMxnCents: 120000,
      jumpFactorMilli: 7500,
      sourceCount: 1,
      familyCount: 1,
      consensus: false,
      quotes: [{ source: 'cardmarket', family: 'cardmarket', priceMxnCents: 900000, capturedDate: '2026-10-11', stale: false }],
      status: 'open',
      createdAt: '2026-10-11T07:30:00Z',
    };

    await page.route('**/admin/pricing/review-queue?**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ data: [seededCase], total: 1, counts: { open: 1 } }),
      }),
    );
    await page.route('**/admin/pricing/review-queue/*/resolve', (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { code: 'CONFLICT', message: 'Case is no longer open', details: { status: 'accepted', resolvedAt: '2026-10-11T08:00:00Z' } },
        }),
      }),
    );

    await page.goto('/es/admin/m10');
    const sec = page.getByTestId('m10-price-review');
    await sec.scrollIntoViewIfNeeded();
    const kase = sec.getByTestId('price-review-case-prc-real-1');
    await expect(kase).toBeVisible();

    // Resolver un caso que el servidor ya cerró ⇒ el aviso «ya se resolvió», ⛔ no un error de red.
    await kase.getByRole('button', { name: new RegExp(PR('actions.keep')) }).click();
    await expect(sec.getByText(PR('conflict.title'))).toBeVisible();
  });
});
