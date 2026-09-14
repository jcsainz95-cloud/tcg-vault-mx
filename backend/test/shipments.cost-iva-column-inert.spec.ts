import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { TrackingDto } from '../src/modules/shipments/dto/shipments.dto';

/**
 * ⭐⭐ **`shippingCostIvaCents` — LA COLUMNA YA SE LEE: el bloque «nadie la lee» CADUCÓ, como estaba
 * escrito que caducaría.** (`ARCHITECTURE §4.44.f-ter`; `API_CONTRACT §M10-IVA.8`, `IVA-11`.)
 *
 * ### Qué pasó aquí, y por qué es una historia de proceso y no solo de código
 * La versión anterior de este fichero medía una promesa del **deploy 1**: *«la columna se escribe
 * desde el día uno y NADIE la lee hasta D-2»*. Y decía, con todas sus letras, que **caducaba a
 * propósito y con nombre**: *«el primer bloque se pone rojo en cuanto el P&L la lea … ese rojo es la
 * señal, no el fallo: quien implemente D-2 borra ESE bloque (y solo ése) y escribe en su lugar los
 * candados `IVA-11(a)(b)(c)`»*.
 *
 * **Eso es exactamente lo que ocurrió, y este commit es el que lo ejecuta.** El bloque (1) se borró
 * entero; sus candados de reemplazo viven en **`iva-11-shipping-cost.spec.ts`**. *Un candado que
 * documenta su propia fecha de caducidad y el nombre de su sustituto no se «arregla» borrándolo sin
 * mirar: se jubila.*
 *
 * ### Lo que ⛔ NO caduca, y por eso el fichero sigue existiendo
 * El **contra-candado**: la columna es un dato de **costo interno** y ⛔ **no se publica al
 * cliente**, ni ella ni su hermana `shippingCostCents` (§M4). *El riesgo de una columna nueva en una
 * tabla de dinero no es que alguien la use — es que **se publique sola**.* Antes de `S49-R4`,
 * `setTracking` devolvía la entidad Prisma cruda; con ese código esta columna habría aparecido en la
 * respuesta sin que nadie escribiera una línea.
 *
 * ⚠️ **Lo que SÍ cambió en el contra-candado, dicho para que no se lea como un aflojamiento:** el
 * **back-office** pasa a ver `shippingCostIvaCents` (es quien lo **captura**, §M10-IVA.8, y sin verlo
 * no puede comprobar la resta que el P&L hace con su dato). El **cliente sigue sin ver ninguno de los
 * dos**, que es la mitad que protege información y la que no se mueve.
 */

