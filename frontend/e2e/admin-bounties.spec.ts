import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * # M2 › Bounties en un NAVEGADOR de verdad (`DESIGN_SYSTEM §28`, casos de §28.14)
 *
 * ## Por qué existe este archivo
 * La consola de bounties tenía **82 pruebas en jsdom y cero en navegador**, y jsdom **no aplica CSS**:
 * es exactamente el entorno en el que un desbordamiento horizontal, una cabecera que no se colapsa o
 * un foco que se pierde **no se ven**. QA lo midió: a 390×844 la tabla desbordaba 334 px y `PAGAMOS`
 * y `TARIFA VIGENTE` quedaban **fuera de la pantalla**, en la única pantalla cuyo trabajo es que el
 * dinero no se esconda. Ningún test podía cazarlo porque ninguno corría donde hay layout.
 *
 * Cubre los cuatro huecos que QA marcó como **no medidos**: **§28.9** (móvil), **caso 15** (rol),
 * **caso 17** (teclado puro) y la mitad medible del **caso 5** (los chips).
 *
 * ## ⚠️ Lo que este archivo NO puede medir, y por qué se dice aquí
 * **La otra mitad del caso 5 —`truncated: true`: el banner de lista incompleta y los chips con `≥`—
 * NO es alcanzable en modo mock.** No es una omisión: en modo fixtures `getAdminBounties` **no hace
 * ninguna petición HTTP** (`api.ts` corta antes y devuelve el servidor falso en proceso), así que no
 * hay nada que interceptar con `page.route`; y el techo de la lista son **1000 filas** contra las
 * **6** que puede tener la semilla (el servidor falso solo puede clasificar cartas que existan en
 * `mockCards`). Fabricar una puerta trasera —un `q` mágico, un tope configurable desde la URL— sería
 * meter en el bundle una rama que solo existe para que un test se ponga verde. *Un candado que se
 * abre desde fuera no es un candado.* Ese caso vive donde sí es real: en jsdom, donde la respuesta se
 * inyecta entera (`BountiesView.test.tsx`, «⭐ B-4 (espejo de cliente)»), y en el gate contra el
 * stack real, que es de QA.
 */

const B = (key: string, vars?: Record<string, string | number>) =>
  t('es', `admin.m2.bounties.${key}`, vars);

/** La carta `rebasada` de la semilla del servidor falso: la fila por la que existe la pantalla. */
const OUTBID_CARD = 'Charizard';

async function openBounties(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2/bounties');
  await expect(page.getByRole('heading', { name: B('title'), level: 1 })).toBeVisible();
  await expect(page.getByRole('table', { name: B('table.caption') })).toBeVisible();
}

/** Desbordamiento horizontal del DOCUMENTO, que es lo que obliga a barrer con el dedo. */
async function overflow(page: Page) {
  return page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
}

/**
 * Cuenta los roles de tabla **en el ÁRBOL DE ACCESIBILIDAD DEL NAVEGADOR**, no en el DOM.
 *
 * ⚠️ **Y no vale `getByRole` para esto.** El `getByRole` de Playwright deriva el rol del **DOM**
 * (`tagName` + atributos) y **no mira el `display`**: sobre un `<table>` desplomado a bloque
 * contestaría «table» aunque el navegador hubiera dejado de exponerlo. Sería un candado que mide
 * el marcado y afirma sobre la semántica. Esto lee el AX tree de Chromium por CDP, que es lo que
 * recibe un lector de pantalla.
 */
async function axTableRoles(page: Page): Promise<Record<string, number>> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Accessibility.enable');
  const { nodes } = (await cdp.send('Accessibility.getFullAXTree')) as {
    nodes: { role?: { value?: string } }[];
  };
  await cdp.detach();
  const count: Record<string, number> = { table: 0, rowgroup: 0, row: 0, rowheader: 0, cell: 0 };
  for (const n of nodes) {
    const role = n.role?.value;
    if (role && role in count) count[role] += 1;
  }
  return count;
}

