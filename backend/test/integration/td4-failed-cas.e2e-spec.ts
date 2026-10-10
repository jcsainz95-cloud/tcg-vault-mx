/**
 * td4-failed-cas.e2e-spec.ts — 💰 v1.84 LIVE-4 · TD-4 (API_CONTRACT §14.4) contra Postgres REAL y el webhook FIRMADO.
 *
 * Los tres escritores de `failed` (`releaseReservation`, `supersedeOwnOrder`, `sweepExpiredReservations`) pasan
 * `pending → failed` con CAS (`updateMany` con `status:'pending'` en el `WHERE`, primera escritura de la tx). Si no
 * casa ⇒ ⛔ no se liberan piezas. Riesgo que cierran: un pedido que el cliente PAGÓ (liquidado por el webhook) o que
 * ya se reembolsó queda `failed` (liquidable de nuevo) y con sus piezas fuera de su sitio.
 *
 *  TD4-1   `releaseReservation` sobre una orden ya `settled` (las dos rutas) ⇒ sigue `settled`, piezas intactas
 *          (`xmin`). Control: sobre `pending` ⇒ `failed` + piezas `listed`.
 *  TD4-2   «settled/refunded ENTRE la lectura y la escritura», DETERMINISTA: el doble de Stripe, mientras el barrido
 *          o la sustitución cancelan el PI (B3, que corre entre su lectura `pending` y su transacción), hace llegar el
 *          `payment_intent.succeeded` firmado (y en la variante `refunded`, también el `charge.refunded`).
 *  TD4-3   La carrera DENTRO de la tx: una barrera toma la fila de la orden y la escribe `settled` (piezas a
 *          custodia) SIN confirmar; el barrido se VE bloqueado en su escritura (canario `pg_stat_activity`, ⛔ sin
 *          `sleep`); al confirmar, Postgres re-evalúa el `WHERE` del CAS y pierde. N=10, proporción.
 *
 * ⚠ Sobre TD4-3 «libre» (sin barrera): con un Stripe FIEL, el barrido solo escribe si el PI quedó `canceled`, y un PI
 * cancelado ya no puede liquidarse ⇒ la carrera libre no llega al CAS (por eso la tabla de la norma lo trata como
 * defensa en profundidad). Se fuerza el entrelazado que la norma quiere cerrar; ver BACKEND_NOTES §89.
 */
import { randomUUID } from 'crypto';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';
import { diferida } from './helpers/row-lock-barrier';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { PaymentsService } from '../../src/modules/payments/payments.service';

const RUN = Date.now().toString(36);
const N_CARRERA = 10;
type Mode = 'vault' | 'direct_ship';

