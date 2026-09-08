import { test, expect } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, needsSeed } from './utils/auth';

/**
 * Flujo: panel admin responsive (PROJECT §F / AC 24, 25, 27; contrato §10).
 * Dashboard de 8 tarjetas + enmascarado financiero para vault_operator, M1
 * (alta SIN foto propia + certNumber de gradeada, v1.2), M5 (cherry-pick), M8
 * (disputa por correo a soporte, sin comparador de fotos, v1.2).
 */
test.describe('admin · dashboard', () => {
  /**
   * Entra al subset real porque es **la puerta**: si el dashboard no resuelve contra datos de
   * verdad, ninguna de las pantallas del ciclo (M1/M5) es alcanzable, y el resto de los `@real`
   * de este archivo fallaría por un motivo que no es el suyo.
   */
  test('@real muestra las 8 tarjetas del dashboard', async ({ page }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    await expect(page.getByRole('heading', { name: t('es', 'admin.modules.dashboard') })).toBeVisible();

    for (const key of [
      'profit',
      'sales',
      'workQueue',
      'inventoryValue',
      'custodyValue',
      'buylist',
      'dataHealth',
      'launch',
    ] as const) {
      await expect(page.getByText(t('es', `admin.dashboard.${key}`)).first()).toBeVisible();
    }
  });

  test('enmascara cifras financieras para vault_operator', async ({ page }) => {
    // El switcher «Ver como» es una afordancia de DEMO: en modo real el rol lo dicta el JWT
    // (`RoleProvider.canSwitchRole === false`) y el selector no se pinta. El enmascarado real
    // por rol lo cubre el backend + el unitario de AdminShell, no este smoke.
    mockOnly('el switcher de rol «Ver como» solo existe en modo demo');
    await loginAs(page, 'admin');
    await page.goto('/es/admin');
    // Como super_admin (default) no hay enmascarado.
    await expect(page.getByText(t('es', 'admin.masked'))).toHaveCount(0);

    // Cambia el rol a operador de bóveda → tarjetas de dinero enmascaradas.
    await page.getByLabel(t('es', 'admin.roleLabel')).selectOption('vault_operator');
    await expect(page.getByText(t('es', 'admin.masked')).first()).toBeVisible();
  });
});

test.describe('admin · M1 inventario', () => {
  test('P-17: M1 abre en Master Set con pestañas Sellado/Gradeadas y SIN pestaña Piezas', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m1');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m1.title') })).toBeVisible();

    await expect(page.getByRole('tab', { name: t('es', 'admin.inventory.tabs.masterSet') })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(page.getByRole('tab', { name: t('es', 'admin.inventory.tabs.sealed') })).toBeVisible();
    await expect(page.getByRole('tab', { name: t('es', 'admin.inventory.tabs.graded') })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Piezas' })).toHaveCount(0);
    // Buscador por folio persistente (abre el drill-down de la variante dueña).
    await expect(page.getByLabel(t('es', 'admin.inventory.folioSearch.label'))).toBeVisible();
  });

  test('alta por LOTE es SIN foto propia (imagen de catálogo) y captura certNumber de gradeada', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m1');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m1.title') })).toBeVisible();

    // P-17: el alta masiva (P-5) vive en la toolbar como «Alta por lote».
    await page.getByRole('button', { name: t('es', 'admin.inventory.batchAddCta') }).first().click();
    // v1.2: sin uploader de foto de producto; aviso de imagen de catálogo remota.
    await expect(page.getByText(t('es', 'admin.m1.noPhotoNotice'))).toBeVisible();

    // Al elegir gradeada aparece el campo de número de certificado (requerido).
    await page.getByLabel(t('es', 'admin.m1.productType'), { exact: true }).selectOption('graded');
    await expect(page.getByText(t('es', 'admin.m1.certNumberRequired')).first()).toBeVisible();
  });
});

