import { test, expect, type Locator, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly } from './utils/auth';

/**
 * # M2 › Tipo de cambio en un NAVEGADOR de verdad (`DESIGN_SYSTEM §30`, contrato `§M2-F` v1.63.4)
 *
 * ## Por qué existe este archivo
 * QA lo midió y tenía razón: **ningún spec de `e2e/` tocaba la tarjeta de FX**. `admin.spec.ts`
 * navega a `/es/admin/m2` y sólo asierta los spreads del sellado, así que **el interruptor que
 * reprecia el catálogo entero no tenía ni un smoke**. El gate por work stream de `CLAUDE.md` exige
 * smoke E2E de los flujos que el stream tocó; éste es ese smoke.
 *
 * ## ⭐⭐ Y por qué se REESCRIBIÓ (`I-QA-6`, y es el hallazgo más incómodo de los dos)
 * La primera versión era **verde contra fixtures y sólo contra fixtures**: `playwright.config.ts`
 * levanta su `webServer` con `NEXT_PUBLIC_USE_MOCKS=true`, y los tres casos afirmaban **valores
 * del mundo del mock** —*«19.0000 MANUAL, sin tasa de Banxico y MODO HEREDADO»*— con `mockOnly` en
 * la cabecera. Consecuencia, dicha sin adorno: **el par cliente↔servidor del interruptor —justo el
 * hueco que `I-QA-2` vino a cerrar— no lo medía nadie, y nadie podía medirlo**, porque el spec
 * *no se podía correr* contra el stack real tal y como estaba escrito.
 *
 * **Lo que cambia aquí:** los casos que importan afirman **CONDUCTA** y **leen su estado de
 * partida** en vez de asumirlo:
 *
 *  - *«el interruptor pide permiso ANTES de mover el dinero»* — y **cuál** de los dos diálogos
 *    toca lo decide **el estado leído en pantalla**, no el test (§30.8 exige el **acuse** ⟺ no hay
 *    tasa de Banxico; con ella, el diálogo normal). Esa equivalencia se afirma **en los dos
 *    sentidos**, que es lo que la convierte en candado y no en descripción.
 *  - *«cancelar no mueve nada»* y *«volver deja el número intacto»* — comparados contra **lo que
 *    la propia pantalla decía al empezar**, no contra un `19.0000` de fixture.
 *  - la marca `RIGE` se comprueba con **la regla mecánica del contrato** (v1.63.3): *exactamente
 *    una de las dos `applied` es `true` ⟺ `source` la nombra; con `fallback`, ninguna*. Esa regla
 *    es cierta en **todo** estado legal ⇒ vale igual en mock y contra Postgres.
 *
 * Lo que **de verdad** depende del mundo del mock (el `19.0000`, el `MODO HEREDADO`, el desenlace
 * `no_token` del refresco) **se queda**, en sus propios casos y marcado `mockOnly`: cubre lo mismo
 * que antes y ⛔ deja de disfrazarse de verificación de producto.
 *
 * ## ⚠️⚠️ ESTE SPEC MUEVE EL TIPO DE CAMBIO DEL ENTORNO. LÉASE ANTES DE APUNTARLO A ALGO
 * Confirmar el interruptor **reprecia el catálogo entero al instante** (§30.0). Contra el stack
 * real este spec **cambia estado de dinero de verdad**, así que:
 *
 *  - **Blanco autorizado: local o staging.** ⛔ Nunca producción. (`CLAUDE.md`, fase de seguridad:
 *    misma regla y por la misma razón.)
 *  - El caso del interruptor hace **ida y vuelta** y **restaura el modo de partida en un
 *    `finally`**, incluso si falla a medias. Si la restauración no puede completarse, lo deja
 *    **anotado en el reporte** en vez de callarlo: un entorno que se queda en el otro modo es un
 *    dato que alguien tiene que ver.
 *  - Y si el entorno no ofrece el otro segmento (no hay tasa manual guardada, §30.4 caso 4), el
 *    test **guarda una — la que YA rige** — con un acto legal de la pantalla. Guardar en `auto`
 *    ⛔ no cambia lo que rige (I-FX2/I-FX5) y el número es el mismo que ya regía, así que **el
 *    viaje de ida y vuelta no mueve un peso**.
 *  - Por eso el archivo corre en **serie**: dos casos moviendo el mismo interruptor a la vez
 *    medirían la carrera del arnés, no el producto.
 *
 * ## Lo que este archivo NO puede medir, y se dice aquí
 * **El desenlace `updated` del refresco** (Banxico devuelve una tasa nueva): en modo mock el plan
 * del refresco es `failed`/`no_token` —el estado real de producción— y cambiarlo desde el test
 * exigiría exactamente la puerta trasera que no se pone; contra el stack real **lo decide Banxico**.
 * Ese caso vive donde sí es inyectable: en jsdom (`FxRateCard.test.tsx`, FX-UI-3).
 * ⛔ **Sin fixture mágico, sin `?scenario=`, sin tope configurable por la URL**: la misma
 * disciplina de `admin-bounties.spec.ts` — *un candado que se abre desde fuera no es un candado*.
 */

