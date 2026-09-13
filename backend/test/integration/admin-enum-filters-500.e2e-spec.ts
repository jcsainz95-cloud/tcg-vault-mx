/**
 * admin-enum-filters-500.e2e-spec.ts — **`P-84`: el mismo `500` disparable desde la barra de
 * direcciones, en los cuatro módulos que quedaron fuera de `A5`.**
 *
 * ### Qué mide y por qué por HTTP real
 * `A5` cerró `GET /admin/users` (`?status=banana` ⇒ `400`, antes `500 INTERNAL`). El **camino de
 * código** idéntico seguía vivo en otros SEIS ejes, todos con la misma forma: un valor de query
 * CRUDO metido en un `where` de Prisma con `as never`. Prisma revienta con
 * `PrismaClientValidationError`, y el filtro global (`src/common/filters/all-exceptions.filter.ts`)
 * **no mapea nada de Prisma**: todo lo que no sea `HttpException` cae a `500 INTERNAL`.
 *
 * Se mide por HTTP real y no con mocks a propósito: el defecto **es** que Prisma explote contra
 * Postgres de verdad. Un doble de Prisma acepta `'banana'` sin rechistar y el test saldría verde
 * sobre código roto — exactamente el falso verde que esta suite existe para no dar.
 *
 * ### Los seis ejes (fichero:línea del defecto, medido sobre `c12b940`)
 * | # | Ruta | Eje | Sitio |
 * |---|---|---|---|
 * | 1 | `GET /admin/orders` | `status` | `orders/admin-orders.controller.ts:58` |
 * | 2 | `GET /admin/disputes` | `status` | `disputes/disputes.service.ts:159` |
 * | 3 | `GET /admin/shipments` | `status` | `shipments/shipments.service.ts:373` |
 * | 4 | `GET /admin/inventory/items` | `status` | `inventory/inventory.service.ts:2224` |
 * | 5 | `GET /admin/inventory/items` | `ownerType` | `inventory/inventory.service.ts:2226` |
 * | 6 | `GET /admin/inventory/items` | `zone` | `inventory/inventory.service.ts:2228` |
 *
 * El (1) ya lo exigía el contrato (`API_CONTRACT.md` §M3, `400 VALIDATION_ERROR` para `status` fuera
 * de enum): ahí el código **incumplía** lo publicado, no es conducta nueva.
 *
 * ### `details.field` es obligatorio, y en inventario es el punto entero
 * Tres ejes conviven en la misma petición. Un `400` que no diga **cuál** rechazó deja al operador
 * adivinando entre `status`, `ownerType` y `zone`. Misma forma que `A5` publicó
 * (`admin.service.ts` · `assertEnumFilter`).
 *
 * ### Lo que este fichero NO hace (acotado a propósito, techlead)
 * No comprueba rechazo de **llaves desconocidas** (`?zzz=1`). Rechazar una llave desconocida puede
 * romper a un cliente que hoy funciona; validar un enum que **ya da `500`** no puede romper a nadie,
 * porque quien lo manda ya está recibiendo un `500`. Son dos cambios de riesgo distinto y aquí solo
 * va el segundo.
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };

describe('`P-84` — valor fuera de enum en filtro admin ⇒ `400`, NUNCA `500`', () => {
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
   * El candado, idéntico para los seis ejes: `400` + `VALIDATION_ERROR` + `details.field` con el
   * nombre del eje rechazado. Se afirma `not.toBe(500)` explícitamente además del `toBe(400)`
   * porque **`500` es el defecto concreto** y quiero que la salida del rojo lo nombre.
   */
  async function esperaCuatrocientos(path: string, field: string) {
    const res = await get(path);
    expect({ path, status: res.status }).toEqual({ path, status: 400 });
    expect(res.status).not.toBe(500);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.field).toBe(field);
    return res;
  }

  /**
   * §0-Q punto 1, fila 1 — **vacío / solo espacios (tras `trim()`) ≡ ausente. NUNCA `400`.**
   * Un `Select` en «Todas» manda cadena vacía; tratarla como inválida rompe la pantalla por su
   * estado por defecto. El espacio es el caso que el `if (status)` de los seis sitios **no** cubría:
   * `' '` es **truthy** en JS, así que viajaba a Prisma igual que `'banana'`.
   */
  async function esperaEquivaleAAusente(base: string, field: string) {
    const sinFiltro = await get(base);
    expect(sinFiltro.status).toBe(200);
    const total = (sinFiltro.body as any).total;
    for (const [etiqueta, valor] of [['vacío', ''], ['un espacio', '%20'], ['tabulador', '%09']] as const) {
      const res = await get(`${base}${base.includes('?') ? '&' : '?'}${field}=${valor}`);
      expect({ etiqueta, field, status: res.status }).toEqual({ etiqueta, field, status: 200 });
      expect({ etiqueta, field, total: (res.body as any).total }).toEqual({ etiqueta, field, total });
    }
  }

  /**
   * §0-Q punto 1, fila 3 — **valor NO ESCALAR ⇒ `400`.**
   *
   * ⚠️ **Corrección `P-89` (QA):** este docstring repetía el mecanismo que §0-Q punto 1 fila 3
   * SUPONE —«llega al handler como **array**»— y que **este mismo commit ya había refutado con
   * medición** en `common/enum-filter.ts:117-131`: el `ValidationPipe` global va con
   * `transform: true` (`src/main.ts:56`) y el parámetro se declara `@Query('x') x?: string`, así que
   * Nest **coacciona el array al metatipo `String` ANTES del handler** ⇒ `['a','b']` llega como
   * `'a,b'`. Al handler **no llega ningún array**.
   *
   * Lo que esta prueba mide, por tanto, es el **desenlace** —`400`, que es lo que §0-Q manda— **por
   * un mecanismo distinto del que el contrato describe**: `'a,b'` no pertenece al dominio. El
   * desenlace es el mismo y la prueba sigue siendo válida; lo que era falso era la explicación, y
   * una explicación falsa en un test es la que manda a alguien a «arreglar» lo que no está roto.
   */
  async function esperaNoEscalar(base: string, field: string) {
    const res = await get(`${base}${base.includes('?') ? '&' : '?'}${field}=a&${field}=b`);
    expect({ field, status: res.status }).toEqual({ field, status: 400 });
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.field).toBe(field);
  }

  /** Los seis ejes de `P-84`, como tabla: la norma §0-Q es UNA y se comprueba IGUAL en los seis. */
  const EJES: ReadonlyArray<readonly [string, string]> = [
    ['/admin/orders', 'status'],
    ['/admin/disputes', 'status'],
    ['/admin/shipments', 'status'],
    ['/admin/inventory/items', 'status'],
    ['/admin/inventory/items', 'ownerType'],
    ['/admin/inventory/items', 'zone'],
  ];

  describe('§0-Q.1 — vacío/espacios ≡ ausente (⛔ nunca `400`), en los SEIS ejes', () => {
    it.each(EJES)('`GET %s` · `?%s=` vacío/espacio/tab ⇒ 200 y el MISMO `total` que sin filtro', async (base, field) => {
      await esperaEquivaleAAusente(base, field);
    });
  });

  // ⚠️ `P-89`: el título decía «⇒ array». Medido: llega `'a,b'` (ver el docstring de `esperaNoEscalar`).
  describe('§0-Q.1 — parámetro REPETIDO (`?x=a&x=b`) ⇒ `400`, en los SEIS ejes', () => {
    it.each(EJES)('`GET %s` · `?%s` repetido ⇒ 400 con `details.field` (⛔ nunca 500)', async (base, field) => {
      await esperaNoEscalar(base, field);
    });
  });

  describe('`P-84.1` — `GET /admin/orders?status=` (el contrato §M3 YA lo exigía)', () => {
    it('`?status=banana` ⇒ 400 VALIDATION_ERROR con `details.field=status` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/orders?status=banana', 'status');
    });

    it('un valor VÁLIDO sigue filtrando (la validación no rompe el camino feliz)', async () => {
      const res = await get('/admin/orders?status=settled');
      expect(res.status).toBe(200);
    });
  });

  describe('`P-84.2` — `GET /admin/disputes?status=`', () => {
    it('`?status=banana` ⇒ 400 VALIDATION_ERROR con `details.field=status` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/disputes?status=banana', 'status');
    });

    it('un valor VÁLIDO sigue filtrando', async () => {
      const res = await get('/admin/disputes?status=abierta');
      expect(res.status).toBe(200);
    });
  });

  describe('`P-84.3` — `GET /admin/shipments?status=`', () => {
    it('`?status=banana` ⇒ 400 VALIDATION_ERROR con `details.field=status` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/shipments?status=banana', 'status');
    });

    it('un valor VÁLIDO sigue filtrando', async () => {
      const res = await get('/admin/shipments?status=solicitado');
      expect(res.status).toBe(200);
    });
  });

  describe('`P-84.4/5/6` — `GET /admin/inventory/items`: TRES ejes en la misma petición', () => {
    it('`?status=banana` ⇒ 400 con `details.field=status` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/inventory/items?status=banana', 'status');
    });

    it('`?ownerType=banana` ⇒ 400 con `details.field=ownerType` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/inventory/items?ownerType=banana', 'ownerType');
    });

    it('`?zone=banana` ⇒ 400 con `details.field=zone` (⛔ nunca 500)', async () => {
      await esperaCuatrocientos('/admin/inventory/items?zone=banana', 'zone');
    });

    it('⭐ los tres ejes inválidos a la vez: el `400` nombra UNO y es uno de los tres', async () => {
      const res = await get('/admin/inventory/items?status=x&ownerType=y&zone=z');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(['status', 'ownerType', 'zone']).toContain(res.body.error.details.field);
    });

    it('valores VÁLIDOS en los tres ejes siguen filtrando', async () => {
      const res = await get('/admin/inventory/items?status=in_stock&ownerType=platform&zone=platform_stock');
      expect(res.status).toBe(200);
    });
  });
});
