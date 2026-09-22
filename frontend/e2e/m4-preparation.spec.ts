import { test, expect, type Page } from '@playwright/test';
import { t } from './utils/i18n';
import { loginAs, mockOnly, needsSeed } from './utils/auth';

/**
 * **«Pedidos a preparar» (M4) en un NAVEGADOR DE VERDAD** — `DESIGN_SYSTEM §35`, contrato §M4-PREP.
 *
 * ⭐ **Por qué existe este fichero, dicho con la medición que lo motivó.** QA levantó que los
 * candados `PR-1..PR-10` **solo existían en jsdom** y que el CI no podía ejercerlos. El diagnóstico
 * que traía —«falta una fixture con `fullName: null`»— **era incorrecto**: esa fixture existe desde
 * `102d57d` (`mockPreparationQueue` tiene TRES filas y la tercera, `shp-7005`, trae
 * `customer: { lastName: null, fullName: null }`). **La causa real era otra y más simple: no había
 * ningún spec de Playwright que abriera esta pantalla.** El único `/admin/m4` de la suite
 * (`account.spec.ts`) entra para probar el rebote de contraseña temporal y se va.
 *
 * Así que lo que faltaba no era un dato: era **este fichero**. Y la diferencia importa, porque
 * añadir la fixture habría dejado el hueco abierto con la sensación de haberlo cerrado.
 *
 * **Qué mide aquí que jsdom NO puede medir**, y es lo que justifica el coste de un navegador:
 * §35.14 A-4 pide los candados en **390×844** y **1280×800**, y jsdom **no tiene viewport ni
 * layout**: allí `display`, el reflow y el desbordamiento no existen. Estos casos corren en los dos
 * anchos y comprueban, además de la conducta, que **nada desborda en horizontal**.
 */

/**
 * ⚠️⚠️ **LO QUE ESTE FICHERO NO PUEDE MEDIR, Y POR QUÉ — para QA, y dicho con el dato.**
 *
 * §35.14 A-4 pide **PR-11..PR-16** (el `409` de fila corrupta, §35.15) también en los dos viewports.
 * **Aquí no se pueden escribir**, y no por pereza: cuando Playwright levanta el servidor él mismo lo
 * hornea con `NEXT_PUBLIC_USE_MOCKS=true`, y en esa rama `getAdminPreparationQueue` **devuelve el
 * fixture sin hacer ninguna petición HTTP** (`lib/api.ts`: el `apiRequest` vive detrás de
 * `if (!config.useMocks)`). ⇒ **no hay red que interceptar**, y por tanto **no hay forma de provocar
 * un `409`** desde esta corrida. Un `page.route()` aquí no casaría nunca y el caso fallaría por la
 * razón equivocada.
 *
 * ⛔ **Por eso NO se deja aquí un caso que solo sepa saltarse:** una prueba que nadie ha visto pasar
 * no es cobertura, es una promesa. Los `PR-11..PR-16` viven hoy en `M4View.test.tsx` (jsdom), donde
 * **sí** se pueden ejercer, con **8 casos** y canarios de mutación.
 *
 * **Cómo ejercerlos en navegador cuando haya stack real** (`E2E_BASE_URL=… npm run test:e2e`), que es
 * el camino que QA ya usó para PR-1..PR-10:
 *
 * ```ts
 * await page.route('**\/admin/shipments/picking-list*', (route) =>
 *   route.fulfill({
 *     status: 409,
 *     contentType: 'application/json',
 *     body: JSON.stringify({ error: { code: 'CONFLICT', message: 'shipmentId: shp-roto' } }),
 *   }),
 * );
 * ```
 * …y después asertar lo de §35.14 A-4: el título del `409` y **ninguno** de los otros tres (PR-11),
 * cero botones dentro del aviso (PR-12), `role="alert"` único con la región viva vacía (PR-13), el
 * `<details>` cerrado (PR-14), la frase de impacto en tinta **computada** (PR-15 — esto es lo que
 * jsdom no puede) y el filtro habilitado que no cambia el estado (PR-16).
 */

/** Ancho de trabajo del operador (de pie) y el de escritorio. §35.14 A-4 pide los dos. */
const VIEWPORTS = [
  { name: '390×844 (de pie)', size: { width: 390, height: 844 } },
  { name: '1280×800 (escritorio)', size: { width: 1280, height: 800 } },
] as const;

const P = (key: string) => t('es', `admin.m4.prep.${key}`);

/** ⛔ Un `toBeVisible()` pasa igual con scroll horizontal: lo que se aserta es que NO lo haya. */
async function expectNoHorizontalOverflow(page: Page) {
  const { scrollW, clientW } = await page.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
  }));
  expect(scrollW, `la pantalla desborda ${scrollW - clientW}px en horizontal`).toBeLessThanOrEqual(
    clientW,
  );
}

