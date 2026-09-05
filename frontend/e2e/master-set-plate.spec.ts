import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { needsSeed } from './utils/auth';

/**
 * P-54 · DESIGN_SYSTEM §24 — GEOMETRÍA REAL de la placa de tinta, medida en Chromium.
 *
 * POR QUÉ ESTE ARCHIVO EXISTE. La suite de vitest **no puede** cerrar esta clase de defecto:
 * jsdom no hace layout ni carga imágenes, así que `expect(plate.className).toContain('aspect-[3/2]')`
 * comprueba que la CADENA de clase está, no que la caja mida 3:2. Con esa afirmación de más, el
 * bloqueante B-1 de QA (la placa crecía con la proporción del logo: 180×180 con uno cuadrado,
 * 180×312 con uno vertical) pasó con 964 pruebas verdes. Aquí se mide la caja de verdad.
 *
 * Lo que se fija:
 *  1. **R1 / §24.12 nº3** — la placa es de tamaño FIJO: mide lo mismo con logo apaisado, con uno
 *     cuadrado, con uno vertical y sin logo, y su alto es el 2/3 de su ancho.
 *  2. **Cero CLS** — la caja NO cambia de alto cuando la imagen llega.
 *  3. **§24.5 / B-2** — cuando el logo carga, el monograma se RETIRA (los PNG del proveedor son
 *     transparentes: si se queda, se ve a través del logo).
 *  4. **§24.5 nº3** — un 404 cae al monograma, sin icono roto.
 *  5. **§24.5 / I-2** — el monograma es proporcional a la PLACA, no al breakpoint del viewport.
 *
 * ALCANCE. El spec está escrito de forma AGNÓSTICA (no hay nombres de set literales: los logos se
 * interceptan por URL, las proporciones se reparten por índice de descubrimiento y el oráculo —la
 * víctima del 404 y su testigo— se descubre del DOM), pero hoy se marca `needsSeed` contra el
 * stack real: `logoUrl` es `null` en TODO el catálogo hasta que un operador re-sincronice
 * (ARCHITECTURE §4.40.4 — no hay backfill), así que en real no habría ninguna placa CON logo que
 * medir. El día que el seed traiga un set con logo, este archivo corre tal cual: basta borrar el
 * `needsSeed`. Interceptar las imágenes NO es la parte mock: la geometría es una propiedad del CSS
 * y hace falta forzar proporciones que un CDN de terceros no ofrece a la carta.
 */

/**
 * Proporciones INTRÍNSECAS deliberadamente dispares (§4.40.2: «proporción MUY variable entre
 * sets»).
 *  · 1.92:1 es el único que el defecto B-1 NO manifestaba (por encima del umbral de ~1.83:1);
 *    los otros tres son los que descuadraban la retícula. Servir SOLO ese equivaldría a no probar.
 */
const LOGO_SHAPES = [
  { w: 480, h: 250, label: 'apaisado 1.92:1' },
  { w: 480, h: 300, label: 'apaisado 1.60:1 (bajo el umbral que rompía)' },
  { w: 300, h: 300, label: 'cuadrado 1:1' },
  { w: 200, h: 400, label: 'vertical 1:2' },
];

const svg = (w: number, h: number) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
  `<rect width="${w}" height="${h}" fill="#e8e4d8"/></svg>`;

/**
 * Stub de logos: proporción por **ÍNDICE DE DESCUBRIMIENTO**, no por hash de la URL.
 *
 * ⚠️ La versión anterior repartía con `hash(url) % 4` y lo llamaba «cíclico». No lo era: QA la
 * instrumentó y de los cuatro sets con logo del fixture, **tres colisionaban en `cuadrado 1:1` y
 * uno en `vertical 1:2`** — las dos proporciones APAISADAS no se servían nunca, mientras el título
 * del test y las notas afirmaban que sí (defecto N-2). Hoy la colisión era benigna porque caía en
 * los peores casos, pero era una lotería: un cambio de ids del fixture podía mandarlas las cuatro a
 * `1.92:1`, justo la única que NO manifiesta B-1, y dejar el test insignia en verde permanente.
 *
 * Con índice de descubrimiento el reparto es **determinista por construcción**: cada URL distinta
 * toma la siguiente forma de la lista, así que con ≥4 logos se sirven **las cuatro, siempre**, sin
 * depender de qué ids traiga el catálogo (que es lo que se buscaba con el hash). El mapa `assigned`
 * se devuelve para que la prueba pueda **afirmar** qué se sirvió de verdad, en vez de suponerlo.
 *
 * Solo intercepta `**\/logo.png`: el arte de carta (otra ruta del mismo host) no se toca.
 */
