import { test, expect, type Page, type Locator } from '@playwright/test';
import { t } from './utils/i18n';
import { MONEY_RE, loginAs, mockOnly, needsSeed, realOnly } from './utils/auth';
import { apiAsOk } from './utils/env';
import { gradingScenario, type GradingScenario } from './utils/grading';

/**
 * Flujo: **«Valor estimado si se gradea» — el gancho de grading** en sus superficies
 * (PROJECT §O, criterios **97–103**; DESIGN_SYSTEM §22).
 *
 * ─────────────────────────────────────────────────────────────────────────────────────
 * QUÉ CAMBIÓ Y POR QUÉ (bloqueante de QA, v1.50.3).
 *
 * La versión anterior navegaba a ids de FIXTURE (`c-blastoise`, `c-eevee`, `c-pikachu`,
 * `c-milotic-fa`) y asertaba MONTOS de fixture (`MX$29,000.00`). Contra el stack vivo eso eran
 * 9 rojos; y como ningún test del gancho llevaba `@real`, **el subset `@real` —el gate de
 * verdad— no probaba ni una línea de esta feature**. En mock se probaba contra las propias
 * simulaciones del front; en real, nada.
 *
 * Ahora los specs son **agnósticos al fixture**: las cartas y los grados los resuelve
 * `./utils/grading`, que en mock devuelve los ids de `src/lib/mock/fixtures.ts` y en real
 * **descubre** cartas del catálogo publicado y **siembra el escenario por los endpoints del
 * contrato** (`PUT /admin/settings` + `POST /admin/pricing/override` con
 * `intent:"graded_estimate"`), verificando el resultado con
 * `GET /admin/pricing/graded-estimates/preview`. Los asserts son de ESTRUCTURA
 * (`MONEY_RE`, número de cifras = dial `grades`), no de importes horneados.
 *
 * Consecuencia: los mismos asserts corren en los DOS modos y van etiquetados **`@real`**, así
 * que el gate contra el stack levantado por fin afirma algo sobre el gancho.
 * ─────────────────────────────────────────────────────────────────────────────────────
 *
 * Qué se verifica de punta a punta, contra la app corriendo (no componentes aislados):
 *  1. **Ficha** — bloque con las cifras que haya, su micro-aviso y la nota al pie.
 *  2. **Teja de Compra** — badge en las cartas curadas; teja **idéntica a hoy** en las demás.
 *  3. **Vitrina del home** «Joyas para gradear» — cada teja con su propio micro-aviso.
 *  4. **El caso que FALLÓ y por el que QA rechazó (§22.12 nº8 c-bis):** se **ocultan a propósito
 *     todos los `sr-only`** y se comprueba que el aviso **sigue visible**. Un aviso que solo existe
 *     para el lector de pantalla es, para un comprador vidente, ningún aviso — y `PROJECT.md` §O.5
 *     lo califica de **defecto bloqueante**.
 *  5. **Aserción transversal (D8 del techlead):** en cualquier página, **si el DOM contiene una
 *     cifra estimada, contiene la nota al pie completa**. Es la red que impide que un refactor deje
 *     cifras huérfanas en una superficie que nadie estaba mirando.
 */

/** Texto plano de una clave i18n con rich text (`<b>…</b>` no viaja al DOM como literal). */
function plain(locale: 'es' | 'en', key: string): string {
  return t(locale, key).replace(/<[^>]+>/g, '').trim();
}

/** Las DOS ideas obligatorias del micro-aviso (§O.5), tal como se ven en pantalla. */
const IDEA_ILUSTRATIVO = /ilustrativ/i;
const IDEA_NO_EVALUAMOS = /no evaluamos (el estado de )?esta carta/i;

/** Titular de la nota al pie: su presencia ⇔ la página hospeda el disclaimer completo. */
const NOTE_HEADLINE = 'catalog.gradingNote.headline';

