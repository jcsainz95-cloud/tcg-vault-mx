import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * ROTACIÓN AUTOMÁTICA DEL CARRUSEL «Piezas destacadas» (P-49, DESIGN_SYSTEM §23).
 *
 * Estos son los casos que **jsdom no puede dar** y que §23.15 nº4 pide expresamente con caso propio:
 * `prefers-reduced-motion` **en caliente** (§23.14 g) y **sin JS** (§23.14 h). Se suman el reposo
 * inicial cronometrado, el aterrizaje en punto de snap (que necesita layout de verdad), la
 * suspensión por puntero y la pausa permanente por rueda.
 *
 * ══ SIN CONMUTADOR ════════════════════════════════════════════════════════════════════════════
 * El par PAUSAR/REANUDAR/REPETIR se retiró (decisión del dueño: WCAG 2.2.2 es estándar del W3C, no
 * obligación legal para esta tienda) y la cadencia bajó de 7 s a 5 s. Con el botón fuera, **la
 * única evidencia de que un freno funciona es que la pista no se mueve**, así que todas las
 * aserciones que leían la etiqueta del control ahora leen `scrollLeft`. Se retiró el caso que
 * medía **exclusivamente** el conmutador (área táctil 44×44 en 390/640/1024, §23.14 f); ninguno de
 * los cinco frenos automáticos perdió cobertura.
 *
 * Corren en modo MOCK (sin `@real`): la rotación es conducta de cliente y no depende del backend.
 */

const SECTION = '#piezas-destacadas';
const TRACK = '#piezas-destacadas-pista';
/** §23.3 — reposo entre tics y reposo inicial. Debe seguir a `ROTATION_REST_MS` del componente. */
const REST_MS = 5000;

/** Espera que la pista NO se mueva durante `rests` reposos completos, con holgura. */
async function expectFrozen(page: Page, rests = 2) {
  const before = (await readTrack(page)).scrollLeft;
  await page.waitForTimeout(REST_MS * rests + 2000);
  expect((await readTrack(page)).scrollLeft).toBe(before);
  return before;
}

/** Lee la pista sin tocarla: posición y borde izquierdo de cada teja relativo a la pista. */
async function readTrack(page: Page) {
  return page.evaluate((sel) => {
    const track = document.querySelector(sel) as HTMLElement;
    const box = track.getBoundingClientRect();
    return {
      scrollLeft: track.scrollLeft,
      maxScroll: track.scrollWidth - track.clientWidth,
      tileLefts: Array.from(track.children).map((c) => c.getBoundingClientRect().left - box.left),
    };
  }, TRACK);
}

/**
 * Deja el carrusel listo para rotar: pista ≥ 50 % visible (§23.5 suspende si no) y foto de la teja
 * líder cargada (§23.3 precondición 3). El ratón se aparta a la esquina: el puntero sobre la
 * sección suspende, y Playwright lo deja en (0,0) por defecto, que ya está fuera.
 */
async function primeCarousel(page: Page) {
  await page.goto('/es');
  const track = page.locator(TRACK);
  await expect(track).toBeVisible();
  await expect(track.locator('a[href*="/catalog/"]').first()).toBeVisible();
  await track.scrollIntoViewIfNeeded();
  await page.waitForFunction((sel) => {
    const img = document.querySelector(`${sel} img`) as HTMLImageElement | null;
    return !!img && img.complete;
  }, TRACK).catch(() => {
    // El tope de 3 s de §23.3 cubre la imagen que nunca llega; no es motivo de fallo del test.
  });
  return track;
}

