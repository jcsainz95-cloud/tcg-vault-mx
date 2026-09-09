/**
 * iva-price-convention.e2e-spec.ts — ⭐⭐ **EL DEPLOY 1 DE D54, CONTRA POSTGRES REAL.**
 * (`ARCHITECTURE §4.44.e/§4.44.j/§4.44.k` + `§11 M-50`; `API_CONTRACT §M10-IVA.5` candados
 * `IVA-3` e `IVA-5`, que son **los dos que el deploy 1 tiene que correr**.)
 *
 * **Por qué esta suite existe y por qué AQUÍ y no en unitarios.** Las tres afirmaciones que sostienen
 * el deploy 1 **no se pueden probar con un mock**:
 *
 *  1. **Que la columna NO tiene `DEFAULT`.** Es una propiedad del DDL, y se verifica **por lo
 *     negativo** sobre `information_schema` / `pg_attrdef`. Un `ADD COLUMN … NOT NULL DEFAULT`
 *     seguido de `DROP DEFAULT` produce el mismo esquema final; lo que **no** puede es sobrevivir a
 *     que el `DROP` se caiga en un rebase — por eso el candado mira el estado, y por eso además la
 *     migración se escribió en el orden que nunca lo crea.
 *  2. ⭐⭐ **Que un camino de escritura que OLVIDE la convención FALLA.** Es una violación de
 *     `NOT NULL` de Postgres. Si el sistema deja pasar una orden sin convención, el deploy 1 no
 *     sirve para nada: la fila de mañana se reinterpretaría sola.
 *  3. **Que el P&L da exactamente lo mismo.** Se mide como **identidad contra la propia base**
 *     (`Σ` de las columnas persistidas leído por SQL vs. lo que responde el endpoint), no contra una
 *     constante copiada.
 *
 * ⛔ **NADA de este fichero prueba el deploy 2.** La fórmula nueva, el dial abierto y los seis
 * candados restantes (`IVA-1`, `IVA-2`, `IVA-4`, `IVA-6`, `IVA-7`, `IVA-8`) **no entran en este
 * pase**: `API_CONTRACT §M10-IVA.6` los asigna al deploy 2.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { computeCartBreakdown, computeDirectShipBreakdown, computeShipmentBreakdown } from '../../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
const SHIPPING = 17500;

const RUN = Date.now().toString(36);
const GUEST_EMAIL = `iva.conv.${RUN}@example.com`;
const ADDRESS = {
  line1: 'Av. Reforma 100',
  line2: 'Depto 3',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};

/** Pieza vendible propia de la corrida (folio único: la BD de integración se comparte). */
async function nuevaPiezaListada(h: E2EHarness, template: { cardId: string; locationId: string | null }, folio: string) {
  return h.prisma.inventoryItem.create({
    data: {
      folio,
      cardId: template.cardId,
      productType: 'raw',
      rawCondition: 'NM',
      finish: 'normal',
      ownerType: 'platform',
      status: 'listed',
      acquisitionType: 'compra',
      acquisitionCostCents: 70000,
      locationId: template.locationId,
    },
  });
}

