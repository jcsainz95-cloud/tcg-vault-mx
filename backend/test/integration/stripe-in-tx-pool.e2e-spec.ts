/**
 * `stripe-in-tx-pool.e2e-spec.ts` — **H-3 / I3 (techlead + QA, 2026-09-11): ¿cuánto le cuesta al
 * pool que la cancelación de Stripe viva DENTRO de la transacción del checkout?** Propiedad:
 * backend. Contra Postgres REAL, con el pool de CI.
 *
 * ### El defecto que se mide (no se supone)
 * `OrdersService.supersedeOwnOrder` (`orders.service.ts:868-870`) llama `closePaymentIntent()` —HTTP
 * a Stripe— **dentro** del `$transaction` que sostiene (a) la conexión de Prisma y (b) el
 * `pg_advisory_xact_lock` por cliente. Esa transacción tiene `timeout: 30_000`
 * (`reservation.ts` · `RESERVATION_TX_OPTIONS`), y el cliente de Stripe **no fijaba `timeout`**
 * (`payments/stripe.service.ts`): el default del SDK son **80 s**, con `maxNetworkRetries: 2`.
 * Es la misma familia que el defecto que v1.68.1 cerró (el pricing pedía una SEGUNDA conexión),
 * pero **por latencia en vez de por una segunda conexión**: aquí la conexión es una sola, y el
 * problema es cuánto se retiene.
 *
 * ### Cómo se mide
 * Doble de Stripe con **retardo inyectable** (`TestStripeService.cancelDelayMs`) + **N
 * sustituciones concurrentes de clientes DISTINTOS** (clientes distintos ⇒ claves de advisory lock
 * distintas ⇒ **no se serializan en la puerta**: compiten de verdad por el pool). Se cuentan los
 * `500` y los timeouts de pool (`Timed out fetching a new connection`).
 *
 * ⚠️ **Esta suite exige `connection_limit` en la `DATABASE_URL`.** Sin él, Prisma usa
 * `num_cpus * 2 + 1` y la medición no dice nada del pool de CI; se SALTA con un aviso ruidoso en
 * vez de dar un verde que no significa nada (mismo criterio que `E2E_STRICT_INFRA`).
 *
 * ### Qué NO es
 * No es un candado de conducta: es un **instrumento**. Su aserción dura es la única propiedad de
 * dinero que hay aquí — con o sin latencia, **nunca dos reservas vivas sobre la misma pieza, ni
 * dos PaymentIntents cobrando lo mismo**.
 */
import { Logger } from '@nestjs/common';
import { E2EHarness } from './helpers/e2e-app';
import { E2E_USERS } from '../../prisma/e2e-fixtures';
import { RESERVATION_TX_OPTIONS } from '../../src/modules/orders/reservation';

const RUN = Date.now().toString(36);
/** N de la medición que pidió QA. */
const N = 6;
/** Retardo inyectado en la cancelación (la latencia de Stripe que se simula). */
const RETARDO_MS = 2_000;

const POOL_LIMIT = Number(
  new URL((process.env.DATABASE_URL ?? '').replace(/^postgres(ql)?:/, 'http:')).searchParams.get(
    'connection_limit',
  ) ?? NaN,
);
const TIENE_POOL_DE_CI = Number.isFinite(POOL_LIMIT);