for (const vp of VIEWPORTS) {
  test.describe(`admin · Pedidos a preparar · ${vp.name}`, () => {
    test.use({ viewport: vp.size });

    test.beforeEach(async ({ page }) => {
      await loginAs(page, 'admin');
    });

    /**
     * **P-10 en layout real.** La ruta hospeda una pantalla de administración (la cola de envíos,
     * sin paginar) y una de ejecución física. Manda la que se usa de pie: el operador que entra a
     * preparar ⛔ no puede tener que hacer scroll por una lista que no es la suya.
     */
    test('la hoja de trabajo se pinta ARRIBA de la cola de envíos, y nada desborda', async ({ page }) => {
      needsSeed('la cola de preparación exige un ShipmentRequest en `picking`');
      await page.goto('/es/admin/m4');

      const prep = page.getByRole('heading', { name: P('title') });
      const cola = page.getByRole('heading', { name: t('es', 'admin.m4.queueTitle') });
      await expect(prep).toBeVisible();
      await expect(cola).toBeVisible();

      const yPrep = (await prep.boundingBox())!.y;
      const yCola = (await cola.boundingBox())!.y;
      expect(yPrep, 'la herramienta de trabajo quedó debajo de la pantalla de administración').toBeLessThan(yCola);

      await expectNoHorizontalOverflow(page);
    });

    /**
     * **PR-7 · PR-8 · PR-9 · PR-10 sobre el bloque de §35.6a, con layout de verdad.**
     * `mockOnly` porque el caso depende de un dato de fixture: `fullName === null` solo ocurre con
     * un invitado cuyo `addressSnapshot` es de los de ocho campos, y el seed real no lo siembra
     * (backend midió que hoy es prácticamente inalcanzable en producción — razón de más para que el
     * único sitio donde se puede ejercer, el modo mocks, lo ejerza de verdad).
     */
    test('§35.6a · la ausencia total de nombre se NOMBRA: marca + frase, sin guion', async ({ page }) => {
      mockOnly('`fullName: null` es un pedido de invitado con snapshot legado; el seed real no lo tiene');
      await page.goto('/es/admin/m4');

      const block = page.getByTestId('prep-fullname-missing-shp-7005');
      await expect(block).toBeVisible();

      // El copy normativo, en pantalla (la carga útil de la frase, que ⛔ no se puede recortar).
      await expect(block).toContainText('hueco del registro, no un cliente anónimo');

      /*
       * ⚠️ **Dos instrumentos, y no son intercambiables — lo aprendí fallando aquí.**
       * `innerText` devuelve el texto **RENDERIZADO**: aplica el `text-transform: uppercase`, así que
       * dice «SIN NOMBRE REGISTRADO». `textContent` devuelve el texto **del DOM**, que es el que
       * recoge quien aplane el nodo a una cadena — y es el sujeto de **PR-9**. Mi primera versión
       * midió PR-9 sobre `innerText` y falló por la CAJA, no por el espacio. *(De paso: el `·` que
       * Playwright pintó en el diff no era contenido — así dibuja él un salto de línea.)*
       */
      const rendered = (await block.innerText()).trim();
      const dom = (await block.evaluate((el) => el.textContent ?? '')).trim();

      // PR-7 · ⛔ ningún em dash, ni en lo que se ve ni en lo que se lee: en este sistema ya
      // significa «precio pendiente» (§16.3a) y se lee como cero.
      expect(rendered, 'volvió el guion a la ranura del nombre').not.toContain('—');
      expect(dom).not.toContain('—');

      // PR-9 · el espacio entre marca y frase existe DE VERDAD en el DOM, no lo pinta un `gap`.
      expect(dom).not.toMatch(/registradoLa dirección/);
      expect(dom).toMatch(/registrado\s+La dirección/);

      /*
       * ⭐ **§35.6a-f, medido de punta a punta y SOLO posible en un navegador:** la versalita la pone
       * el **CSS**, ⛔ no la cadena (hay lectores de pantalla que deletrean la caja alta). El
       * unitario solo puede afirmar la mitad —que el catálogo no está en mayúsculas—; que el motor
       * **sí** la pinte en versalitas exige cascada real, y jsdom no la tiene.
       */
      const tag = block.locator('p').first();
      expect(await tag.evaluate((el) => getComputedStyle(el).textTransform)).toBe('uppercase');
      expect((await tag.evaluate((el) => el.textContent ?? '')).trim()).toBe(P('nameMissing.tag'));
      expect(rendered).toContain(P('nameMissing.tag').toUpperCase());

      // PR-8 · una ausencia, UNA frase: el aviso del apellido no se apila encima.
      const card = page.getByTestId('prep-customer-shp-7005');
      await expect(card).not.toContainText(t('es', 'admin.m4.prep.lastNameUnknown'));

      /*
       * ⭐ Lo que jsdom NO podía comprobar y por eso este caso vive aquí: que marca y frase son dos
       * BLOQUES de verdad. El unitario cuenta `children.length === 2`, que es estructura; esto lee
       * el `display` COMPUTADO por el motor, que es lo que de verdad separa las dos líneas.
       */
      const displays = await block.evaluate((el) =>
        Array.from(el.children).map((c) => getComputedStyle(c).display),
      );
      expect(displays).toHaveLength(2);
      for (const d of displays) expect(d).toBe('block');

      await expectNoHorizontalOverflow(page);
    });

    /**
     * **PR-1 en navegador, y es env-AGNÓSTICO a propósito:** la cubeta `vault` está vacía **en los
     * dos modos**, porque las órdenes `fulfillmentMode='vault'` no generan `ShipmentRequest`
     * (hallazgo medido del arquitecto, §M4-PREP). Es el único candado de esta pantalla que el
     * backend real puede satisfacer hoy sin sembrar nada.
     */
    test('PR-1 · la cubeta de bóveda vacía explica la ausencia y ⛔ NO afirma «nada pendiente»', async ({ page }) => {
      await page.goto('/es/admin/m4');
      await page.getByRole('button', { name: P('filterVault') }).click();

      await expect(page.getByRole('heading', { name: P('emptyVault.title') })).toBeVisible();
      const body = await page.locator('main').innerText();
      expect(body.toLowerCase(), 'el vacío volvió a tranquilizar sobre lo que nadie mide').not.toContain(
        'nada pendiente',
      );
      await expectNoHorizontalOverflow(page);
    });
  });
}