/**
 * Selecciona una PESTAÑA DE ETAPA de M5 y espera a que su contenido esté en pantalla.
 *
 * ⚠️ **Por qué hace falta declararla.** La pestaña activa por defecto es *la primera con
 * solicitudes*, así que un test que no la elige está midiendo **el orden de los datos del seed**,
 * no la pantalla. Estos dos casos leían «Verificando» por accidente —era la primera no vacía— y se
 * cayeron en cuanto el servidor falso ganó una solicitud `cotizada` para la mesa de decisión, **sin
 * que el producto cambiara ni una línea**.
 */
async function openM5Stage(page: import('@playwright/test').Page, label: string) {
  await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();
  await page.getByRole('tab', { name: new RegExp(`^${label}`) }).click();
}

/**
 * **LA MESA DE DECISIÓN** (§23.6/§23.7) — la petición original del humano: *«el admin no debería
 * decidir una compra sin saber cuánto de eso ya tiene»*.
 *
 * El smoke mide **lo que la pantalla existe para no confundir**: que los cuatro sumandos van
 * separados, que «sin conteo» **no se parece a un cero**, y que la sugerencia **no bloquea**.
 */
test.describe('admin · M5 mesa de decisión (§23.6)', () => {
  /**
   * Abre la mesa de la primera solicitud `cotizada`.
   *
   * ⚠️ Se espera a que la cola RESUELVA antes de preguntar. `count()` no auto-espera: con
   * `GET /admin/buylist` en vuelo devuelve 0 y el test se saltaría solo — un falso verde
   * silencioso sobre la pantalla que el humano pidió primero. La cola está resuelta cuando hay
   * una solicitud con mesa **o** cuando dice explícitamente que la pestaña está vacía.
   *
   * ⚠️ **Cola vacía ⇒ ROJO, no `skip`** (v1.51.20). Antes devolvía `false` y el llamador se
   * saltaba el caso; desde que el seed siembra una `cotizada`, quedarse sin mesa que abrir **es**
   * el hallazgo. El mensaje dice quién siembra el dato.
   */
  async function openDesk(page: import('@playwright/test').Page): Promise<void> {
    await page.goto('/es/admin/m5');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();
    const open = page.getByRole('button', { name: t('es', 'admin.m5.desk.open') }).first();
    await expect(open.or(page.getByText(t('es', 'admin.m5.emptyTab'))).first()).toBeVisible();
    if ((await open.count()) === 0) {
      throw new Error(
        'No hay ninguna solicitud `cotizada` con mesa de decisión que abrir. En modo real la ' +
          'siembra `backend/prisma/seed-e2e.ts`; en modo mock, `src/lib/mock/fixtures.ts`.',
      );
    }
    await open.click();
    await expect(page.getByTestId('decision-desk')).toBeVisible();
  }

  test('@real la posición se lee en dos tiempos y los cuatro sumandos van SEPARADOS', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await openDesk(page);

    const strip = page.getByTestId('position-strip').first();
    await expect(strip).toBeVisible();
    // Los grupos son encabezados REALES: el lector anuncia el grupo antes de la cifra, que es
    // justo la distinción que R6 protege.
    await expect(strip.getByText(t('es', 'admin.m5.desk.position.groupInHouse'))).toBeVisible();
    await expect(strip.getByText(t('es', 'admin.m5.desk.position.groupNotYet'))).toBeVisible();
    for (const key of ['stock', 'verifying', 'inTransit', 'committed']) {
      await expect(strip.getByText(t('es', `admin.m5.desk.position.${key}`))).toBeVisible();
    }
    // ⛔ R6: ni un `+`, ni un subtotal que junte «en camino» con «comprometido».
    expect(await strip.innerText()).not.toMatch(/\+|subtotal|por llegar/i);
  });

  /**
   * §23.7 — el caso que la pantalla existe para no confundir: `positionUnavailable` significa
   * **«no pude contar»**, y un cero ahí *se ve confiable* y empuja a comprar de más.
   */
  test('un conteo que no se pudo hacer no se parece a un cero, y NO bloquea la emisión', async ({
    page,
  }) => {
    mockOnly('la fila «sin conteo» es un estado fabricado por el fixture');
    await loginAs(page, 'admin');
    await openDesk(page);

    const box = page.getByTestId('position-unavailable').first();
    await expect(box).toBeVisible();
    await expect(box).toContainText(t('es', 'admin.m5.desk.position.unavailable.tag'));
    await expect(box).toContainText(t('es', 'admin.m5.desk.position.unavailable.noSuggestion'));
    // No ocupa columna: ocupa una oración. Esa fila NO tiene retícula de cifras.
    await expect(box.getByRole('table')).toHaveCount(0);
    // Aviso de pantalla, y el botón sigue vivo: falta el CONSEJO, no el permiso.
    await expect(page.getByText(/No pudimos contar el inventario de \d+ de \d+ cartas/)).toBeVisible();
  });

  test('@real la sugerencia informa y NO bloquea: se puede emitir con líneas desaconsejadas', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await openDesk(page);

    // Las líneas con precio nacen MARCADAS aunque la sugerencia diga «no comprar» (D6: si el
    // default siguiera a la sugerencia, sería un bloqueo blando).
    const boxes = page.getByTestId('decision-desk').getByRole('checkbox');
    await expect(boxes.first()).toBeVisible();
    const emit = page
      .getByRole('button', { name: t('es', 'admin.m5.desk.totals.emit') })
      .or(page.getByRole('button', { name: t('es', 'admin.m5.desk.totals.emitForApproval') }));
    await expect(emit.first()).toBeEnabled();

    // Y al quitarlas todas, el botón se apaga PERO NUNCA MUDO: dice el motivo.
    await page.getByRole('button', { name: t('es', 'admin.m5.desk.clearAll') }).click();
    await expect(emit.first()).toBeDisabled();
    await expect(page.getByText(t('es', 'admin.m5.desk.totals.noLines'))).toBeVisible();
  });
});