const FX = (key: string, vars?: Record<string, string | number>) => t('es', `admin.m2.fx.${key}`, vars);

/** Una tasa, tal y como esta tarjeta las escribe **siempre**: cuatro decimales (§30.3b). */
const RATE_RE = /\d{1,4}\.\d{4}/;
/** El hueco de un número dentro de un copy, para comparar por ESTRUCTURA y no por fixture. */
const NUM = '[\\d.,]+';

/**
 * Convierte una cadena del catálogo en una expresión regular **con sus huecos abiertos**: se
 * afirma **la frase del sistema de diseño**, sin hornear el número que la rellena. Es la pieza que
 * permite que el mismo `expect` valga con `19.0000` (mock) y con lo que haya en staging.
 */
function copyRe(key: string, holders: Record<string, string> = {}): RegExp {
  const raw = t('es', `admin.m2.fx.${key}`);
  let src = raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const [name, pattern] of Object.entries(holders)) src = src.replace(`\\{${name}\\}`, pattern);
  return new RegExp(src);
}

/** El CTA del diálogo normal (§30.9a) y el del acuse (§30.8): los dos NOMBRAN su número. */
const CONFIRM_CTA = copyRe('confirm.cta', { rate: NUM });
const ACK_CTA = copyRe('ack.cta', { fallback: NUM });
/** Cualquiera de los dos: el diálogo que toca lo decide el ESTADO, no el test. */
const ANY_CTA = new RegExp(`(?:${CONFIRM_CTA.source})|(?:${ACK_CTA.source})`);

type Mode = 'manual' | 'auto';

/** Texto de un nodo, por `textContent` (⛔ no `innerText`: `text-transform` no es contenido). */
async function textOf(locator: Locator): Promise<string> {
  return ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();
}

async function openM2(page: Page) {
  await loginAs(page, 'admin');
  await page.goto('/es/admin/m2');
  await expect(page.getByRole('heading', { name: FX('title'), level: 2 })).toBeVisible();
  // La tarjeta ha resuelto su `GET` cuando la cifra que rige deja de ser el guion de carga.
  await expect(page.getByTestId('fx-current')).not.toHaveText('—');
}

/** La tarjeta entera. `<section aria-labelledby>` ⇒ `role="region"` con nombre accesible. */
const fxCard = (page: Page): Locator => page.getByRole('region', { name: FX('title') });

const segment = (page: Page, mode: Mode): Locator => fxCard(page).getByRole('radio', { name: FX(`toggle.${mode}`) });

/**
 * ⚠️ **Todo botón de la tarjeta se busca DENTRO de la tarjeta.** `M2` monta varias tarjetas de
 * ajustes y `Guardar` es el rótulo común del sistema: a nivel de página resuelve a **cuatro**
 * botones. Lo cazó el control positivo de `I-QA-6` (mover el mundo de partida del simulador), no
 * una revisión: un ancla ambigua se ve verde mientras el estado de la página no cambie.
 */
const cardButton = (page: Page, name: string | RegExp): Locator => fxCard(page).getByRole('button', { name });

