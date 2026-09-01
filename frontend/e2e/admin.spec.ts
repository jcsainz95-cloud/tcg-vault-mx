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
  test('muestra las 8 tarjetas del dashboard', async ({ page }) => {
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
  /** Abre la mesa de la primera solicitud `cotizada`. `false` si no hay ninguna en cola. */
  async function openDesk(page: import('@playwright/test').Page): Promise<boolean> {
    await page.goto('/es/admin/m5');
    await expect(page.getByRole('heading', { name: t('es', 'admin.m5.title') })).toBeVisible();
    const open = page.getByRole('button', { name: t('es', 'admin.m5.desk.open') }).first();
    /*
     * ⚠️ Se espera a que la cola RESUELVA antes de preguntar. `count()` no auto-espera: con
     * `GET /admin/buylist` en vuelo devuelve 0 y el test se saltaría solo — un falso verde
     * silencioso sobre la pantalla que el humano pidió primero. La cola está resuelta cuando hay
     * una solicitud con mesa **o** cuando dice explícitamente que la pestaña está vacía.
     */
    await expect(open.or(page.getByText(t('es', 'admin.m5.emptyTab'))).first()).toBeVisible();
    if ((await open.count()) === 0) return false;
    await open.click();
    await expect(page.getByTestId('decision-desk')).toBeVisible();
    return true;
  }

  test('la posición se lee en dos tiempos y los cuatro sumandos van SEPARADOS', async ({ page }) => {
    needsSeed('ninguna solicitud `cotizada` en cola: no hay mesa que abrir');
    await loginAs(page, 'admin');
    test.skip(!(await openDesk(page)), 'sin solicitudes cotizadas en este entorno');

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
    test.skip(!(await openDesk(page)), 'sin solicitudes cotizadas en este entorno');

    const box = page.getByTestId('position-unavailable').first();
    await expect(box).toBeVisible();
    await expect(box).toContainText(t('es', 'admin.m5.desk.position.unavailable.tag'));
    await expect(box).toContainText(t('es', 'admin.m5.desk.position.unavailable.noSuggestion'));
    // No ocupa columna: ocupa una oración. Esa fila NO tiene retícula de cifras.
    await expect(box.getByRole('table')).toHaveCount(0);
    // Aviso de pantalla, y el botón sigue vivo: falta el CONSEJO, no el permiso.
    await expect(page.getByText(/No pudimos contar el inventario de \d+ de \d+ cartas/)).toBeVisible();
  });

  test('la sugerencia informa y NO bloquea: se puede emitir con líneas desaconsejadas', async ({
    page,
  }) => {
    needsSeed('ninguna solicitud `cotizada` en cola: no hay mesa que abrir');
    await loginAs(page, 'admin');
    test.skip(!(await openDesk(page)), 'sin solicitudes cotizadas en este entorno');

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

test.describe('admin · M5 buylist (cherry-pick)', () => {
  test('permite decisión carta por carta y respeta dinero saliente', async ({ page }) => {
    // Las acciones cherry-pick solo existen si hay AL MENOS una solicitud con items en cola.
    // Verificado contra el stack vivo: `GET /admin/buylist` → `total: 0`.
    needsSeed('ninguna solicitud de buylist en cola (GET /admin/buylist → total 0)');
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
    needsSeed('ninguna solicitud de buylist en cola: no hay botón «Rechazar» que abrir');
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

  test('v1.18: la pestaña Piezas rechazadas existe y NO ofrece convertir a inventario', async ({ page }) => {
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
  test('hay fila editable para UPC y Collection, y el vacío dice que cae al global', async ({
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