// =================================================================================================
// (2) ⛔ NO SE PUBLICA SOLA — esto NO caduca
// =================================================================================================
describe('⛔ CONTRA-CANDADO — el costo de envío no se cuela en NINGUNA respuesta de CLIENTE (S49-R4)', () => {
  /** Fila cruda de Prisma **ya con la columna de v1.64(4)** y con un valor bien visible. */
  const rawRow = {
    id: 'ship1',
    userId: 'user1',
    orderId: null,
    addressSnapshot: { city: 'CDMX' },
    status: 'guia',
    shippingFeeCents: 20300,
    shippingCostCents: 20300, // BRUTO: la factura del carrier, IVA incluido (§4.44.f-ter)
    shippingCostIvaCents: 2800, // el IVA acreditable congelado — interno, y en D-1 ni se lee
    ivaCents: 2800,
    processingFeeCents: 1200,
    totalCents: 21500,
    priceConvention: 'IVA_EXCLUSIVE',
    ivaTransferPct: null,
    stripePaymentIntentId: 'pi_123',
    carrier: 'DHL',
    trackingNumber: 'TRACK123',
    requestedAt: new Date('2026-09-10T00:00:00Z'),
    pickingAt: null,
    shippedAt: null,
    deliveredAt: null,
    items: [],
  };

  function buildService() {
    const prisma: any = {
      shipmentRequest: {
        findUnique: jest.fn().mockResolvedValue({ ...rawRow }),
        findMany: jest.fn().mockResolvedValue([{ ...rawRow }]),
        update: jest.fn().mockResolvedValue({ ...rawRow }),
      },
    };
    return {
      svc: new ShipmentsService(prisma as PrismaService, {} as SettingsService, {} as StripeService),
      prisma,
    };
  }

  it('⭐ back-office (`setTracking` → `toAdminShipmentRow`): ve el BRUTO **y** su IVA acreditable', async () => {
    const { svc } = buildService();
    const res: any = await svc.setTracking('ship1', 'DHL', 'TRACK123', 20300, 2800);
    // El rol de M4 SÍ debe ver el costo (§M4) — eso no cambia.
    expect(res.shippingCostCents).toBe(20300);
    // ⭐ D56: y también el crédito, porque es QUIEN LO CAPTURA. Publicar solo el bruto dejaba al
    // operador sin poder comprobar la resta que el P&L hace con su propia captura.
    expect(res.shippingCostIvaCents).toBe(2800);
    // ⚠️ Siguen siendo una LISTA BLANCA: si esto se convierte en `...row`, el contra-candado del
    // cliente (abajo) es el que muerde.
  });

  it('⛔ cliente (`getMine`): no ve el costo, ni bruto ni su IVA', async () => {
    const { svc } = buildService();
    const res: any = await svc.getMine('user1', 'ship1');
    expect(res).not.toHaveProperty('shippingCostCents');
    expect(res).not.toHaveProperty('shippingCostIvaCents');
    expect(res.shippingFeeCents).toBe(20300); // lo que el cliente SÍ ve sigue igual
  });

  it('⛔ cliente (`listMine`): tampoco en ninguna fila de la lista', async () => {
    const { svc } = buildService();
    const res: any = await svc.listMine('user1');
    expect(res.data).toHaveLength(1);
    for (const row of res.data) expect(row).not.toHaveProperty('shippingCostIvaCents');
  });

  it('⭐⭐ `IVA-11(c)`: el crédito se CAPTURA — `setTracking` lo escribe cuando se lo dan…', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 20300, 2800);
    expect(prisma.shipmentRequest.update.mock.calls[0][0].data).toMatchObject({
      shippingCostCents: 20300,
      shippingCostIvaCents: 2800,
    });
  });

  it('⛔ …y ⛔ NO lo DERIVA: omitirlo deja la columna como estaba (no se inventa `costo×16/116`)', async () => {
    // *Un crédito fiscal derivado de una división ciega es un crédito que nadie verificó.* Omitir el
    // campo ⇒ la columna no se toca ⇒ `0` en las filas históricas ⇒ `neto = bruto`, que es la
    // dirección CONSERVADORA (subestima la ganancia, no la infla).
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 20300);
    const data = prisma.shipmentRequest.update.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('shippingCostIvaCents');
    expect(data.shippingCostCents).toBe(20300);
  });
});

// =================================================================================================
// (3) EL ESQUEMA — la forma de la columna, y ⛔ dónde NO está
// =================================================================================================
describe('el esquema Prisma declara la columna donde toca y ⛔ solo ahí', () => {
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  /**
   * El bloque del modelo **sin las líneas de comentario**. Se limpian a propósito: los comentarios
   * de este esquema EXPLICAN las columnas que no existen (`ShipmentRequest` no tiene `ivaRatePct`, y
   * el comentario de la columna nueva lo dice con esas palabras), así que un assert sobre el texto
   * crudo mediría la documentación en vez del esquema. *Lo aprendí con el rojo de esta misma línea.*
   */
  const modelo = (nombre: string) =>
    (schema.match(new RegExp(`model ${nombre} \\{[\\s\\S]*?\\n\\}`))?.[0] ?? '')
      .split('\n')
      .filter((l) => !l.trimStart().startsWith('//'))
      .join('\n');

  it('`ShipmentRequest.shippingCostIvaCents Int @default(0)` — entera, NOT NULL, con default', () => {
    expect(modelo('ShipmentRequest')).toMatch(/shippingCostIvaCents\s+Int\s+@default\(0\)/);
    // ⛔ NO nullable (`Int?`): en las filas existentes «costó cero» y «no se capturó» son
    // indistinguibles, y un `NULL` exigiría un backfill que INVENTA esa distinción (§4.44.f-ter).
    expect(modelo('ShipmentRequest')).not.toMatch(/shippingCostIvaCents\s+Int\?/);
  });

  it('⛔ `Order` NO la gana: el alcance de v1.64(4) es UNA columna en UNA tabla', () => {
    expect(modelo('Order')).not.toMatch(/shippingCostIvaCents/);
  });

  it('⛔ y `ShipmentRequest` sigue SIN `ivaRatePct` — el hecho que obligó a la columna', () => {
    // Si algún día apareciera, alguien podría "ahorrarse" la columna neteando con la tasa… y
    // volvería el defecto que `IVA-5` prohíbe. Aparecer no es ilegal, pero tiene que ser una
    // decisión mirada: por eso está asertado.
    expect(modelo('ShipmentRequest')).not.toMatch(/\bivaRatePct\b/);
    expect(modelo('Order')).toMatch(/\bivaRatePct\b/); // control: en `Order` sí está
  });
});