describe('H-3 / I3 — Stripe DENTRO de la transacción: presión sobre el pool de conexiones', () => {
  let h: E2EHarness;
  let template: { cardId: string; locationId: string };
  /** Un cliente por petición concurrente: claves de advisory lock distintas ⇒ no se serializan. */
  const clientes: { email: string; token: string }[] = [];
  let seq = 0;

  beforeAll(async () => {
    h = await E2EHarness.create();
    const base = await h.prisma.inventoryItem.findFirstOrThrow({
      where: { status: 'listed', ownerType: 'platform', productType: 'raw' },
      select: { cardId: true, locationId: true },
    });
    template = { cardId: base.cardId, locationId: base.locationId! };

    // N clientes REALES (no basta un token: el candado es por identidad de cliente).
    const passwordHash = (
      await h.prisma.user.findUniqueOrThrow({ where: { email: E2E_USERS.customer.email } })
    ).passwordHash;
    for (let i = 0; i < N; i += 1) {
      const email = `i3.${RUN}.${i}@e2e.local`;
      await h.prisma.user.create({
        data: {
          email,
          passwordHash,
          name: `I3 ${i}`,
          role: 'customer',
          locale: 'es',
          emailVerified: true,
          phone: '5511110000',
        },
      });
      clientes.push({ email, token: await h.login(email, E2E_USERS.customer.password) });
    }
  }, 120_000);

  afterAll(async () => {
    await limpia();
    // Orden FK-safe: los pedidos de estos clientes primero (cascada a `OrderItem`), luego ellos.
    const mios = await h.prisma.user.findMany({
      where: { email: { startsWith: `i3.${RUN}.` } },
      select: { id: true },
    });
    const userIds = mios.map((u) => u.id);
    if (userIds.length > 0) {
      await h.prisma.shipmentRequest.deleteMany({ where: { userId: { in: userIds } } });
      await h.prisma.order.deleteMany({ where: { userId: { in: userIds } } });
      await h.prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await h.close();
  });

  async function limpia() {
    const mine = await h.prisma.inventoryItem.findMany({
      where: { folio: { startsWith: `E2E-I3-${RUN}-` } },
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
      data: { status: 'listed', ownerType: 'platform', reservedByOrderId: null, reservedUntil: null },
    });
  }

  const piece = () =>
    h.prisma.inventoryItem.create({
      data: {
        folio: `E2E-I3-${RUN}-${(seq += 1)}`,
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

  const session = (token: string, ids: string[]) =>
    h.api('POST', '/checkout/session', { token, json: { inventoryItemIds: ids } });

  /**
   * Monta N clientes, cada uno con UNA orden `pending` propia sobre una pieza propia, y lanza a la
   * vez la SUSTITUCIÓN de las N (carrito distinto ⇒ no es reuso ⇒ pasa por `supersedeOwnOrder`,
   * que es donde vive la llamada a Stripe dentro de la `tx`).
   */
  async function nSustitucionesConcurrentes(retardoMs: number) {
    const setup: { token: string; vieja: string; nuevoCarrito: string[] }[] = [];
    for (const c of clientes) {
      const a = (await piece()).id;
      const b = (await piece()).id;
      const first = await session(c.token, [a]);
      expect(first.status).toBe(201);
      // Carrito DISTINTO ⇒ sustitución, no reuso (§4-R.2).
      setup.push({ token: c.token, vieja: first.body.orderId, nuevoCarrito: [a, b] });
    }
    h.stripe.cancelDelayMs = retardoMs;
    // ⚠ El timeout de pool NO se puede contar por el cuerpo de la respuesta: el filtro global
    // sanea el `500` y el cliente solo ve `INTERNAL_ERROR` (que es lo correcto de cara afuera).
    // La única fuente fiel es el log del servidor, así que se cuenta ahí.
    const errores: string[] = [];
    const spy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation((m: unknown, ...rest: unknown[]) => {
        errores.push(`${String(m)} ${rest.map(String).join(' ')}`);
      });
    const t0 = Date.now();
    let res;
    try {
      res = await Promise.all(setup.map((s) => session(s.token, s.nuevoCarrito)));
    } finally {
      h.stripe.cancelDelayMs = 0;
      spy.mockRestore();
    }
    const ms = Date.now() - t0;

    const quinientos = res.filter((r) => r.status >= 500).length;
    const poolTimeouts = errores.filter((e) =>
      /Timed out fetching a new connection/i.test(e),
    ).length;
    const creadas = res.filter((r) => r.status === 201).length;
    return { res, setup, ms, quinientos, poolTimeouts, creadas };
  }

  /** La propiedad de DINERO: ninguna pieza puede quedar reservada por dos órdenes vivas. */
  async function ningunaPiezaDobleReservada(setup: { nuevoCarrito: string[] }[]) {
    const ids = setup.flatMap((s) => s.nuevoCarrito);
    const filas = await h.prisma.inventoryItem.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, reservedByOrderId: true },
    });
    const malas: string[] = [];
    for (const f of filas) {
      if (f.status !== 'reserved') continue;
      const vivas = await h.prisma.order.count({
        where: { status: 'pending', items: { some: { inventoryItemId: f.id } } },
      });
      if (vivas > 1) malas.push(`${f.id}: ${vivas} órdenes pending`);
    }
    return malas;
  }

  (TIENE_POOL_DE_CI ? it : it.skip)(
    `N=${N} sustituciones concurrentes de clientes DISTINTOS con ${RETARDO_MS}ms de latencia de Stripe DENTRO de la tx — proporción de 500 y de timeouts de pool`,
    async () => {
      const m = await nSustitucionesConcurrentes(RETARDO_MS);
      // eslint-disable-next-line no-console
      console.log(
        `[I3] connection_limit=${POOL_LIMIT} · N=${N} · cancelDelayMs=${RETARDO_MS} ⇒ ` +
          `201: ${m.creadas}/${N} · 5xx: ${m.quinientos}/${N} · pool-timeouts: ${m.poolTimeouts}/${N} · ` +
          `pared ${m.ms}ms · códigos [${m.res.map((r) => r.status).join(',')}]`,
      );
      // ⛔ Lo único NO negociable: cero doble reserva, pase lo que pase con la latencia.
      expect(await ningunaPiezaDobleReservada(m.setup)).toEqual([]);
      await limpia();
    },
    180_000,
  );

  (TIENE_POOL_DE_CI ? it : it.skip)(
    'el TECHO: con una latencia mayor que el `pool_timeout`, el mecanismo se ve — y el `timeout` del cliente de Stripe es lo que lo acota',
    async () => {
      // `pool_timeout` de CI = 10 s. Una latencia por encima de eso hace visible el mecanismo que
      // el caso anterior puede no alcanzar a disparar con N=6: la conexión se retiene más de lo que
      // el siguiente en la cola está dispuesto a esperar.
      const RETARDO_ALTO = 12_000;
      const m = await nSustitucionesConcurrentes(RETARDO_ALTO);
      // eslint-disable-next-line no-console
      console.log(
        `[I3·techo] connection_limit=${POOL_LIMIT} · N=${N} · cancelDelayMs=${RETARDO_ALTO} ⇒ ` +
          `201: ${m.creadas}/${N} · 5xx: ${m.quinientos}/${N} · pool-timeouts: ${m.poolTimeouts}/${N} · ` +
          `pared ${m.ms}ms · códigos [${m.res.map((r) => r.status).join(',')}]`,
      );
      expect(await ningunaPiezaDobleReservada(m.setup)).toEqual([]);
      await limpia();
    },
    180_000,
  );

  it('el `timeout` del cliente de Stripe está por DEBAJO del `timeout` de la transacción de reserva', () => {
    // ⭐ La acotación de I3, comprobada como PROPIEDAD y no como comentario: el SDK no puede
    // retener la conexión más de lo que la propia transacción tolera. Sin esto, el default del SDK
    // (80 s) es 2.6× el `timeout` de la transacción (30 s) ⇒ el proveedor decide cuánto dura
    // nuestra transacción.
    // `getApiField` existe en el SDK pero no en sus `.d.ts` (medido: 80000 por defecto en v16).
    const timeoutSdk = (h.stripe.stripe as unknown as { getApiField(k: string): unknown }).getApiField(
      'timeout',
    ) as number;
    expect(typeof timeoutSdk).toBe('number');
    expect(timeoutSdk).toBeLessThan(RESERVATION_TX_OPTIONS.timeout);
    expect(timeoutSdk).toBeGreaterThan(0);
  });
});