describe('E2E — M-50 / DEPLOY 1: la convención de precio se congela por fila y NADA se mueve', () => {
  let h: E2EHarness;
  let adminToken: string;
  let customerToken: string;
  let customerId: string;
  let plantilla: { cardId: string; locationId: string | null };
  /**
   * ⚠️ REGLA DE LA CASA (BE-64, y me la salté una vez): la BD de integración se COMPARTE entre
   * suites y `vault-shipments.e2e-spec.ts` asierta el portafolio de **`customer`** como una SUMA
   * EXACTA (`charizard + common`). Las piezas que este candado necesita en la bóveda **la inflaban**
   * (medido: 1 005 000 en vez de 5 000, **3 rojos ajenos**). Dos remedios, los dos aplicados:
   *   1. ⭐ toda esta suite compra y retira como **`customer2`**, cuya bóveda nadie cuenta pieza a
   *      pieza (`buylist-cycle` solo mira su acumulado MENSUAL de VENTAS, que esto no toca, y
   *      además corre antes);
   *   2. y aun así se limpia el residuo en el `afterAll`, porque una suite no debe dejar nada.
   */
  const aLimpiar: { shipmentIds: string[]; orderIds: string[]; inventoryItemIds: string[] } = {
    shipmentIds: [],
    orderIds: [],
    inventoryItemIds: [],
  };

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    adminToken = await h.login(E2E_USERS.admin.email, E2E_USERS.admin.password);
    customerToken = await h.login(E2E_USERS.customer2.email, E2E_USERS.customer2.password);
    const customer = await h.prisma.user.findUnique({ where: { email: E2E_USERS.customer2.email } });
    customerId = customer!.id;
    const t = await h.prisma.inventoryItem.findUnique({ where: { folio: E2E_FOLIOS.listedCharizard } });
    plantilla = { cardId: t!.cardId, locationId: t!.locationId };
  });

  afterAll(async () => {
    // Cascada explícita y en orden: `ShipmentItem` cuelga del envío; el `InventoryItem` no se puede
    // borrar mientras un `ShipmentItem` lo referencie.
    for (const id of aLimpiar.shipmentIds) {
      await h.prisma.shipmentItem.deleteMany({ where: { shipmentRequestId: id } });
      await h.prisma.shipmentRequest.deleteMany({ where: { id } });
    }
    for (const id of aLimpiar.orderIds) {
      await h.prisma.orderItem.deleteMany({ where: { orderId: id } });
      await h.prisma.order.deleteMany({ where: { id } });
    }
    for (const id of aLimpiar.inventoryItemIds) {
      await h.prisma.inventoryItem.deleteMany({ where: { id } });
    }
    await h?.close();
  });

  // =============================================================================================
  // `IVA-3(c)` — EL DDL, VERIFICADO POR LO NEGATIVO
  // =============================================================================================
  describe('⭐⭐ `IVA-3(c)` — la columna es NOT NULL y ⛔ NO tiene DEFAULT', () => {
    it.each(['Order', 'ShipmentRequest'])(
      '%s.priceConvention: is_nullable = NO **y** column_default IS NULL',
      async (tabla) => {
        const [col] = await h.prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string | null; udt_name: string }[]>(
          `SELECT is_nullable, column_default, udt_name
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'priceConvention'`,
          tabla,
        );
        expect(col).toBeDefined();
        expect(col.udt_name).toBe('PriceConvention');
        expect(col.is_nullable).toBe('NO');
        // ⭐ EL ASSERT QUE ES LA DECISIÓN. Rojo si la migración usó `ADD COLUMN … NOT NULL DEFAULT`,
        // **aunque después hiciera `DROP DEFAULT`** y el esquema final coincidiera: aquí se mira el
        // estado, y en la migración se mira el orden. Las dos puntas.
        expect(col.column_default).toBeNull();
      },
    );

    it.each(['Order', 'ShipmentRequest'])(
      '%s: tampoco hay un DEFAULT «escondido» en pg_attrdef para esas dos columnas',
      async (tabla) => {
        // `information_schema.column_default` es una vista; esto mira el catálogo a pelo, que es
        // donde Postgres guarda de verdad la expresión por defecto.
        const filas = await h.prisma.$queryRawUnsafe<{ attname: string }[]>(
          `SELECT a.attname
             FROM pg_attrdef d
             JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
            WHERE d.adrelid = $1::regclass
              AND a.attname IN ('priceConvention', 'ivaTransferPct')`,
          `"${tabla}"`,
        );
        expect(filas).toEqual([]);
      },
    );

    it.each(['Order', 'ShipmentRequest'])(
      '%s.ivaTransferPct: NULLABLE (el hueco honesto), entero y sin default',
      async (tabla) => {
        const [col] = await h.prisma.$queryRawUnsafe<{ is_nullable: string; column_default: string | null; data_type: string }[]>(
          `SELECT is_nullable, column_default, data_type
             FROM information_schema.columns
            WHERE table_name = $1 AND column_name = 'ivaTransferPct'`,
          tabla,
        );
        expect(col.is_nullable).toBe('YES');
        expect(col.column_default).toBeNull();
        // ⛔ ENTERO, y el «entero» es la columna: un 37.5 se truncaría en silencio a 37 (§4.44.g).
        expect(col.data_type).toBe('integer');
      },
    );

    it('el enum tiene EXACTAMENTE los dos valores del contrato, en ese orden', async () => {
      const filas = await h.prisma.$queryRawUnsafe<{ enumlabel: string }[]>(
        `SELECT e.enumlabel
           FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname = 'PriceConvention'
          ORDER BY e.enumsortorder`,
      );
      expect(filas.map((f) => f.enumlabel)).toEqual(['IVA_EXCLUSIVE', 'IVA_INCLUSIVE']);
    });
  });

  // =============================================================================================
  // `IVA-3(d)` — NADIE BACKFILLEÓ UNA MENTIRA
  // =============================================================================================
  describe('⭐⭐ `IVA-3(d)` — el backfill dijo la verdad y NO inventó ningún hecho', () => {
    it('CERO filas con `ivaTransferPct` poblado (el dial no existía cuando se cobraron)', async () => {
      // El candado del contrato lo acota a `createdAt < fecha del deploy 2`; en el deploy 1 esa
      // fecha es el futuro, así que la cota es **todas las filas** — que es más fuerte, no menos.
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "ivaTransferPct" IS NOT NULL`,
      );
      const [s] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "ShipmentRequest" WHERE "ivaTransferPct" IS NOT NULL`,
      );
      expect(Number(o.n)).toBe(0);
      expect(Number(s.n)).toBe(0);
    });

    it('⛔ y CERO filas `IVA_INCLUSIVE`: el deploy 1 no escribe esa convención en ninguna parte', async () => {
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "priceConvention" <> 'IVA_EXCLUSIVE'`,
      );
      const [s] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "ShipmentRequest" WHERE "priceConvention" <> 'IVA_EXCLUSIVE'`,
      );
      expect(Number(o.n)).toBe(0);
      expect(Number(s.n)).toBe(0);
    });
  });

  // =============================================================================================
  // ⭐⭐ `IVA-3(e)` — EL CANDADO QUE MÁS IMPORTA: OLVIDAR LA CONVENCIÓN **REVIENTA**
  // =============================================================================================
  describe('⭐⭐ `IVA-3(e)` — un camino de escritura que OLVIDE la convención FALLA (no hereda nada)', () => {
    /**
     * ⚠️ Se asierta el **SQLSTATE `23502`** (`not_null_violation`), no el texto: Prisma **recorta el
     * `DETAIL`** del error de Postgres y el nombre de la columna no llega al cliente. El código, en
     * cambio, es normativo del motor y no es ambiguo — y ADEMÁS distingue este fallo del `23514`
     * (violación de CHECK), que es justo el error "parecido" con el que un test flojo se pondría
     * verde sin haber probado nada. *Se afirma lo que se puede medir, y se dice por qué.*
     */
    it('INSERT en `Order` omitiendo `priceConvention` ⇒ NOT NULL violation (SQLSTATE 23502)', async () => {
      const err = await h.prisma
        .$executeRawUnsafe(
          `INSERT INTO "Order" (id, "userId", status, "subtotalCents", "processingFeeCents", "ivaCents", "totalCents")
           VALUES ('iva-e2e-${RUN}-noconv', '${customerId}', 'pending', 10000, 869, 1600, 12469)`,
        )
        .then(() => null)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('23502');
      expect((err as Error).message).not.toContain('23514');
    });

    it('INSERT en `ShipmentRequest` omitiendo `priceConvention` ⇒ NOT NULL violation (SQLSTATE 23502)', async () => {
      const err = await h.prisma
        .$executeRawUnsafe(
          `INSERT INTO "ShipmentRequest" (id, "addressSnapshot", status, "shippingFeeCents")
           VALUES ('iva-e2e-${RUN}-noconv-s', '{}'::jsonb, 'solicitado', 17500)`,
        )
        .then(() => null)
        .catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toContain('23502');
      expect((err as Error).message).not.toContain('23514');
    });

    it('⭐ y el `create` de Prisma tampoco lo inventa (el error llega del motor, no de un default)', async () => {
      // `as any` a propósito: en TypeScript esto **no compila** —el tipo generado exige el campo, que
      // es la PRIMERA línea de defensa y ya la probó el compilador al romper un fixture existente—.
      // Aquí se prueba la SEGUNDA, la que sigue viva en runtime: SQL a mano, migraciones de datos,
      // scripts de operación y cualquier cosa que no pase por el compilador.
      await expect(
        h.prisma.order.create({
          data: {
            status: 'pending',
            subtotalCents: 10000,
            processingFeeCents: 869,
            ivaCents: 1600,
            totalCents: 12469,
          } as any,
        }),
      ).rejects.toThrow();
    });

    it('⛔ CONTRA-CANDADO: la fila NO quedó a medias — el INSERT fallido no dejó rastro', async () => {
      const huerfana = await h.prisma.order.findUnique({ where: { id: `iva-e2e-${RUN}-noconv` } });
      expect(huerfana).toBeNull();
    });

    it('⭐ y CON la convención el mismo INSERT pasa (se probó que falla por ESO y no por otra cosa)', async () => {
      // Sin este control, el test de arriba pasaría también si el INSERT reventara por una FK, por un
      // NOT NULL de otra columna o por un typo del SQL — y estaría verde sin haber probado nada.
      const id = `iva-e2e-${RUN}-conv-ok`;
      await h.prisma.$executeRawUnsafe(
        `INSERT INTO "Order" (id, "userId", status, "subtotalCents", "processingFeeCents", "ivaCents", "totalCents", "priceConvention")
         VALUES ('${id}', '${customerId}', 'pending', 10000, 869, 1600, 12469, 'IVA_EXCLUSIVE')`,
      );
      const fila = await h.prisma.order.findUnique({ where: { id } });
      expect(fila!.priceConvention).toBe('IVA_EXCLUSIVE');
      expect(fila!.ivaTransferPct).toBeNull();
      await h.prisma.order.delete({ where: { id } });
    });
  });

  // =============================================================================================
  // TODA ESCRITURA NUEVA NACE `IVA_EXCLUSIVE` — por los caminos REALES, no por mocks
  // =============================================================================================
  describe('toda fila NUEVA se escribe `IVA_EXCLUSIVE` (§4.44.k, deploy 1)', () => {
    it('checkout de BÓVEDA (`POST /checkout/session`) ⇒ orden `IVA_EXCLUSIVE`, dial NULL', async () => {
      const pieza = await nuevaPiezaListada(h, plantilla, `E2E-IVA-${RUN}-V1`);
      const res = await h.api('POST', '/checkout/session', {
        token: customerToken,
        json: { inventoryItemIds: [pieza.id] },
        headers: { 'idempotency-key': `iva-v-${RUN}` },
      });
      expect(res.status).toBe(201);
      aLimpiar.orderIds.push(res.body.orderId);
      aLimpiar.inventoryItemIds.push(pieza.id);
      const order = await h.prisma.order.findUnique({ where: { id: res.body.orderId } });
      expect(order!.priceConvention).toBe('IVA_EXCLUSIVE');
      expect(order!.ivaTransferPct).toBeNull();

      // ⭐ Y EL DINERO NO SE MOVIÓ: el desglose persistido es EXACTAMENTE el de la aritmética de hoy.
      const esperado = computeCartBreakdown(order!.subtotalCents, IVA, FEE);
      expect({
        ivaCents: order!.ivaCents,
        processingFeeCents: order!.processingFeeCents,
        totalCents: order!.totalCents,
        ivaRatePct: order!.ivaRatePct,
      }).toEqual({
        ivaCents: esperado.ivaCents,
        processingFeeCents: esperado.processingFeeCents,
        totalCents: esperado.totalCents,
        ivaRatePct: IVA,
      });
      // La identidad de la convención VIEJA sigue siendo cierta, y debe serlo (§5.1).
      expect(order!.totalCents).toBe(order!.subtotalCents + order!.ivaCents + order!.processingFeeCents);
    });

    it('checkout de INVITADO (`direct_ship`) ⇒ orden `IVA_EXCLUSIVE`, y el envío sigue sumándose aparte', async () => {
      const pieza = await nuevaPiezaListada(h, plantilla, `E2E-IVA-${RUN}-G1`);
      const res = await h.api('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [pieza.id], email: GUEST_EMAIL, shippingAddress: ADDRESS, acceptedTerms: true },
      });
      expect(res.status).toBe(201);
      const order = await h.prisma.order.findUnique({ where: { id: res.body.orderId } });
      expect(order!.priceConvention).toBe('IVA_EXCLUSIVE');
      expect(order!.ivaTransferPct).toBeNull();
      expect(order!.fulfillmentMode).toBe('direct_ship');
      expect(order!.shippingFeeCents).toBe(SHIPPING);

      // ⭐ money-neutral: idéntico a `computeDirectShipBreakdown` con la tarifa NETA de hoy.
      const esperado = computeDirectShipBreakdown(order!.subtotalCents, SHIPPING, IVA, FEE);
      expect(order!.ivaCents).toBe(esperado.ivaCents);
      expect(order!.processingFeeCents).toBe(esperado.processingFeeCents);
      expect(order!.totalCents).toBe(esperado.totalCents);

      // Y al liquidar, el `ShipmentRequest` de fulfillment (payments.service) también nace etiquetado.
      const settle = await h.sendStripeWebhook({
        type: 'payment_intent.succeeded',
        data: {
          object: {
            id: order!.stripePaymentIntentId,
            object: 'payment_intent',
            amount: order!.totalCents,
            amount_received: order!.totalCents,
            currency: 'mxn',
          },
        },
      });
      expect(settle.status).toBe(200);
      const envio = await h.prisma.shipmentRequest.findFirst({ where: { orderId: order!.id } });
      expect(envio!.priceConvention).toBe('IVA_EXCLUSIVE');
      expect(envio!.ivaTransferPct).toBeNull();
      // Invariante §4.21b intacta: la tarifa vive en la ORDEN, no en este envío (evita doble conteo).
      expect(envio!.shippingFeeCents).toBe(0);
    });

    it('retiro de BÓVEDA (`POST /shipments`) ⇒ `ShipmentRequest` `IVA_EXCLUSIVE`, con la aritmética de hoy', async () => {
      const pieza = await h.prisma.inventoryItem.create({
        data: {
          folio: `E2E-IVA-${RUN}-C1`,
          cardId: plantilla.cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          ownerType: 'customer',
          ownerUserId: customerId,
          ownershipStatus: 'settled',
          status: 'in_custody',
          acquisitionType: 'compra',
          locationId: plantilla.locationId,
        },
      });
      const addr = await h.prisma.address.findFirst({ where: { userId: customerId } });
      const res = await h.api('POST', '/shipments', {
        token: customerToken,
        json: { inventoryItemIds: [pieza.id], addressId: addr!.id },
        headers: { 'idempotency-key': `iva-s-${RUN}` },
      });
      expect(res.status).toBe(201);
      aLimpiar.shipmentIds.push(res.body.shipmentId);
      aLimpiar.inventoryItemIds.push(pieza.id);
      const envio = await h.prisma.shipmentRequest.findUnique({ where: { id: res.body.shipmentId } });
      expect(envio!.priceConvention).toBe('IVA_EXCLUSIVE');
      expect(envio!.ivaTransferPct).toBeNull();

      // ⭐ Y el envío sigue costando lo mismo: tarifa NETA + IVA aparte (la convención de hoy).
      const esperado = computeShipmentBreakdown(SHIPPING, IVA, FEE);
      expect(envio!.shippingFeeCents).toBe(SHIPPING);
      expect(envio!.ivaCents).toBe(esperado.ivaCents);
      expect(envio!.totalCents).toBe(esperado.totalCents);
    });
  });

  // =============================================================================================
  // ⭐ EL CENSO FINAL — se repite DESPUÉS de haber escrito, y ésa es la mitad que importa
  // =============================================================================================
  describe('⭐ tras escribir por los tres caminos: la base SIGUE sin una sola fila `IVA_INCLUSIVE`', () => {
    /**
     * ⚠️ **Este bloque existe por una medición, no por simetría.** La mutación **M7b** —un camino que
     * escribe la convención EQUIVOCADA (`IVA_INCLUSIVE`), que **compila sin problema** porque el tipo
     * la admite— dejó el censo de `IVA-3(d)` **en verde**: ese censo corre en un `describe` ANTERIOR,
     * o sea **antes de que este fichero escriba nada**. Un candado que solo mira el pasado no puede
     * ver lo que el pase acaba de introducir. ⇒ **se repite al final**, cuando ya hay filas nuevas.
     * *(Con M7b: 3 rojos antes de añadir esto, 4 después — y el cuarto es el que nombra el defecto.)*
     */
    it('CERO `Order` y CERO `ShipmentRequest` con `IVA_INCLUSIVE` (el deploy 1 no la escribe jamás)', async () => {
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      const [s] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "ShipmentRequest" WHERE "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      expect(Number(o.n)).toBe(0);
      expect(Number(s.n)).toBe(0);
    });

    it('⭐ y CERO filas con el dial poblado, también entre las recién creadas', async () => {
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "ivaTransferPct" IS NOT NULL`,
      );
      expect(Number(o.n)).toBe(0);
    });

    it('⛔ CONTROL: el censo NO está vacío — esta suite SÍ creó filas nuevas', async () => {
      // Sin esto, los dos de arriba pasarían igual sobre una base sin una sola orden, y estarían
      // verdes sin haber mirado nada. El control mide que hay algo que mirar.
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "priceConvention" = 'IVA_EXCLUSIVE'`,
      );
      expect(Number(o.n)).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  // ⭐⭐ `IVA-5` (mitad del deploy 1) — EL P&L, NEUTRO CONTRA DATOS REALES
  // =============================================================================================
  describe('⭐⭐ `IVA-5` — el P&L da EXACTAMENTE lo que dicen las columnas persistidas', () => {
    it('`incomeCents` == Σ `Order.subtotalCents` de las liquidadas (neteo = identidad bajo IVA_EXCLUSIVE)', async () => {
      const res = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      expect(res.status).toBe(200);
      const [suma] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("subtotalCents"), 0) AS n FROM "Order" WHERE status = 'settled'`,
      );
      // ⭐ Identidad, no constante: mide contra la base, así que sigue midiendo aunque otra suite
      // añada órdenes. Es literalmente «el ingreso del P&L es el de siempre».
      expect(res.body.incomeCents).toBe(Number(suma.n));
    });

    it('⭐ `D-IVA-5`: `shippingRevenueCents` == Σ envíos liquidados **+** Σ `direct_ship` (el sumando que faltaba)', async () => {
      const res = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      const [envios] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("shippingFeeCents"), 0) AS n FROM "ShipmentRequest"
          WHERE status IN ('picking','guia','enviado','entregado')`,
      );
      const [directos] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("shippingFeeCents"), 0) AS n FROM "Order"
          WHERE status = 'settled' AND "fulfillmentMode" = 'direct_ship'`,
      );
      expect(res.body.shippingRevenueCents).toBe(Number(envios.n) + Number(directos.n));
      // ⭐ La medida de que el defecto ERA real: hay pedidos `direct_ship` liquidados con tarifa > 0
      // (los crea esta misma suite), y antes del pase ese dinero no lo contaba nadie.
      expect(Number(directos.n)).toBeGreaterThan(0);
    });

    it('⛔ el ingreso de envío NO se coló en `incomeCents` (son dos líneas distintas del reporte)', async () => {
      const res = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      const [suma] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("subtotalCents"), 0) AS n FROM "Order" WHERE status = 'settled'`,
      );
      expect(res.body.incomeCents).toBe(Number(suma.n));
      expect(res.body.incomeCents).not.toBe(Number(suma.n) + res.body.shippingRevenueCents);
    });

    it('⭐ el CSV del P&L reserializa las MISMAS cifras (no es un quinto sitio, §4.44.j)', async () => {
      const json = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      const csv = await h.api('GET', '/admin/finance/export.csv?report=pnl', { token: adminToken });
      expect(csv.status).toBe(200);
      const [, fila] = csv.text.trim().split('\n');
      expect(fila).toBe(
        `pnl,${json.body.incomeCents},${json.body.shippingRevenueCents},${json.body.cogsCents},` +
          `${json.body.stripeFeesCents},${json.body.shippingCostCents},${json.body.profitCents}`,
      );
    });

    it('⭐⭐ el reporte del IVA (`/admin/finance/iva`) ⛔ NO SE TOCÓ: sigue siendo Σ `ivaCents`', async () => {
      // §4.44.j, sitio 4: «⛔ NO SE TOCA. Ya es correcto». Se asierta para que nadie lo "arregle".
      const res = await h.api('GET', '/admin/finance/iva', { token: adminToken });
      expect(res.status).toBe(200);
      const [suma] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("ivaCents"), 0) AS n FROM "Order" WHERE status = 'settled'`,
      );
      expect(res.body.ivaCollectedCents).toBe(Number(suma.n));
    });

    it('el P&L es estable: dos llamadas seguidas dan lo mismo (no hay dial ni reloj en el camino)', async () => {
      const a = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      const b = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      expect(b.body).toEqual(a.body);
    });
  });

  // =============================================================================================
  // EL DIAL EXISTE EN LA BASE, PERO EL CONTRATO OBSERVABLE NO CAMBIA (§4.44.k, deploy 1)
  // =============================================================================================
  describe('la fila del dial está sembrada en 100 y ⛔ el contrato observable NO cambia', () => {
    it('`iva_transfer_pct` existe en `ConfigSetting` y vale 100 (el NEUTRO)', async () => {
      const fila = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
      expect(fila).not.toBeNull();
      expect(fila!.valueJson).toBe(100);
    });

    it('⛔ pero NO viaja en `GET /admin/settings`: el deploy 1 no cambia ni un DTO', async () => {
      const res = await h.api('GET', '/admin/settings', { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('ivaTransferPct');
      // Control: el GET sí responde los diales de siempre (no está vacío ni roto).
      expect(res.body).toHaveProperty('ivaPct', 16);
      expect(res.body).toHaveProperty('shippingFeeCents', SHIPPING);
    });

    it('⛔ y `PUT /admin/settings { ivaTransferPct }` ⇒ 422 clave desconocida, SIN escribir', async () => {
      // Precedente exacto de `stripeFeeIvaPct` (v1.40) y `fxRateMode`: no hace falta código de
      // rechazo, hace falta NO estar en `SETTING_DTO_MAP`. Su única puerta será
      // `PUT /admin/settings/iva-transfer` **con acuse**, y esa puerta abre en el DEPLOY 2.
      const res = await h.api('PUT', '/admin/settings', { token: adminToken, json: { ivaTransferPct: 50 } });
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      const fila = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
      expect(fila!.valueJson).toBe(100);
    });

    it('⛔ y `ivaPct` NO deriva del dial nuevo ni al revés: son dos filas independientes', async () => {
      // Media pieza del futuro `IVA-7`, la que ya se puede afirmar en el deploy 1: mover la TASA no
      // toca la fila del dial de traslación. (El resto de `IVA-7` es del deploy 2.)
      const antes = await h.prisma.configSetting.findUnique({ where: { key: 'iva_pct' } });
      const res = await h.api('PUT', '/admin/settings', { token: adminToken, json: { ivaPct: 16 } });
      expect(res.status).toBe(200);
      const dial = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
      expect(dial!.valueJson).toBe(100);
      expect(antes!.valueJson).toBe(16);
    });
  });
});