function escapeRe(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * El texto CONDICIONAL con el que la teja abre su cifra («En PSA 10 vale…»), derivado de la
 * clave i18n y NO copiado a mano: si el copy cambia, cambia el oráculo con él. Se corta en el
 * `<approx>` porque el `≈` y el importe se asertan aparte.
 */
function badgeFigureRe(locale: 'es' | 'en', grade: string, company = 'PSA'): RegExp {
  const raw = t(locale, 'catalog.gradingBadge.figure', { company, grade, amount: '' });
  const prefix = raw.split('<approx>')[0].trim();
  return new RegExp(escapeRe(prefix));
}

/**
 * ¿La página muestra alguna cifra estimada? Dos marcas que **solo** produce el gancho y ninguna
 * otra superficie del sitio: el glifo `≈` (exclusivo de la cifra del badge, §22.5) y el eyebrow del
 * bloque de la ficha (§22.3). Deliberadamente NO se usa el micro-aviso como marca: sería circular
 * —es justo lo que estos tests verifican—.
 */
function hasEstimateFigure(text: string): boolean {
  return (
    text.includes('≈') ||
    text.includes(t('es', 'catalog.gradingEstimate.eyebrow')) ||
    text.includes(t('en', 'catalog.gradingEstimate.eyebrow'))
  );
}

function hasFootnote(text: string): boolean {
  return text.includes(plain('es', NOTE_HEADLINE)) || text.includes(plain('en', NOTE_HEADLINE));
}

/**
 * D8 (techlead) — aserción TRANSVERSAL: **cifra ⇔ nota al pie**, en cualquier página. Si hay cifra
 * tiene que haber nota (R3.3), y una nota huérfana —sin ninguna cifra que la justifique— también
 * es un defecto: el diseño exige que ambas se rendericen bajo la MISMA condición.
 */
async function expectFigureImpliesFootnote(page: Page) {
  const text = await page.locator('body').innerText();
  expect(
    hasFootnote(text),
    hasEstimateFigure(text)
      ? 'hay cifra estimada pero NO la nota al pie (R3.3)'
      : 'hay nota al pie sin ninguna cifra que la justifique (R3.3)',
  ).toBe(hasEstimateFigure(text));
}

/** Oculta TODO lo `sr-only`: lo que quede es, literalmente, lo que ve un comprador vidente. */
async function hideScreenReaderOnly(page: Page) {
  await page.addStyleTag({ content: '.sr-only { display: none !important; }' });
}

/** El aviso adyacente, visible, con sus dos ideas, dentro del contenedor dado. */
async function expectVisibleMicroNotice(scope: Locator) {
  const notice = scope.getByText(IDEA_NO_EVALUAMOS).first();
  await expect(notice).toBeVisible();
  await expect(scope.getByText(IDEA_ILUSTRATIVO).first()).toBeVisible();
}

/**
 * Cuántos IMPORTES MXN hay dentro del contenedor. Se cuenta sobre el texto renderizado y no con
 * `getByText(MONEY_RE).count()` a propósito: el selector de texto puede casar además contenedores
 * intermedios, y aquí el número exacto ES la aserción (una cifra por grado del dial, ni una más).
 */
async function moneyCount(scope: Locator): Promise<number> {
  const text = await scope.innerText();
  return (text.match(new RegExp(MONEY_RE, 'g')) ?? []).length;
}

/** El bloque del gancho en la ficha (§22.3), anclado a su eyebrow. */
function detailBlock(page: Page, locale: 'es' | 'en' = 'es'): Locator {
  return page
    .locator('section', { hasText: t(locale, 'catalog.gradingEstimate.eyebrow') })
    .first();
}

/**
 * Escenario del entorno (cartas + diales). Se resuelve una vez por corrida y se comparte entre
 * workers; aquí solo se memoiza la promesa del proceso.
 */
let scenarioPromise: Promise<GradingScenario> | null = null;
function scenario(): Promise<GradingScenario> {
  scenarioPromise ??= gradingScenario();
  return scenarioPromise;
}

test.describe('Gancho de grading · ficha de carta (§22.3) @real', () => {
  test('pinta una cifra por grado del dial, su micro-aviso VISIBLE y la nota al pie de la página', async ({
    page,
  }) => {
    const { curated, detailGrades } = await scenario();
    await page.goto(`/es/catalog/${curated.id}`);

    const block = detailBlock(page);
    await expect(block).toBeVisible();
    // Tantas cifras como grados expone el dial `grades`: el número lo decide el SERVIDOR, así que
    // añadir o quitar un grado no debe romper el test ni pasar desapercibido.
    expect(await moneyCount(block), 'una cifra por grado del dial `grades`').toBe(
      detailGrades.length,
    );
    // Cada cifra va tras su condicional «SI SALE» (§22.3): jamás «PSA 10: MX$…».
    await expect(
      block.getByText(t('es', 'catalog.gradingEstimate.ifGradesLabel')).first(),
    ).toBeVisible();
    for (const grade of detailGrades) {
      await expect(block.getByText(new RegExp(`PSA\\s*${escapeRe(grade)}\\b`)).first()).toBeVisible();
    }

    // R3.1 — micro-aviso adyacente, visible, con las dos ideas.
    await expectVisibleMicroNotice(block);

    // R3.2/R3.3 — la nota al pie completa vive en ESTA página, sin interacción alguna.
    const note = page.locator('#nota-estimado');
    await expect(note).toBeVisible();
    await expect(note.getByText(t('es', NOTE_HEADLINE))).toBeVisible();
    await expect(note.locator('details')).toHaveCount(0);

    // R5 — ni una pieza del cálculo en toda la página.
    await expect(page.locator('body')).not.toContainText(/multiplicador|ganancia neta|ROI/i);

    await expectFigureImpliesFootnote(page);
  });

  test('la llamada * lleva a la nota y el aviso SOBREVIVE a ocultar los `sr-only` (el bloqueante)', async ({
    page,
  }) => {
    const { curated } = await scenario();
    await page.goto(`/es/catalog/${curated.id}`);
    await expect(page.locator('#nota-estimado')).toBeVisible();

    // Con los `sr-only` fuera, el aviso tiene que seguir ahí: es texto real, no una ayuda técnica.
    await hideScreenReaderOnly(page);
    await expectVisibleMicroNotice(detailBlock(page));

    // La llamada de la ficha es un enlace real al pie (§22.4a).
    const call = page.locator('#llamada-estimado a');
    await expect(call).toHaveAttribute('href', '#nota-estimado');
    await call.click();
    await expect(page.locator('#nota-estimado')).toBeInViewport();
  });

  test('un solo grado con dato es el estado NORMAL: se pinta el que exista y nada anuncia el otro', async ({
    page,
  }) => {
    const { informed } = await scenario();
    await page.goto(`/es/catalog/${informed.id}`);

    const block = detailBlock(page);
    await expect(block).toBeVisible();
    expect(await moneyCount(block), 'exactamente la cifra que existe, ni una más').toBe(1);
    // Money-safe: sin «—», sin $0, sin «pendiente», y sin anunciar la ausencia del otro grado.
    await expect(block).not.toContainText(/MX\$0\.00|—|pendiente/i);
    await expectVisibleMicroNotice(block);
    await expectFigureImpliesFootnote(page);
  });

  test('sin gancho no se pinta NADA: ni bloque, ni nota, ni rastro (R4)', async ({ page }) => {
    const { bare } = await scenario();
    await page.goto(`/es/catalog/${bare.id}`);
    // Se espera a que la ficha resuelva antes de afirmar ausencias.
    await expect(page.getByRole('heading', { name: bare.name }).first()).toBeVisible();

    await expect(page.getByText(t('es', 'catalog.gradingEstimate.eyebrow'))).toHaveCount(0);
    await expect(page.locator('#nota-estimado')).toHaveCount(0);
    await expect(page.getByText(IDEA_NO_EVALUAMOS)).toHaveCount(0);
    await expectFigureImpliesFootnote(page);
  });
});

test.describe('Gancho de grading · teja de Compra (§22.5) @real', () => {
  test('la teja curada lleva la cifra con el condicional y su micro-aviso visible; la nota está al pie', async ({
    page,
  }) => {
    const { curated, badgeGrades } = await scenario();
    await page.goto(`/es/catalog?q=${encodeURIComponent(curated.name)}`);
    await expect(page.getByText(curated.name).first()).toBeVisible();

    // La cifra incorpora el condicional: «En PSA 10 vale ≈ MX$…» (nunca «PSA 10: MX$…»).
    const figure = page.getByText(badgeFigureRe('es', badgeGrades[0])).first();
    await expect(figure).toBeVisible();
    await expect(figure).toContainText(MONEY_RE);

    // El aviso viaja con la cifra, en el MISMO bloque de la teja (el contenedor del badge).
    const badge = figure.locator('xpath=ancestor::div[1]');
    await expectVisibleMicroNotice(badge);

    await expect(page.locator('#nota-estimado')).toBeVisible();
    await expectFigureImpliesFootnote(page);
  });

  test('EL BLOQUEANTE: con los `sr-only` ocultos, TODA cifra de la retícula conserva su aviso', async ({
    page,
  }) => {
    const { curated, badgeGrades } = await scenario();
    await page.goto('/es/catalog');
    await expect(page.getByText(curated.name).first()).toBeVisible();
    await hideScreenReaderOnly(page);

    const figures = page.getByText(badgeFigureRe('es', badgeGrades[0]));
    const count = await figures.count();
    expect(count, 'la retícula debe traer al menos una teja curada').toBeGreaterThan(0);
    // Tantos avisos VISIBLES como cifras: ninguna se queda huérfana en una retícula densa.
    const notices = page.getByText(IDEA_NO_EVALUAMOS);
    expect(await notices.count()).toBeGreaterThanOrEqual(count);
    for (let i = 0; i < count; i++) {
      await expect(figures.nth(i)).toBeVisible();
      await expect(notices.nth(i)).toBeVisible();
    }
  });

  test('una carta que NO pasa el gate se ve exactamente como hoy: sin badge y sin rastro', async ({
    page,
  }) => {
    // `informed` tiene estimado (su FICHA lo muestra) pero no pasa el gate: su teja no lleva badge.
    // Se filtra la retícula a esa sola carta para que la ausencia se afirme a nivel de PÁGINA —más
    // fuerte y menos frágil que colgarse de la estructura de un contenedor.
    const { informed } = await scenario();
    await page.goto(`/es/catalog?q=${encodeURIComponent(informed.name)}`);
    await expect(page.getByText(informed.name).first()).toBeVisible();

    await expect(page.getByText('≈')).toHaveCount(0);
    await expect(page.getByText(IDEA_NO_EVALUAMOS)).toHaveCount(0);
    // Sin ninguna cifra en la página, la nota al pie tampoco se hospeda (R3.3, misma condición).
    await expect(page.locator('#nota-estimado')).toHaveCount(0);
    await expectFigureImpliesFootnote(page);

    // …y su ficha SÍ trae el bloque: informar ≠ promover (§22.7, estado normal, no un bug).
    await page.goto(`/es/catalog/${informed.id}`);
    await expect(
      page.getByRole('heading', { name: t('es', 'catalog.gradingEstimate.eyebrow'), exact: true }),
    ).toBeVisible();
    await expectFigureImpliesFootnote(page);
  });
});

test.describe('Gancho de grading · vitrina del home (§22.6) @real', () => {
  test('cada teja de «Joyas para gradear» lleva SU micro-aviso; el kicker no lo sustituye', async ({
    page,
  }) => {
    const { badgeGrades } = await scenario();
    await page.goto('/es');

    const shelfTitle = page.getByText(t('es', 'home.gradingGems.title')).first();
    await expect(shelfTitle).toBeVisible();
    // El kicker es refuerzo (§22.6), no la garantía: se comprueba que ADEMÁS esté el aviso por teja.
    await expect(page.getByText(t('es', 'home.gradingGems.kicker'))).toBeVisible();

    await hideScreenReaderOnly(page);
    const figures = page.getByText(badgeFigureRe('es', badgeGrades[0]));
    const count = await figures.count();
    expect(count).toBeGreaterThan(0);
    const notices = page.getByText(IDEA_NO_EVALUAMOS);
    expect(await notices.count()).toBeGreaterThanOrEqual(count);
    await expect(notices.first()).toBeVisible();

    // La nota al pie del home existe y el texto corto NO la sustituye.
    await expect(page.locator('#nota-estimado')).toBeVisible();
    await expect(page.locator('#nota-estimado')).toContainText(plain('es', NOTE_HEADLINE));
    await expectFigureImpliesFootnote(page);
  });

  test('EN: la misma vitrina, con su aviso y su nota, en inglés (§O.3 bilingüe)', async ({ page }) => {
    await scenario();
    await page.goto('/en');
    await expect(page.getByText(t('en', 'home.gradingGems.title')).first()).toBeVisible();

    await hideScreenReaderOnly(page);
    await expect(page.getByText(/we haven't assessed this card/i).first()).toBeVisible();
    await expect(page.locator('#nota-estimado')).toContainText(plain('en', NOTE_HEADLINE));
  });
});

test.describe('Gancho de grading · BACK-OFFICE: la captura manual de estimados (§O.6 / §O.8)', () => {
  /**
   * El agujero que cierra este bloque: hasta v1.50.2 **ninguna superficie del back-office** podía
   * mandar `intent:"graded_estimate"`, así que la captura manual —que §O.6 conserva como
   * herramienta de curaduría y respaldo del ingest— era inalcanzable, y el «Fijar valor…» de M1
   * (que sí toca dinero) llevaba días devolviendo `422 GRADED_INTENT_REQUIRED`.
   */
  test('@real la captura publica el estimado contra el stack real y el diagnóstico lo refleja', async ({
    page,
  }) => {
    realOnly('escribe por la API del contrato y comprueba la fila que lee el storefront');
    const { informed, detailGrades } = await scenario();
    const grade = detailGrades[0];

    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateCapture.title'),
    });
    // La frontera con M1 › Gradeadas se dice VISIBLEMENTE, no en un `title` ni solo para el lector
    // de pantalla: es la confusión que mueve dinero (§O.8).
    await expect(
      page.getByText(t('es', 'admin.m2.gradedEstimateCapture.boundaryTitle')),
    ).toBeVisible();

    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateCapture.searchLabel'))
      .fill(informed.name);
    await section.getByRole('button', { name: new RegExp(escapeRe(informed.name)) }).first().click();

    // Se reescribe EL MISMO importe que ya sembró el arnés: el guardado es idempotente (supersede)
    // y el entorno queda como estaba, pero la vía que se ejercita es la de verdad —el front manda
    // `intent:"graded_estimate"` y el backend escribe la fila que lee el storefront—.
    const preview = await apiAsOk<{ groups: { psa10MxnCents: number | null }[] }>(
      'admin',
      'GET',
      `/admin/pricing/graded-estimates/preview?cardId=${encodeURIComponent(informed.id)}`,
    );
    const cents = preview.groups[0]?.psa10MxnCents;
    expect(cents, 'el arnés debió sembrar el estimado del grado alto').toBeTruthy();

    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateCapture.gradeLabel', { grade }))
      .fill(String(cents! / 100));
    await section
      .getByRole('button', { name: t('es', 'admin.m2.gradedEstimateCapture.save') })
      .click();

    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateCapture.resultOk', { grade })),
    ).toBeVisible();
    // El diagnóstico de curaduría (solo back-office) confirma el estado real de la carta: sin
    // PSA 9 no hay promoción, y eso se le dice al operador con palabras, no con un código.
    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateCapture.diagnosis.reason.NO_PSA9')),
    ).toBeVisible();
  });

  test('separa las dos intenciones y el bloqueo de §O.8 le llega al operador POR GRADO', async ({
    page,
  }) => {
    // El PRE-VUELO (deshabilitar el grado con slab publicado) necesita una carta que tenga a la vez
    // un grupo **raw publicado** Y un **slab publicado** de ese grado: `publishedSlabGrades` viaja
    // POR GRUPO RAW, así que sin grupo raw no hay nada que bloquear. El seed sintético no tiene esa
    // carta (su única gradeada no tiene raw publicado) y además este test asserta el copy del 409
    // con literales del fixture. Queda `mockOnly` con su motivo, y la fila que lo desbloquearía
    // está pedida a backend en `docs/FRONTEND_NOTES.md`.
    // ⚠️ La cobertura REAL de esta superficie NO se pierde: la da el test `@real` de arriba
    // («la captura publica el estimado contra el stack real»), que ejercita la misma vía.
    mockOnly(
      'el copy del 409 y la carta con slab publicado + raw publicado son datos de fixture (§O.8 / INV-D)',
    );
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateCapture.title'),
    });
    await expect(
      page.getByText(t('es', 'admin.m2.gradedEstimateCapture.boundaryTitle')),
    ).toBeVisible();

    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateCapture.searchLabel'))
      .fill('Charizard');
    await section.getByRole('button', { name: /Charizard/ }).first().click();

    // Fixture: `c-charizard` tiene una PSA 9 PUBLICADA. Esa fila es el precio de venta REAL de esa
    // pieza, así que el estimado de ese grado se rechaza (409) — mientras que el PSA 10, libre, sí
    // se publica. Los dos grados van en el MISMO guardado: el bloqueo de uno no apaga el otro.
    const psa10 = section.getByLabel(
      t('es', 'admin.m2.gradedEstimateCapture.gradeLabel', { grade: '10' }),
    );
    const psa9 = section.getByLabel(
      t('es', 'admin.m2.gradedEstimateCapture.gradeLabel', { grade: '9' }),
    );
    await psa10.fill('29000');
    await psa9.fill('9000');
    await section
      .getByRole('button', { name: t('es', 'admin.m2.gradedEstimateCapture.save') })
      .click();

    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateCapture.resultOk', { grade: '10' })),
    ).toBeVisible();
    // El 409 llega TRADUCIDO y con su detalle (cuántas piezas y de qué grado), no como código.
    await expect(section.getByRole('alert')).toContainText('una pieza PSA 9 publicada');
    await expect(section.getByRole('alert')).toContainText('dinero real');
  });
});

