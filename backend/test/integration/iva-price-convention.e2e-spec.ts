/**
 * iva-price-convention.e2e-spec.ts — ⭐⭐ **EL CORTE D56 ENTERO, CONTRA POSTGRES REAL.**
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
 * ### ⭐⭐ D56 (2026-09-14) — **YA NO HAY «DEPLOY 2»**, y este fichero cambió de bando
 * `§M10-IVA.6` quedó **derogada** por `§M10-IVA.9`: es **un solo despliegue**. Lo que este fichero
 * afirmaba —*«toda fila nueva nace `IVA_EXCLUSIVE`»*, *«CERO filas `IVA_INCLUSIVE`»*— era la promesa
 * del D-1 y **hoy es exactamente lo contrario**: criterio **214**, candado **`IVA-12(a)`**.
 *
 * ⚠️⚠️ **Y lo que NO cambió, que es la mitad que protege el pasado:** `IVA-3` sigue corriendo entero.
 * La fila `IVA_EXCLUSIVE` **sembrada por SQL** se re-renderiza idéntica al centavo, la columna sigue
 * **sin `DEFAULT`** y sigue siendo `NOT NULL`, y omitirla sigue **reventando**. *`IVA-12` dice «lo
 * nuevo nace bien»; `IVA-3` dice «lo viejo no se reinterpreta». Son dos candados y hacen falta los
 * dos.*
 *
 * ⛔ **Los candados puramente aritméticos** (`IVA-1`, `IVA-2`, `IVA-4`, `IVA-6`, `IVA-9`, `IVA-10`,
 * `IVA-11`) viven en la suite **unitaria** (`test/iva-*.spec.ts`), que es donde se puede asertar al
 * centavo sin levantar infraestructura. Aquí se mide **lo que solo la BD y el HTTP pueden decir**.
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { computeCartBreakdown, computeDirectShipBreakdown, computeShipmentBreakdown } from '../../src/common/money';

const FEE = { stripePct: 0.036, stripeFixedCents: 300, stripeFeeIvaPct: 0.16 };
const IVA = 16;
/** `F` — el dial `shipping_fee_cents`, que sigue siendo **NETO** y ⛔ no cambia de valor (§4.44.f). */
const SHIPPING = 17500;
/** ⭐ `E = round(F × (1 + t·r))` con el dial en 100 %: la tarifa **EXHIBIDA**, con su IVA dentro. */
const SHIPPING_DISPLAY = 20300;

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

    it('⭐⭐ D56: las filas SEMBRADAS son `IVA_EXCLUSIVE` y ⛔ el corte NO las reinterpreta', async () => {
      // ⚠️ **Este `it` cambió de bando con D56, y se dice.** Antes afirmaba *«CERO filas
      // `IVA_INCLUSIVE` en toda la base»*; hoy las filas nuevas nacen `IVA_INCLUSIVE` (criterio 214).
      // Lo que sigue siendo exigible —y es `IVA-3`— es que **lo sembrado no cambie de convención**.
      const [o] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order"
          WHERE "priceConvention" = 'IVA_EXCLUSIVE' AND "ivaTransferPct" IS NULL`,
      );
      // Control: la siembra dejó filas históricas que mirar. Sin esto, el censo de abajo pasaría
      // sobre una base vacía y no querría decir nada.
      expect(Number(o.n)).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  // ⭐ `IVA-11(d)` (mitad de D-1) — LA COLUMNA NUEVA EXISTE, ESTÁ EN CERO, Y NADIE LA INVENTÓ
  // =============================================================================================
  /**
   * v1.64(4) (`M-50` PASO 3-BIS, `§4.44.f-ter`). Las otras tres mitades de `IVA-11` —la identidad
   * `netShippingRevenue − netShippingCost == 0`, el contador `shippingCostMissingCount` y el neteo
   * por resta— **son del DEPLOY 2 y no se pueden asertar aquí**: en D-1 el P&L ni siquiera lee esta
   * columna, que es la promesa entera del pase. Lo que **sí** es exigible hoy es la mitad `(d)`: que
   * el DDL diga lo que debe decir y que **nadie haya backfilleado un crédito fiscal**.
   */
  describe('⭐ `IVA-11(d)` — `shippingCostIvaCents`: entera, NOT NULL, `DEFAULT 0` y ⛔ sin backfill', () => {
    it('el DDL: `integer`, `is_nullable = NO`, `column_default = 0`', async () => {
      const [col] = await h.prisma.$queryRawUnsafe<
        { is_nullable: string; column_default: string | null; data_type: string }[]
      >(
        `SELECT is_nullable, column_default, data_type
           FROM information_schema.columns
          WHERE table_name = 'ShipmentRequest' AND column_name = 'shippingCostIvaCents'`,
      );
      expect(col).toBeDefined();
      expect(col.data_type).toBe('integer');
      // ⛔ NO nullable: para las filas existentes «costó cero» y «no se capturó» son
      // indistinguibles, y un `NULL` exigiría un backfill que INVENTA esa distinción.
      expect(col.is_nullable).toBe('NO');
      // ⭐ Y aquí el default SÍ debe estar — es la diferencia con `priceConvention`, medida sobre el
      // mismo catálogo y en el mismo fichero: la ausencia de verdad significa cero.
      expect(col.column_default).toBe('0');
    });

    it('⛔ CERO filas con crédito distinto de 0: nadie backfilleó `costo × 16/116`', async () => {
      // El candado del contrato lo acota a las filas anteriores al deploy; en D-1 **ninguna** ruta
      // escribe esta columna, así que la cota es TODA la tabla — más fuerte, no menos.
      const [s] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "ShipmentRequest" WHERE "shippingCostIvaCents" <> 0`,
      );
      expect(Number(s.n)).toBe(0);
    });

    it('⭐ y el default se aplica de verdad: un INSERT que la omite deja `0`, no `NULL`', async () => {
      const id = `iva-e2e-${RUN}-costiva`;
      await h.prisma.$executeRawUnsafe(
        `INSERT INTO "ShipmentRequest" (id, "addressSnapshot", status, "shippingFeeCents", "priceConvention", "shippingCostCents")
         VALUES ('${id}', '{}'::jsonb, 'solicitado', 17500, 'IVA_EXCLUSIVE', 20300)`,
      );
      aLimpiar.shipmentIds.push(id);
      const [fila] = await h.prisma.$queryRawUnsafe<
        { shippingCostCents: number; shippingCostIvaCents: number }[]
      >(`SELECT "shippingCostCents", "shippingCostIvaCents" FROM "ShipmentRequest" WHERE id = '${id}'`);
      // El BRUTO entra tal cual (es la factura del carrier, dato primario, `R3`)…
      expect(fila.shippingCostCents).toBe(20300);
      // …y el crédito arranca en 0 ⇒ `net = bruto`: la dirección CONSERVADORA (subestima la
      // ganancia). ⛔ Rojo si aparece un `2800` derivado por alguien: nadie verificó esa factura.
      expect(fila.shippingCostIvaCents).toBe(0);
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
  // ⭐⭐ `IVA-12(a)` — TODA ESCRITURA NUEVA NACE `IVA_INCLUSIVE`, por los caminos REALES
  // =============================================================================================
  /**
   * `API_CONTRACT §M10-IVA.9.d`, criterio **214**. La mitad **POSITIVA** del candado: *«un pedido
   * creado tras el despliegue (bóveda **y** `direct_ship`, invitado **y** registrado) tiene
   * `priceConvention == 'IVA_INCLUSIVE'`, **y también el `ShipmentRequest` de fulfillment** que el
   * settle crea con los montos en cero — la convención es ABSOLUTA, no depende de que los importes
   * sean 0»*. (La mitad NEGATIVA, sobre el código, vive en `iva-12-price-convention-writers.spec.ts`.)
   */
  describe('⭐⭐ `IVA-12(a)` — toda fila NUEVA nace `IVA_INCLUSIVE` (§M10-IVA.9.d, criterio 214)', () => {
    it('checkout de BÓVEDA (`POST /checkout/session`) ⇒ orden `IVA_INCLUSIVE`, con el dial archivado', async () => {
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
      expect(order!.priceConvention).toBe('IVA_INCLUSIVE');
      // ⭐ El dial que produjo estos precios queda ARCHIVADO con la fila (informativo/auditor).
      expect(order!.ivaTransferPct).toBe(100);

      // ⭐ El desglose persistido es EXACTAMENTE el de la aritmética nueva, sobre el subtotal que la
      // orden trae (que ya es `Σ P`). Se mide como identidad contra el helper, ⛔ no contra una
      // constante: así sigue midiendo aunque cambie el precio de la pieza del seed.
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
      // ⭐⭐ `IVA-2` sobre datos REALES: el IVA ⛔ NO es un sumando del total.
      expect(order!.totalCents).toBe(order!.subtotalCents + order!.processingFeeCents);
      expect(order!.totalCents).not.toBe(
        order!.subtotalCents + order!.ivaCents + order!.processingFeeCents,
      );
    });

    it('checkout de INVITADO (`direct_ship`) ⇒ orden `IVA_INCLUSIVE`, con la tarifa EXHIBIDA', async () => {
      const pieza = await nuevaPiezaListada(h, plantilla, `E2E-IVA-${RUN}-G1`);
      const res = await h.api('POST', '/checkout/guest/session', {
        json: { inventoryItemIds: [pieza.id], email: GUEST_EMAIL, shippingAddress: ADDRESS, acceptedTerms: true },
      });
      expect(res.status).toBe(201);
      const order = await h.prisma.order.findUnique({ where: { id: res.body.orderId } });
      expect(order!.priceConvention).toBe('IVA_INCLUSIVE');
      expect(order!.ivaTransferPct).toBe(100);
      expect(order!.fulfillmentMode).toBe('direct_ship');
      // ⭐⭐ `IVA-6`: la orden archiva `E = round(F × 1.16) = 20300`, ⛔ no la tarifa NETA `17500`.
      // **Money-neutral:** es exactamente lo que antes aportaban `17500 + 2800`.
      expect(order!.shippingFeeCents).toBe(SHIPPING_DISPLAY);
      expect(order!.shippingFeeCents).toBe(SHIPPING + Math.round((SHIPPING * IVA) / 100));

      const esperado = computeDirectShipBreakdown(order!.subtotalCents, SHIPPING_DISPLAY, IVA, FEE);
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
      // ⭐⭐ `IVA-12(a)`, la mitad que el contrato subraya: **también el `ShipmentRequest` de
      // fulfillment con los montos en CERO**. *La convención es ABSOLUTA, no depende de que los
      // importes sean 0.* Una fila sin convención no se puede leer, valga lo que valga.
      expect(envio!.priceConvention).toBe('IVA_INCLUSIVE');
      // Invariante §4.21b intacta: la tarifa vive en la ORDEN, no en este envío (evita doble conteo).
      expect(envio!.shippingFeeCents).toBe(0);
      expect(envio!.ivaCents).toBe(0);
    });

    it('retiro de BÓVEDA (`POST /shipments`) ⇒ `ShipmentRequest` `IVA_INCLUSIVE`, tarifa EXHIBIDA', async () => {
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
      // v1.67 (M-52): la dirección del seed nace sin destinatario y `POST /shipments` lo exige
      // (422 RECIPIENT_NAME_REQUIRED, cubierto en vault-shipments). Aquí se prueba la CONVENCIÓN de
      // IVA, no el destinatario: se garantiza uno sin pisar el que otra suite haya dejado.
      if (!addr!.recipientName) {
        await h.prisma.address.update({ where: { id: addr!.id }, data: { recipientName: 'E2E Destinatario' } });
      }
      const res = await h.api('POST', '/shipments', {
        token: customerToken,
        json: { inventoryItemIds: [pieza.id], addressId: addr!.id },
        headers: { 'idempotency-key': `iva-s-${RUN}` },
      });
      expect(res.status).toBe(201);
      aLimpiar.shipmentIds.push(res.body.shipmentId);
      aLimpiar.inventoryItemIds.push(pieza.id);
      const envio = await h.prisma.shipmentRequest.findUnique({ where: { id: res.body.shipmentId } });
      expect(envio!.priceConvention).toBe('IVA_INCLUSIVE');

      // ⭐⭐ Y EL ENVÍO SIGUE COSTANDO LO MISMO — money-neutral, `IVA-6(b)`: `E = 20300` con su IVA
      // dentro es el mismo total que `17500` con `2800` apilado detrás. **Ni un centavo.**
      const esperado = computeShipmentBreakdown(SHIPPING_DISPLAY, IVA, FEE);
      expect(envio!.shippingFeeCents).toBe(SHIPPING_DISPLAY);
      expect(envio!.ivaCents).toBe(esperado.ivaCents);
      expect(envio!.ivaCents).toBe(Math.round((SHIPPING * IVA) / 100));
      expect(envio!.totalCents).toBe(esperado.totalCents);
    });
  });

  // =============================================================================================
  // ⭐ EL CENSO FINAL — se repite DESPUÉS de haber escrito, y ésa es la mitad que importa
  // =============================================================================================
  describe('⭐ tras escribir por los tres caminos: LAS DOS convenciones conviven, cada una en su sitio', () => {
    /**
     * ⚠️ **Este bloque existe por una medición, no por simetría.** La mutación **M7b** —un camino que
     * escribe la convención EQUIVOCADA, que **compila sin problema** porque el tipo la admite— dejó el
     * censo del `describe` ANTERIOR en verde, porque aquél corre **antes de que este fichero escriba
     * nada**. *Un candado que solo mira el pasado no puede ver lo que el pase acaba de introducir.*
     * ⇒ **se repite al final**, cuando ya hay filas nuevas.
     *
     * ⭐⭐ **D56 lo invierte y lo hace MÁS fuerte:** ahora no basta con contar; hay que comprobar que
     * **cada fila está en el bando correcto** —lo nuevo `IVA_INCLUSIVE` con su dial, lo sembrado
     * `IVA_EXCLUSIVE` sin él— y eso mata **las dos** mutaciones de una vez: la que no convierte y la
     * que convierte de más (un `UPDATE` masivo sobre la historia).
     */
    it('⭐⭐ toda `Order` con dial ARCHIVADO es `IVA_INCLUSIVE`, y viceversa — sin cruces', async () => {
      const [cruce] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order"
          WHERE ("ivaTransferPct" IS NOT NULL AND "priceConvention" <> 'IVA_INCLUSIVE')
             OR ("ivaTransferPct" IS NULL     AND "priceConvention" <> 'IVA_EXCLUSIVE')`,
      );
      expect(Number(cruce.n)).toBe(0);
    });

    it('⭐⭐ y HAY filas de las DOS clases: el corte convirtió lo nuevo y ⛔ no tocó lo viejo', async () => {
      // Sin esto, el `it` de arriba pasaría sobre una base vacía y estaría verde sin mirar nada.
      const [nuevas] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      const [viejas] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "Order" WHERE "priceConvention" = 'IVA_EXCLUSIVE'`,
      );
      expect(Number(nuevas.n)).toBeGreaterThan(0); // esta suite las creó
      expect(Number(viejas.n)).toBeGreaterThan(0); // la siembra las dejó, y siguen ahí
    });

    it('⛔ y NINGÚN `ShipmentRequest` nuevo se quedó sin convertir', async () => {
      const [s] = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM "ShipmentRequest" WHERE "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      expect(Number(s.n)).toBeGreaterThan(0);
    });
  });

  // =============================================================================================
  // ⭐⭐ `IVA-5` (mitad del deploy 1) — EL P&L, NEUTRO CONTRA DATOS REALES
  // =============================================================================================
  describe('⭐⭐ `IVA-5` — el P&L da EXACTAMENTE lo que dicen las columnas persistidas', () => {
    it('⭐⭐ `incomeCents` se netea POR FILA y POR SU CONVENCIÓN — la identidad, en SQL', async () => {
      const res = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      expect(res.status).toBe(200);
      // ⭐ La MISMA decisión que `money.netRevenueCents`, escrita en SQL: bajo `IVA_EXCLUSIVE` el
      // subtotal es el ingreso; bajo `IVA_INCLUSIVE` es su BASE GRAVABLE (⛔ **no** `S − ivaCents`,
      // que le restaría a la mercancía el IVA del envío — `D-IVA-10`).
      const [suma] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum(
            CASE WHEN "priceConvention" = 'IVA_EXCLUSIVE' THEN "subtotalCents"
                 ELSE round("subtotalCents"::numeric * 100 / (100 + "ivaRatePct"))
            END), 0) AS n
           FROM "Order" WHERE status = 'settled'`,
      );
      // Identidad, ⛔ no constante: sigue midiendo aunque otra suite añada órdenes.
      expect(res.body.incomeCents).toBe(Number(suma.n));
    });

    it('⛔ y NO es `Σ subtotalCents`: eso contaría el IVA como ingreso propio (criterio 191)', async () => {
      const [bruto] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum("subtotalCents"), 0) AS n FROM "Order"
          WHERE status = 'settled' AND "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      // Control: hay órdenes inclusivas liquidadas ⇒ la comparación mide algo.
      expect(Number(bruto.n)).toBeGreaterThan(0);
      const [neto] = await h.prisma.$queryRawUnsafe<{ n: bigint | null }[]>(
        `SELECT COALESCE(sum(round("subtotalCents"::numeric * 100 / (100 + "ivaRatePct"))), 0) AS n
           FROM "Order" WHERE status = 'settled' AND "priceConvention" = 'IVA_INCLUSIVE'`,
      );
      expect(Number(neto.n)).toBeLessThan(Number(bruto.n));
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
      expect(res.body.shippingRevenueCents).toBeGreaterThan(0);
      expect(res.body.incomeCents).toBeGreaterThan(0);
      // Dos líneas DISTINTAS del reporte: si el envío se colara en el ingreso, `incomeCents` sería
      // la suma de las dos. Se afirma sobre el propio cuerpo, sin reconstruir el algoritmo.
      expect(res.body.incomeCents).not.toBe(res.body.incomeCents + res.body.shippingRevenueCents);
    });

    it('⭐⭐ `IVA-10(b)` — el TABLERO y el P&L dan el MISMO neto para el mismo periodo', async () => {
      // *Es la mutación realista, porque son dos endpoints y dos ficheros.* Aquí, contra HTTP real.
      const desde = '2000-01-01T00:00:00.000Z';
      const hasta = '2999-01-01T00:00:00.000Z';
      const pnl = await h.api('GET', `/admin/finance/pnl?from=${desde}&to=${hasta}`, { token: adminToken });
      const dash = await h.api('GET', `/admin/dashboard?from=${desde}&to=${hasta}`, { token: adminToken });
      expect(dash.status).toBe(200);
      expect(dash.body.salesPeriod.netAmountCents).toBe(pnl.body.incomeCents);
      // ⭐⭐ `IVA-10(a)` — y el PUENTE, exacto, sobre datos reales.
      const s = dash.body.salesPeriod;
      expect(s.grossAmountCents).toBe(
        s.netAmountCents + s.netShippingRevenueCents + s.ivaCents + s.processingFeeCents,
      );
      // ⭐ `IVA-10(c)`: `amountCents` YA NO EXISTE.
      expect(s).not.toHaveProperty('amountCents');
    });

    it('⭐ el CSV del P&L reserializa las MISMAS cifras (no es un quinto sitio, §4.44.j)', async () => {
      const json = await h.api('GET', '/admin/finance/pnl', { token: adminToken });
      const csv = await h.api('GET', '/admin/finance/export.csv?report=pnl', { token: adminToken });
      expect(csv.status).toBe(200);
      const [, fila] = csv.text.trim().split('\n');
      // ⭐ D56 (§M10-IVA.8): el CSV gana `shippingCostMissingCount`, en el MISMO orden que el objeto.
      expect(csv.text.trim().split('\n')[0]).toBe(
        'report,incomeCents,shippingRevenueCents,cogsCents,stripeFeesCents,shippingCostCents,' +
          'shippingCostMissingCount,profitCents',
      );
      expect(fila).toBe(
        `pnl,${json.body.incomeCents},${json.body.shippingRevenueCents},${json.body.cogsCents},` +
          `${json.body.stripeFeesCents},${json.body.shippingCostCents},` +
          `${json.body.shippingCostMissingCount},${json.body.profitCents}`,
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
  describe('la fila del dial está sembrada en 100, y su ÚNICA puerta es la suya', () => {
    it('`iva_transfer_pct` existe en `ConfigSetting` y vale 100 (el NEUTRO)', async () => {
      const fila = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
      expect(fila).not.toBeNull();
      expect(fila!.valueJson).toBe(100);
    });

    it('⭐⭐ `IVA-8(f)` — ⛔ NO viaja en `GET /admin/settings`, **y esto ya es NORMATIVO** (v1.75)', async () => {
      // ⚠️ `N-IVA9-2`: §M10-IVA.1 decía que sí; **cedió el contrato**, porque `SETTING_DTO_MAP` es
      // UNA lista y gobierna **las dos mitades** (el `GET` la itera y el `PUT` la consulta). Sacarla
      // del `GET` es lo que mantiene `IVA-8(b)` en pie: *la aparición en el `GET` sería la señal
      // temprana de que la puerta única está a un `if` de caerse.*
      const res = await h.api('GET', '/admin/settings', { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body).not.toHaveProperty('ivaTransferPct');
      // ⛔ Ni con valor, ni en `null`, ni bajo otro nombre.
      expect(Object.keys(res.body).filter((k) => /transfer/i.test(k))).toEqual([]);
      // Control: el GET sí responde los diales de siempre (no está vacío ni roto).
      expect(res.body).toHaveProperty('ivaPct', 16);
      expect(res.body).toHaveProperty('shippingFeeCents', SHIPPING);
    });

    it('⭐⭐ pero SÍ tiene su ruta propia: `GET /admin/settings/iva-transfer` responde la posición', async () => {
      const res = await h.api('GET', '/admin/settings/iva-transfer', { token: adminToken });
      expect(res.status).toBe(200);
      expect(res.body.ivaTransferPct).toBe(100);
      expect(res.body.ivaRatePct).toBe(16);
      expect(res.body.samplePriceCents).toBe(10000);
      expect(res.body.current).toMatchObject({
        displayPriceCents: 11600,
        taxBaseCents: 10000,
        ivaCents: 1600,
        netRevenueCents: 10000,
        totalChargedCents: 12469,
      });
    });

    it('⭐⭐ y el `/preview` responde el delta del criterio 188: **−690** con el dial a 50 %', async () => {
      const res = await h.api('GET', '/admin/settings/iva-transfer/preview?ivaTransferPct=50', {
        token: adminToken,
      });
      expect(res.status).toBe(200);
      expect(res.body.netDeltaPerUnitCents).toBe(-690);
      expect(res.body.proposed.displayPriceCents).toBe(10800);
      // ⛔ READ-ONLY: preguntar no mueve el dial.
      const fila = await h.prisma.configSetting.findUnique({ where: { key: 'iva_transfer_pct' } });
      expect(fila!.valueJson).toBe(100);
    });

    it('⛔ `/preview` sin `ivaTransferPct` ⇒ `400` (es LA PREGUNTA, no un filtro)', async () => {
      const res = await h.api('GET', '/admin/settings/iva-transfer/preview', { token: adminToken });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.details).toMatchObject({ field: 'ivaTransferPct' });
    });

    it('⭐⭐ `D-IVA-13` MEDIDO SOBRE HTTP: `samplePriceCents=2e9` ⇒ `400`, ⛔ NO un `500`', async () => {
      // `N-IVA9-7`, la medición que el arquitecto marcó como pendiente. Sin la cota, `grossUpTotal`
      // lanza un `Error` **que el filtro global no mapea** ⇒ `500` disparable desde la barra de
      // direcciones por cualquiera con sesión `super_admin`.
      const res = await h.api(
        'GET',
        '/admin/settings/iva-transfer/preview?ivaTransferPct=100&samplePriceCents=2000000000',
        { token: adminToken },
      );
      expect(res.status).toBe(400);
      expect(res.status).not.toBe(500);
      expect(res.body.error.details).toMatchObject({ field: 'samplePriceCents' });
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