type LogoStub = {
  /** URL del logo → forma que se le sirvió. Es el oráculo de «se sirvieron las cuatro». */
  assigned: Map<string, (typeof LOGO_SHAPES)[number]>;
  /** Rompe (404) ESA url a partir de la siguiente petición. Conserva el reparto ya hecho. */
  breakUrl: (url: string) => void;
};

async function stubSetLogos(page: Page): Promise<LogoStub> {
  const assigned = new Map<string, (typeof LOGO_SHAPES)[number]>();
  let broken: string | null = null;
  await page.route('**/logo.png', (route) => {
    const url = route.request().url();
    if (broken !== null && url === broken) return route.fulfill({ status: 404, body: '' });
    let shape = assigned.get(url);
    if (!shape) {
      shape = LOGO_SHAPES[assigned.size % LOGO_SHAPES.length];
      assigned.set(url, shape);
    }
    return route.fulfill({
      status: 200,
      contentType: 'image/svg+xml',
      body: svg(shape.w, shape.h),
    });
  });
  return {
    assigned,
    breakUrl: (url: string) => {
      broken = url;
    },
  };
}

/** Índice de sets del cotizador (`MasterSetIndex` mode="quoter"), sin auth. */
async function openSetIndex(page: Page) {
  await page.goto('/es/buylist');
  await expect(page.getByLabel(t('es', 'masterSet.searchSet'))).toBeVisible();
  const plates = page.getByTestId('set-plate');
  await expect(plates.first()).toBeVisible();
  // `loading="lazy"`: lo que está fuera del viewport no descarga. Se recorren todas para que las
  // de la segunda fila entren y las medidas no dependan del alto de la ventana.
  const count = await plates.count();
  for (let i = 0; i < count; i += 1) await plates.nth(i).scrollIntoViewIfNeeded();
  return plates;
}

/** Espera a que TODAS las imágenes de placa hayan terminado (cargadas o falladas). */
async function settleLogos(page: Page) {
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-testid="set-plate"] img')).every(
      (el) => (el as HTMLImageElement).complete,
    ),
  );
}

const NEEDS_LOGO =
  'ningún set del catálogo real tiene `logoUrl` hasta que un operador re-sincronice ' +
  '(ARCHITECTURE §4.40.4: no hay backfill) ⇒ no habría placa CON logo que medir. ' +
  'Borrar este guardarraíl en cuanto el seed E2E traiga un set con logo.';

test.describe('§24 · la placa de tinta mide lo mismo con cualquier logo (R1)', () => {
  test.beforeEach(() => needsSeed(NEEDS_LOGO));
  test('todas las placas de la retícula son idénticas y 3:2, con logo apaisado, cuadrado, vertical y sin logo', async ({
    page,
  }) => {
    const stub = await stubSetLogos(page);
    const plates = await openSetIndex(page);
    await settleLogos(page);

    const count = await plates.count();
    expect(count).toBeGreaterThanOrEqual(4); // hay retícula que medir

    // (0) EL ORÁCULO DEL PROPIO STUB. El título dice «apaisado, cuadrado, vertical»: esto lo
    //     comprueba en vez de suponerlo (defecto N-2). Con ≥4 logos tienen que estar las CUATRO
    //     formas servidas; si el reparto vuelve a colisionar —o alguien reintroduce un hash—, esta
    //     línea se pone roja antes de que la geometría dé un verde que no vale nada.
    const servidas = [...stub.assigned.values()].map((f) => f.label);
    // eslint-disable-next-line no-console
    console.log(`[proporciones servidas] ${JSON.stringify([...stub.assigned].map(([u, f]) => [u.split('/').slice(-2)[0], f.label]))}`);
    expect(stub.assigned.size, 'ningún logo servido: no hay nada que medir').toBeGreaterThan(0);
    if (stub.assigned.size >= LOGO_SHAPES.length) {
      expect(new Set(servidas)).toEqual(new Set(LOGO_SHAPES.map((f) => f.label)));
    }

    const boxes = [];
    for (let i = 0; i < count; i += 1) {
      const box = await plates.nth(i).boundingBox();
      expect(box, `placa ${i} sin caja`).not.toBeNull();
      boxes.push(box!);
    }

    // (a) Ninguna placa se sale de 3:2. Ésta es la aserción que B-1 rompía: con la <img> en flujo,
    //     el cuadrado daba 180×180 y el vertical 180×312 contra los 180×120 esperados.
    for (const [i, box] of boxes.entries()) {
      expect(
        Math.abs(box.height - (box.width * 2) / 3),
        `placa ${i}: ${Math.round(box.width)}×${Math.round(box.height)} no es 3:2`,
      ).toBeLessThanOrEqual(1);
    }

    // (b) Y todas miden EXACTAMENTE lo mismo entre sí (misma caja para todos los sets, R1).
    const [first] = boxes;
    for (const [i, box] of boxes.entries()) {
      expect(Math.abs(box.width - first.width), `ancho de la placa ${i}`).toBeLessThanOrEqual(1);
      expect(Math.abs(box.height - first.height), `alto de la placa ${i}`).toBeLessThanOrEqual(1);
    }
  });

  test('cero CLS: la placa NO cambia de alto cuando el logo llega', async ({ page }) => {
    // Se retiene la respuesta del logo para medir ANTES y DESPUÉS de que la imagen exista.
    let release: (() => void) | null = null;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // CUADRADO a propósito, para TODAS: es la proporción que hacía crecer la caja al cargar
    // (180×120 → 180×180). Con un logo apaisado de 1.92:1 el defecto no se manifestaba y esta
    // prueba habría pasado sin probar nada.
    await page.route('**/logo.png', async (route) => {
      await held; // el logo no llega hasta que se mide la placa vacía
      await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: svg(300, 300) });
    });

    const plates = await openSetIndex(page);
    const plate = plates.first();
    // Con la imagen aún en vuelo la placa ya está pintada con su relación de aspecto…
    await expect(page.getByTestId('set-monogram').first()).toBeVisible();
    const before = (await plate.boundingBox())!;

    release!();
    await settleLogos(page);
    await expect(plate.locator('img')).toHaveJSProperty('complete', true);

    const after = (await plate.boundingBox())!;
    expect(Math.abs(after.height - before.height), 'la placa saltó de alto al cargar').toBeLessThanOrEqual(1);
    expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  });
});

