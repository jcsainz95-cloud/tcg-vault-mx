import { test, expect, type Page, type Locator } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * Flujo: **«Valor estimado si se gradea» — el gancho de grading** en sus TRES superficies
 * (PROJECT §O, criterios **97–103**; DESIGN_SYSTEM §22).
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
 *
 * Datos: fixtures de mocks (`NEXT_PUBLIC_USE_MOCKS=true`, el modo que levanta Playwright por
 * defecto). Cobertura deliberada: `c-blastoise` (dos grados + curada), `c-milotic-fa` (dos grados,
 * NO curada ⇒ ficha con bloque y teja sin badge), `c-eevee` (un solo grado), `c-pikachu` (sin
 * estimados ⇒ nada en ninguna superficie).
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

test.describe('Gancho de grading · ficha de carta (§22.3)', () => {
  test('pinta las dos cifras, su micro-aviso VISIBLE y la nota al pie de la página', async ({ page }) => {
    await page.goto('/es/catalog/c-blastoise');

    const block = page.locator('section', { hasText: t('es', 'catalog.gradingEstimate.eyebrow') }).first();
    await expect(block).toBeVisible();
    // Dos cifras de referencia (PSA 10 y PSA 9), cada una tras su condicional «SI SALE».
    await expect(block.getByText('MX$29,000.00')).toBeVisible();
    await expect(block.getByText('MX$14,500.00')).toBeVisible();
    await expect(block.getByText(t('es', 'catalog.gradingEstimate.ifGradesLabel')).first()).toBeVisible();

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

  test('la llamada * lleva a la nota y el aviso SOBREVIVE a ocultar los `sr-only` (el bloqueante)', async ({ page }) => {
    await page.goto('/es/catalog/c-blastoise');
    await expect(page.locator('#nota-estimado')).toBeVisible();

    // Con los `sr-only` fuera, el aviso tiene que seguir ahí: es texto real, no una ayuda técnica.
    await hideScreenReaderOnly(page);
    const block = page.locator('section', { hasText: t('es', 'catalog.gradingEstimate.eyebrow') }).first();
    await expectVisibleMicroNotice(block);

    // La llamada de la ficha es un enlace real al pie (§22.4a).
    const call = page.locator('#llamada-estimado a');
    await expect(call).toHaveAttribute('href', '#nota-estimado');
    await call.click();
    await expect(page.locator('#nota-estimado')).toBeInViewport();
  });

  test('un solo grado con dato es el estado NORMAL: se pinta el que exista y nada anuncia el otro', async ({ page }) => {
    await page.goto('/es/catalog/c-eevee');

    const block = page.locator('section', { hasText: t('es', 'catalog.gradingEstimate.eyebrow') }).first();
    await expect(block).toBeVisible();
    await expect(block.getByText('MX$1,450.00')).toBeVisible();
    // Money-safe: sin «—», sin $0, sin «pendiente», y sin anunciar la ausencia del otro grado.
    await expect(block).not.toContainText(/MX\$0\.00|—|pendiente/i);
    await expectVisibleMicroNotice(block);
    await expectFigureImpliesFootnote(page);
  });

  test('sin estimados no se pinta NADA: ni bloque, ni nota, ni rastro (R4)', async ({ page }) => {
    await page.goto('/es/catalog/c-pikachu');
    // Se espera a que la ficha resuelva antes de afirmar ausencias.
    await expect(page.getByRole('heading', { name: 'Pikachu' }).first()).toBeVisible();

    await expect(page.getByText(t('es', 'catalog.gradingEstimate.eyebrow'))).toHaveCount(0);
    await expect(page.locator('#nota-estimado')).toHaveCount(0);
    await expect(page.getByText(IDEA_NO_EVALUAMOS)).toHaveCount(0);
    await expectFigureImpliesFootnote(page);
  });
});

test.describe('Gancho de grading · teja de Compra (§22.5)', () => {
  test('la teja curada lleva la cifra con el condicional y su micro-aviso visible; la nota está al pie', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByText('Blastoise').first()).toBeVisible();

    // La cifra incorpora el condicional: «En PSA 10 vale ≈ MX$…» (nunca «PSA 10: MX$…»).
    const figure = page.getByText(/En PSA 10 vale/).first();
    await expect(figure).toBeVisible();
    await expect(figure).toContainText(/MX\$[\d,]+/);

    // El aviso viaja con la cifra, en el MISMO bloque de la teja (el contenedor del badge).
    const badge = figure.locator('xpath=ancestor::div[1]');
    await expectVisibleMicroNotice(badge);

    await expect(page.locator('#nota-estimado')).toBeVisible();
    await expectFigureImpliesFootnote(page);
  });

  test('EL BLOQUEANTE: con los `sr-only` ocultos, TODA cifra de la retícula conserva su aviso', async ({ page }) => {
    await page.goto('/es/catalog');
    await expect(page.getByText('Blastoise').first()).toBeVisible();
    await hideScreenReaderOnly(page);

    const figures = page.getByText(/En PSA 10 vale/);
    const count = await figures.count();
    expect(count, 'los fixtures deben traer al menos una teja curada').toBeGreaterThan(0);
    // Tantos avisos VISIBLES como cifras: ninguna se queda huérfana en una retícula densa.
    const notices = page.getByText(IDEA_NO_EVALUAMOS);
    expect(await notices.count()).toBeGreaterThanOrEqual(count);
    for (let i = 0; i < count; i++) {
      await expect(figures.nth(i)).toBeVisible();
      await expect(notices.nth(i)).toBeVisible();
    }
  });

  test('una carta que NO pasa el gate se ve exactamente como hoy: sin badge y sin rastro', async ({ page }) => {
    // Milotic ex tiene estimados (su FICHA los muestra) pero no está curada: su teja no lleva badge.
    await page.goto('/es/catalog?q=Milotic');
    const tile = page.locator('div', { hasText: 'Milotic ex' }).last();
    await expect(tile).toBeVisible();
    await expect(tile.getByText(/vale ≈|PSA 10 ≈/)).toHaveCount(0);
    await expect(tile).not.toContainText(IDEA_NO_EVALUAMOS);

    // …y su ficha SÍ trae el bloque: informar ≠ promover (§22.7, estado normal, no un bug).
    await page.goto('/es/catalog/c-milotic-fa');
    await expect(
      page.getByRole('heading', { name: t('es', 'catalog.gradingEstimate.eyebrow'), exact: true }),
    ).toBeVisible();
    await expectFigureImpliesFootnote(page);
  });
});

test.describe('Gancho de grading · vitrina del home (§22.6)', () => {
  test('cada teja de «Joyas para gradear» lleva SU micro-aviso; el kicker no lo sustituye', async ({ page }) => {
    await page.goto('/es');

    const shelfTitle = page.getByText(t('es', 'home.gradingGems.title')).first();
    await expect(shelfTitle).toBeVisible();
    // El kicker es refuerzo (§22.6), no la garantía: se comprueba que ADEMÁS esté el aviso por teja.
    await expect(page.getByText(t('es', 'home.gradingGems.kicker'))).toBeVisible();

    await hideScreenReaderOnly(page);
    const figures = page.getByText(/En PSA 10 vale/);
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
    await page.goto('/en');
    await expect(page.getByText(t('en', 'home.gradingGems.title')).first()).toBeVisible();

    await hideScreenReaderOnly(page);
    await expect(page.getByText(/we haven't assessed this card/i).first()).toBeVisible();
    await expect(page.locator('#nota-estimado')).toContainText(plain('en', NOTE_HEADLINE));
  });
});
