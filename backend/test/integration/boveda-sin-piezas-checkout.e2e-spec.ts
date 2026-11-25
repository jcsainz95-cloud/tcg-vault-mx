/**
 * boveda-sin-piezas-checkout.e2e-spec.ts — §BOVEDA-COBRADA-SIN-PIEZAS, criterio 8 (la carrera REAL, R1-R3). Postgres real, rutas HTTP
 * reales (`POST /checkout/session`), webhooks Stripe firmados y Stripe simulado con el PI1 RETRASADO:
 *   petición 1 se detiene tras crear O1 y antes de adjuntar el PI ⇒ petición 2 sustituye ⇒ se libera la petición 1 ⇒ pago de PI1.
 * Esperado en N = 20/20: 409 `ORDER_SUPERSEDED` y PI1 cancelado (R1a) · o, forzando el atajo sin R1a, liquidación por R2.
 */
import { E2EHarness } from './helpers/e2e-app';
import { VaultOrphansDb } from './helpers/vault-orphans-db';
import { OrdersService } from '../../src/modules/orders/orders.service';
import { E2E_FOLIOS, E2E_USERS } from '../../prisma/e2e-fixtures';

const RUN = Date.now().toString(36);
const N = 20;

describe('§BOVEDA-COBRADA-SIN-PIEZAS — criterio 8: la carrera real de checkout (R1-R3)', () => {
  let h: E2EHarness;
  let fx: VaultOrphansDb;
  let orders: OrdersService;
  let cardId: string;
  const myUsers: string[] = [];

  beforeAll(async () => {
    h = await E2EHarness.create();
    fx = new VaultOrphansDb(h, RUN);
    await fx.init();
    orders = h.app.get(OrdersService);
    cardId = (await h.prisma.inventoryItem.findUniqueOrThrow({ where: { folio: E2E_FOLIOS.listedCharizard }, select: { cardId: true } })).cardId;
  });
  afterAll(async () => {
    if (h) {
      orders.supersedeWaitMaxMs = 5000;
      await fx.cleanup(myUsers);
      await h.close();
    }
  });
  afterEach(() => {
    h.stripe.cancelOutcome = 'canceled';
    orders.supersedeWaitMaxMs = 5000;
  });

  /** Cliente propio de la corrida, con sesión. */
  async function buyer(tag: string) {
    const u = await fx.user(tag);
    myUsers.push(u.id);
    const token = await h.login(u.email as string, E2E_USERS.customer.password);
    return { u, token };
  }
  const session = (token: string, ids: string[]) => h.api('POST', '/checkout/session', { token, json: { inventoryItemIds: ids } });
  const intentsOf = (orderId: string) => h.stripe.createdIntents.filter((i) => i.metadata.orderId === orderId);
  async function until<T>(fn: () => Promise<T | null | undefined>, ms = 8000): Promise<T> {
    const t0 = Date.now();
    for (;;) {
      const v = await fn();
      if (v) return v;
      if (Date.now() - t0 > ms) throw new Error('until: tiempo agotado');
      await new Promise((r) => setTimeout(r, 25));
    }
  }

  it('R1a — PI1 retrasado: la petición 1 pierde el CAS ⇒ 409 ORDER_SUPERSEDED, PI1 cancelado, O2 vigente con sus piezas (N = 20)', async () => {
    let ok = 0;
    for (let i = 0; i < N; i += 1) {
      orders.supersedeWaitMaxMs = 0; // sustituir sin esperar: el atajo que R1a debe cerrar
      const { u, token } = await buyer('r1a');
      const a = await fx.piece(cardId);
      const b = await fx.piece(cardId);
      const release = h.stripe.holdNextCreate();
      const p1 = session(token, [a.id]);
      const o1 = await until(() => h.prisma.order.findFirst({ where: { userId: u.id, status: 'pending' } }));
      const r2 = await session(token, [a.id, b.id]);
      release();
      const r1 = await p1;
      const o1After = await h.prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      const pi1 = intentsOf(o1.id)[0];
      const itemA = await fx.item(a.id);
      const good =
        r2.status === 201 &&
        r1.status === 409 &&
        r1.body?.error?.code === 'ORDER_SUPERSEDED' &&
        !JSON.stringify(r1.body).includes('_secret') && // el clientSecret del PI huérfano NUNCA se entrega
        o1After.status === 'failed' &&
        o1After.stripePaymentIntentId === null &&
        !!pi1 &&
        h.stripe.canceledIntents.includes(pi1.id) &&
        itemA.reservedByOrderId === r2.body.orderId &&
        (await h.prisma.order.count({ where: { userId: u.id, status: 'pending' } })) === 1;
      if (good) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
  });

  it('R1b — con la espera (≤ 5 s) la sustitución ve el PI1 y lo cancela por el flujo normal; nunca un PI vivo huérfano (N = 20)', async () => {
    let ok = 0;
    for (let i = 0; i < N; i += 1) {
      const { u, token } = await buyer('r1b');
      const a = await fx.piece(cardId);
      const b = await fx.piece(cardId);
      const release = h.stripe.holdNextCreate();
      const p1 = session(token, [a.id]);
      const o1 = await until(() => h.prisma.order.findFirst({ where: { userId: u.id, status: 'pending' } }));
      const p2 = session(token, [a.id, b.id]);
      await new Promise((r) => setTimeout(r, 250)); // la petición 2 está esperando a que la 1 adjunte
      release();
      const [r1, r2] = await Promise.all([p1, p2]);
      const o1After = await h.prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      const live = h.stripe.createdIntents.filter((x) => x.metadata.userId === u.id && !h.stripe.canceledIntents.includes(x.id));
      const good =
        r1.status === 201 &&
        r2.status === 201 &&
        r2.body.supersededOrderIds.includes(o1.id) &&
        o1After.status === 'failed' &&
        live.length === 1 && // exactamente UN PI vivo: el de O2
        live[0].id === r2.body.stripe.paymentIntentId;
      if (good) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
  });

  it('atajo SIN R1a (PI1 adjunto a la fuerza a la orden ya sustituida) + pago de PI1 ⇒ R2: piezas del comprador, O1 settled, O2 failed, PI2 cancelado, 1 `settle` por pieza (N = 20)', async () => {
    let ok = 0;
    for (let i = 0; i < N; i += 1) {
      orders.supersedeWaitMaxMs = 0;
      const { u, token } = await buyer('r2');
      const a = await fx.piece(cardId);
      const b = await fx.piece(cardId);
      const release = h.stripe.holdNextCreate();
      const p1 = session(token, [a.id]);
      const o1 = await until(() => h.prisma.order.findFirst({ where: { userId: u.id, status: 'pending' } }));
      const r2 = await session(token, [a.id, b.id]);
      release();
      await p1; // 409 (R1a); aquí se reproduce lo que pasaba SIN el cierre: el PI1 queda adjunto a la orden `failed`
      const pi1 = intentsOf(o1.id)[0];
      await h.prisma.order.update({ where: { id: o1.id }, data: { stripePaymentIntentId: pi1.id } });
      const total = (await h.prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).totalCents;
      const wh = await fx.paid(pi1.id, total);
      const o1After = await h.prisma.order.findUniqueOrThrow({ where: { id: o1.id } });
      const o2After = await h.prisma.order.findUniqueOrThrow({ where: { id: r2.body.orderId } });
      const itemA = await fx.item(a.id);
      const itemB = await fx.item(b.id);
      const good =
        wh.status === 200 &&
        o1After.status === 'settled' &&
        o2After.status === 'failed' &&
        itemA.ownerUserId === u.id &&
        itemA.status === 'in_custody' &&
        // B no la cubría O1 ⇒ se libera (nunca queda reservada por una orden `failed`).
        itemB.status === 'listed' &&
        (await fx.movements(a.id, 'settle')).length === 1 &&
        h.stripe.canceledIntents.includes(r2.body.stripe.paymentIntentId) &&
        (await fx.violations([o1.id, r2.body.orderId])).length === 0;
      if (good) ok += 1;
    }
    expect(`${ok}/${N}`).toBe(`${N}/${N}`);
  });

  it('doble envío del formulario: 2 y 5 envíos simultáneos ⇒ 1 orden vigente y 1 PI vigente', async () => {
    for (const [size, runs] of [[2, N], [5, 10]] as const) {
      let ok = 0;
      for (let i = 0; i < runs; i += 1) {
        const { u, token } = await buyer(`dbl${size}`);
        const a = await fx.piece(cardId);
        const res = await Promise.all(Array.from({ length: size }, () => session(token, [a.id])));
        const orderIds = new Set(res.map((r) => r.body?.orderId));
        const live = h.stripe.createdIntents.filter((x) => x.metadata.userId === u.id && !h.stripe.canceledIntents.includes(x.id));
        const good =
          res.every((r) => r.status === 200 || r.status === 201) &&
          orderIds.size === 1 &&
          (await h.prisma.order.count({ where: { userId: u.id, status: 'pending' } })) === 1 &&
          live.length === 1 &&
          new Set(res.map((r) => r.body?.stripe?.paymentIntentId)).size === 1;
        if (good) ok += 1;
      }
      expect(`${size} envíos: ${ok}/${runs}`).toBe(`${size} envíos: ${runs}/${runs}`);
    }
  });

  it('doble cobro REAL por la ruta de checkout: O1 y O2 pagadas ⇒ ambas «requieren atención», 0 dinero automático', async () => {
    orders.supersedeWaitMaxMs = 0;
    const { u, token } = await buyer('dc');
    const a = await fx.piece(cardId);
    const b = await fx.piece(cardId);
    const release = h.stripe.holdNextCreate();
    const p1 = session(token, [a.id]);
    const o1 = await until(() => h.prisma.order.findFirst({ where: { userId: u.id, status: 'pending' } }));
    const r2 = await session(token, [a.id, b.id]);
    release();
    await p1;
    const pi1 = intentsOf(o1.id)[0];
    await h.prisma.order.update({ where: { id: o1.id }, data: { stripePaymentIntentId: pi1.id } });
    const total2 = (await h.prisma.order.findUniqueOrThrow({ where: { id: r2.body.orderId } })).totalCents;
    expect((await fx.paid(r2.body.stripe.paymentIntentId, total2)).status).toBe(200);
    expect((await fx.paid(pi1.id, (await h.prisma.order.findUniqueOrThrow({ where: { id: o1.id } })).totalCents)).status).toBe(200);
    // O1 llevaba solo `a` (la de O2 se pagó primero y se la quedó): su línea y la de O2 sobre `a` quedan marcadas; `b` (solo de O2) está bien.
    const lineA = (orderId: string) => h.prisma.orderItem.findFirstOrThrow({ where: { orderId, inventoryItemId: a.id } });
    expect([(await lineA(o1.id)).fulfillmentFailedReason, (await lineA(r2.body.orderId)).fulfillmentFailedReason]).toEqual(['double_charge', 'double_charge']);
    expect(await fx.item(a.id)).toMatchObject({ ownerUserId: u.id, status: 'in_custody' });
    expect(await h.prisma.paymentRefund.count({ where: { orderId: { in: [o1.id, r2.body.orderId] } } })).toBe(0);
    expect(h.stripe.refundCreateCalls).toHaveLength(0);
  });
});