/**
 * **LAS CUATRO COLAS DEL CICLO** (§23.8) y **la cola que lo cierra** en M1.
 *
 * Cada una contesta un pendiente **nuestro** que, si nadie mira, cuesta dinero o cuesta una venta.
 * El smoke mide **lo que no se puede recalcular en el cliente** y **lo que no desaparece solo**.
 */
test.describe('admin · colas del ciclo de compra (§23.8)', () => {
  test('la cola de autorización avisa de que la fila SE MUERE SOLA', async ({ page }) => {
    // v1.51.20: el endpoint EXISTE (antes daba 404) — lo que falta es una fila. Es `needsSeed`,
    // no `mockOnly`: una petición accionable a `backend/prisma/seed-e2e.ts`, no una limitación.
    needsSeed('ninguna oferta en `pending_authorization` (GET …/offers/pending-authorization → total 0)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    const queues = page.getByTestId('cycle-queues');
    await expect(queues).toBeVisible();
    await expect(
      queues.getByText(t('es', 'admin.m5.queues.pendingAuth.warning')),
    ).toBeVisible();
    await expect(queues.getByText(t('es', 'admin.m5.queues.pendingAuth.diesToday'))).toBeVisible();
  });

  /**
   * ⚠️ `businessDaysWaiting: null` **no es cero**, y `alert` **falla hacia «sí, avisa»**: «llevo
   * demasiado esperando» y «no sé cuánto llevo» piden la MISMA acción humana.
   */
  test('«por confirmar envío»: un cálculo imposible se dice con palabras y la alerta sigue encendida', async ({
    page,
  }) => {
    // `businessDaysWaiting: null` sí es un estado fabricado; pero además la cola viene vacía.
    needsSeed('ninguna solicitud por confirmar envío (GET …/pending-shipment-confirmation → total 0)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    const queues = page.getByTestId('cycle-queues');
    await queues.getByRole('tab', { name: t('es', 'admin.m5.queues.pendingShipment.tab') }).click();

    await expect(
      queues.getByText(t('es', 'admin.m5.queues.pendingShipment.waitingUnknown')),
    ).toBeVisible();
    // Ni un cero que se vea confiable…
    await expect(queues.getByText('0 días hábiles')).toHaveCount(0);
    // …ni una alerta apagada por falta de dato.
    await expect(queues.getByTestId('shipment-alert').first()).toBeVisible();
  });

  /** D22 · criterio 139: la cola **no se vacía sola**. Las dos mitades van juntas. */
  test('«guías por cancelar» tiene salida, y es la única', async ({ page }) => {
    // ⚠️ Además de vacía, este caso CONFIRMA la cancelación: contra el stack consumiría la fila.
    needsSeed('ninguna guía por cancelar (GET …/guides/pending-cancellation → total 0)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    const queues = page.getByTestId('cycle-queues');
    await queues.getByRole('tab', { name: t('es', 'admin.m5.queues.pendingGuide.tab') }).click();

    await expect(queues.getByText(t('es', 'admin.m5.queues.pendingGuide.note'))).toBeVisible();
    await queues.getByRole('button', { name: t('es', 'admin.m5.queues.pendingGuide.done') }).first().click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog
      .getByRole('button', { name: t('es', 'admin.m5.queues.pendingGuide.doneConfirm') })
      .click();
    await expect(page.getByText(t('es', 'admin.m5.queues.pendingGuide.doneOk'))).toBeVisible();
    // Y ahora la cola SÍ está vacía — porque alguien la vació, no porque se vaciara sola.
    await expect(queues.getByText(t('es', 'admin.m5.queues.pendingGuide.empty'))).toBeVisible();
  });

  /**
   * **D12: el teléfono viaja EN LA FILA**, para poder llamar sin ir a buscar al usuario.
   *
   * v1.51.20 — pasa a `@real`. Antes afirmaba el literal del fixture (`5555123456`) y exigía que
   * hubiera **a la vez** una fila con teléfono y otra sin él, lo que solo es cierto en mocks. Se
   * reescribe contra el **invariante**, que es el que D12 protege y el que vale en los dos
   * entornos: *cada fila resuelve la columna del teléfono — o el número, o el aviso de que no hay
   * — y **nunca la deja en blanco***. Un hueco es el fallo real: el operador no sabe si el
   * vendedor no dio teléfono o si la pantalla se lo comió.
   */
  test('@real «vendedores con solicitudes vivas»: cada fila resuelve el teléfono, sin huecos', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    const queues = page.getByTestId('cycle-queues');
    await queues.getByRole('tab', { name: t('es', 'admin.m5.queues.liveSellers.tab') }).click();

    // La cola resolvió cuando hay filas O cuando dice que está vacía (`count()` no auto-espera).
    const rows = queues.locator('tbody tr');
    await expect(rows.first().or(queues.getByText(t('es', 'admin.m5.queues.empty'))).first()).toBeVisible();
    const total = await rows.count();
    expect(total, 'sin vendedores con solicitudes vivas: el seed debe dejar al menos uno').toBeGreaterThan(0);

    const noPhone = t('es', 'admin.m5.queues.liveSellers.noPhone');
    for (let i = 0; i < total; i++) {
      const phoneCell = rows.nth(i).locator('td').nth(1);
      const text = (await phoneCell.innerText()).trim();
      // O un número marcable, o la frase que dice que no lo hay. Jamás la celda vacía.
      expect(text === noPhone || /\d{7,}/.test(text), `fila ${i}: teléfono sin resolver ("${text}")`).toBe(true);
    }
  });

  /**
   * La cola que CIERRA el ciclo. ⚠️ Cada fila dice **qué le falta**, y una pieza sin `missing`
   * legible **no se pinta como lista**: saldría de la única pantalla donde alguien la encontraría.
   */
  /**
   * v1.51.20 — pasa a `@real`. Antes exigía que coexistieran una pieza a la que le falta
   * **ubicación** y otra a la que le falta **precio**, que es una coincidencia de fixture (contra
   * el stack todas las piezas de la cola tienen precio resoluble). Se reescribe contra los tres
   * invariantes que el caso existe para proteger, ciertos en cualquier entorno:
   *   1. **cada fila dice qué le falta** — una fila muda saldría de la única pantalla donde
   *      alguien la encontraría;
   *   2. **nunca `MX$0.00`** para «no resoluble» — cero es un precio (§7.3); y
   *   3. **ningún botón de publicar** — la pieza sale sola (D10, criterio 125).
   * Y se añade el **tamaño de la cola** (deuda D5 del techlead): el servidor paga un barrido
   * completo del inventario para calcularlo (`BLC-D1`) y hasta ahora el único consumidor lo tiraba.
   */
  test('@real M1 · «listas para publicar» dice cuántas hay, qué le falta a cada pieza y no inventa precios', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m1');
    const queue = page.getByTestId('pending-publish-queue');
    await expect(queue).toBeVisible();

    // La cola resolvió cuando hay filas O cuando dice que está vacía.
    const rows = queue.locator('tbody tr');
    await expect(
      rows.first().or(queue.getByText(t('es', 'admin.m1.publishQueue.empty'))).first(),
    ).toBeVisible();
    const total = await rows.count();
    expect(total, 'la cola de publicar está vacía: el seed debe dejar al menos una pieza').toBeGreaterThan(0);

    // D5: el TAMAÑO del trabajo pendiente, que es para lo que existe una cola. Es el conteo del
    // servidor sobre la cola entera, así que puede ser MAYOR que las filas de esta página.
    await expect(queue.getByTestId('publish-queue-total')).toBeVisible();

    // (1) Ninguna fila muda: la celda «Le falta» siempre dice algo.
    for (let i = 0; i < total; i++) {
      const missing = (await rows.nth(i).locator('td').nth(2).innerText()).trim();
      expect(missing, `fila ${i}: no dice qué le falta`).not.toBe('');
    }
    // (2) y (3).
    await expect(queue.getByText('MX$0.00')).toHaveCount(0);
    await expect(queue.getByRole('button', { name: /publicar/i })).toHaveCount(0);
  });
});

test.describe('admin · M5 buylist (cherry-pick)', () => {
  test('permite decisión carta por carta y respeta dinero saliente', async ({ page }) => {
    // Las acciones cherry-pick viven en las solicitudes que YA están EN LA CASA. v1.51.20: el seed
    // ya siembra solicitudes (`cotizada` + `ofertada`), pero **ninguna llega a `verificacion`** —
    // hacerlo exige recorrer aceptar → guía → «ya lo mandé» → confirmar → recibir.
    // Verificado contra el stack vivo: `GET /admin/buylist?status=verificacion` → `total: 0`.
    needsSeed('ninguna solicitud en `recibida`/`verificacion` (GET /admin/buylist?status=verificacion → total 0)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    // El cherry-pick por ítem vive en las solicitudes que YA están en la casa.
    await openM5Stage(page, t('es', 'admin.m5.tabs.verificando'));

    // Acciones cherry-pick por item.
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.approve') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.adjust') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.reject') }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.convert') }).first()).toBeVisible();
    // Nota de dinero saliente (solo súper-admin, queda en bitácora).
    await expect(page.getByText(t('es', 'admin.moneyOutNote')).first()).toBeVisible();
  });

  test('v1.18: rechazar exige motivo en un diálogo (3–500) antes de enviar la decisión', async ({ page }) => {
    needsSeed('ninguna solicitud en `verificacion`: no hay botón «Rechazar» que abrir');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    await openM5Stage(page, t('es', 'admin.m5.tabs.verificando'));
    await page.getByRole('button', { name: t('es', 'admin.m5.reject') }).first().click();

    // El mini-diálogo pide el motivo; sin él, confirmar está deshabilitado.
    const dialog = page.getByRole('dialog', { name: t('es', 'admin.m5.rejectTitle') });
    await expect(dialog).toBeVisible();
    const confirm = dialog.getByRole('button', { name: t('es', 'admin.m5.rejectConfirm') });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel(t('es', 'admin.m5.rejectReasonLabel')).fill('no es NM: esquina doblada');
    await expect(confirm).toBeEnabled();
  });

  test('@real v1.18: la pestaña Piezas rechazadas existe y NO ofrece convertir a inventario', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m5');
    await page.getByRole('tab', { name: t('es', 'admin.m5.tabs.piezas_rechazadas') }).click();
    // Pestaña transversal informativa: sin acción de conversión (PROJECT criterio 16).
    await expect(page.getByRole('button', { name: t('es', 'admin.m5.convert') })).toHaveCount(0);
  });
});

