/**
 * pending-publish-seed.e2e-spec.ts — **EL ARNÉS SE PRUEBA A SÍ MISMO (2/2).** Propiedad: backend;
 * la ejecuta QA.
 *
 * ### Por qué existe
 * La suite E2E completa corrió por primera vez contra el stack real y `admin.spec.ts:329` cayó con
 * *«la cola de publicar está vacía: el seed debe dejar al menos una pieza»* — y **fallaba igual en
 * `main`**: no era regresión, era un **hueco de datos de prueba**. `GET /admin/inventory/
 * pending-publish` filtra `status='in_stock'` y el seed sintético **no creaba ni una** pieza en ese
 * estado (sus nueve `E2E-LST-*` nacen `listed`). La cola salía vacía **por falta de dato**, así que
 * la pantalla que existe para que *«una carta comprada y pagada no se quede quieta sin que nada lo
 * señale»* se verificaba **sin nada que señalar**: los tres invariantes que el caso de UI protege
 * recorrían **cero filas** y pasaban por vacuidad.
 *
 * Este spec es el guardián del arreglo, del lado del backend y **por HTTP**: la pieza sembrada no es
 * un dato suelto que nadie comprueba —*la próxima ficha falsa*— sino una promesa con test. Si
 * mañana alguien la publica, la ubica o la borra del seed, **esto se pone rojo aquí**, en la suite
 * barata, y no en un gate de Playwright de 38 casos.
 *
 * ### Qué afirma, y por qué EXACTAMENTE esas tres cosas
 * Son los tres invariantes del docblock de `frontend/e2e/admin.spec.ts:300-313`, comprobados en el
 * EMISOR (lo que la UI pinta no puede ser mejor que lo que el backend manda):
 *   1. **la cola no está vacía** y **cada fila dice qué le falta** (`missing` no vacío) — una fila
 *      muda se pintaría como «ya está lista» y **saldría de la única pantalla donde alguien la
 *      encontraría**;
 *   2. **ningún precio resuelto es CERO** — cero es un precio (§7.3): `MX$0.00` en esa columna
 *      significaría «vale nada», no «no sé»; el «no sé» viaja como `null`;
 *   3. y la pieza del fixture está ahí **por lo que se sembró** (`in_stock`, sin ubicación, con
 *      precio de venta resoluble), que es el perfil REAL de la cola: la conversión desde M5 no
 *      exige ubicación (§4.39m.3) y el precio sí resuelve.
 *
 * ⚠️ **No afirma `total === 1`.** La BD local de trabajo acumula piezas `in_stock` de corridas
 * previas y en CI la BD es efímera; fijar el tamaño de la cola haría fallar al entorno, no al
 * código. Lo que se fija es lo que el producto promete: **≥ 1 y todas las filas bien formadas**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

interface PendingPublishRow {
  inventoryItemId: string;
  folio: string;
  locationId: string | null;
  resolvedSalePriceCents: number | null;
  priceBasis: string | null;
  missing: string[];
  acquisitionType: string;
  productType: string;
}

describe('E2E — la COLA «listas para publicar» tiene TRABAJO con el seed sintético (§4.39m.1)', () => {
  let h: E2EHarness;
  let adminToken: string;
  let queue: PendingPublishRow[];
  let total: number;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    ({ rows: queue, total } = await fetchWholeQueue());
  });

  afterAll(async () => {
    await h?.close();
  });

  /**
   * La cola ENTERA, no la primera página. La BD de trabajo local puede tener cientos de piezas
   * `in_stock` de corridas anteriores, y la pieza del fixture se ordena por `createdAt asc`: mirar
   * solo la página 1 haría que este spec pasara o fallara **según la antigüedad de la BD**, que es
   * exactamente el tipo de test que enseña a ignorar los rojos.
   */
  async function fetchWholeQueue(): Promise<{ rows: PendingPublishRow[]; total: number }> {
    const pageSize = 100;
    const rows: PendingPublishRow[] = [];
    let page = 1;
    let reported = 0;
    for (;;) {
      const path = `/admin/inventory/pending-publish?page=${page}&pageSize=${pageSize}`;
      const res = await h.api('GET', path, { token: adminToken });
      expect(res.status).toBe(200);
      const body = res.body as { data: PendingPublishRow[]; total: number };
      reported = body.total;
      rows.push(...body.data);
      if (body.data.length < pageSize || rows.length >= reported) break;
      page += 1;
    }
    return { rows, total: reported };
  }

  const rowsFor = (folio: string) => queue.filter((r) => r.folio === folio);

  it('la cola NO sale vacía: el seed deja al menos una pieza (el fallo de admin.spec.ts:329)', () => {
    expect(total).toBeGreaterThan(0);
    expect(rowsFor(E2E_FOLIOS.pendingPublishNoLocation)).toHaveLength(1);
  });

  it('`total` cuenta el MISMO conjunto que `data` pagina (norma D del contrato v1.51.18)', () => {
    expect(queue).toHaveLength(total);
  });

  /**
   * Las violaciones se acumulan POR FOLIO y se comparan contra `[]`. Un `for` con `expect` dentro
   * corta en la primera y sólo dice «esperaba > 0»: aquí el rojo nombra **qué piezas** están mal,
   * que es lo que alguien necesita para ir a arreglarlas.
   */
  const offenders = (predicate: (r: PendingPublishRow) => string | null) =>
    queue.map((r) => predicate(r)).filter((m): m is string => m !== null);

  it('(1) ninguna fila MUDA: toda pieza de la cola dice QUÉ le falta', () => {
    expect(
      offenders((r) => {
        if (r.missing.length === 0) return `${r.folio}: no dice qué le falta`;
        const unknown = r.missing.filter((w) => w !== 'location' && w !== 'price');
        return unknown.length ? `${r.folio}: missing desconocido ${unknown.join()}` : null;
      }),
    ).toEqual([]);
  });

  it('(2) ningún precio resuelto es CERO: el «no resoluble» viaja como null, no como 0 (§7.3)', () => {
    expect(
      offenders((r) => {
        if (r.resolvedSalePriceCents === null) {
          // «No sé» explícito ⇒ la pieza tiene que decirlo, y el basis es el veredicto `pending`.
          if (!r.missing.includes('price')) return `${r.folio}: sin precio y sin decirlo`;
          return r.priceBasis === 'pending' ? null : `${r.folio}: basis ${r.priceBasis} sin precio`;
        }
        if (r.resolvedSalePriceCents <= 0) return `${r.folio}: resolvió MX$0.00`;
        return r.missing.includes('price') ? `${r.folio}: tiene precio y dice que le falta` : null;
      }),
    ).toEqual([]);
  });

  it('(3) la pieza del fixture: `in_stock`, SIN ubicación y con precio de venta RESOLUBLE', async () => {
    const [row] = rowsFor(E2E_FOLIOS.pendingPublishNoLocation);
    expect(row).toBeDefined();
    // Lo que le falta, y SOLO eso: es el caso real (la conversión desde M5 no exige ubicación).
    expect(row.missing).toEqual(['location']);
    expect(row.locationId).toBeNull();
    // El precio SÍ resuelve y es un importe de verdad ⇒ la columna de dinero de la UI pinta
    // `MX$xx.xx`, no la etiqueta de «pendiente» ni un cero.
    expect(row.resolvedSalePriceCents).toBeGreaterThan(0);
    expect(row.priceBasis).toBe('market');
    expect(row.acquisitionType).toBe('buylist');

    // Y en la BD sigue siendo lo que el seed prometió: la cola no la publicó por mirarla.
    const item = await h.prisma.inventoryItem.findUnique({
      where: { folio: E2E_FOLIOS.pendingPublishNoLocation },
    });
    expect(item?.status).toBe('in_stock');
    expect(item?.ownerType).toBe('platform');
    expect(item?.locationId).toBeNull();
  });

  it('el filtro `?missing=location` la incluye (es el deep-link del back-office)', async () => {
    const path = '/admin/inventory/pending-publish?missing=location&pageSize=100';
    const res = await h.api('GET', path, { token: adminToken });
    expect(res.status).toBe(200);
    const body = res.body as { data: PendingPublishRow[]; total: number };
    expect(body.total).toBeGreaterThan(0);
    for (const row of body.data) expect(row.missing).toContain('location');
  });
});