test.describe('§24.5 · el monograma', () => {
  test.beforeEach(() => needsSeed(NEEDS_LOGO));
  test('B-2: se RETIRA en las placas cuyo logo cargó y SOLO queda en las que no tienen logo', async ({
    page,
  }) => {
    await stubSetLogos(page);
    const plates = await openSetIndex(page);
    await settleLogos(page);

    const total = await plates.count();
    const withLogo = await page.locator('[data-testid="set-plate"] img').count();
    // El fixture tiene que traer los DOS casos, o esta prueba no prueba nada.
    expect(withLogo).toBeGreaterThan(0);
    expect(total - withLogo).toBeGreaterThan(0);

    // Un monograma por placa SIN logo, ni uno más: los que cargaron su logo se retiraron. Si el
    // monograma solo quedara «debajo», aquí habría `total` monogramas y se vería a través del PNG.
    await expect(page.getByTestId('set-monogram')).toHaveCount(total - withLogo);

    // Y ninguna placa tiene las dos cosas a la vez.
    for (let i = 0; i < total; i += 1) {
      const plate = plates.nth(i);
      const imgs = await plate.locator('img').count();
      const monos = await plate.getByTestId('set-monogram').count();
      expect(imgs + monos, `placa ${i}: ni vacía ni doble`).toBe(1);
    }
  });

  test('§24.5 nº3: un 404 del CDN cae al monograma — sin icono roto y sin dejar la placa esperando', async ({
    page,
  }) => {
    // ─────────────────────────────────────────────────────────────────────────────────────
    // LA VÍCTIMA SE ATA POR IDENTIDAD (defecto N-1). La versión anterior la localizaba como «la
    // primera teja SIN imagen», y el fixture ya trae DOS sets legítimamente sin logo: al borrar el
    // `onError` del componente, la víctima conservaba su <img> rota y el selector se iba a un set
    // que NUNCA tuvo logo, así que las tres aserciones pasaban sin haber tocado a la víctima. Era
    // un FALSO VERDE en la prueba que existe justamente para impedirlos. Ahora se recuerda QUIÉN es
    // (su nombre, descubierto del DOM) y se le exige el resultado A ELLA.
    // ─────────────────────────────────────────────────────────────────────────────────────
    const stub = await stubSetLogos(page);
    await openSetIndex(page);
    await settleLogos(page);

    // ⚠️ Se acota a las `li` que TIENEN placa: `/es/buylist` también pinta «Top Bounties», cuyas
    // tarjetas llevan arte de carta. Sin este filtro se mediría una tarjeta de bounty — el falso
    // ROJO que se corrigió antes. Ninguna de las dos acotaciones sustituye a la otra.
    const tiles = page.locator('li').filter({ has: page.getByTestId('set-plate') });

    // Se descubren la víctima (primera teja CON logo) y un TESTIGO sano (otra teja con logo).
    const total = await tiles.count();
    const conLogo: number[] = [];
    for (let i = 0; i < total; i += 1) {
      if ((await tiles.nth(i).locator('img').count()) > 0) conLogo.push(i);
    }
    expect(conLogo.length, 'hacen falta ≥2 placas con logo: una víctima y un testigo').toBeGreaterThanOrEqual(2);

    const nameOf = (i: number) => tiles.nth(i).locator('[lang="en"]').first().innerText();
    const victimName = (await nameOf(conLogo[0])).trim();
    const witnessName = (await nameOf(conLogo[1])).trim();
    const victimUrl = await tiles.nth(conLogo[0]).locator('img').getAttribute('src');
    expect(victimUrl, 'no hay ninguna placa con logo que romper').not.toBeNull();
    expect(victimName, 'la víctima no tiene nombre con el que identificarla').not.toBe('');
    expect(witnessName).not.toBe(victimName);

    // Se rompe SOLO esa URL y se recarga (el reparto de proporciones ya hecho se conserva).
    stub.breakUrl(victimUrl!);
    await openSetIndex(page);
    await settleLogos(page);

    // La víctima se localiza POR SU NOMBRE, no por «la primera que cumpla una condición».
    const victimTile = tiles.filter({ hasText: victimName });
    await expect(victimTile, `«${victimName}» tiene que identificar UNA sola teja`).toHaveCount(1);
    // Ella —y no otra— perdió la imagen y se quedó con el monograma: ni icono roto ni placa vacía.
    await expect(victimTile.locator('img')).toHaveCount(0);
    await expect(victimTile.getByTestId('set-monogram')).toBeVisible();

    // Y el TESTIGO, cuya URL no se tocó, SIGUE con su logo: prueba que lo que retiró la imagen fue
    // el 404 y no una caída global (sin esto, «cero imágenes en la página» también pasaría).
    const witnessTile = tiles.filter({ hasText: witnessName });
    await expect(witnessTile).toHaveCount(1);
    await expect(witnessTile.locator('img')).toHaveCount(1);
    await expect(witnessTile.getByTestId('set-monogram')).toHaveCount(0);

    // …y la caja de la víctima sigue midiendo lo mismo que la del testigo.
    const broken = (await victimTile.getByTestId('set-plate').boundingBox())!;
    const healthy = (await witnessTile.getByTestId('set-plate').boundingBox())!;
    expect(Math.abs(broken.height - healthy.height)).toBeLessThanOrEqual(1);
    expect(Math.abs(broken.width - healthy.width)).toBeLessThanOrEqual(1);
  });

  test('I-2: el tamaño del monograma es proporcional a la PLACA, no al breakpoint del viewport', async ({
    page,
  }) => {
    await stubSetLogos(page);

    const measure = async () => {
      const plate = page
        .locator('[data-testid="set-plate"]')
        .filter({ has: page.getByTestId('set-monogram') })
        .first();
      await plate.scrollIntoViewIfNeeded();
      const box = (await plate.boundingBox())!;
      const fontSize = await plate
        .getByTestId('set-monogram')
        .evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
      // Ancho REAL del texto (no el del `<span>`, que es `inset-0` y mide siempre lo que la placa:
      // compararlo con la placa sería una aserción que no puede fallar).
      const glyphs = await plate.getByTestId('set-monogram').evaluate((el) => {
        const range = document.createRange();
        range.selectNodeContents(el);
        return range.getBoundingClientRect().width;
      });
      return { box, fontSize, glyphs };
    };

    // 640 → 3 columnas ⇒ placa ~181px · 1024 → 4 columnas en la MISMA columna estrecha del
    // cotizador ⇒ placa ~116px (más pequeña que en móvil: es el hallazgo I-2 de QA sobre §24.4,
    // reportado a ux-ui). Sirven justo por eso: son dos placas de tamaños muy distintos.
    await page.setViewportSize({ width: 640, height: 900 });
    await openSetIndex(page);
    await settleLogos(page);
    const wide = await measure();

    await page.setViewportSize({ width: 1024, height: 900 });
    await openSetIndex(page);
    await settleLogos(page);
    const narrow = await measure();

    // Las placas miden distinto de verdad (si no, la prueba no probaría nada).
    expect(Math.abs(wide.box.width - narrow.box.width)).toBeGreaterThan(30);

    // …y en AMBOS el monograma guarda la misma proporción con su placa (§24.5: ≈16 % del ancho).
    for (const [label, m] of [
      ['ancho', wide],
      ['estrecho', narrow],
    ] as const) {
      const ratio = m.fontSize / m.box.width;
      expect(ratio, `${label}: monograma ${m.fontSize}px sobre placa ${m.box.width}px`).toBeGreaterThan(0.12);
      expect(ratio, `${label}: monograma ${m.fontSize}px sobre placa ${m.box.width}px`).toBeLessThan(0.2);
      // Y las letras nunca llenan la placa de borde a borde (el defecto I-2: «CEL» desbordado).
      expect(m.glyphs, `${label}: el monograma ocupa ${m.glyphs}px de ${m.box.width}px`).toBeLessThan(
        m.box.width * 0.8,
      );
    }
  });
});