/** El modo que el SERVIDOR dice que rige, leído del interruptor (⛔ no se deduce de la cifra). */
async function currentMode(page: Page): Promise<Mode> {
  return (await segment(page, 'manual').getAttribute('aria-checked')) === 'true' ? 'manual' : 'auto';
}

/** La tasa de una columna, si la hay (`null` = la columna dice «SIN GUARDAR» / «NO HAY»). */
async function columnRate(page: Page, testId: 'fx-manual' | 'fx-automatic'): Promise<string | null> {
  const match = RATE_RE.exec(await textOf(page.getByTestId(testId)));
  return match ? match[0] : null;
}

/**
 * ⭐ **La regla mecánica de v1.63.3, hecha aserción**: *exactamente una de las dos `applied` es
 * `true` ⟺ `source` la nombra; con `source: "fallback"` las DOS son `false`*. Es cierta en **todo
 * estado alcanzable**, así que sirve de oráculo **sin saber en qué estado está el entorno** — que
 * es justo lo que hacía falta para poder correr esto contra el stack real.
 */
async function expectRulingMarkAgreesWithSource(page: Page) {
  const source = await textOf(page.getByTestId('fx-source'));
  const manualMarked = (await textOf(page.getByTestId('fx-manual'))).includes(FX('ruling.mark'));
  const autoMarked = (await textOf(page.getByTestId('fx-automatic'))).includes(FX('ruling.mark'));

  expect(
    [FX('source.manual'), FX('source.banxico'), FX('source.fallback')],
    `la tarjeta pinta una fuente que el enum de §M2-F.3 no publica: «${source}»`,
  ).toContain(source);

  expect(manualMarked, 'la marca RIGE de MANUAL no concuerda con la fuente').toBe(source === FX('source.manual'));
  expect(autoMarked, 'la marca RIGE de AUTOMÁTICA no concuerda con la fuente').toBe(source === FX('source.banxico'));
}

/**
 * Guarda una tasa manual **con un acto legal de la pantalla** (§30.9c). Se usa sólo para dejar el
 * entorno en condiciones de ofrecer el segmento MANUAL, y con **la tasa que ya rige**: guardar en
 * `auto` ⛔ no cambia lo que rige (I-FX2), y el número es el mismo ⇒ no mueve un peso.
 */
async function saveManualRate(page: Page, rate: string) {
  await cardButton(page, FX('manual.create')).click();
  await fxCard(page).getByLabel(FX('manual.field')).fill(rate);
  await cardButton(page, t('es', 'common.save')).click();
  await expect(page.getByTestId('fx-manual')).toContainText(rate);
}

/** Deja el interruptor donde estaba. Tolerante a propósito: corre en el `finally` de un fallo. */
async function restoreMode(page: Page, mode: Mode) {
  if (await page.getByRole('dialog').count()) await page.keyboard.press('Escape');
  if ((await currentMode(page)) === mode) return;
  const target = segment(page, mode);
  if (await target.isDisabled()) throw new Error(`no se puede volver a «${mode}»: el segmento no se ofrece`);
  await target.click();
  const cta = page.getByRole('dialog').getByRole('button', { name: ANY_CTA });
  if (await cta.count()) await cta.click();
  await expect(target).toHaveAttribute('aria-checked', 'true');
}

/**
 * ⚠️ **Secuencial, ⛔ pero NO `serial`.** El interruptor es UNO y su estado es del ENTORNO: con
 * `fullyParallel: true`, dos casos moviéndolo a la vez desde workers distintos medirían la carrera
 * del arnés, no el producto. `mode: 'default'` los pone en el MISMO worker y en orden.
 *
 * ⛔ **`mode: 'serial'` se descartó, y se midió por qué**: además de secuenciar, **salta todo lo que
 * venga detrás del primer rojo**. Con la mutación «el segmento cambia el modo sin diálogo» eso
 * daba **1 rojo + 1 caso perdido**; en `default` salen **los 2 rojos**. Un modo que esconde
 * hallazgos para ahorrar tiempo de corrida no es lo que hace falta en una superficie de dinero.
 */