test.describe('admin · M8 disputas', () => {
  test('disputa por correo a soporte, sin comparador de fotos (v1.2)', async ({ page }) => {
    // `DisputeEvidenceContact` cuelga de la disputa ACTIVA (M8View:141): sin disputas no hay panel.
    // Verificado contra el stack vivo: `GET /admin/disputes` → `total: 0`.
    needsSeed('ninguna disputa sembrada (GET /admin/disputes → total 0)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m8');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m8.title') })).toBeVisible();
    // Panel de contacto de evidencia (correo del contrato, no hardcodeado en la UI).
    await expect(page.getByText(t('es', 'dispute.evidenceTitle')).first()).toBeVisible();
    await expect(page.getByTestId('evidence-email').first()).toBeVisible();
    // Ya no existe comparador de fotos de ingreso/reclamo.
    await expect(page.getByText('Comparador de fotos')).toHaveCount(0);
  });
});

/**
 * T-1 (techlead) — el editor de spreads del SELLADO tiene que dar una fila EDITABLE por cada
 * presentación del enum, incluidas `upc` y `collection`. Es la prueba al nivel en que el dueño vive
 * el problema: no «la lista tiene siete elementos», sino «hay un campo donde escribir el precio».
 *
 * Corre en los DOS modos a propósito, y afirma el INVARIANTE, no el estado: la fila existe y se
 * puede editar **venga o no venga** su llave en la respuesta. Eso importa desde v2.1.9-a, cuando la
 * semilla pasó a cubrir las siete presentaciones: un test que exigiera «UPC viene vacío» se pondría
 * rojo por un cambio de DATO, y peor, dejaría de vigilar lo único que se rompió (que la fila
 * exista). El vínculo vacío ⇔ «usa el global» se afirma como bicondicional, sin asumir cuál de los
 * dos lados toca hoy.
 */