/**
 * ⭐⭐ **EL DEFECTO DE M11, POR HTTP: `?productType=sealed` NO puede devolver una carta SUELTA.**
 * (backend, este pase; el dueño lo halló en la tienda.)
 *
 * ### El defecto, dicho con el dato
 * `GET /admin/inventory/pending-publish` **no tenía** el parámetro `?productType=`. El frontend de M11
 * monta la cola de «Listas para publicar» con `productType='sealed'` creyendo que el endpoint ya lo
 * filtra — pero NestJS **ignora el query desconocido**, así que la cola devolvía **TODO** y una carta
 * SUELTA (`raw`, p. ej. «Salamence ex» holofoil de aportación) aparecía en la cola «filtrada a
 * sellado». Este spec siembra **una suelta y una sellada**, ambas en la cola (plataforma, `in_stock`,
 * SIN ubicación ⇒ `missing:['location']`), y exige que el filtro **discrimine de verdad**.
 *
 * ⛔ **Money-safe:** es una LECTURA. Siembra filas PROPIAS y efímeras (prefijo `PPPT-`), no toca
 * dinero ni precios de nadie, y las limpia al terminar.
 *
 * ### Por qué falla contra el código SIN el arreglo
 * Sin el `@Query('productType')` + el predicado en el `where`, `?productType=sealed` devuelve AMBAS
 * piezas ⇒ `folios.not.toContain(RAW)` y `every(r => r.productType==='sealed')` se ponen ROJOS. Es la
 * prueba que muerde exactamente el defecto reportado.
 */
