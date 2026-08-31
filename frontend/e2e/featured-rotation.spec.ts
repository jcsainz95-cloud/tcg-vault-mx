import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';

/**
 * ROTACIÓN AUTOMÁTICA DEL CARRUSEL «Piezas destacadas» (P-49, DESIGN_SYSTEM §23).
 *
 * Estos son los casos que **jsdom no puede dar** y que §23.15 nº4 pide expresamente con caso propio:
 * `prefers-reduced-motion` **en caliente** (§23.14 g) y **sin JS** (§23.14 h). Se suman el reposo
 * inicial cronometrado, el aterrizaje en punto de snap (que necesita layout de verdad), la
 * suspensión por puntero, la pausa permanente por rueda y el presupuesto de la fila en las tres
 * anchuras (§23.14 f).
 *
 * Corren en modo MOCK (sin `@real`): la rotación es conducta de cliente y no depende del backend.
 */

const SECTION = '#piezas-destacadas';
const TRACK = '#piezas-destacadas-pista';
const REST_MS = 7000;

const PAUSE_ARIA = t('es', 'home.featured.playback.pauseAria');
const RESUME_ARIA = t('es', 'home.featured.playback.resumeAria');
const REPLAY_ARIA = t('es', 'home.featured.playback.replayAria');

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
  test('reposo inicial de 7 s, un tic de UNA teja y aterrizaje en punto de snap', async ({ page }) => {
    test.setTimeout(90_000);
    const track = await primeCarousel(page);
    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toBeVisible();

    // OJO: el reposo inicial NO es `scrollLeft: 0`. Chromium aplica `scroll-snap` al hidratar y
    // deja la pista en el `gutter` (32px en `lg`) por su cuenta, sin usuario de por medio — es el
    // hallazgo que documenta `USER_INPUT_WINDOW_MS`. Se mide contra la posición de reposo REAL.
    const before = await readTrack(page);
    expect(before.scrollLeft).toBeLessThanOrEqual(40);

    // §23.14 a — nada se mueve durante los primeros segundos.
    await page.waitForTimeout(REST_MS - 2500);
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

  test('§23.14 g · movimiento reducido EN CALIENTE: se detiene al momento y el conmutador desaparece', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await primeCarousel(page);
    const toggle = page.getByRole('button', { name: PAUSE_ARIA });
    await expect(toggle).toBeVisible();

    await page.waitForFunction(
      (sel) => (document.querySelector(sel) as HTMLElement).scrollLeft > 40,
      TRACK,
      { timeout: 15_000 },
    );
    await page.waitForTimeout(1200);
    const frozen = (await readTrack(page)).scrollLeft;

    await page.emulateMedia({ reducedMotion: 'reduce' });

    // El freno desaparece: un botón «Pausar» sobre contenido quieto es una afirmación falsa.
    await expect(toggle).toHaveCount(0);
    await expect(page.getByRole('button', { name: RESUME_ARIA })).toHaveCount(0);
    await expect(page.getByRole('button', { name: REPLAY_ARIA })).toHaveCount(0);

    await page.waitForTimeout(REST_MS + 3000);
    expect((await readTrack(page)).scrollLeft).toBe(frozen);
  });

  test('con movimiento reducido desde el inicio no hay conmutador ni rotación, y las flechas SALTAN', async ({
    page,
  }) => {
    test.setTimeout(90_000);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await primeCarousel(page);

    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toHaveCount(0);
    const rest = (await readTrack(page)).scrollLeft;
    await page.waitForTimeout(REST_MS + 3000);
    expect((await readTrack(page)).scrollLeft).toBe(rest);

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

    // Suspensión silenciosa: el conmutador NO cambia de etiqueta (§23.13 nº14).
    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toBeVisible();
    const rest = (await readTrack(page)).scrollLeft;
    await page.waitForTimeout(REST_MS + 3000);
    expect((await readTrack(page)).scrollLeft).toBe(rest);

    // Rueda horizontal sobre la pista = intervención ⇒ PAUSA PERMANENTE (§23.5 nivel 2).
    await page.mouse.wheel(200, 0);
    await page.waitForTimeout(800);
    await expect(page.getByRole('button', { name: RESUME_ARIA })).toBeVisible();

    // Se retira el puntero y se deja correr MÁS de un reposo completo: no se reactiva solo (R5).
    await page.mouse.move(0, 0);
    const parked = (await readTrack(page)).scrollLeft;
    await page.waitForTimeout(REST_MS * 2 + 2000);
    expect((await readTrack(page)).scrollLeft).toBe(parked);
  });

  /**
   * §23.5a es un **SI Y SOLO SI**, y éste es el lado que se rompía: un gesto REAL que cae DENTRO del
   * deslizamiento de nuestro propio tic tiene antecedente de usuario ⇒ **pausa**.
   *
   * Regresión medida en este mismo navegador antes de arreglarla: rueda sobre la pista a **+56 ms**
   * del arranque de un tic ⇒ el conmutador se quedaba en PAUSAR (el gesto se tragaba) y, al retirar
   * el puntero, la pista **se movía sola** de `scrollLeft` 460 a 756. Es R5 incumplido y §23.13 nº9
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
    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toBeVisible();
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

    // El gesto NO se traga: pausa permanente, aquí y ahora.
    await expect(page.getByRole('button', { name: RESUME_ARIA })).toBeVisible();

    // Y al retirar el puntero no se reanuda sola, que es la mitad que de verdad se rompía: la
    // suspensión por hover terminaba y el temporizador volvía a arrancar como si nadie hubiera
    // tocado nada.
    await page.mouse.move(0, 0);
    // La posición de reposo se lee DESPUÉS de que asiente el `scroll-snap` del propio gesto: justo
    // tras la rueda la pista sigue en movimiento (medido: 304 en vuelo → 460 asentado) y comparar
    // contra un valor en vuelo mediría el snap, no una reanudación. Esto no tapa nada: lo que el
    // test afirma es que **no hay un tic más**, no que no se mueva ni un píxel tras soltar.
    await page.waitForTimeout(2000);
    const parked = (await readTrack(page)).scrollLeft;
    await page.waitForTimeout(REST_MS * 2 + 2000);
    expect((await readTrack(page)).scrollLeft).toBe(parked);
    await expect(page.getByRole('button', { name: RESUME_ARIA })).toBeVisible();
  });

  test('§23.14 f · el conmutador cabe en 390 / 640 / 1024 sin pisar el H2 ni el link', async ({ page }) => {
    test.setTimeout(90_000);
    for (const width of [390, 640, 1024]) {
      await page.setViewportSize({ width, height: 900 });
      await primeCarousel(page);
      const toggle = page.getByRole('button', { name: PAUSE_ARIA });
      await expect(toggle, `sin conmutador a ${width}px`).toBeVisible();

      const metrics = await toggle.evaluate((el) => {
        const rect = el.getBoundingClientRect();
        const after = getComputedStyle(el, '::after');
        const inset = (v: string) => Math.abs(parseFloat(v) || 0);
        return {
          left: rect.left - inset(after.left),
          right: rect.right + inset(after.right),
          top: rect.top - inset(after.top),
          bottom: rect.bottom + inset(after.bottom),
        };
      });
      // Área táctil ≥ 44×44 obtenida con el pseudo-elemento, no con padding (§23.4b).
      expect(metrics.right - metrics.left, `ancho táctil a ${width}px`).toBeGreaterThanOrEqual(44);
      expect(metrics.bottom - metrics.top, `alto táctil a ${width}px`).toBeGreaterThanOrEqual(44);

      // Y esa expansión no puede solaparse con nada de la fila.
      const heading = (await page.locator(`${SECTION} h2`).boundingBox())!;
      expect(metrics.left, `el área táctil pisa el H2 a ${width}px`).toBeGreaterThanOrEqual(
        heading.x + heading.width - 1,
      );
      const link = await page.locator(`${SECTION} a[href$="/catalog"]`).boundingBox();
      if (link) {
        expect(metrics.right, `el área táctil pisa el link a ${width}px`).toBeLessThanOrEqual(link.x + 1);
      }
    }
  });

  test('§23.14 i · la pasada TERMINA: se detiene en el extremo, el conmutador dice REPETIR y REPETIR vuelve al inicio', async ({
    page,
  }) => {
    // Una pasada completa: reposo inicial + un tic cada 7 s hasta el tope de la pista (§23.6).
    test.setTimeout(180_000);
    await primeCarousel(page);
    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toBeVisible();

    const replay = page.getByRole('button', { name: REPLAY_ARIA });
    await expect(replay).toBeVisible({ timeout: 120_000 });

    const ended = await readTrack(page);
    expect(Math.abs(ended.scrollLeft - ended.maxScroll)).toBeLessThanOrEqual(2);
    // TERMINADO es el MISMO predicado que apaga la flecha «siguiente»: un solo criterio.
    await expect(page.getByRole('button', { name: t('es', 'home.carouselNext') })).toBeDisabled();
    // Y no vuelve a moverse: sin bucle, sin rebobinado automático.
    await page.waitForTimeout(REST_MS + 2000);
    expect((await readTrack(page)).scrollLeft).toBe(ended.scrollLeft);

    await replay.click();
    await page.waitForTimeout(300);
    expect((await readTrack(page)).scrollLeft).toBeLessThanOrEqual(40);
    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toBeVisible();
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
 * **Sí:** no se pinta ni una flecha ni el conmutador, y nada se mueve. Ése es el punto que importa
 * para WCAG 2.2.2 — **no puede existir movimiento sin freno**, porque los tres nacen del mismo JS.
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

  test('no hay flechas, ni conmutador, ni movimiento', async ({ page }) => {
    await page.goto('/es');
    await expect(page.locator(SECTION)).toBeVisible();

    await expect(page.getByRole('button', { name: PAUSE_ARIA })).toHaveCount(0);
    await expect(page.getByRole('button', { name: RESUME_ARIA })).toHaveCount(0);
    await expect(page.getByRole('button', { name: REPLAY_ARIA })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'home.carouselPrev') })).toHaveCount(0);
    await expect(page.getByRole('button', { name: t('es', 'home.carouselNext') })).toHaveCount(0);

    // El link «Ver todo el catálogo» sí está: el contenido no depende del JS, los controles sí.
    await expect(page.locator(`${SECTION} a[href$="/catalog"]`)).toHaveCount(1);
  });
});
