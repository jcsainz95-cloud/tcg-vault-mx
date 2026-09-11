import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
import { plainToInstance } from 'class-transformer';
import { ShipmentsService } from '../src/modules/shipments/shipments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { TrackingDto } from '../src/modules/shipments/dto/shipments.dto';

/**
 * ⭐⭐ **`shippingCostIvaCents` EXISTE Y NO HACE NADA — el candado de que D-1 sigue sin cambiar NADA
 * observable.** (`ARCHITECTURE §11 M-50 punto 3-bis` y `§4.44.f-ter`; `API_CONTRACT §M10-IVA.8`.)
 *
 * v1.64(4) mete **una columna** en el DEPLOY 1 para que el DEPLOY 2 pueda netear el costo de envío
 * **por una resta**. La promesa que la hace admisible aquí, y no en su propia migración más tarde,
 * es literal: **la columna se escribe desde el día uno y NADIE la lee hasta D-2** ⇒ cero cambios de
 * contrato observable. **Este fichero es esa promesa, medida.**
 *
 * **Por qué hace falta medirla, y no basta con no escribir código:** el riesgo de una columna nueva
 * en una tabla de dinero no es que alguien la use — es que **se publique sola**. Antes de `S49-R4`,
 * `setTracking` devolvía la entidad Prisma cruda: con ese código, añadir esta columna la habría
 * puesto en la respuesta de M4 **sin que nadie escribiera una línea**, y D-1 habría roto su promesa
 * en el mismo commit que la enunció. La lista blanca `toAdminShipmentRow` ya impide eso; lo que este
 * fichero añade es que **quede medido**, porque una defensa que nadie asierta se borra en un
 * refactor.
 *
 * ⚠️⚠️ **ESTE FICHERO CADUCA EN D-2, A PROPÓSITO Y CON NOMBRE.** El primer bloque —«nadie la lee»—
 * se pone **rojo** en cuanto el P&L la lea, que es exactamente lo que `§M10-IVA.8` manda hacer en el
 * deploy 2. **Ese rojo es la señal, no el fallo:** quien implemente D-2 borra ESE bloque (y solo
 * ése) y escribe en su lugar los candados `IVA-11(a)(b)(c)`. ⛔ Lo que **no** caduca es el resto:
 * las proyecciones no deben publicar esta columna **nunca** (es un dato de costo interno, como su
 * hermana `shippingCostCents`, §M4).
 */

// =================================================================================================
// (1) ⭐⭐ NADIE LA LEE — el bloque que CADUCA en D-2
// =================================================================================================
describe('⭐⭐ D-1 — `shippingCostIvaCents` está en la BD y ⛔ NINGÚN código la toca', () => {
  const SRC = join(__dirname, '..', 'src');

  /** Todos los `.ts` de `src/`, recursivo. */
  function ficheros(dir: string): string[] {
    return readdirSync(dir).flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? ficheros(p) : p.endsWith('.ts') ? [p] : [];
    });
  }

  it('⛔ ni un solo fichero de `src/` menciona `shippingCostIvaCents`', () => {
    // Control de que el barrido barre de verdad: si mañana esto encuentra 0 ficheros, el test de
    // abajo pasaría vacío y no querría decir nada.
    const todos = ficheros(SRC);
    expect(todos.length).toBeGreaterThan(100);
    const culpables = todos
      .filter((f) => /shippingCostIvaCents/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(SRC.length + 1));
    expect(culpables).toEqual([]);
  });

  it('⭐ y el P&L en particular sigue sumando el costo BRUTO, sin restarle nada (D-2 lo netea)', () => {
    const pnl = readFileSync(join(SRC, 'modules', 'admin', 'admin.service.ts'), 'utf8');
    expect(pnl).toMatch(/shippingCostCents \+= s\.shippingCostCents;/);
    // ⛔ La resta del D-2 todavía NO está. Rojo el día que aparezca aquí sin sus candados.
    expect(pnl).not.toMatch(/shippingCostIvaCents/);
    // ⛔ Y por lo negativo, lo que NUNCA debe aparecer, ni en D-1 ni en D-2: netear dividiendo por
    // la tasa VIVA. `ShipmentRequest` no tiene `ivaRatePct` ⇒ sería el dial, y un P&L histórico
    // cambiaría al moverlo (incumple `IVA-5`). El neteo es una RESTA. `IVA-11(c)`.
    expect(pnl).not.toMatch(/shippingCostCents\s*\/\s*\(?\s*1\s*\+/);
  });

  it('⛔ el DTO de captura de M4 NO gana el campo: el contrato del endpoint no cambió en D-1', () => {
    // `POST /admin/shipments/:id/tracking` sigue siendo `{ carrier, trackingNumber,
    // shippingCostCents? }` (API_CONTRACT §M4). Con `whitelist: true` en el ValidationPipe, un
    // cliente que ya mandara `shippingCostIvaCents` recibe hoy un 200 y el campo se DESCARTA;
    // añadirlo al DTO cambiaría eso en silencio — que es justo lo observable que D-1 no puede
    // cambiar. La captura entra en D-2, con su rótulo de M4 («importe TOTAL de la factura, IVA
    // incluido»), que es obligación de ux-ui.
    const dto: any = plainToInstance(TrackingDto, {
      carrier: 'DHL',
      trackingNumber: 'T1',
      shippingCostCents: 20300,
      shippingCostIvaCents: 2800,
    });
    expect(dto.shippingCostCents).toBe(20300);
    expect(Object.prototype.hasOwnProperty.call(new TrackingDto(), 'shippingCostIvaCents')).toBe(false);
    const fuente = readFileSync(join(SRC, 'modules', 'shipments', 'dto', 'shipments.dto.ts'), 'utf8');
    expect(fuente).not.toMatch(/shippingCostIvaCents/);
  });
});

// =================================================================================================
// (2) ⛔ NO SE PUBLICA SOLA — esto NO caduca
// =================================================================================================
describe('⛔ CONTRA-CANDADO — la columna nueva no se cuela en ninguna respuesta (S49-R4 / SEC-C1)', () => {
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

  it('⭐ back-office (`setTracking` → `toAdminShipmentRow`): ve el costo BRUTO y ⛔ no el IVA nuevo', async () => {
    const { svc } = buildService();
    const res: any = await svc.setTracking('ship1', 'DHL', 'TRACK123', 20300);
    // El rol de M4 SÍ debe ver el costo (§M4) — eso no cambia.
    expect(res.shippingCostCents).toBe(20300);
    // ⛔ …y la columna nueva NO sale, aunque la fila cruda la traiga. Si esto se pone rojo es que
    // alguien volvió a esparcir la entidad (`...row`) y la lista blanca dejó de existir.
    expect(res).not.toHaveProperty('shippingCostIvaCents');
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

  it('⛔ `setTracking` no ESCRIBE la columna: en D-1 su único valor posible es el default (0)', async () => {
    const { svc, prisma } = buildService();
    await svc.setTracking('ship1', 'DHL', 'TRACK123', 20300);
    expect(prisma.shipmentRequest.update.mock.calls[0][0].data).not.toHaveProperty(
      'shippingCostIvaCents',
    );
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
