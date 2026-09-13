/**
 * enum-query-filter-scalar.e2e-spec.ts — **§0-Q punto 1 fila 3 y fila 1 en los DOS ejes que el censo
 * del contrato da por conformes: `GET /admin/buylist` (CSV, DINERO) y `GET /admin/users` (`A5`).**
 *
 * ### Por qué este fichero existe aparte de `admin-enum-filters-500.e2e-spec.ts`
 * Aquél cubre los **seis** ejes que llegaban crudos a Prisma. Éste cubre los dos que el censo de
 * `API_CONTRACT §0-Q punto 4` marca **✅ ya validan** — y que por tanto **nadie iba a volver a medir**.
 * La nota del propio contrato lo dice con todas las letras:
 *
 * > *«Camino de código leído, NO ejecutado (NO MEDIDO): lo esperable es `TypeError` ⇒ `500`. Sea cual
 * > sea el desenlace real, la norma es la misma —`400`— y **la prueba que lo cierre es del backend**,
 * > no una afirmación de este documento.»*
 *
 * Eso es exactamente lo que se mide aquí, y por eso se mide **por HTTP real**: el desenlace depende
 * de cómo Express parsea `?status=a&status=b` y de qué hace Prisma con un array, dos cosas que un
 * doble no reproduce.
 *
 * ### `GET /admin/buylist` toca DINERO
 * Es la cola de compra (`SellRequest`): montos cotizados, pagos al vendedor. Un `500` ahí no es solo
 * ruido — es una cola de dinero que el operador no puede abrir. Por eso el séptimo sitio se mide
 * aunque el censo lo diera por bueno: *el censo midió que valida **tokens**, no que sobreviva a un
 * **array**.*
 */
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';

type ErrorBody = { error: { code: string; message: string; details: Record<string, unknown> } };

describe('`P-84` · §0-Q — los dos ejes que el censo daba por conformes', () => {
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

  describe('⭐ SÉPTIMO sitio — `GET /admin/buylist` (CSV, cola de DINERO)', () => {
    it('el CSV de tokens sigue funcionando (⛔ no se rompe lo que ya servía)', async () => {
      const res = await get('/admin/buylist?status=pagada,rechazada,abandonada');
      expect(res.status).toBe(200);
    });

    it('un token inválido sigue dando 400 con `details.invalidStatus` (publicado, NO se retira)', async () => {
      const res = await get('/admin/buylist?status=pagada,bogus');
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.invalidStatus).toEqual(['bogus']);
    });

    it('§0-Q aditivo: el mismo 400 trae AHORA `details.field` y `details.allowed`', async () => {
      const res = await get('/admin/buylist?status=pagada,bogus');
      expect(res.body.error.details.field).toBe('status');
      expect(Array.isArray(res.body.error.details.allowed)).toBe(true);
      expect(res.body.error.details.allowed).toContain('pagada');
    });

    /**
     * ⭐⭐ **La medición que REFUTA la nota «NO MEDIDO» de §0-Q punto 4.**
     *
     * El contrato supone que `?status=a&status=b` entrega un **array**, que `.split(',')` sobre un
     * array lanza `TypeError` y que el desenlace es **`500`**. **Los tres eslabones son falsos aquí**,
     * y la causa está aguas arriba del handler: el `ValidationPipe` global va con `transform: true`
     * (`src/main.ts:56`) y el parámetro se declara `@Query('status') status?: string`, así que Nest
     * **coacciona el array al metatipo `String`** antes de que el handler exista: `['a','b']` ⇒ `'a,b'`.
     *
     * Medido por HTTP el 2026-09-13 (`admin@e2e.local`, app real + Postgres real):
     * `?status=pagada&status=bogus` ⇒ `400 { invalidStatus: ['bogus'] }`, **byte a byte idéntico** a
     * `?status=pagada,bogus`. `.split` funcionó ⇒ era una cadena ⇒ **no hay `TypeError` ni `500`**.
     *
     * ⚠️ **Discrepancia viva para el arquitecto, NO cerrada por backend.** §0-Q punto 1 fila 3 exige
     * `400` para el valor no escalar. En este endpoint eso es **inimplementable en el handler**: la
     * información de que vinieron DOS parámetros la destruye el pipe antes de llegar, y `?status=a&
     * status=b` es indistinguible de `?status=a,b` — que es una peticion CSV **legítima**. Forzar el
     * `400` exigiría `@Req()` o cambiar el tipo del parámetro, y ninguna de las dos es una decisión de
     * backend. **Este test fija la conducta MEDIDA**, no la supuesta; el día que el arquitecto decida
     * otra cosa, este test es el que hay que cambiar — a propósito.
     */
    it('⭐ NO ESCALAR `?status=a&status=b` ≡ CSV `?status=a,b` — y NUNCA 500 (medido, ⛔ no es lo que §0-Q supone)', async () => {
      const repetido = await get('/admin/buylist?status=pagada&status=rechazada');
      const csv = await get('/admin/buylist?status=pagada,rechazada');
      expect(repetido.status).not.toBe(500);
      expect(repetido.status).toBe(csv.status);
      expect(repetido.body).toEqual(csv.body);

      // Y con un token malo, el `400` es el del CSV — la prueba de que hubo `.split` sobre una cadena.
      const malo = await get('/admin/buylist?status=pagada&status=bogus');
      expect(malo.status).toBe(400);
      expect(malo.status).not.toBe(500);
      expect(malo.body.error.details.invalidStatus).toEqual(['bogus']);
    });

    it('vacío/espacios ≡ ausente (⛔ nunca 400)', async () => {
      for (const v of ['', '%20', '%09']) {
        const res = await get(`/admin/buylist?status=${v}`);
        expect({ v, status: res.status }).toEqual({ v, status: 200 });
      }
    });
  });

  describe('`GET /admin/users` — el «ejemplar» de `A5`, en los dos casos que `A5` no cubrió', () => {
    it.each(['status', 'kycStatus'])('`?%s=a&%s=b` (array) ⇒ 400, NUNCA 500', async (field) => {
      const res = await get(`/admin/users?${field}=a&${field}=b`);
      expect({ field, status: res.status }).toEqual({ field, status: 400 });
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details.field).toBe(field);
    });

    it.each(['status', 'kycStatus'])('`?%s=` con SOLO UN ESPACIO ≡ ausente (⛔ nunca 400)', async (field) => {
      const sin = await get('/admin/users');
      const res = await get(`/admin/users?${field}=%20`);
      expect({ field, status: res.status }).toEqual({ field, status: 200 });
      expect((res.body as any).total).toBe((sin.body as any).total);
    });
  });

  describe('`GET /admin/inventory/items` — alineación ADITIVA de `finish`/`productType` a §0-Q', () => {
    it.each(['finish', 'productType'])('`?%s=banana` ⇒ 400 y el `details` trae `field` (§0-Q lo exige)', async (field) => {
      const res = await get(`/admin/inventory/items?${field}=banana`);
      expect(res.status).toBe(400);
      expect(res.body.error.details.field).toBe(field);
      expect(Array.isArray(res.body.error.details.allowed)).toBe(true);
    });
  });
});