test.describe('Carrusel destacadas · rotación automática (§23)', () => {
  /**
   * **EL CASO QUE MÁS IMPORTA QUE SOBREVIVA.** Prueba que el carrusel **no se auto-pausa antes de
   * su primer tic**: el motor de Chromium aplica `scroll-snap` al hidratar y mueve `scrollLeft`
   * por su cuenta, y §23.5a leído al pie de la letra tomaba eso por intervención del usuario y
   * dejaba la función muerta. Antes se leía en la etiqueta del conmutador («sigue diciendo
   * PAUSAR»); ahora se lee donde de verdad está la respuesta: **la pista se mueve**.
   */
  test('reposo inicial de 5 s sin auto-pausarse, un tic de UNA teja y aterrizaje en punto de snap', async ({ page }) => {
    test.setTimeout(90_000);
    const track = await primeCarousel(page);

    // OJO: el reposo inicial NO es `scrollLeft: 0`. Chromium aplica `scroll-snap` al hidratar y
    // deja la pista en el `gutter` (32px en `lg`) por su cuenta, sin usuario de por medio — es el
    // hallazgo que documenta `USER_INPUT_WINDOW_MS`. Se mide contra la posición de reposo REAL.
    const before = await readTrack(page);
    expect(before.scrollLeft).toBeLessThanOrEqual(40);

    // §23.14 a — nada se mueve durante los primeros segundos.
    await page.waitForTimeout(REST_MS - 2000);
    expect((await readTrack(page)).scrollLeft).toBe(before.scrollLeft);

    // …y después sí. Se espera por la CONDICIÓN (se movió), no por un tiempo exacto.
    await page.waitForFunction(
      ([sel, from]) => (document.querySelector(sel as string) as HTMLElement).scrollLeft > (from as number) + 40,
      [TRACK, before.scrollLeft] as const,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(1200); // deja terminar el deslizamiento de ~550 ms

    // §23.14 b — ninguna teja queda cortada por el borde IZQUIERDO: alguna arranca flush con él.
    const after = await readTrack(page);
    expect(after.scrollLeft).toBeGreaterThan(before.scrollLeft);
    const flush = after.tileLefts.some((left) => Math.abs(left) <= 2);
    expect(flush || Math.abs(after.scrollLeft - after.maxScroll) <= 2).toBe(true);

    // Avanzó UNA teja: el desplazamiento es menor que el ancho visible de la pista.
    expect(after.scrollLeft).toBeLessThan(
      await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).clientWidth, TRACK),
    );
  });

  /**
   * **EL FRENO INNEGOCIABLE**, y el único de los cinco que protege a alguien ANTES de que el
   * movimiento ocurra (trastorno vestibular, §8.2). Se escucha EN VIVO: activar la preferencia a
   * media rotación la detiene en ese instante, sin recargar.
   */
  test('§23.14 g · movimiento reducido EN CALIENTE: la rotación se detiene al momento', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await primeCarousel(page);

    await page.waitForFunction(
      (sel) => (document.querySelector(sel) as HTMLElement).scrollLeft > 40,
      TRACK,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(1200);
    const frozen = (await readTrack(page)).scrollLeft;

    await page.emulateMedia({ reducedMotion: 'reduce' });

    // Cero movimiento a partir de aquí, por más reposos que pasen.
    await page.waitForTimeout(REST_MS * 2 + 3000);
    expect((await readTrack(page)).scrollLeft).toBe(frozen);
  });

  test('con movimiento reducido desde el inicio el temporizador NO arranca, y las flechas SALTAN', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await primeCarousel(page);

    // Ni un tic: se dejan pasar DOS reposos completos desde el montaje.
    const rest = await expectFrozen(page);

    // §23.7: las flechas siguen funcionando (la preferencia quita movimiento, no información).
    await page.getByRole('button', { name: t('es', 'home.carouselNext') }).click();
    // Salto instantáneo: sin `behavior:'smooth'` no hay animación que esperar.
    await page.waitForTimeout(150);
    const after = await readTrack(page);
    expect(after.scrollLeft).toBeGreaterThan(rest);
    // Aterriza en un punto de snap **o** en el tope de la pista. El tope es la única excepción
    // geométricamente inevitable a R6 («ningún reposo deja una teja cortada por el borde
    // izquierdo»): en `scrollWidth − clientWidth` la última teja queda flush a la DERECHA, y la
    // primera visible sale cortada salvo que el contenido sea múltiplo exacto del paso. Ver
    // `docs/FRONTEND_NOTES.md` — es un hallazgo del navegador, no una licencia de implementación.
    const landed =
      after.tileLefts.some((left) => Math.abs(left) <= 2) ||
      Math.abs(after.scrollLeft - after.maxScroll) <= 2;
    expect(landed).toBe(true);
  });

  test('§23.5 · el puntero encima suspende en silencio; la rueda pausa PARA SIEMPRE', async ({ page }) => {
    test.setTimeout(120_000);
    const track = await primeCarousel(page);
    const box = (await track.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);

    // Suspensión silenciosa por HOVER: dos reposos completos con el puntero encima y ni un tic.
    await expectFrozen(page);

    // Rueda horizontal sobre la pista = intervención ⇒ PAUSA PERMANENTE (§23.5 nivel 2).
    await page.mouse.wheel(200, 0);
    await page.waitForTimeout(1500);

    // Se retira el puntero —se acaba la suspensión por hover— y se deja correr MÁS de dos reposos
    // completos. Si la pausa por intervención no fuera permanente, aquí habría un tic. No lo hay.
    await page.mouse.move(0, 0);
    await expectFrozen(page);
  });

  /**
   * **SUSPENSIÓN POR VISIBILIDAD (`IntersectionObserver`, §23.5) — solo se puede probar aquí.**
   * jsdom no tiene `IntersectionObserver`, así que este freno NO tiene red en los unitarios: una
   * mutación que borre `inView` de `suspended` los pasa TODOS en verde (verificado). Éste es el
   * caso que la tapa.
   *
   * El apartado se hace con scroll de PÁGINA (`window.scrollTo`), nunca tocando la pista: un gesto
   * sobre la pista sería intervención del usuario (§23.5 nivel 2) y pausaría para siempre, con lo
   * que el test pasaría por el motivo equivocado y no probaría nada de la visibilidad.
   */
  test('§23.5 · la pista fuera de vista suspende, y al volver NO se acumulan tics', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await primeCarousel(page);

    // Rotando de verdad antes de apartar la vista: sin este tic el test pasaría en verde aunque la
    // rotación no hubiera arrancado nunca.
    const rest = (await readTrack(page)).scrollLeft;
    await page.waitForFunction(
      ([sel, from]) =>
        (document.querySelector(sel as string) as HTMLElement).scrollLeft > (from as number) + 40,
      [TRACK, rest] as const,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1200);
    const moved = (await readTrack(page)).scrollLeft;

    // Fuera de vista: se dejan pasar TRES reposos completos.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(REST_MS * 3 + 2000);
    expect((await readTrack(page)).scrollLeft).toBe(moved);

    // De vuelta a la vista: el reposo empieza DE CERO (§23.3, «ni un solo tic acumulado»), así que
    // los tres tics que no ocurrieron no se recuperan de golpe.
    await page.evaluate(
      (sel) => document.querySelector(sel)!.scrollIntoView({ block: 'center' }),
      TRACK,
    );
    await page.waitForTimeout(REST_MS - 2000);
    expect((await readTrack(page)).scrollLeft).toBe(moved);

    // …y entonces sí, UN tic: menos de un ancho de pista, nunca tres de golpe.
    await page.waitForFunction(
      ([sel, from]) =>
        (document.querySelector(sel as string) as HTMLElement).scrollLeft > (from as number) + 40,
      [TRACK, moved] as const,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(1200);
    const back = await readTrack(page);
    expect(back.scrollLeft - moved).toBeLessThan(
      await page.evaluate((sel) => (document.querySelector(sel) as HTMLElement).clientWidth, TRACK),
    );
  });

  /**
   * §23.5a es un **SI Y SOLO SI**, y éste es el lado que se rompía: un gesto REAL que cae DENTRO del
   * deslizamiento de nuestro propio tic tiene antecedente de usuario ⇒ **pausa**.
   *
   * Regresión medida en este mismo navegador antes de arreglarla: rueda sobre la pista a **+56 ms**
   * del arranque de un tic ⇒ el gesto se tragaba y, al retirar el puntero, la pista **se movía
   * sola** de `scrollLeft` 460 a 756. Es R5 incumplido y §23.13 nº9
   * al pie de la letra. La causa era una guarda «este scroll lo originamos nosotros» que hacía ganar
   * a la evidencia débil; se retiró (ver `handleScroll`). Este test es su lápida: solo puede pasar
   * mientras el antecedente del usuario gane.
   *
   * Es de navegador y no de jsdom a propósito: la ventana de coexistencia (el tic asentándose y el
   * dedo llegando) la produce el scroll suave nativo, que jsdom no tiene.
   */
  test('§23.5a · un gesto REAL dentro del tic PAUSA y no se reanuda sola (gana el humano)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const track = await primeCarousel(page);
    const box = (await track.boundingBox())!;
    const rest = (await readTrack(page)).scrollLeft;

    // Se espera al INSTANTE en que arranca el tic; el deslizamiento suave dura ~550 ms, así que el
    // gesto de las líneas siguientes cae dentro de él.
    await page.waitForFunction(
      ([sel, from]) =>
        (document.querySelector(sel as string) as HTMLElement).scrollLeft > (from as number) + 8,
      [TRACK, rest] as const,
      { timeout: 20_000, polling: 16 },
    );
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(300, 0);

    // El gesto NO se traga: pausa permanente, aquí y ahora. Y al retirar el puntero no se reanuda
    // sola, que es la mitad que de verdad se rompía: la
    // suspensión por hover terminaba y el temporizador volvía a arrancar como si nadie hubiera
    // tocado nada.
    await page.mouse.move(0, 0);
    // La posición de reposo se lee DESPUÉS de que asiente el `scroll-snap` del propio gesto: justo
    // tras la rueda la pista sigue en movimiento (medido: 304 en vuelo → 460 asentado) y comparar
    // contra un valor en vuelo mediría el snap, no una reanudación. Esto no tapa nada: lo que el
    // test afirma es que **no hay un tic más**, no que no se mueva ni un píxel tras soltar.
    await page.waitForTimeout(2000);
    await expectFrozen(page);
  });

  /**
   * **Una pasada completa, de punta a punta.** Con la cadencia de 7 s tardaba ~39,7 s; a 5 s son
   * ~28 s (reposo inicial + un tic cada 5 s hasta el tope de la pista, §23.6). Al terminar la
   * pista queda QUIETA para siempre: ya no hay control que la devuelva a REPETIR, y el fin de la
   * pasada se detecta donde corresponde —la pista tocó su tope y la flecha «siguiente» se apagó—.
   */
  test('§23.14 i · la pasada TERMINA en el extremo y ahí se queda (sin bucle, sin rebobinado)', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    await primeCarousel(page);

    // El fin de la pasada: la pista llegó a su tope. ~28 s con la cadencia de 5 s; el margen cubre
    // el arranque y los deslizamientos.
    await page.waitForFunction(
      (sel) => {
        const el = document.querySelector(sel) as HTMLElement;
        return Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) <= 2;
      },
      TRACK,
      { timeout: 80_000 },
    );

    const ended = await readTrack(page);
    expect(Math.abs(ended.scrollLeft - ended.maxScroll)).toBeLessThanOrEqual(2);
    // TERMINADO es el MISMO predicado que apaga la flecha «siguiente»: un solo criterio.
    await expect(page.getByRole('button', { name: t('es', 'home.carouselNext') })).toBeDisabled();
    // Y no vuelve a moverse: sin bucle, sin rebobinado automático, sin control que la relance.
    await expectFrozen(page);

    // Las flechas SIGUEN navegando a mano después del fin (§20.3): la pista no queda muerta.
    await page.getByRole('button', { name: t('es', 'home.carouselPrev') }).click();
    await page.waitForTimeout(800);
    expect((await readTrack(page)).scrollLeft).toBeLessThan(ended.scrollLeft);
    // Y retroceder no relanza la rotación (un reposo completo basta: el tic caería dentro).
    await expectFrozen(page, 1);
  });

  test('§23.9 · la sección se anuncia como carrusel y la pista es un tope de tabulación con nombre', async ({
    page,
  }) => {
    await primeCarousel(page);
    await expect(page.locator(SECTION)).toHaveAttribute(
      'aria-roledescription',
      t('es', 'home.featured.roledescription'),
    );
    await expect(page.locator(SECTION)).toHaveAttribute('aria-label', t('es', 'home.featuredTitle'));
    await expect(page.locator(TRACK)).toHaveAttribute('role', 'group');
    await expect(page.locator(TRACK)).toHaveAttribute('tabindex', '0');
    await expect(page.locator(TRACK)).toHaveAttribute('aria-label', t('es', 'home.featured.trackAria'));
  });
});

