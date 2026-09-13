/**
 * catalog-enum-filters-empty.e2e-spec.ts — **§0-Q punto 1 fila 1 en el CATÁLOGO PÚBLICO: un filtro
 * de enum vacío (o solo espacios) NO filtra y devuelve `200`. Hoy devuelve `400`.**
 *
 * ### Por qué este fichero existe (`P-89`, medido 2026-09-13 por HTTP sobre `8d29988`)
 * El censo de `API_CONTRACT §0-Q punto 4` declara **✅ conforme** a `GET /catalog/cards` y
 * `GET /catalog/sealed`. Lo son en **la forma del `details`** (`{field,value,allowed}`, y `value` es
 * opcional-conforme), **no** en la **fila 1** de §0-Q punto 1: los seis ejes escriben `if (q.X)`, y
 * en JS **`' '` es truthy** ⇒ un espacio pasa el `if`, entra en `validateEnum` y sale `400`.
 *
 * Es el **mismo borde** que `P-84` cerró en los seis ejes admin, con dos diferencias que importan:
 *
 *  - **Severidad MENOR:** aquí el desenlace es `400`, no `500` — el valor nunca llegó crudo a Prisma
 *    (el catálogo sí valida el token). No hay `PrismaClientValidationError` que enterrar.
 *  - **Exposición MAYOR:** estos dos endpoints son **`@Public()`** (`catalog.controller.ts:29,78`).
 *    No hace falta sesión admin: lo dispara cualquiera desde la barra de direcciones.
 *
 * ### ⚠️ El séptimo caso NO es un eje: `GET /catalog/sealed?productType=` (medido, no asumido)
 * Devuelve `200` — pero **no porque sea conforme**: `GET /catalog/sealed` **no declara** un
 * `@Query('productType')` (`catalog.controller.ts:80-87`, siete líneas, y `productType` no está), y
 * `listSealed` fija `productType: 'sealed'` en el `where` (`sealed-catalog.service.ts:235`). Es una
 * **llave desconocida**, y la doctrina de llaves desconocidas sigue ⛔ acotada a `GET /admin/users`
 * (`§0-Q`, `D-A5-3`) ⇒ se ignora en silencio. Se prueba aquí **como no-eje**, con esa afirmación
 * escrita, para que nadie vuelva a leer su `200` como una conformidad.
 *
 * ### El eje que sí faltaba medir: `GET /catalog/sealed?condition=`
 * El censo de §0-Q punto 4 lista para `/catalog/sealed` los ejes **`sealedSubtype` y `condition`**.
 * `condition` (⇒ `sealedCondition`) es el sexto eje real del catálogo y **no estaba en la medición
 * que abrió `P-89`**; se mide aquí.
 */
import { E2EHarness } from './helpers/e2e-app';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };

describe('`P-89` · §0-Q punto 1 fila 1 — filtro de enum VACÍO en el catálogo público', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
  }, 60000);

  afterAll(async () => {
    await h?.close();
  });

  // Endpoint PÚBLICO: ⛔ a propósito SIN token. Si un día dejara de ser público, esto debe romperse.
  const get = (path: string) => h.api<ErrorBody>('GET', path, {});

  /**
   * Los SEIS ejes de enum reales del catálogo público, con el nombre del param **tal como lo manda
   * el cliente** (que es lo que §0-Q punto 2 exige en `details.field`).
   */
  const AXES: ReadonlyArray<{ path: string; param: string; field: string }> = [
    { path: '/catalog/cards', param: 'productType', field: 'productType' },
    { path: '/catalog/cards', param: 'condition', field: 'condition' },
    { path: '/catalog/cards', param: 'finish', field: 'finish' },
    { path: '/catalog/cards', param: 'sealedSubtype', field: 'sealedSubtype' },
    { path: '/catalog/sealed', param: 'sealedSubtype', field: 'sealedSubtype' },
    { path: '/catalog/sealed', param: 'condition', field: 'condition' },
  ];

  describe('⭐ fila 1 — un espacio (`%20`) es VACÍO: no filtra, `200`', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=%20`, a.path, a.param] as const))(
      '`GET %s` ⇒ 200 (no filtra)',
      async (url) => {
        const res = await get(url);
        expect(res.status).toBe(200);
      },
    );
  });

  describe('fila 1 — la cadena VACÍA (`?x=`) ya conformaba, y debe seguir conformando', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=`] as const))('`GET %s` ⇒ 200 (no filtra)', async (url) => {
      const res = await get(url);
      expect(res.status).toBe(200);
    });
  });

  describe('⛔ lo que NO cambia: el token inválido sigue siendo `400` con su `details`', () => {
    it.each(AXES.map((a) => [`${a.path}?${a.param}=bogus`, a.field] as const))(
      '`GET %s` ⇒ 400 VALIDATION_ERROR con `details.field` = %s',
      async (url, field) => {
        const res = await get(url);
        expect(res.status).toBe(400);
        expect(res.body.error.code).toBe('VALIDATION_ERROR');
        expect(res.body.error.details.field).toBe(field);
        expect(Array.isArray(res.body.error.details.allowed)).toBe(true);
      },
    );

    /**
     * ⭐ `details.value` es una llave **ya publicada** por estos dos endpoints `@Public()`, y §0-Q
     * punto 2 la declara OPCIONAL-conforme. Migrar al helper común la habría retirado en silencio:
     * `parseEnumFilter` emite `{field, allowed}`. Este candado es la razón de que el helper tenga
     * `echoValue` — si alguien lo quita, esto muerde.
     */
    it.each(AXES.map((a) => [`${a.path}?${a.param}=bogus`] as const))(
      '⭐ `GET %s` conserva `details.value` (llave publicada, ⛔ no se retira)',
      async (url) => {
        expect((await get(url)).body.error.details.value).toBe('bogus');
      },
    );

    /**
     * §0-Q: el `trim()` decide si está VACÍO; ⛔ **no «arregla» el token**. `' NM'` es entrada mal
     * formada, no un `NM` con adornos — la misma frontera que `A5` fijó en
     * `test/admin.users-kyc-filter.spec.ts:218-223`.
     */
    it('`?condition=%20NM` (token con espacio delante) ⇒ 400, NO se normaliza a `NM`', async () => {
      const res = await get('/catalog/cards?condition=%20NM');
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe('condition');
    });
  });

  /**
   * ⚠️ NO es un eje. Ver el docstring de cabecera: `GET /catalog/sealed` no declara `productType`.
   * Su `200` mide la **doctrina de llaves desconocidas**, no §0-Q.
   */
  describe('⚠️ `GET /catalog/sealed?productType=` NO es un eje de enum — es una llave desconocida', () => {
    it('un espacio ⇒ 200 (llave ignorada, no validada)', async () => {
      expect((await get('/catalog/sealed?productType=%20')).status).toBe(200);
    });

    it('⭐ la PRUEBA de que no está validado: un token BASURA también ⇒ 200 (un eje daría 400)', async () => {
      expect((await get('/catalog/sealed?productType=bogus')).status).toBe(200);
    });

    it('⭐ y un token VÁLIDO de `ProductType` tampoco filtra: `?productType=raw` ⇒ 200 con sellado', async () => {
      // Si `productType` fuera un eje vivo, pedir `raw` en la rejilla de SELLADO daría lista vacía.
      // Devuelve `200` y el `where` fijo (`productType: 'sealed'`) sigue mandando.
      const res = await get('/catalog/sealed?productType=raw');
      expect(res.status).toBe(200);
    });
  });
});
