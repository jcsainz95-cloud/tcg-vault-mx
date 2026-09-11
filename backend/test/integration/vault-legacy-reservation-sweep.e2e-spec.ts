/**
 * vault-legacy-reservation-sweep.e2e-spec.ts — **SEC-SB-1 / condición C9** (`docs/SECURITY_NOTES.md`
 * §3.4; red team `SB-B1` en `docs/PENTEST_NOTES.md`). Integración contra Postgres REAL y el doble
 * offline de Stripe del arnés.
 *
 * ⭐ **LA PROPIEDAD QUE SE FIJA AQUÍ, y no la implementación que hoy la cumple:**
 *
 *   1. Una pieza `reserved` **que nadie puede reclamar** acaba **disponible por sí sola** —sin que un
 *      humano la destrabe— en cuanto corre el barrido programado.
 *   2. Una pieza `reserved` **con dueño vivo** no se toca. «Dueño vivo» son las tres clases que un
 *      barrido podría robarle a un cliente que está pagando: la orden **reciente** (dentro del plazo
 *      de pago), la orden cuyo **PaymentIntent sigue cobrable** (Stripe no lo deja cancelar), y la
 *      orden **ya liquidada** (alguien pagó esa pieza).
 *
 * La prueba NO nombra `legacyExpiredByOrder`, ni el `where` del barrido, ni en qué servicio vive: se
 * pide el job programado (`OrderReservationSweepJobService`, lo mismo que corre el cron) y se miran
 * **`InventoryItem.status` y `Order.status`**, que es lo que ve el dueño de la tienda. Si mañana el
 * barrido se reescribe en otro sitio, esta prueba debe seguir verde; si el barrido deja de cubrir la
 * bóveda, debe ponerse roja.
 *
 * **Qué es una reserva LEGADA (y por qué no es «lo que estaba en vuelo al desplegar»):** la migración
 * `20260911130000_m53_reservation_owner` es aditiva **y SIN backfill**, así que en el instante del
 * despliegue **toda** pieza que estuviera `reserved` quedó con `reservedByOrderId IS NULL` y
 * `reservedUntil IS NULL` — incluida la acumulación histórica de órdenes de BÓVEDA `pending`, que
 * **nunca** tuvieron barrido (defecto `D-SB-1`). Ese estado es el que se reproduce aquí a mano:
 * las dos columnas a `NULL` sobre una orden real.
 */
import { E2EHarness } from './helpers/e2e-app';
import { OrderReservationSweepJobService } from '../../src/jobs/order-reservation-sweep.service';
import { seedE2E } from '../../prisma/seed-e2e';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);
const PREFIX = 'E2E-LEG-';
const ADDRESS = {
  line1: 'Av. Reforma 100',
  neighborhood: 'Juárez',
  city: 'Ciudad de México',
  state: 'CDMX',
  postalCode: '06600',
  country: 'MX',
  phone: '5512345678',
  recipientName: 'Juan Pérez López',
};
const HORA = 60 * 60 * 1000;