test.describe.configure({ mode: 'default' });

test.describe('admin · M2 tipo de cambio (§30)', () => {
  /**
   * ⭐ Agnóstico del entorno: no afirma **qué** tasa rige, afirma que la tarjeta **se lee entera y
   * no se contradice**. Todo lo de aquí sale de las reglas 1–4 de §M2-F.3, que valen en cualquier
   * estado legal: las dos tasas viajan siempre, la que rige lleva la marca y sólo ella, el salto
   * existe o se dice por qué no, y el colchón es de solo lectura.
   */
  test('@real la tarjeta se lee ENTERA y ⛔ no se contradice, sea cual sea el estado del entorno', async ({
    page,
  }) => {
    await openM2(page);
    const card = fxCard(page);

    // Pieza 1: la cifra que rige, con la precisión de esta tarjeta, y su fuente nombrada.
    await expect(page.getByTestId('fx-current')).toHaveText(RATE_RE);
    await expect(page.getByTestId('fx-source')).not.toHaveText(FX('source.unknown'));

    // Pieza 2 (§M2-F.3 regla 1): las DOS columnas existen SIEMPRE — con número o diciendo que no
    // lo hay. ⛔ Nunca «la que rige y ya».
    const manualText = await textOf(page.getByTestId('fx-manual'));
    const autoText = await textOf(page.getByTestId('fx-automatic'));
    expect(
      RATE_RE.test(manualText) || manualText.includes(FX('manual.none')),
      'la columna MANUAL no dice ni un número ni que no lo hay',
    ).toBe(true);
    expect(
      RATE_RE.test(autoText) || autoText.includes(FX('auto.missing')),
      'la columna AUTOMÁTICA no dice ni un número ni que no lo hay',
    ).toBe(true);

    // Pieza 3 ⭐: la marca RIGE obedece a `source` (v1.63.3), en el estado que sea.
    await expectRulingMarkAgreesWithSource(page);

    // Pieza 4: el salto se dice, o se dice POR QUÉ no se puede decir (§30.3c) — ⛔ nunca en blanco.
    const jump = await textOf(page.getByTestId('fx-jump'));
    expect(
      jump.includes(FX('jump.unavailable')) || jump.includes(FX('jump.none')) || RATE_RE.test(jump),
      'la línea del salto no dice ni una cifra ni por qué no la hay',
    ).toBe(true);

    // Pieza 5: el colchón, de SOLO LECTURA y con su frase de dónde se edita (§30.3d).
    await expect(card.getByText(/^\d+\.\d %$/)).toBeVisible();
    await expect(card.getByText(FX('buffer.hint'))).toBeVisible();
    // ⛔ Y aquí no se edita: §30.1 saca el dial de esta tarjeta (vive en M10 · Ajustes).
    await expect(card.getByLabel(FX('buffer.label'))).toHaveCount(0);
  });

  test('el estado de producción del simulador se lee entero: 19.0000 MANUAL, sin Banxico y MODO HEREDADO', async ({
    page,
  }) => {
    mockOnly('los VALORES del estado inicial son dato del servidor falso');
    await openM2(page);

    await expect(page.getByTestId('fx-current')).toHaveText('19.0000');
    await expect(page.getByTestId('fx-source')).toHaveText(FX('source.manual'));
    await expect(page.getByTestId('fx-manual')).toContainText(FX('ruling.mark'));
    await expect(page.getByTestId('fx-automatic')).toContainText(FX('auto.missing'));
    await expect(page.getByTestId('fx-automatic')).not.toContainText(FX('ruling.mark'));
    // Sin segunda tasa no hay salto, y se dice por qué (⛔ no se inventa contra el 18).
    await expect(page.getByTestId('fx-jump')).toContainText(FX('jump.unavailable'));
    await expect(page.getByText('3.0 %')).toBeVisible();
    // La única traza visible del riesgo residual: se dice SIEMPRE, y en muted.
    await expect(page.getByText(FX('mode.legacyLabel'))).toBeVisible();
  });

  /**
   * ⭐ §30.7 medido **sin saber qué va a contestar Banxico**: la tarjeta tiene que declarar UN
   * desenlace —y **un `200` no es un éxito**—. En mock el plan es `failed`/`no_token`; contra el
   * stack real lo decide el servidor. Las dos ramas se afirman aquí, y ⛔ la de fallo **no puede**
   * llevar copy de éxito.
   *
   * ⚠️ Contra el stack real esto dispara **una consulta de verdad a Banxico** desde el servidor.
   */
  test('«pulsé Refrescar»: la tarjeta declara UN desenlace, y un `200` ⛔ no es un éxito', async ({ page }) => {
    await openM2(page);
    const card = fxCard(page);
    const before = await textOf(page.getByTestId('fx-current'));

    await cardButton(page, FX('refresh.cta')).click();

    // El `role="alert"` de la TARJETA (Next monta su propio anunciador de ruta, también `alert`).
    const failure = card.getByRole('alert');
    const success = card
      .getByText(copyRe('refresh.updated', { rate: NUM }))
      .or(card.getByText(copyRe('refresh.unchanged', { rate: NUM })));
    await expect(failure.or(success).first()).toBeVisible();

    if ((await failure.count()) > 0) {
      await expect(failure).toContainText(FX('refresh.failedTitle'));
      // El fallo dice qué SIGUE rigiendo (⛔ no deja al humano adivinando) y ⛔ no se disfraza.
      await expect(failure).toContainText(copyRe('refresh.failedBody', { rate: NUM, source: '.+' }));
      await expect(fxCard(page).getByText(/Banxico devolvió/)).toHaveCount(0);
      // ⛔ Un refresco que falló no toca la tasa que rige.
      await expect(page.getByTestId('fx-current')).toHaveText(before);
    } else {
      // Un desenlace bueno trae SU cifra (la que devolvió Banxico), ⛔ nunca un hueco.
      await expect(success.first()).toContainText(RATE_RE);
    }
    // Sea cual sea el desenlace, la tarjeta sigue coherente consigo misma.
    await expectRulingMarkAgreesWithSource(page);
  });

  test('⭐ «pulsé Refrescar y no pasó nada»: ahora lo dice, en rojo, con su motivo y sin desaparecer', async ({
    page,
  }) => {
    mockOnly('el desenlace y el MOTIVO del refresco los decide el plan del servidor falso');
    await openM2(page);

    await cardButton(page, FX('refresh.cta')).click();

    const alert = fxCard(page).getByRole('alert');
    await expect(alert).toContainText(FX('refresh.failedTitle'));
    // El motivo REAL de producción, traducido a lo que el dueño puede hacer (D-OPS-1 / P-63).
    await expect(alert).toContainText(FX('refresh.reason.no_token'));
    await expect(alert).toContainText('Sigue rigiendo 19.0000');

    // ⛔ Ni una frase de éxito sobre un `200`: ésa fue la mitad exacta de la queja del dueño.
    await expect(page.getByText('Banxico devolvió', { exact: false })).toHaveCount(0);

    // ⛔ Y no es un toast: sigue ahí pasados 10 s y tras otra interacción de la tarjeta.
    await page.waitForTimeout(10_000);
    await cardButton(page, FX('manual.edit')).click();
    await expect(alert).toContainText(FX('refresh.failedTitle'));
  });

  /**
   * ⭐ El estado que la tarjeta existe para hacer visible, alcanzado **con actos legales de la
   * pantalla**: sin tasa de Banxico, pasar a automática deja rigiendo **un número que nadie
   * tecleó**. Sigue siendo `mockOnly` porque el ENTORNO de partida (ninguna fila `FxRate`, y
   * ninguna en absoluto) es del servidor falso; contra el stack real el par lo cubre el caso de
   * arriba, en el estado que haya.
   */
  test('⭐ sin tasa de Banxico, confirmar el acuse deja el sistema en SIN RESPALDO REAL', async ({ page }) => {
    mockOnly('el entorno de partida —ninguna fila `FxRate`— es dato del servidor falso');
    await openM2(page);

    await segment(page, 'auto').click();
    await page
      .getByRole('dialog')
      .getByRole('button', { name: FX('ack.cta', { fallback: '18.0000' }) })
      .click();

    await expect(segment(page, 'auto')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText('18.0000');
    // ⭐ El peor estado del sistema, por fin visible: un número que nadie tecleó, con su nombre.
    await expect(page.getByTestId('fx-source')).toHaveText(FX('source.fallback'));
    await expect(page.getByText(FX('source.fallbackBody'))).toBeVisible();
    // ⛔ Y NINGUNA de las dos columnas rige: quien manda no es ninguna de ellas.
    await expect(page.getByText(FX('ruling.mark'), { exact: true })).toHaveCount(0);
    // El interruptor ya no se deduce de nada: se movió una vez.
    await expect(page.getByText(FX('mode.legacyLabel'))).toHaveCount(0);
    await expect(page.getByText('Ahora rige 18.0000', { exact: false })).toBeVisible();
    // El manual se CONSERVA: sigue completo, en pantalla y sin marca de que rige.
    await expect(page.getByTestId('fx-manual')).toContainText('19.0000');
    await expect(page.getByTestId('fx-manual')).not.toContainText(FX('ruling.mark'));
  });
  // ⚠️ ORDEN DELIBERADO: el caso del interruptor va **el último** del archivo. Este `describe` corre
  // en SERIE (el interruptor es uno solo y el estado es del entorno), y en modo serie un fallo
  // **salta** todo lo que venga detrás: poner el caso más largo al final evita que su rojo esconda
  // los de los demás. Medido — con la mutación «el segmento cambia el modo sin diálogo», antes se
  // perdía un caso por salto y ahora se ven los dos rojos.
  /**
   * ⭐⭐ **EL CASO QUE `I-QA-2` PEDÍA Y QUE HASTA HOY NADIE PODÍA CORRER CONTRA UN SERVIDOR.**
   *
   * Mide el **par cliente↔servidor del interruptor**, y lo mide por conducta:
   *  1. mover el segmento **pide permiso** — y **cuál** diálogo sale lo decide el estado (§30.8);
   *  2. **cancelar no mueve nada** (ni la selección, ni la cifra, ni la fuente);
   *  3. **confirmar sí mueve**, y la pantalla **lo declara** (§30.9b, ⛔ nunca «Deshacer»);
   *  4. cambiar de modo ⛔ **no escribe ninguno de los dos números** (I-FX3): los dos siguen ahí;
   *  5. **volver no exige retecleárlos**, y la tarjeta vuelve **exactamente** a donde estaba.
   */
  test('⭐⭐ @real el interruptor: permiso ANTES de mover el dinero, y volver deja el número intacto', async ({
    page,
  }, testInfo) => {
    await openM2(page);

    const start = await currentMode(page);
    const target: Mode = start === 'manual' ? 'auto' : 'manual';
    const startRate = await textOf(page.getByTestId('fx-current'));
    const startSource = await textOf(page.getByTestId('fx-source'));

    // §30.4 caso 4: sin tasa manual guardada ese segmento no se ofrece. Se resuelve con un acto
    // legal de la pantalla —guardar **la que ya rige**—, ⛔ no con una puerta trasera.
    if (target === 'manual' && (await columnRate(page, 'fx-manual')) === null) {
      await saveManualRate(page, startRate);
    }
    const startManual = await columnRate(page, 'fx-manual');
    const startAutomatic = await columnRate(page, 'fx-automatic');
    const targetSegment = segment(page, target);
    await expect(targetSegment).toBeEnabled();

    // ── 1 · Mover el interruptor PIDE PERMISO. ⛔ Nada se ha movido todavía ───────────────────
    await targetSegment.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(segment(page, start)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText(startRate);

    // ⭐ CUÁL de los dos diálogos toca **no lo elige el test**: §30.8 exige el ACUSE ⟺ se va a
    // AUTOMÁTICA y no hay ninguna tasa de Banxico. Se afirma la equivalencia **en los dos
    // sentidos**: pedir el acuse de más (con `stale`, p. ej.) es tan rojo como no pedirlo.
    const noBanxico = startAutomatic === null;
    const isAck = (await textOf(dialog)).includes(FX('ack.title'));
    expect(isAck, isAck ? 'salió el ACUSE donde tocaba el diálogo normal' : 'faltó el ACUSE de §30.8').toBe(
      target === 'auto' && noBanxico,
    );

    if (isAck) {
      // El párrafo por el que existe el diálogo, COMPLETO y sin «ver más».
      await expect(dialog).toContainText(FX('ack.whereFrom'));
      // ⭐ El acuse NOMBRA el número al que se saltaría, ANTES de tocar nada (§30.8 + regla 6 de
      // §M2-F.3). ⛔ Y sin códigos ni «error» en superficie: no es un error, es una precondición.
      await expect(dialog.getByRole('button', { name: ACK_CTA })).toBeVisible();
      await expect(dialog).not.toContainText('FX_NO_AUTOMATIC_RATE');
      await expect(dialog).not.toContainText('422');
    } else {
      await expect(dialog).toContainText(FX('confirm.title'));
      await expect(dialog.getByRole('button', { name: CONFIRM_CTA })).toBeVisible();
    }
    // Las dos piezas que los dos diálogos comparten: la consecuencia EN DINERO y lo intocado.
    await expect(dialog).toContainText(/[−+]?\d+\.\d{2} %/);
    await expect(dialog).toContainText(FX('confirm.untouched'));

    // ── 2 · Cancelar no mueve NADA: ni selección, ni cifra, ni fuente ─────────────────────────
    await dialog.getByRole('button', { name: t('es', 'common.cancel') }).click();
    await expect(dialog).toHaveCount(0);
    await expect(segment(page, start)).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('fx-current')).toHaveText(startRate);
    await expect(page.getByTestId('fx-source')).toHaveText(startSource);

    try {
      // ── 3 · Confirmarlo SÍ mueve el dinero, y la pantalla lo declara ───────────────────────
      await targetSegment.click();
      await page.getByRole('dialog').getByRole('button', { name: ANY_CTA }).click();

      await expect(targetSegment).toHaveAttribute('aria-checked', 'true');
      await expect(fxCard(page).getByText(copyRe('switched', { rate: NUM, source: '.+', previousMode: '.+' }))).toBeVisible();
      // ⛔ Se ofrece VOLVER, nunca «Deshacer»: volver es un SEGUNDO repreciado (§30.0).
      await expect(cardButton(page, /Deshacer|Undo/)).toHaveCount(0);
      // Y la tarjeta sigue sin contradecirse en el estado nuevo.
      await expectRulingMarkAgreesWithSource(page);

      // ── 4 ⭐ · Cambiar el MODO ⛔ no escribe ninguno de los dos números (I-FX3) ─────────────
      // Es el encargo textual del dueño —«que el override manual se conserve»— y aquí se mide
      // como lo que es: una invarianza, ⛔ no un `19.0000` de fixture.
      expect(await columnRate(page, 'fx-manual'), 'el cambio de modo tocó la tasa MANUAL').toBe(startManual);
      expect(await columnRate(page, 'fx-automatic'), 'el cambio de modo tocó la de Banxico').toBe(startAutomatic);

      // ── 5 · Y volver NO exige reteclear nada: la tarjeta vuelve EXACTAMENTE a donde estaba ──
      await segment(page, start).click();
      await page.getByRole('dialog').getByRole('button', { name: ANY_CTA }).click();

      await expect(segment(page, start)).toHaveAttribute('aria-checked', 'true');
      await expect(page.getByTestId('fx-current')).toHaveText(startRate);
      await expect(page.getByTestId('fx-source')).toHaveText(startSource);
    } finally {
      // ⚠️ El entorno no se deja movido ni cuando el caso falla a medias. Si ni siquiera esto se
      // puede, se ANOTA en el reporte: un stack que se queda en el otro modo es un dato, no un
      // detalle — y ⛔ no se tapa el error original del test con el de la restauración.
      await restoreMode(page, start).catch((error: Error) => {
        testInfo.annotations.push({ type: 'fx-restore-failed', description: error.message });
      });
    }
  });

});