test.describe('Gancho de grading · BACK-OFFICE: la lista de revisión (criterio 111(e), v1.50.3)', () => {
  /**
   * La contrapartida de §4.38(k.3): la cifra incoherente **no se oculta** en la ficha, así que
   * alguien tiene que enterarse. Este smoke fija lo único que no se puede relajar sin convertir la
   * lista en algo peor que no tenerla: que el **default** sean los tres motivos de coherencia y que
   * `SLAB_PUBLISHED` entre **solo** al pedirlo.
   */
  test('lista por defecto las cifras incoherentes; el slab publicado entra solo al pedirlo', async ({
    page,
  }) => {
    mockOnly('el conjunto de cartas marcadas es dato de fixture');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateReview.title'),
    });
    await expect(section.getByText(t('es', 'admin.m2.gradedEstimateReview.subtitle'))).toBeVisible();

    // Default: los tres motivos de COHERENCIA. El error de unidades (USD como MXN) se nombra por
    // lo que es, no por su código.
    // `exact: true`: sin él, «Slab publicado» casaría por subcadena con la propia etiqueta de la
    // casilla («…con slab publicado de ese grado») y el aserto de AUSENCIA sería siempre falso.
    const slabBadge = section.getByText(
      t('es', 'admin.m2.gradedEstimateReview.reasonShort.SLAB_PUBLISHED'),
      { exact: true },
    );
    await expect(
      section
        .getByText(t('es', 'admin.m2.gradedEstimateReview.reasonShort.NOT_ABOVE_RAW'), {
          exact: true,
        })
        .first(),
    ).toBeVisible();
    await expect(slabBadge).toHaveCount(0);

    // Opt-in: al pedirlo, aparece — y sigue siendo una categoría distinta, no un dato erróneo.
    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateReview.includeSlabPublished'))
      .check();
    await expect(slabBadge.first()).toBeVisible();
  });

  /**
   * Contra el stack real el oráculo NO puede ser «qué cartas salen» (depende del dato del entorno),
   * pero sí **que la UI esté leyendo el endpoint del contrato y pintando SUS números**: el resumen
   * («N cifras marcadas sobre M cartas con estimado») se compara contra la misma consulta hecha por
   * API. Es lo que atrapa una lista cableada a un fixture, un filtro por defecto equivocado o un
   * truncamiento pintado como lista completa — sin escribir nada ni depender de datos sucios.
   */
  test('@real el resumen de la lista coincide con lo que responde el contrato', async ({ page }) => {
    realOnly('compara la UI contra la respuesta real de GET /admin/pricing/graded-estimates/review');
    await scenario();

    const byDefault = await apiAsOk<{ total: number; scannedCards: number; truncated: boolean }>(
      'admin',
      'GET',
      '/admin/pricing/graded-estimates/review',
    );
    // El conjunto motor son las cartas CON fila de estimado: tras la siembra hay al menos dos.
    expect(
      byDefault.scannedCards,
      'el arnés sembró estimados, así que el barrido no puede ser vacío',
    ).toBeGreaterThan(0);

    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateReview.title'),
    });
    await expect(section.getByText(t('es', 'admin.m2.gradedEstimateReview.subtitle'))).toBeVisible();
    await expect(
      section.getByText(
        t('es', 'admin.m2.gradedEstimateReview.summary', {
          total: byDefault.total,
          scanned: byDefault.scannedCards,
        }),
      ),
    ).toBeVisible();

    // «Prohibido truncar en silencio»: si el backend NO truncó, el aviso no puede estar pintado.
    if (!byDefault.truncated) {
      await expect(
        section.getByText(t('es', 'admin.m2.gradedEstimateReview.truncatedTitle')),
      ).toHaveCount(0);
    }

    // Opt-in de `SLAB_PUBLISHED`: la casilla cambia la consulta, y el resumen sigue a la API.
    const withSlab = await apiAsOk<{ total: number; scannedCards: number }>(
      'admin',
      'GET',
      '/admin/pricing/graded-estimates/review?reason=NOT_ABOVE_RAW,ABOVE_MAX_MULTIPLE,GRADE_ORDER_INVERTED,SLAB_PUBLISHED',
    );
    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateReview.includeSlabPublished'))
      .check();
    await expect(
      section.getByText(
        t('es', 'admin.m2.gradedEstimateReview.summary', {
          total: withSlab.total,
          scanned: withSlab.scannedCards,
        }),
      ),
    ).toBeVisible();
  });
});

/**
 * Casos de forma que el seed sintético todavía no puede producir (solo tiene DOS cartas raw
 * publicadas). Están escritos de forma agnóstica y pasarán tal cual el día que el seed siembre una
 * tercera: es una petición accionable a backend, no una limitación del test. Ver
 * `docs/FRONTEND_NOTES.md`.
 */
test.describe('Gancho de grading · estados que faltan en el seed', () => {
  test('dos grados con dato y SIN destacar: la ficha informa y la teja no promueve', async ({
    page,
  }) => {
    needsSeed(
      'hace falta una TERCERA carta raw publicada para tener a la vez «un solo grado» y «dos grados sin destacar»',
    );
    // Fixture: `c-milotic-fa` tiene PSA 10 y PSA 9 y no pasa el gate.
    await page.goto('/es/catalog/c-milotic-fa');
    const block = detailBlock(page);
    await expect(block).toBeVisible();
    expect(await moneyCount(block)).toBe(2);
    await expectVisibleMicroNotice(block);
    await expectFigureImpliesFootnote(page);

    await page.goto('/es/catalog?q=Milotic');
    await expect(page.getByText('≈')).toHaveCount(0);
    await expect(page.locator('#nota-estimado')).toHaveCount(0);
  });
});