describe('E2E — SEC-SB-1/C9: la reserva LEGADA que nadie puede reclamar vuelve al catálogo sola', () => {
  let h: E2EHarness;
  let token: string;
  let userId: string;
  let template: { cardId: string; locationId: string | null };
  let seq = 0;

  /** Pieza PROPIA de esta corrida (clona la charizard listada del seed; folio único). */
  async function piece(tag: string) {
    return h.prisma.inventoryItem.create({
      data: {
        folio: `${PREFIX}${RUN}-${tag}-${(seq += 1)}`,
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

  const item = (id: string) => h.prisma.inventoryItem.findUniqueOrThrow({ where: { id } });
  const order = (id: string) => h.prisma.order.findUniqueOrThrow({ where: { id } });

  /**
   * Deja una orden real EXACTAMENTE como la dejó la migración M-53: sus piezas siguen `reserved`
   * pero **sin dueño y sin vencimiento**, y la orden nació hace `edadHoras`. Es el único modo
   * honesto de tener una legada: ni se inventa un `reservedUntil` (M-53 tampoco pudo) ni se toca
   * ninguna otra columna.
   */
  async function volverLegada(orderId: string, edadHoras: number): Promise<void> {
    await h.prisma.inventoryItem.updateMany({
      where: { reservedByOrderId: orderId },
      data: { reservedByOrderId: null, reservedUntil: null },
    });
    await h.prisma.order.update({
      where: { id: orderId },
      data: { createdAt: new Date(Date.now() - edadHoras * HORA) },
    });
  }

  /** Crea una orden de BÓVEDA (usuario con cuenta) por la ruta real y la vuelve legada. */
  async function ordenDeBovedaLegada(tag: string, edadHoras: number) {
    const id = (await piece(tag)).id;
    const res = await h.api('POST', '/checkout/session', {
      token,
      json: { inventoryItemIds: [id] },
    });
    expect(res.status).toBe(201);
    await volverLegada(res.body.orderId, edadHoras);
    return { itemId: id, orderId: res.body.orderId as string, pi: res.body.stripe.paymentIntentId as string };
  }

  /** Corre el job programado tal cual lo corre el cron. */
  const barrer = () => h.app.get(OrderReservationSweepJobService).run();

  /** ⛑️ Devuelve fuera de venta todo lo de esta suite y cierra sus órdenes `pending`. */
  async function purgeSuitePieces(prefix: string): Promise<void> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const mine = await h.prisma.inventoryItem.findMany({
          where: { folio: { startsWith: prefix } },
          select: { id: true },
        });
        const ids = mine.map((m) => m.id);
        if (ids.length === 0) return;
        await h.prisma.order.updateMany({
          where: { status: 'pending', items: { some: { inventoryItemId: { in: ids } } } },
          data: { status: 'failed' },
        });
        await h.prisma.inventoryItem.updateMany({
          where: { id: { in: ids } },
          data: {
            status: 'withdrawn',
            ownerType: 'platform',
            ownerUserId: null,
            ownershipStatus: null,
            reservedByOrderId: null,
            reservedUntil: null,
          },
        });
        return;
      } catch {
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  }

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    await purgeSuitePieces(PREFIX);
    // ⛑️ Usuario PROPIO de la corrida: las piezas de bóveda en `pending` cuentan en el portafolio de
    // su dueño y `vault-shipments` asierta el total EXACTO del cliente del seed.
    const seedCustomer = await h.prisma.user.findUniqueOrThrow({
      where: { email: E2E_USERS.customer.email },
    });
    const email = `legada.${RUN}@e2e.local`;
    const own = await h.prisma.user.upsert({
      where: { email },
      create: {
        email,
        passwordHash: seedCustomer.passwordHash,
        name: 'E2E Legacy Reservation Owner',
        role: 'customer',
        locale: 'es',
        phone: seedCustomer.phone,
        emailVerified: true,
      },
      update: { emailVerified: true, status: 'active' },
    });
    userId = own.id;
    token = await h.login(email, E2E_USERS.customer.password);
    template = await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
    });
  });

  afterAll(async () => {
    if (h) await purgeSuitePieces(`${PREFIX}${RUN}-`);
    await h?.close();
  });

  afterEach(() => {
    h.stripe.cancelOutcome = 'canceled';
  });

  describe('(1) nadie puede reclamarla ⇒ vuelve a estar disponible SOLA', () => {
    it('BÓVEDA (usuario con cuenta): la pieza atascada vuelve a `listed` de la plataforma y su orden queda `failed`', async () => {
      const { itemId, orderId, pi } = await ordenDeBovedaLegada('VAULT', 3);

      // Punto de partida: atascada. Y NADIE puede reclamarla — ni el propio cliente: al no tener
      // `reservedByOrderId`, el pre-scan de reserva propia no la ve, y `reserveItems` exige
      // `listed|in_stock` ⇒ ni siquiera su dueño original puede volver a comprarla.
      const antes = await item(itemId);
      expect(antes.status).toBe('reserved');
      expect(antes.reservedByOrderId).toBeNull();
      const reintento = await h.api('POST', '/checkout/session', {
        token,
        json: { inventoryItemIds: [itemId] },
      });
      expect(reintento.status).toBe(409);
      expect(reintento.body.error.code).toBe('ITEM_UNAVAILABLE');

      await barrer();

      const despues = await item(itemId);
      expect(despues.status).toBe('listed');
      expect(despues.ownerType).toBe('platform');
      expect(despues.ownerUserId).toBeNull();
      expect(despues.ownershipStatus).toBeNull();
      expect((await order(orderId)).status).toBe('failed');
      // B3: la vía de cobro se cierra ANTES de soltar el inventario.
      expect(h.stripe.canceledIntents).toContain(pi);

      // Y lo que importa para la tienda: ya se puede volver a vender.
      const revendida = await h.api('POST', '/checkout/session', {
        token,
        json: { inventoryItemIds: [itemId] },
      });
      expect(revendida.status).toBe(201);
    });

    it('ENVÍO DIRECTO de invitado (lo único que el barrido legado cubría): sigue cubierto, no se estrecha la cobertura', async () => {
      const id = (await piece('GUEST')).id;
      const res = await h.api('POST', '/checkout/guest/session', {
        json: {
          inventoryItemIds: [id],
          email: `legada.guest.${RUN}@example.com`,
          shippingAddress: ADDRESS,
          acceptedTerms: true,
        },
      });
      expect(res.status).toBe(201);
      await volverLegada(res.body.orderId, 3);

      await barrer();

      expect((await item(id)).status).toBe('listed');
      expect((await order(res.body.orderId)).status).toBe('failed');
    });

    it('varias piezas atascadas a la vez: TODAS vuelven (la acumulación histórica se drena, no una por pasada)', async () => {
      const a = await ordenDeBovedaLegada('LOTE-A', 5);
      const b = await ordenDeBovedaLegada('LOTE-B', 9);
      const c = await ordenDeBovedaLegada('LOTE-C', 48);

      await barrer();

      for (const x of [a, b, c]) {
        expect((await item(x.itemId)).status).toBe('listed');
        expect((await order(x.orderId)).status).toBe('failed');
      }
    });
  });

  describe('(2) con dueño VIVO ⇒ no se toca (soltar de más es peor que soltar de menos)', () => {
    it('la orden es RECIENTE: el cliente aún está dentro de su plazo de pago ⇒ la reserva sigue en pie', async () => {
      // 5 minutos: legada igual (sin dueño ni vencimiento), pero dentro del plazo de pago.
      const { itemId, orderId } = await ordenDeBovedaLegada('RECIENTE', 5 / 60);

      await barrer();

      expect((await item(itemId)).status).toBe('reserved');
      expect((await order(orderId)).status).toBe('pending');
    });

    it('el PaymentIntent NO se deja cancelar (el pago aún puede confirmarse) ⇒ la reserva NO se suelta', async () => {
      const { itemId, orderId } = await ordenDeBovedaLegada('PI-VIVO', 3);
      h.stripe.cancelOutcome = 'throws-succeeded';

      await barrer();

      expect((await item(itemId)).status).toBe('reserved');
      expect((await order(orderId)).status).toBe('pending');
    });

    it('la orden ya está LIQUIDADA: alguien pagó esa pieza ⇒ el barrido no se la quita', async () => {
      const { itemId, orderId } = await ordenDeBovedaLegada('PAGADA', 3);
      // Anomalía real: la orden liquidó y la pieza se quedó `reserved`. Tiene dueño: el que pagó.
      await h.prisma.order.update({ where: { id: orderId }, data: { status: 'settled' } });

      await barrer();

      const despues = await item(itemId);
      expect(despues.status).toBe('reserved');
      expect(despues.ownerUserId).toBe(userId);
      expect((await order(orderId)).status).toBe('settled');
    });

    it('reserva NORMAL (con dueño y vencimiento vivo): intacta — el barrido de siempre no cambia', async () => {
      const id = (await piece('VIVA')).id;
      const res = await h.api('POST', '/checkout/session', {
        token,
        json: { inventoryItemIds: [id] },
      });
      expect(res.status).toBe(201);

      await barrer();

      const despues = await item(id);
      expect(despues.status).toBe('reserved');
      expect(despues.reservedByOrderId).toBe(res.body.orderId);
      expect((await order(res.body.orderId)).status).toBe('pending');
    });
  });
});