describe('💰 LIVE-4 · TD-4 — CAS en los tres escritores de `failed` (Postgres real, webhook firmado)', () => {
  let h: E2EHarness;
  let orders: OrdersService;
  let userId: string;
  let template: { cardId: string; locationId: string };
  const orderIds: string[] = [];
  const itemIds: string[] = [];
  const restores: jest.SpyInstance[] = [];
  let seq = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
    orders = h.app.get(OrdersService);
    const base = await h.prisma.inventoryItem.findUniqueOrThrow({
      where: { folio: E2E_FOLIOS.listedCharizard },
      select: { cardId: true, locationId: true },
    });
    template = { cardId: base.cardId, locationId: base.locationId! };
    const passwordHash = (await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })).passwordHash;
    const u = await h.prisma.user.create({
      data: { email: `td4.${RUN}@e2e.local`, passwordHash, name: 'TD4 Cliente', role: 'customer', emailVerified: true },
    });
    userId = u.id;
    // Los avisos del settle no son lo que se mide aquí: se silencian en la instancia VIVA.
    const p = h.app.get(PaymentsService) as unknown as {
      mail: { send: (m: unknown) => Promise<unknown> };
      guestMail: { sendConfirmation: (o: unknown) => Promise<void> };
    };
    restores.push(jest.spyOn(p.mail, 'send').mockImplementation(async () => ({})));
    restores.push(jest.spyOn(p.guestMail, 'sendConfirmation').mockImplementation(async () => undefined));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    h.stripe.cancelOutcome = 'canceled';
  });

  afterAll(async () => {
    restores.forEach((s) => s.mockRestore());
    if (!h) return;
    const del = async (fn: () => Promise<unknown>) => fn().catch(() => undefined);
    await del(() => h.prisma.vaultPlacementItem.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } }));
    await del(() => h.prisma.vaultPlacement.deleteMany({ where: { orderId: { in: orderIds } } }));
    await del(() => h.prisma.shipmentItem.deleteMany({ where: { shipmentRequest: { orderId: { in: orderIds } } } }));
    await del(() => h.prisma.shipmentRequest.deleteMany({ where: { orderId: { in: orderIds } } }));
    await del(() => h.prisma.paymentRefund.deleteMany({ where: { orderId: { in: orderIds } } }));
    await del(() => h.prisma.auditLog.deleteMany({ where: { entityId: { in: orderIds } } }));
    await del(() => h.prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }));
    await del(() => h.prisma.order.deleteMany({ where: { id: { in: orderIds } } }));
    await del(() => h.prisma.inventoryMovement.deleteMany({ where: { itemId: { in: itemIds } } }));
    await del(() => h.prisma.inventoryItem.deleteMany({ where: { id: { in: itemIds } } }));
    await del(() => h.prisma.user.deleteMany({ where: { id: userId } }));
    await h.close();
  });

  /** Orden `pending` con PI y `n` piezas `reserved` por ella; `vencida` ⇒ `reservedUntil` en el pasado (barrible). */
  async function mk(n: number, mode: Mode = 'vault', vencida = false) {
    const k = (seq += 1);
    const totalCents = 30000 + k;
    const pi = `pi_td4_${RUN}_${k}`;
    const order = await h.prisma.order.create({
      data: {
        userId,
        fulfillmentMode: mode,
        orderNumber: `TD4-${RUN}-${k}`,
        status: 'pending',
        subtotalCents: totalCents,
        processingFeeCents: 0,
        ivaCents: 0,
        totalCents,
        priceConvention: 'IVA_INCLUSIVE',
        stripePaymentIntentId: pi,
        shippingAddressSnapshot: mode === 'direct_ship' ? { line1: 'x' } : undefined,
      },
    });
    orderIds.push(order.id);
    const items = [];
    const reservedUntil = new Date(Date.now() + (vencida ? -5 : 30) * 60 * 1000);
    for (let i = 0; i < n; i += 1) {
      const it = await h.prisma.inventoryItem.create({
        data: {
          folio: `TD4-${RUN}-${k}-${i}`,
          cardId: template.cardId,
          productType: 'raw',
          rawCondition: 'NM',
          finish: 'normal',
          acquisitionType: 'compra',
          acquisitionCostCents: 1000,
          locationId: template.locationId,
          status: 'reserved',
          reservedByOrderId: order.id,
          reservedUntil,
          ...(mode === 'vault'
            ? { ownerType: 'customer' as const, ownerUserId: userId, ownershipStatus: 'pending' as const }
            : { ownerType: 'platform' as const }),
        },
      });
      itemIds.push(it.id);
      items.push(it);
      await h.prisma.orderItem.create({ data: { orderId: order.id, inventoryItemId: it.id, cardSnapshot: {}, unitPriceCents: 1 } });
    }
    return { order, items, pi, totalCents, mode };
  }
  type O = Awaited<ReturnType<typeof mk>>;

  const evt = () => `evt_e2e_td4_${randomUUID().replace(/-/g, '')}`;
  const pay = (o: O) =>
    h.sendStripeWebhook({
      id: evt(),
      type: 'payment_intent.succeeded',
      data: { object: { id: o.pi, object: 'payment_intent', amount: o.totalCents, amount_received: o.totalCents, currency: 'mxn' } },
    });
  const refundFull = (o: O) =>
    h.sendStripeWebhook({
      id: evt(),
      type: 'charge.refunded',
      data: { object: { object: 'charge', payment_intent: o.pi, amount: o.totalCents, amount_refunded: o.totalCents } },
    });

  async function foto(o: O) {
    const ids = o.items.map((i) => i.id);
    const order = await h.prisma.$queryRawUnsafe<{ x: string; status: string }[]>(
      `SELECT xmin::text AS x, status::text AS status FROM "Order" WHERE id = $1`,
      o.order.id,
    );
    const items = await h.prisma.$queryRawUnsafe<{ x: string; status: string; reservedByOrderId: string | null }[]>(
      `SELECT xmin::text AS x, status::text AS status, "reservedByOrderId" FROM "InventoryItem" WHERE id = ANY($1::text[]) ORDER BY id`,
      ids,
    );
    return { order: order[0], items };
  }

  /** Lleva la orden a `settled` (o `settled → refunded`) por el webhook firmado real. */
  async function mover(o: O, a: 'settled' | 'refunded') {
    expect((await pay(o)).status).toBe(200);
    if (a === 'refunded') expect((await refundFull(o)).status).toBe(200);
    expect((await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id } })).status).toBe(a);
  }

  /** El doble de Stripe: al cancelar el PI de `o`, ANTES de responder `canceled`, el otro escritor mueve la orden. */
  function moverAlCancelar(o: O, a: 'settled' | 'refunded') {
    const real = h.stripe.cancelPaymentIntent.bind(h.stripe);
    const st: { n: number; tras?: Awaited<ReturnType<typeof foto>> } = { n: 0 };
    jest.spyOn(h.stripe, 'cancelPaymentIntent').mockImplementation(async (pi: string) => {
      if (pi === o.pi) {
        st.n += 1;
        await mover(o, a);
        st.tras = await foto(o); // lo que dejó el OTRO escritor; desde aquí, el de `failed` no debe escribir nada
        return { status: 'canceled' };
      }
      return real(pi);
    });
    return st;
  }

  describe('TD4-1 · releaseReservation', () => {
    it.each<Mode>(['vault', 'direct_ship'])('%s: orden ya `settled` ⇒ sigue `settled`, piezas sin reescribir (xmin)', async (mode) => {
      const o = await mk(2, mode);
      await mover(o, 'settled');
      const antes = await foto(o);
      await orders.releaseReservation(o.order.id, o.items.map((i) => i.id));
      const despues = await foto(o);
      expect(despues.order.status).toBe('settled');
      expect(despues).toEqual(antes);
    });

    it('control: orden `pending` ⇒ `failed` y piezas `listed` sin dueño', async () => {
      const o = await mk(2, 'vault');
      await orders.releaseReservation(o.order.id, o.items.map((i) => i.id));
      const d = await foto(o);
      expect(d.order.status).toBe('failed');
      expect(d.items.map((i) => [i.status, i.reservedByOrderId])).toEqual([
        ['listed', null],
        ['listed', null],
      ]);
    });
  });

  describe('TD4-2 · barrido — leída `pending`, movida por el webhook antes de su tx', () => {
    it.each<[Mode, 'settled' | 'refunded']>([
      ['vault', 'settled'],
      ['direct_ship', 'settled'],
      ['vault', 'refunded'],
      ['direct_ship', 'refunded'],
    ])('%s → %s ⇒ la orden NO pasa a `failed` y sus piezas no se tocan en la tx del barrido', async (mode, a) => {
      const o = await mk(2, mode, true);
      const st = moverAlCancelar(o, a);
      await orders.sweepExpiredReservations();
      expect(st.n).toBe(1); // el arnés entró en la ventana (si no, la prueba no mide nada)
      const d = await foto(o);
      expect(d.order.status).toBe(a);
      // Cero escrituras del barrido tras el otro escritor: orden y piezas con el MISMO `xmin`.
      expect(d).toEqual(st.tras);
    });

    it('control: sin otro escritor ⇒ `failed` y piezas `listed`', async () => {
      const o = await mk(1, 'vault', true);
      await orders.sweepExpiredReservations();
      const d = await foto(o);
      expect(d.order.status).toBe('failed');
      expect(d.items[0].status).toBe('listed');
    });
  });

  describe('TD4-2 · sustitución — la vieja se liquida (o reembolsa) mientras se cancela su PI', () => {
    it.each<['settled' | 'refunded']>([['settled'], ['refunded']])('→ %s ⇒ la vieja NO pasa a `failed`; nada lanza', async (a) => {
      const o = await mk(2, 'vault');
      const st = moverAlCancelar(o, a);
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id }, include: { items: true } });
      expect(order.status).toBe('pending');
      await h.prisma.$transaction((tx) =>
        orders.supersedeOwnOrder(tx, { order, heldItemIds: o.items.map((i) => i.id), heldAlive: true }),
      );
      expect(st.n).toBe(1);
      const d = await foto(o);
      expect(d.order.status).toBe(a);
      expect(d).toEqual(st.tras);
    });

    it('control: sin otro escritor ⇒ la vieja `failed` y sus piezas `listed`', async () => {
      const o = await mk(1, 'vault');
      const order = await h.prisma.order.findUniqueOrThrow({ where: { id: o.order.id }, include: { items: true } });
      await h.prisma.$transaction((tx) => orders.supersedeOwnOrder(tx, { order, heldItemIds: [o.items[0].id], heldAlive: true }));
      const d = await foto(o);
      expect([d.order.status, d.items[0].status]).toEqual(['failed', 'listed']);
    });
  });

  /**
   * TD4-3 — una tirada. `'ok'` | `'KO(…)'` | `'INVALIDA'` (canario: no se vio al barrido esperando la fila ⇒ la tirada
   * no midió la carrera y ⛔ no cuenta como verde).
   */
  async function carrera(): Promise<string> {
    const o = await mk(2, 'vault', true);
    const ids = o.items.map((i) => i.id);
    const soltar = diferida();
    const tomado = diferida();
    // (1) La barrera: lo que haría el settle, SIN confirmar — orden `settled`, piezas a custodia liquidada.
    const barrera = h.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${o.order.id} FOR UPDATE`;
        await tx.$executeRaw`UPDATE "Order" SET status = 'settled', "settledAt" = now() WHERE id = ${o.order.id}`;
        await tx.$executeRaw`UPDATE "InventoryItem" SET status = 'in_custody', "ownershipStatus" = 'settled',
                               "reservedByOrderId" = NULL, "reservedUntil" = NULL WHERE id = ANY(${ids}::text[])`;
        tomado.abrir();
        await soltar.promesa;
      },
      { timeout: 30000 },
    );
    await tomado.promesa;
    // (2) El barrido lee `pending` confirmado, cancela el PI (doble: `canceled`) y entra en su tx.
    let terminado = false;
    const sw = orders.sweepExpiredReservations().finally(() => {
      terminado = true;
    });
    const visto = await verBloqueado(() => terminado);
    // (3) La barrera confirma: el barrido re-evalúa su `WHERE`.
    soltar.abrir();
    await barrera;
    await sw;
    if (!visto) return 'INVALIDA';
    const d = await foto(o);
    const custodia = d.items.every((i) => i.status === 'in_custody');
    const liberadas = d.items.every((i) => i.status === 'listed');
    const ok = (d.order.status === 'settled' && custodia) || (d.order.status === 'failed' && liberadas);
    return ok ? 'ok' : `KO(${d.order.status},${d.items.map((i) => i.status).join('+')})`;
  }

  async function verBloqueado(terminado: () => boolean): Promise<boolean> {
    const hasta = Date.now() + 10000;
    while (Date.now() < hasta) {
      const filas = await h.prisma.$queryRawUnsafe<{ n: bigint }[]>(
        `SELECT count(*) AS n FROM pg_stat_activity
          WHERE datname = current_database() AND wait_event_type = 'Lock' AND state = 'active'
            AND query ILIKE '%UPDATE%' AND (query ILIKE '%"Order"%' OR query ILIKE '%"InventoryItem"%')`,
      );
      if (Number(filas[0].n) >= 1) return true;
      if (terminado()) return false;
      await new Promise((res) => setTimeout(res, 25));
    }
    return false;
  }

  describe('⭐ TD4-3 — liquidación ∥ barrido sobre la misma orden (barrera de fila)', () => {
    it(`N=${N_CARRERA}: en TODAS las tiradas válidas, \`settled\`+custodia o \`failed\`+liberadas — nunca mezcla`, async () => {
      const r: string[] = [];
      for (let t = 0; t < N_CARRERA; t += 1) r.push(await carrera());
      const validas = r.filter((x) => x !== 'INVALIDA');
      const verdes = validas.filter((x) => x === 'ok').length;
      // eslint-disable-next-line no-console
      console.log(`[TD4-3] válidas ${validas.length}/${N_CARRERA} · verdes ${verdes}/${validas.length} · ${r.join(' ')}`);
      expect(validas).toHaveLength(N_CARRERA);
      expect(validas).toEqual(Array(N_CARRERA).fill('ok'));
    }, 120000);
  });
});