describe('E2E — `?productType=` FILTRA la cola por tipo (defecto M11: una SUELTA en la cola de SELLADO)', () => {
  let h2: E2EHarness;
  let admin2: string;
  const RAW_FOLIO = 'PPPT-RAW-0001'; // una carta SUELTA (raw), platform + in_stock + sin ubicación
  const SEALED_FOLIO = 'PPPT-SEALED-0001'; // una pieza SELLADA, mismo perfil de cola

  beforeAll(async () => {
    h2 = await E2EHarness.create();
    admin2 = await h2.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    const card = await h2.prisma.card.findFirstOrThrow({ select: { id: true } });
    await h2.prisma.inventoryItem.deleteMany({ where: { folio: { in: [RAW_FOLIO, SEALED_FOLIO] } } });
    await h2.prisma.inventoryItem.create({
      data: {
        folio: RAW_FOLIO, cardId: card.id, productType: 'raw', rawCondition: 'NM',
        ownerType: 'platform', status: 'in_stock', acquisitionType: 'aportacion_en_especie',
        // SIN locationId ⇒ missing:['location'] ⇒ entra a la cola.
      },
    });
    await h2.prisma.inventoryItem.create({
      data: {
        folio: SEALED_FOLIO, cardId: card.id, productType: 'sealed', sealedSubtype: 'box',
        sealedCondition: 'mint', sealedProductName: 'PPPT Caja de prueba',
        ownerType: 'platform', status: 'in_stock', acquisitionType: 'compra',
      },
    });
  }, 180000);

  afterAll(async () => {
    if (h2) {
      await h2.prisma.inventoryItem.deleteMany({ where: { folio: { in: [RAW_FOLIO, SEALED_FOLIO] } } });
      await h2.close();
    }
  });

  /** La cola ENTERA con el filtro dado (paginada), como en el bloque de arriba: no dependemos de página. */
  async function queueFor(productType?: string): Promise<PendingPublishRow[]> {
    const filter = productType ? `productType=${productType}&` : '';
    const pageSize = 100;
    const rows: PendingPublishRow[] = [];
    let page = 1;
    for (;;) {
      const res = await h2.api('GET', `/admin/inventory/pending-publish?${filter}page=${page}&pageSize=${pageSize}`, { token: admin2 });
      expect(res.status).toBe(200);
      const body = res.body as { data: PendingPublishRow[]; total: number };
      rows.push(...body.data);
      if (body.data.length < pageSize || rows.length >= body.total) break;
      page += 1;
    }
    return rows;
  }

  it('`?productType=sealed` incluye la SELLADA y ⛔ NO la SUELTA (el defecto exacto de M11)', async () => {
    const rows = await queueFor('sealed');
    const folios = rows.map((r) => r.folio);
    expect(folios).toContain(SEALED_FOLIO); // una SELLADA SÍ
    expect(folios).not.toContain(RAW_FOLIO); // una SUELTA NO
    // La aserción que muerde el defecto entero: cada fila devuelta es realmente sellado.
    for (const r of rows) expect(r.productType).toBe('sealed');
  });

  it('`?productType=raw` incluye la SUELTA y ⛔ NO la SELLADA', async () => {
    const rows = await queueFor('raw');
    const folios = rows.map((r) => r.folio);
    expect(folios).toContain(RAW_FOLIO);
    expect(folios).not.toContain(SEALED_FOLIO);
    for (const r of rows) expect(r.productType).toBe('raw');
  });

  it('sin filtro, la cola trae AMBAS (el eje es ADITIVO: ausente ⇒ cola entera, como hoy)', async () => {
    const folios = (await queueFor()).map((r) => r.folio);
    expect(folios).toContain(SEALED_FOLIO);
    expect(folios).toContain(RAW_FOLIO);
  });

  it('basura ⇒ `400` con `details.{field,allowed}` (mismo patrón que el resto de ejes de enum)', async () => {
    const res = await h2.api('GET', '/admin/inventory/pending-publish?productType=no_soy_un_tipo', { token: admin2 });
    expect(res.status).toBe(400);
    const body = res.body as { error: { code: string; details: { field: string; allowed: string[] } } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.details.field).toBe('productType');
    expect(body.error.details.allowed).toEqual(expect.arrayContaining(['raw', 'sealed', 'graded']));
  });
});
