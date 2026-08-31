import { test, expect, type Page, type Locator } from '@playwright/test';
import { t } from './utils/i18n';
import { MONEY_RE, loginAs, mockOnly, needsSeed, realOnly } from './utils/auth';
import { apiAs, apiAsOk } from './utils/env';
import { gradingScenario, seedIncoherentEstimate, type GradingScenario } from './utils/grading';

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
 * Importe MXN tal como lo pinta la UI en `es` (`formatMoneyCents`, DESIGN_SYSTEM §9.3). Se replica
 * aquí —tres líneas— en vez de importar `src/lib/format`: los E2E **no importan código de la app** a
 * propósito (importarlo sería medir el módulo contra sí mismo). El `replace` cubre las dos salidas
 * posibles de ICU para `es-MX`+MXN (`$` y `MX$`), que difieren entre Node y Chromium.
 */
function mxn(cents: number): string {
  return new Intl.NumberFormat('es-MX', {
    style: 'currency',
    currency: 'MXN',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
    .format(cents / 100)
    .replace(/^\$/, 'MX$');
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

    /**
     * Ancla LEGÍTIMA, y conviene decir por qué no es el agujero del carrusel (§22.6b): esta vitrina
     * es la **excepción ratificada a §8.1** —no pinta skeleton—, así que su `Shelf` entero se
     * renderiza *ya resuelto* o no se renderiza. Ver el título implica que las tejas (y sus cifras)
     * están en el MISMO commit de React. El carrusel es lo contrario: encabezado inmediato y tejas
     * después, y por eso allí el ancla tiene que ser la teja, no la sección.
     */
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

/**
 * §22.6b — la CUARTA superficie. Aquí no se puede asertar «hay burbuja»: el carrusel ordena por
 * precio descendente y el gate de ROI castiga justo a las caras, así que **cero burbujas entre ocho
 * es el estado NORMAL** y exigir una haría el test verde por casualidad o rojo por diseño. Lo que sí
 * es determinista son las INVARIANTES de la pista, y son las que se afirman.
 */
test.describe('Gancho de grading · carrusel «Piezas destacadas» (§22.6b) @real', () => {
  test('la pista es anclable, no lleva `aria-label` en sus tejas y numeración y cifra NO coexisten', async ({
    page,
  }) => {
    await scenario();
    await page.goto('/es');

    // (g) El carrusel necesita `id` propio: el regreso de la nota aterriza aquí cuando la vitrina
    // no pintó, que es el caso frecuente.
    const track = page.locator('#piezas-destacadas');
    await expect(track).toBeVisible();
    await expect(track).toHaveClass(/scroll-mt-/);

    /**
     * ⚠️ **EL ANCLA — el bloqueante de QA (v1.50.4).** La `<section>` del `Shelf` se pinta **en el
     * primer frame** con su encabezado; las tejas llegan después por react-query y mientras tanto
     * la pista son cuatro cajas grises (`QueryState.loading`). Todo lo que sigue mide CONTENIDO,
     * así que medirlo aquí medía **el esqueleto**: con la pista vacía salían `hasFigure=false` y
     * `numbering=0`, y la invariante de (c) —«o cifra sin numeración, o numeración sin cifra»— se
     * cumplía **por vacuidad**. El test nunca llegó a verificar lo que dice verificar.
     *
     * Se espera por la **condición que el test necesita** (que la pista TENGA tejas), nunca por
     * tiempo. El ancla es el `href` de la teja —`/es/catalog/<cardId>`—, y es deliberado que sea
     * ése y no «el primer `<a>` de la sección»: el encabezado del `Shelf` ya trae el enlace «Ver
     * todo» (`/es/catalog`, **sin** barra final) desde el primer frame, así que esperar por él no
     * esperaría nada y reabriría el mismo agujero con otra cara.
     */
    const tiles = track.locator('a[href*="/catalog/"]');
    await expect(
      tiles.first(),
      'la pista de destacadas nunca pintó una teja (¿`GET /catalog/cards?sort=price_desc` vacío o en error?)',
    ).toBeVisible();
    const tileCount = await tiles.count();
    /**
     * Y la contra-vacuidad, explícita: la invariante de (c) solo **dice** algo si hay tejas que
     * juzgar, y solo **distingue** los dos casos si hay más de una (la teja grande nunca lleva
     * ordinal, §20.3). Se exige antes de juzgar nada; si la pista no pinta, este es el aserto que
     * se pone rojo, y lo hace nombrando la causa real en vez de fabricar un verde silencioso.
     */
    expect(
      tileCount,
      'la pista de destacadas no trajo tejas: sin tejas no hay ninguna invariante que medir',
    ).toBeGreaterThan(1);

    // (h) La teja es un <a> que envuelve todo ⇒ el badge forma parte del NOMBRE ACCESIBLE. Un
    // `aria-label` lo sustituiría y borraría el micro-aviso del árbol de accesibilidad: el defecto
    // bloqueante que §22.4c corrigió.
    expect(await track.locator('a[aria-label], a[aria-labelledby]').count()).toBe(0);

    await hideScreenReaderOnly(page);
    const text = await track.innerText();
    const hasFigure = text.includes('≈');
    /**
     * (c) **Todo o nada por pista.** Si hay cifra, la numeración `01·02·03` desaparece de las OCHO
     * tejas; si no la hay, la llevan **todas menos la primera**. Se afirma el número EXACTO
     * (`tileCount - 1`) y no un `> 0`: contra una pista a medio pintar, `> 0` es exactamente el
     * tipo de umbral que se cumple solo, mientras que la igualdad exige que las OCHO tejas hayan
     * tomado la misma decisión — que es literalmente lo que §22.6b-c promete.
     */
    const numbering = await track.getByText(/^\d{2}$/).count();
    expect(
      numbering,
      hasFigure
        ? `la pista pinta cifra y CONSERVA la numeración (§22.6b-c): ${numbering} ordinales en ${tileCount} tejas`
        : `la pista no pinta ninguna cifra y perdió la numeración de §20.3: ${numbering} ordinales en ${tileCount} tejas`,
    ).toBe(hasFigure ? 0 : tileCount - 1);

    // R3.1 — si hay cifras, cada una lleva su micro-aviso VISIBLE junto a ella.
    if (hasFigure) {
      await expectVisibleMicroNotice(track);
      await expect(page.locator('#nota-estimado')).toBeVisible();
    }

    /**
     * (g) El regreso de la nota NUNCA apunta a la nada. Aquí **no se puede exigir que la nota
     * exista** —la hospeda la UNIÓN vitrina ∪ carrusel, y cero burbujas en las dos superficies es
     * un estado legítimo—, pero sí se puede evitar que la comprobación se salte sola: la rama que
     * SÍ conocemos (`hasFigure` ⇒ nota, por R3.3) entra **sin condicional**, y el `count()` solo
     * gobierna la que depende del dato del entorno. Ya no se fotografía a media carga: la pista
     * está esperada arriba y la vitrina se renderiza **ya resuelta** (§22.6, sin skeleton).
     */
    const note = page.locator('#nota-estimado');
    if (hasFigure || (await note.count()) > 0) {
      await expect(note).toBeVisible();
      // La nota trae SIEMPRE su enlace de regreso (§22.4b): si falta, es un fallo, no un caso.
      const back = note.locator('a[href^="#"]');
      await expect(back).toHaveCount(1);
      const href = await back.getAttribute('href');
      await expect(page.locator(href!)).toHaveCount(1);
    }

    await expectFigureImpliesFootnote(page);
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

test.describe('Gancho de grading · BACK-OFFICE: la lista de revisión y el RETIRO (criterio 111(e) / §O.7)', () => {
  /**
   * ⚠️ **SERIAL a propósito.** Estos tests comparten un recurso GLOBAL del entorno: el conjunto de
   * cifras marcadas, que es lo que la lista cuenta. El smoke del borrado **siembra una cifra
   * incoherente y la retira**, así que mueve `total`/`scannedCards`; y el smoke del resumen afirma
   * que el número pintado por la UI es **exactamente** el que devolvió la API. En paralelo, un
   * borrado colado entre la llamada a la API y el render de la página fabricaría un rojo que no
   * dice nada del producto. `fullyParallel: true` sigue valiendo para todo lo demás del archivo:
   * el orden se serializa **solo** donde hay estado compartido, que es donde debe.
   */
  test.describe.configure({ mode: 'serial' });

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

  /**
   * **El bucle que la mitad de abajo cierra.** La lista de revisión enseñaba la cifra mala y el único
   * gesto disponible era **capturar otra** — pisar no es descartar, deja otra afirmación comercial
   * en su lugar. `PROJECT.md` §O.7 pide que el dueño pueda *«corregirla con override **o
   * descartarla»*, y desde v1.50.3-d existe el `DELETE`. Sin **este botón**, el endpoint obligaría
   * al dueño a retirar la cifra con `curl`: exactamente el error que la lista corrigió (construir el
   * detector y dejar al operador sin la herramienta).
   *
   * El caso central es la cifra **caducada**: ya no se ve en ninguna superficie, pero **sigue en la
   * tabla**. Se encuentra con el opt-in `?reason=STALE` y se retira aquí mismo.
   */
  test('lo caducado se puede pedir, se distingue su origen, y se RETIRA desde la propia lista', async ({
    page,
  }) => {
    // Lo mock-only de este caso es **el dato**, no el gesto: una cifra CADUCADA exige una
    // `capturedDate` vieja y una de origen INGEST exige `isManual:false`, y ninguna de las dos se
    // puede fabricar por la API del contrato (`POST /admin/pricing/override` escribe siempre
    // manual y con fecha de hoy). El BORRADO contra el backend real ya no falta: lo cubre el test
    // `@real` de más abajo, que siembra una cifra incoherente, la retira desde esta misma lista y
    // comprueba con el contrato que se fue. Lo que sigue sin cobertura real es el opt-in `STALE`,
    // y eso es una petición de DATO al seed (docs/FRONTEND_NOTES.md).
    mockOnly(
      'las cifras CADUCADAS y las de origen ingest son dato de fixture: no se pueden fabricar por ' +
        'la API del contrato (el override escribe siempre manual y con fecha de hoy)',
    );
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateReview.title'),
    });

    // 1. `STALE` es OPT-IN: no está en el default (si entrara, ahogaría la señal de coherencia).
    const staleBadge = section.getByText(
      t('es', 'admin.m2.gradedEstimateReview.reasonShort.STALE'),
      { exact: true },
    );
    /**
     * MISMO DEFECTO que el bloqueante del carrusel, y por eso se arregla en la misma vuelta: el
     * `subtitle` de la sección se pinta **fuera** del `QueryState`, así que verlo NO significa que
     * la lista haya cargado — y una aserción de AUSENCIA contra una lista todavía vacía se cumple
     * sola. El ancla honesta es `howToFix`, el único texto fijo que vive **dentro** de
     * `{query.data && …}`: si está, la consulta resolvió y la lista pintada es la del default.
     */
    await expect(section.getByText(t('es', 'admin.m2.gradedEstimateReview.howToFix'))).toBeVisible();
    await expect(staleBadge).toHaveCount(0);

    await section.getByLabel(t('es', 'admin.m2.gradedEstimateReview.includeStale')).check();
    await expect(staleBadge.first()).toBeVisible();

    // 2. El ORIGEN se pinta, porque decide el remedio: una manual rancia se recaptura o se retira;
    //    una automática rancia manda a mirar el ingest, NO a tocar la carta.
    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateReview.originManual')).first(),
    ).toBeVisible();
    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateReview.originIngest')).first(),
    ).toBeVisible();

    // 3. Retirar exige CONFIRMACIÓN (es destructivo, es dinero y es super_admin), y la confirmación
    //    dice que se lleva TODAS las capturas del grado — no «la última».
    await expect(section.getByText('Zapdos').first()).toBeVisible();
    await section
      .getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
          grade: '10',
          card: 'Zapdos',
        }),
      })
      .first()
      .click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(t('es', 'admin.m2.gradedEstimateReview.deleteConfirmAllRows')),
    ).toBeVisible();
    await expect(
      dialog.getByText(t('es', 'admin.m2.gradedEstimateReview.deleteConfirmAudit')),
    ).toBeVisible();

    await dialog
      .getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteConfirmCta', { grade: '10' }),
      })
      .click();

    // 4. Desenlace: se dice cuántas filas se fueron y la fila DESAPARECE de la lista sin recargar.
    //    (El prefijo se deriva de la propia clave: su cola es un plural ICU que el helper no expande.)
    const okPrefix = t('es', 'admin.m2.gradedEstimateReview.deleteOk', {
      grade: '10',
      card: 'Zapdos',
    }).split('{')[0];
    await expect(section.getByText(okPrefix, { exact: false })).toBeVisible();
    // La fila se fue de la LISTA (se asserta sobre su acción, no sobre el nombre de la carta: el
    // propio aviso de éxito nombra la carta y haría verde un aserto por texto suelto).
    await expect(
      section.getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
          grade: '10',
          card: 'Zapdos',
        }),
      }),
    ).toHaveCount(0);
  });

  /**
   * La otra mitad, y la que **no** se puede relajar: con un slab publicado de ese grado la fila
   * **ya no es un estimado** —es la referencia de mercado de una pieza física en venta— y borrarla
   * la dejaría sin precio. La UI lo previene con el mismo pre-vuelo de la captura (§O.8) y **nombra
   * el remedio correcto: repreciar, no borrar**.
   */
  test('el grado con slab publicado NO ofrece borrado, y la UI manda a repreciar en vez de insistir', async ({
    page,
  }) => {
    mockOnly('la carta con slab publicado + raw publicado es dato de fixture (INV-D, §O.8)');
    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');

    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateReview.title'),
    });
    await section
      .getByLabel(t('es', 'admin.m2.gradedEstimateReview.includeSlabPublished'))
      .check();
    await expect(section.getByText('Charizard').first()).toBeVisible();

    // Fixture: `c-charizard` tiene una PSA 9 PUBLICADA. Ese grado no se retira…
    await expect(
      section
        .getByRole('button', {
          name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
            grade: '9',
            card: 'Charizard',
          }),
        })
        .first(),
    ).toBeDisabled();
    // …y el PSA 10, libre, SÍ: la guarda es por grado, no por carta.
    await expect(
      section
        .getByRole('button', {
          name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
            grade: '10',
            card: 'Charizard',
          }),
        })
        .first(),
    ).toBeEnabled();

    // El «no se puede» viene con su porqué y con el remedio, no como un botón apagado y mudo.
    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateReview.deleteBlockedTitle')),
    ).toBeVisible();
    await expect(
      section.getByText(t('es', 'admin.m2.gradedEstimateReview.deleteBlockedBody')),
    ).toBeVisible();
  });

  /**
   * **IMP-B (QA) — el borrado, de punta a punta y a nivel UI, contra el backend REAL.**
   *
   * Lo que faltaba, dicho con precisión: la ruta `DELETE` estaba verificada por API (QA la probó a
   * mano: `409` y `404` incluidos) y la UI estaba verificada contra fixtures, pero
   * `deleteGradedEstimate()` de `src/lib/api.ts` **nunca había hablado con el backend real en
   * ninguna suite** — los dos smokes de arriba son `mockOnly`. El riesgo residual no era el
   * contrato: era **el pegamento del cliente HTTP** (la URL que se compone, el verbo, el
   * `Authorization`, el parseo del `deletedCount`, la invalidación de la caché de React Query).
   * Eso es exactamente lo que este test mide, y lo mide con el gesto del operador, no con `fetch`.
   *
   * Se limpia a sí mismo por construcción: siembra la cifra incoherente que va a retirar (la carta
   * `deletable` del escenario está elegida **sin slab publicado**, si no el `DELETE` daría `409`
   * por INV-D) y la retira desde la lista. El entorno queda como estaba.
   */
  test('@real retira la cifra desde la lista y el contrato confirma que se fue', async ({
    page,
  }) => {
    realOnly('borra de verdad por DELETE /admin/pricing/graded-estimates/:cardId/:gradeValue');
    const { deletable, detailGrades } = await scenario();
    const [grade, otherGrade] = detailGrades;

    // 1. Se siembra AQUÍ, no en el escenario compartido: la fila existe la ventana más corta
    //    posible y el test no depende del TTL de la caché del escenario.
    const seeded = await seedIncoherentEstimate(deletable, grade, otherGrade);
    const cents = seeded.high;

    await loginAs(page, 'admin');
    await page.goto('/es/admin/m2');
    const section = page.locator('section', {
      hasText: t('es', 'admin.m2.gradedEstimateReview.title'),
    });
    await expect(section.getByText(t('es', 'admin.m2.gradedEstimateReview.subtitle'))).toBeVisible();

    // 2. La fila está en el DEFAULT (no supera el raw: es la categoría de coherencia, sin opt-in)
    //    y la lista pinta el importe que se acaba de escribir — no un fixture.
    const cta = section
      .getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
          grade,
          card: deletable.name,
        }),
      })
      .first();
    await expect(cta).toBeEnabled();
    await expect(section.getByText(mxn(cents)).first()).toBeVisible();

    // 3. Confirmación: es destructivo, es dinero y es `super_admin`.
    await cta.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(
      dialog.getByText(t('es', 'admin.m2.gradedEstimateReview.deleteConfirmAllRows')),
    ).toBeVisible();
    await dialog
      .getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteConfirmCta', { grade }),
      })
      .click();

    // 4. Desenlace en la UI: se dice cuántas filas se fueron y la fila desaparece sin recargar.
    const okPrefix = t('es', 'admin.m2.gradedEstimateReview.deleteOk', {
      grade,
      card: deletable.name,
    }).split('{')[0];
    await expect(section.getByText(okPrefix, { exact: false })).toBeVisible();
    await expect(
      section.getByRole('button', {
        name: t('es', 'admin.m2.gradedEstimateReview.deleteCtaLabel', {
          grade,
          card: deletable.name,
        }),
      }),
    ).toHaveCount(0);

    // 5. …y el CONTRATO confirma que el borrado ocurrió de verdad, no solo en la pantalla: la cifra
    //    ya no está en el diagnóstico, y un segundo borrado responde `404` («no había nada»), que es
    //    la prueba de que el primero se llevó TODAS las filas de la clave.
    const previewPath = `/admin/pricing/graded-estimates/preview?cardId=${encodeURIComponent(deletable.id)}`;
    const preview = await apiAsOk<{
      groups: { psa10MxnCents: number | null; psa9MxnCents: number | null }[];
    }>('admin', 'GET', previewPath);
    expect(preview.groups[0]?.psa10MxnCents, 'la cifra debía irse de la tabla').toBeNull();
    // …y el grado que NO se pidió sigue ahí: la guarda y el borrado son **por grado**, no por carta.
    expect(
      preview.groups[0]?.psa9MxnCents,
      `retirar PSA ${grade} no puede llevarse por delante el PSA ${otherGrade}`,
    ).toBe(seeded.low);
    const again = await apiAs(
      'admin',
      'DELETE',
      `/admin/pricing/graded-estimates/${encodeURIComponent(deletable.id)}/${encodeURIComponent(grade)}`,
    );
    expect(again.status, 'un segundo borrado no puede encontrar nada').toBe(404);

    // 6. Limpieza del grado auxiliar. Se afirma sobre ella en vez de esconderla: el `200` con su
    //    `deletedCount` es la última pieza del contrato de esta ruta, y deja el entorno como estaba.
    const cleanup = await apiAs<{ deletedCount: number }>(
      'admin',
      'DELETE',
      `/admin/pricing/graded-estimates/${encodeURIComponent(deletable.id)}/${encodeURIComponent(otherGrade)}`,
    );
    expect(cleanup.status, 'el grado auxiliar tenía que poder retirarse').toBe(200);
    expect(cleanup.body.deletedCount).toBeGreaterThan(0);
  });
});

/**
 * Casos de forma que el seed sintético todavía no puede producir. Están escritos de forma agnóstica
 * y pasarán tal cual el día que el seed siembre la fila que falta: es una petición accionable a
 * backend, no una limitación del test. Ver `docs/FRONTEND_NOTES.md`.
 */
test.describe('Gancho de grading · estados que faltan en el seed', () => {
  test('dos grados con dato y SIN destacar: la ficha informa y la teja no promueve', async ({
    page,
  }) => {
    needsSeed(
      'hace falta una CUARTA carta raw publicada y libre: las tres que hay ya son la curada, la ' +
        'informada y la del smoke de borrado, y este caso necesita una más con DOS grados que no ' +
        'pasen el gate',
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