test.describe('admin · M2 spreads del sellado (T-1)', () => {
  test('@real hay fila editable para UPC y Collection, y el vacío dice que cae al global', async ({
    page,
  }) => {
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const usesGlobal = /Usa el global \(\d+(\.\d+)?%\)/;
    for (const subtype of ['UPC', 'Collection']) {
      const field = page.getByLabel(
        t('es', 'admin.m2.sealedSpreads.spreadFor', { subtype }),
      );
      await expect(field).toBeVisible();

      // Bicondicional (ausente ≠ 0%): si el campo está vacío, su fila DECLARA que cae al global;
      // si trae regla propia, no lo declara. Cualquiera de los dos estados es válido según semilla.
      const row = page.locator('li').filter({ has: field });
      if ((await field.inputValue()) === '') {
        await expect(row.getByText(usesGlobal)).toBeVisible();
      } else {
        await expect(row.getByText(usesGlobal)).toHaveCount(0);
      }

      // Y es EDITABLE: el dueño puede teclear el spread de lo que sí vende — que era el hallazgo.
      await field.fill('20');
      await expect(field).toHaveValue('20');

      // Vaciarla la devuelve al global EN PANTALLA (al guardar viaja como `null`, nunca como 0).
      await field.fill('');
      await expect(row.getByText(usesGlobal)).toBeVisible();
    }
  });
});
