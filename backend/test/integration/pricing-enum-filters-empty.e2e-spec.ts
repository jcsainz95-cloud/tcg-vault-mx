/**
 * pricing-enum-filters-empty.e2e-spec.ts — **`H3-d`: los DOS ejes de enum de `pricing` que el censo
 * de §0-Q nunca listó. Uno de ellos es la COLA DE PRECIOS PENDIENTES — pantalla de DINERO.**
 *
 * ### De dónde sale (medido por HTTP con token `super_admin`, sobre `3c1bd1e`)
 * `P-84` cerró seis ejes admin, `P-89` los seis del catálogo público. El censo de
 * `API_CONTRACT §0-Q punto 4` **no menciona `pricing`**, así que sus dos ejes de enum en query
 * nunca se midieron. Medidos, los dos incumplen **§0-Q punto 1 fila 1** (vacío ≡ ausente ⇒ `200`),
 * y uno además incumple **§0-Q punto 2** (`400` y no `422` para query):
 *
 * | Ruta | Eje | Antes | §0-Q manda |
 * |---|---|---|---|
 * | `GET /admin/pricing/pending` | `context` (`PendingPriceContext`) | `422` en `''`, `' '` **y** `bogus` | `200` · `200` · **`400`** |
 * | `GET /admin/pricing/bounties` | `finish` (`Finish`) | `400` en `''` y `' '` | `200` · `200` |
 *
 * ### ⭐ Lo que delata el de `bounties`, y es el dato que decide el arreglo
 * En el **mismo controller**, `state` (`admin-bounties.controller.ts:88-98`) y `setId` (`:84-88`)
 * **sí** descartan el vacío, y `finish` no. **Nadie decidió eso**: se coló. El arreglo es alinear
 * `finish` con sus vecinos, no inventar una conducta.
 *
 * ⚠️ **Y `sort` NO estaba tan bien como parecía** (medido aquí, no leído): `parseSort` descartaba
 * `''` pero **no `' '`** (`if (raw === undefined || raw === '')` — un espacio no es cadena vacía), y
 * §0-Q fila 1 dice literalmente *«cadena vacía, o solo espacios (tras `trim()`)»*. Era **medio**
 * arreglo, que es justo la clase de conformidad que se lee como conformidad entera. Por eso este
 * fichero mide **los cuatro** parámetros del controller de bounties y no solo el roto.
 *
 * ### El `422` de `?context=` NO es conducta publicada — el contrato CALLA
 * Medido el 2026-09-13: `rg 'PendingPriceContext' docs/API_CONTRACT.md` ⇒ **0 resultados**, y la
 * única línea que describe `?context=` (`API_CONTRACT.md:10610`, «v1.26 (P-6, dos buckets)») declara
 * el dominio y el «omitido = todos», **sin código de error**. El `422` vive únicamente en el
 * comentario del controller («mismo estilo que el resto del controller»), que es una costumbre de
 * módulo, no una norma. §0-Q punto 2 ratifica **`400` y no `422`** *«es query, no cuerpo»*. No hay
 * nada que retirar del contrato: hay un hueco del censo que se rellena.
 *
 * ### ⛔ Lo que este fichero MIDE pero NO exige (decisión del arquitecto, regla 9)
 * `?reason=` de este mismo endpoint y `?axis=` de `GET /admin/reports/pricing-brackets` están
 * medidos abajo en un `describe` marcado **CENSO**, con `expect` sobre la conducta de HOY, para que
 * el arquitecto decida con dato. Ver la nota de ese bloque: **no son la misma clase entre sí**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };

describe('`H3-d` · §0-Q en `pricing` — los dos ejes que el censo no listó', () => {
  let h: E2EHarness;
  let adminToken: string;

  beforeAll(async () => {
    h = await E2EHarness.create();
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
  }, 60000);

  afterAll(async () => {
    await h?.close();
  });

  const get = (path: string) => h.api<ErrorBody>('GET', path, { token: adminToken });

  /**
   * Los ejes de enum REALES de `pricing`, con el nombre del param **tal como lo manda el cliente**
   * (que es lo que §0-Q punto 2 exige en `details.field`).
   *
   * `state` y `sort` entran aunque `state` ya conformaba: un eje que hoy está bien y **no tiene
   * prueba** es un eje que puede dejar de estarlo sin que nada suene. Es la mitad de la lección de
   * `P-84`→`P-89` (la otra mitad es el censo).
   */
  const AXES: ReadonlyArray<{ path: string; param: string; field: string; bogus: string }> = [
    // ⚠️ Pantalla de DINERO: la cola de precios pendientes.
    { path: '/admin/pricing/pending', param: 'context', field: 'context', bogus: 'bogus' },
    { path: '/admin/pricing/bounties', param: 'finish', field: 'finish', bogus: 'bogus' },
    { path: '/admin/pricing/bounties', param: 'state', field: 'state', bogus: 'bogus' },
    { path: '/admin/pricing/bounties', param: 'sort', field: 'sort', bogus: 'bogus' },
  ];

  describe('⭐ fila 1 — un espacio (`%20`) es VACÍO: no filtra, `200`', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=%20`] as const))('`GET %s` ⇒ 200 (no filtra)', async (url) => {
      const res = await get(url);
      expect(res.status).toBe(200);
    });
  });

  describe('fila 1 — la cadena VACÍA (`?x=`) tampoco filtra: `200`', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=`] as const))('`GET %s` ⇒ 200 (no filtra)', async (url) => {
      const res = await get(url);
      expect(res.status).toBe(200);
    });
  });

  describe('fila 3 — token fuera del dominio ⇒ `400` (⛔ NO `422`: es query, §0-Q punto 2)', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=${a.bogus}`, a.field] as const))(
      '`GET %s` ⇒ 400 con `details.field` = `%s`',
      async (url, field) => {
        const res = await get(url);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.field).toBe(field);
        expect(Array.isArray(res.body.error.details.allowed)).toBe(true);
      },
    );
  });

  /**
   * §0-Q punto 1 fila 2 — el `trim()` decide si está VACÍO, **no «arregla» el token**. `' inventory'`
   * no es `inventory`: es entrada mal formada. Mismo criterio que `A5` fijó para `' pending'`
   * (`test/admin.users-kyc-filter.spec.ts:218-223`).
   */
  it('⚠️ `?context=%20inventory` NO se normaliza: sigue siendo `400`', async () => {
    const res = await get('/admin/pricing/pending?context=%20inventory');
    expect(res.status).toBe(400);
    expect(res.body.error.details.field).toBe('context');
  });

  /**
   * §0-Q punto 2: `details.allowed` es una **COPIA**, no la referencia al array del módulo. Si un
   * consumidor lo mutara (`.sort()`, `.push()`) envenenaría el dominio del proceso entero. El helper
   * único lo garantiza (`common/enum-filter.ts`, `allowed: [...allowed]`).
   */
  it('`details.allowed` de `?context=` trae el dominio COMPLETO derivado de Prisma', async () => {
    const res = await get('/admin/pricing/pending?context=bogus');
    expect(res.body.error.details.allowed).toEqual(
      expect.arrayContaining(['catalog', 'portfolio', 'buylist', 'inventory']),
    );
    expect((res.body.error.details.allowed as string[]).length).toBe(4);
  });

  /**
   * ### `P-89.C1` — **el eco del valor del cliente va ACOTADO**, y aquí se mide por HTTP
   *
   * QA midió sobre `3c1bd1e`: `GET /catalog/cards?condition=<5000 chars>` ⇒ **10 137 bytes de
   * respuesta por ~5 KB de petición**, **sin sesión** (endpoint `@Public()`), porque el valor salía
   * **dos veces** —`message` y `details.value`— íntegro y sin tope.
   *
   * ⚠️ **No es XSS** (QA lo midió: `Content-Type: application/json`, `nosniff`, `<script>` sale
   * escapado como dato). Es **amplificación**: ~2× la entrada, en un endpoint público.
   *
   * El tope vive en el **helper único** (`common/enum-filter.ts`) — un solo sitio que tocar, que es
   * la deuda `H3` entera pagando su primer dividendo.
   */
  describe('`P-89.C1` — el eco del valor ofensor está ACOTADO (helper único)', () => {
    const LONG = 'A'.repeat(5000);

    it('`?context=<5000 chars>` ⇒ el cuerpo del error NO crece con la entrada', async () => {
      const res = await get(`/admin/pricing/pending?context=${LONG}`);
      expect(res.status).toBe(400);
      // El valor NO aparece íntegro ni en `message` ni en `details`.
      expect(res.text.includes(LONG)).toBe(false);
      // Cota dura: el cuerpo entero cabe holgadamente por debajo de la entrada.
      expect(res.text.length).toBeLessThan(1000);
    });

    it('un valor CORTO sigue viajando íntegro (el tope no rompe el caso normal)', async () => {
      const res = await get('/admin/pricing/pending?context=bogus');
      expect(res.body.error.message).toContain("'bogus'");
    });
  });

  /**
   * ### CENSO — ⛔ medido, **NO arreglado**: la decisión es del ARQUITECTO (regla 9)
   *
   * techlead nombró `?reason=` y `?axis=` como «uniones de literales, misma clase que `H3-b`».
   * **Medido, NO son la misma clase entre sí**, y la diferencia es la que decide:
   *
   * | Param | Tipo en `src/` | ¿Hay enum de Prisma detrás? | Clase real |
   * |---|---|---|---|
   * | `?reason=` de `/admin/pricing/pending` | `PendingReason = 'no_market'\|'premium_at_floor'` (`common/pricing-curve.ts:574`) | **SÍ** — `enum PendingPriceReason` (`schema.prisma:394-397`), **columna persistida** `PendingPriceEntry.reason` (`:1093`) | **la misma que `H3-d`**: un enum de Prisma **transcrito a mano** (`pricing.controller.ts:48`), que §0-Q punto 3 prohíbe expresamente («derivado, no transcrito») |
   * | `?axis=` de `/admin/reports/pricing-brackets` | `'sale' \| 'buy'` inline (`admin/admin.controller.ts:471`) | **NO** — `rg "enum.*[Aa]xis" schema.prisma` ⇒ 0 | unión de literales pura ⇒ **`H3-b`**, la pregunta abierta |
   *
   * Los `expect` de abajo congelan la conducta de **HOY** para que el cambio, cuando el arquitecto lo
   * decida, **sea visible** en vez de silencioso. Si mañana estos tests se ponen rojos, no es una
   * regresión: es que alguien movió la conducta y tiene que venir aquí a decir por qué.
   */
  describe('CENSO (no se exige §0-Q; conducta de HOY congelada para el arquitecto)', () => {
    it('`?reason=` (enum de Prisma TRANSCRITO a mano) ⇒ hoy `422`, y el vacío NO se descarta', async () => {
      expect((await get('/admin/pricing/pending?reason=')).status).toBe(422);
      expect((await get('/admin/pricing/pending?reason=%20')).status).toBe(422);
      expect((await get('/admin/pricing/pending?reason=bogus')).status).toBe(422);
      // Y el token válido sí funciona: no está roto, está fuera de norma.
      expect((await get('/admin/pricing/pending?reason=no_market')).status).toBe(200);
    });

    it('`?axis=` (unión de literales PURA, sin enum de Prisma) ⇒ hoy `422`, y el vacío NO se descarta', async () => {
      expect((await get('/admin/reports/pricing-brackets?axis=')).status).toBe(422);
      expect((await get('/admin/reports/pricing-brackets?axis=%20')).status).toBe(422);
      expect((await get('/admin/reports/pricing-brackets?axis=bogus')).status).toBe(422);
      expect((await get('/admin/reports/pricing-brackets?axis=sale')).status).toBe(200);
    });

    /**
     * ### ⚠️⚠️ El eje que NADIE había nombrado: `?origin=` de `GET /admin/inventory/sealed-products`
     *
     * Encontrado censando `src/` tras el arreglo, **no** venía en el encargo ni en la ficha `H3-b`.
     * `inventory/inventory.controller.ts:177-179` compara contra **dos literales escritos a mano**
     * (`origin !== 'set_main' && origin !== 'promo_collection'`) — y detrás hay un **enum de Prisma**:
     * `enum SealedGroupKind` (`schema.prisma:82-85`), columna persistida (`:625`, `:656`). Es la
     * MISMA clase que `?reason=`: enum de Prisma transcrito a mano, prohibido por §0-Q punto 3.
     *
     * Incumple además §0-Q punto 2 **más fuerte que ningún otro eje del censo**: su `400` no lleva
     * `details` **en absoluto** — ni `field` ni `allowed`. Los demás al menos emiten una de las dos.
     *
     * ⛔ **NO se arregla aquí y la razón es de proceso, no de esfuerzo:** `inventory` es de OTRO work
     * stream («Inventario y vault»), y este pase es del stream de `pricing`. Se mide y se enruta.
     */
    it('⚠️ `?origin=` de inventory (enum de Prisma inline, `details` VACÍO) ⇒ hoy `400` sin `field`', async () => {
      const vacio = await get('/admin/inventory/sealed-products?setId=nope&origin=');
      const espacio = await get('/admin/inventory/sealed-products?setId=nope&origin=%20');
      const bogus = await get('/admin/inventory/sealed-products?setId=nope&origin=bogus');

      // `''` SÍ se descarta (`origin !== ''`), pero `' '` NO — la media conformidad de `sort`, otra vez.
      expect(espacio.status).toBe(400);
      expect(bogus.status).toBe(400);
      // ⛔ Y el `400` no dice de qué campo es ni qué se aceptaba: `details` llega VACÍO (`{}`), no
      // ausente — medido, no supuesto. §0-Q punto 2 exige `field` y `allowed`, y aquí no hay ninguno.
      expect(bogus.body.error.details).toEqual({});
      expect(bogus.body.error.details.field).toBeUndefined();
      expect(bogus.body.error.details.allowed).toBeUndefined();
      // El vacío no llega a validarse por `origin`: pasa de largo (su desenlace lo decide el `setId`).
      expect(vacio.body.error.details).toEqual({});
    });
  });
});