/**
 * §23.14 h / §23.8 — SIN JS. Lo que este bloque puede afirmar hoy y lo que NO:
 *
 * **Sí:** no se pinta ni una flecha, y nada se mueve. Rotación y flechas nacen del mismo JS, así
 * que sin JS no hay movimiento que frenar.
 *
 * **No:** §23.8 dice además que sin JS se leen «las ocho tejas completas». Eso **no es cierto hoy y
 * no lo introduce §23**: las tejas las trae `GET /catalog/cards` por react-query **en el cliente**,
 * así que sin JS el estante se queda en su estado de carga. Corregirlo es mover la consulta a
 * servidor (RSC/prefetch), que es una decisión de arquitectura fuera de este pase. Anotado en
 * `docs/FRONTEND_NOTES.md` como solicitud al arquitecto; el test afirma lo verificable y no finge
 * una cobertura que no tiene.
 */
test.describe('Carrusel destacadas · sin JavaScript (§23.8)', () => {
  test.use({ javaScriptEnabled: false });

  test('no hay flechas, ni ningún otro control, ni movimiento', async ({ page }) => {
    await page.goto('/es');
    await expect(page.locator(SECTION)).toBeVisible();

    // El estante no pinta UN SOLO botón sin JS.
    await expect(page.locator(`${SECTION} button`)).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'home.carouselPrev') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'home.carouselNext') })).toHaveCount(0);

    // El link «Ver todo el catálogo» sí está: el contenido no depende del JS, los controles sí.
    await expect(page.locator(`${SECTION} a[href$="/catalog"]`)).toHaveCount(1);
  });
});