test.describe('admin · M2 › Bounties', () => {
  test('§28.9 · a 390px la MISMA tabla se desploma en tarjetas y NO desborda', async ({ page }) => {
    mockOnly('las filas de bounty de la semilla son del servidor falso (§28 demo)');
    await openBounties(page);

    // ── Escritorio: es una tabla, con su cabecera de columnas ────────────────────────────────
    const headerPay = page.getByRole('columnheader', { name: B('col.pay') });
    await expect(headerPay).toBeVisible();
    const desktop = await overflow(page);
    expect(desktop.scrollW, 'la tabla desborda ya en escritorio').toBeLessThanOrEqual(desktop.clientW);

    // ── Móvil 390×844 (el viewport que QA midió) ─────────────────────────────────────────────
    await page.setViewportSize({ width: 390, height: 844 });

    // (1) ⭐ **La medición que faltaba.** `toBeVisible()` pasa igual con scroll horizontal: lo que
    //     hay que aseverar es que **no hay** scroll horizontal.
    const mobile = await overflow(page);
    expect(
      mobile.scrollW,
      `la pantalla desborda ${mobile.scrollW - mobile.clientW}px a 390 (§7.7 lo prohíbe)`,
    ).toBeLessThanOrEqual(mobile.clientW);

    // (2) El colapso OCURRIÓ: la cabecera de columnas desaparece…
    await expect(headerPay).toBeHidden();

    // (3) …y su trabajo lo hace el rótulo dentro de la tarjeta, que ahora SÍ se ve. Sin esto, el
    //     colapso sería una tabla sin cabecera: dos cifras de dinero sin nombre, que es peor.
    const card = page.locator('tr', { hasText: OUTBID_CARD }).first();
    await expect(card.getByText(B('col.pay'), { exact: true })).toBeVisible();
    await expect(card.getByText(B('col.rate'), { exact: true })).toBeVisible();
    await expect(card.getByText(B('col.premium'), { exact: true })).toBeVisible();
    await expect(card.getByText(B('col.progress'), { exact: true })).toBeVisible();

    // (4) El eje sobrevive al colapso —*«lo único innegociable»* de §28.9—: el encabezado de grupo
    //     sigue ahí, de título de sección. Se localiza por su SEMÁNTICA (`th[scope=rowgroup]`) y no
    //     por texto: «ATENCIÓN» casa también con la opción «Atención primero» del selector de orden.
    const groupHeader = page.locator('th[scope="rowgroup"]').first();
    await expect(groupHeader).toBeVisible();
    await expect(groupHeader).toContainText(B('group.attention'));

    // (5) Y las dos acciones de la fila siguen alcanzables dentro de la tarjeta.
    await expect(card.getByRole('button', { name: B('row.editAria', { card: OUTBID_CARD }) })).toBeVisible();
    await expect(card.getByRole('button', { name: B('row.turnOffAria', { card: OUTBID_CARD }) })).toBeVisible();

    // ── (6) ⭐ **DESPLOMADA, SIGUE SIENDO UNA TABLA PARA QUIEN NO LA VE** (§28.10) ─────────────
    // El colapso de §28.9 no puede pagarse con la semántica: *«el eje sobrevive al colapso»* vale
    // también —sobre todo— para el lector de pantalla. Se mide **después** del `setViewportSize`,
    // que es donde el `display` ya no es `table` y donde, por tanto, se puede perder.
    const ax = await axTableRoles(page);
    expect(ax.table, 'desplomada, la tabla dejó de exponerse como tabla').toBeGreaterThanOrEqual(1);
    expect(ax.row, 'desplomada, las filas dejaron de ser filas').toBeGreaterThanOrEqual(1);
    expect(ax.cell, 'desplomada, las celdas dejaron de ser celdas').toBeGreaterThanOrEqual(1);
    expect(ax.rowheader, 'el encabezado de grupo dejó de ser cabecera de grupo').toBeGreaterThanOrEqual(1);

    // ⚠️⚠️ **EL QUE DE VERDAD MUERDE, y está medido:** de los cinco roles explícitos, el único que
    // Chromium **no** deriva solo es `rowgroup` — Blink **ignora el `<tbody>`** si no lleva rol, así
    // que sin `role="rowgroup"` esta cuenta cae de N a **CERO** a 390px (la cabecera, que sí aporta
    // un rowgroup implícito, está en `display:none` aquí). Y con ella se va **el agrupamiento**, que
    // es lo único innegociable de §28.9. Se compara contra los `<tbody>` que hay: un grupo, un
    // rowgroup. ⛔ Si alguien «limpia atributos redundantes», esto es lo que se pone rojo.
    const tbodies = await page.locator('table > tbody').count();
    expect(tbodies).toBeGreaterThan(0);
    expect(
      ax.rowgroup,
      'los `<tbody>` dejaron de exponerse como grupos de filas al colapsar',
    ).toBe(tbodies);
  });

  test('§28.14 caso 15 · con `vault_operator` la pantalla NO se renderiza', async ({ page }) => {
    mockOnly('el switcher de rol «Ver como» solo existe en modo demo (en real el rol lo dicta el JWT)');
    // ⚠️ El cambio de rol se hace **sobre la propia pantalla**, sin navegar: `loginAs` instala un
    // `addInitScript` que reescribe `tcg.role` con el rol del usuario **en cada navegación**, así
    // que un `selectOption` seguido de un `goto` volvería a `super_admin` y el test pasaría por el
    // motivo equivocado. Así además se mide algo más fuerte: la pantalla **se retira en vivo**.
    await openBounties(page);
    await page.getByLabel(t('es', 'admin.roleLabel')).selectOption('vault_operator');

    // Ni la pantalla, ni una versión en solo lectura: la puerta cerrada y su motivo.
    await expect(page.getByText(t('es', 'admin.superAdminGateTitle'))).toBeVisible();
    await expect(page.getByRole('table', { name: B('table.caption') })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: B('title'), level: 1 })).toHaveCount(0);
  });

  test('§28.14 caso 17 · teclado puro: `Esc` confirma, y el foco vuelve al `Editar` de ESA fila', async ({
    page,
  }) => {
    mockOnly('las filas de bounty de la semilla son del servidor falso (§28 demo)');
    await openBounties(page);

    const editButton = page
      .getByRole('button', { name: B('row.editAria', { card: OUTBID_CARD }) })
      .first();

    // Abrir con TECLADO (no con el ratón): el foco entra en `Pagamos`, que es el campo que la fila
    // pide arreglar.
    await editButton.focus();
    await editButton.press('Enter');
    const price = page.getByLabel(B('edit.price'));
    await expect(price).toBeFocused();

    // Teclear y descartar con `Esc` ⇒ **confirma antes de perder lo tecleado** (§28.6b).
    await price.fill('1200');
    await price.press('Escape');
    const confirm = page.getByRole('button', { name: t('es', 'common.confirm') });
    await expect(confirm).toBeVisible();

    // Se confirma también con teclado.
    await confirm.focus();
    await confirm.press('Enter');

    // ⭐ Lo que este caso existe para medir: el foco **no se pierde** ni salta al principio de la
    // tabla — vuelve al `Editar` de la fila que se estaba editando (§28.10).
    await expect(price).toHaveCount(0);
    await expect(editButton).toBeFocused();

    // Y desde ahí se puede seguir sin tocar el ratón: `Enter` reabre, `Esc` cierra (sin cambios no
    // pregunta) y el foco vuelve otra vez.
    await editButton.press('Enter');
    await expect(page.getByLabel(B('edit.price'))).toBeFocused();
    await page.getByLabel(B('edit.price')).press('Escape');
    await expect(editButton).toBeFocused();
  });

  test('§28.14 caso 5 (la mitad medible) · los cinco chips se ven con su número, y sin lista cortada no hay aviso', async ({
    page,
  }) => {
    mockOnly('los conteos salen de las seis filas de la semilla del servidor falso');
    await openBounties(page);

    // Los CINCO, siempre, ninguno escondido por estar en cero (§28.5).
    for (const state of ['rebasada', 'invalida', 'activa', 'completada', 'apagada'] as const) {
      const label = B(`counts.${state}`, { count: '' }).trim();
      await expect(page.getByRole('button', { name: new RegExp(label) })).toBeVisible();
    }
    // El conjunto de la semilla NO está cortado ⇒ ni banner ni `≥` (la otra mitad del caso, la de
    // `truncated: true`, no es alcanzable en mocks — ver la cabecera de este archivo).
    await expect(page.getByText(B('list.truncated'))).toHaveCount(0);
  });
});
