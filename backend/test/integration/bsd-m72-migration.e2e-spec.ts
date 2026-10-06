/**
 * bsd-m72-migration.e2e-spec.ts — 💰 M-72 (rev BSD-1, API_CONTRACT §BSD.1) contra Postgres REAL. Propiedad: backend.
 *
 * - **BSD-B2** — los CHECK `shipment_kind_link` y `shipment_inbound_status`, el `@unique` de `sellRequestId` y la FK
 *   RESTRICT muerden: una fila de entrada con `orderId`, `userId`, PaymentIntent o montos ⇒ rechazo; una de salida con
 *   `sellRequestId` ⇒ rechazo; una de entrada en `picking` ⇒ rechazo; dos filas de entrada por solicitud ⇒ rechazo.
 * - **BSD-B3 (mitad de B-1: el RELLENO)** — el `UPDATE` de la migración (su TEXTO, como en `sdx-d2bc-migrations`) ancla SOLO
 *   las `aceptada` abiertas sin guía, con UN solo `now()` (el de la transacción), y repetido no re-ancla. La otra mitad de
 *   BSD-B3 («barrido a +0 cierra 0, a +7 d cierra las 3») necesita la regla 8 ⇒ B-3 (BSD-B17).
 * - Los dos `ADD VALUE` existen en la BD migrada (M-72 cupo en UNA migración, sin M-72b).
 *
 * Todo corre en transacciones que SIEMPRE se deshacen: la BD compartida queda como estaba.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2EHarness } from './helpers/e2e-app';

const RUN = `m72${Date.now().toString(36)}`;
const MIGRATIONS = join(__dirname, '..', '..', 'prisma', 'migrations');
const M72 = readFileSync(join(MIGRATIONS, readdirSync(MIGRATIONS).find((d) => /_m72_bsd_inbound_label$/.test(d))!, 'migration.sql'), 'utf8');
const code = (s: string) => s.replace(/--.*$/gm, '');
/** La sentencia del texto de la migración que empieza por `head` (hasta su `;`). */
function statement(sql: string, head: RegExp): string {
  const c = code(sql);
  const start = c.search(head);
  if (start < 0) throw new Error(`no encuentro ${head} en la migración`);
  const rest = c.slice(start);
  const end = /;\s*$/m.exec(rest);
  if (!end) throw new Error(`sentencia sin fin: ${head}`);
  return rest.slice(0, end.index + 1).trim();
}
const ROLLBACK = Symbol('rollback');

describe('💰 M-72 (rev BSD-1) contra Postgres real', () => {
  let h: E2EHarness;

  beforeAll(async () => {
    h = await E2EHarness.create();
  });
  afterAll(async () => {
    await h?.close();
  });

  /** Corre `body` en una tx que SIEMPRE se deshace. */
  async function rolledBack(body: (tx: any) => Promise<void>): Promise<void> {
    try {
      await h.prisma.$transaction(async (tx) => {
        await body(tx);
        throw ROLLBACK;
      });
    } catch (e) {
      if (e !== ROLLBACK) throw e;
    }
  }

  let seq = 0;
  async function seller(tx: any) {
    seq += 1;
    return tx.user.create({ data: { email: `m72.${RUN}.${seq}@e2e.local`, name: 'Vendedor M72', role: 'customer', emailVerified: true } });
  }
  async function acceptedRequest(tx: any, userId: string, over: Record<string, unknown> = {}) {
    return tx.sellRequest.create({ data: { userId, status: 'aceptada', acceptedAt: new Date(), ...over } });
  }

  const SNAPSHOT = { recipientName: 'Vendedor', line1: 'Calle 1', city: 'CDMX', state: 'CDMX', postalCode: '01000', country: 'MX', phone: '5500000000' };
  /** Una fila de entrada VÁLIDA (CHECK) con `over` encima. */
  const inboundRow = (sellRequestId: string, over: Record<string, unknown> = {}) => ({
    kind: 'buylist_inbound' as const,
    sellRequestId,
    userId: null,
    orderId: null,
    status: 'solicitado' as const,
    addressSnapshot: SNAPSHOT,
    shippingFeeCents: 0,
    priceConvention: 'IVA_INCLUSIVE' as const,
    ...over,
  });

  describe('BSD-B2 — CHECKs, unicidad y FK', () => {
    it('CONTROL: una fila de entrada bien formada ENTRA; y todas las filas existentes son `outbound` sin solicitud', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        const row = await tx.shipmentRequest.create({ data: inboundRow(sr.id) });
        expect(row).toMatchObject({ kind: 'buylist_inbound', sellRequestId: sr.id, status: 'solicitado' });
        expect(row.folio).toMatch(/^ENV-\d{6,}$/); // la secuencia del folio es UNA para las dos clases
        const bad = await tx.$queryRawUnsafe(
          `SELECT count(*)::int AS n FROM "ShipmentRequest" WHERE "kind"::text = 'outbound' AND "sellRequestId" IS NOT NULL`,
        );
        expect(bad[0].n).toBe(0);
      });
    });

    it('una fila de SALIDA nace `outbound` por el DEFAULT (sin escribir `kind`)', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const row = await tx.shipmentRequest.create({
          data: { userId: u.id, addressSnapshot: SNAPSHOT, shippingFeeCents: 100, priceConvention: 'IVA_INCLUSIVE' },
        });
        expect(row.kind).toBe('outbound');
        expect(row.sellRequestId).toBeNull();
      });
    });

    const violations: [string, (srId: string, userId: string) => Record<string, unknown>, RegExp][] = [
      ['entrada con userId', (sr, u) => inboundRow(sr, { userId: u }), /shipment_kind_link/],
      ['entrada con shippingFeeCents > 0', (sr) => inboundRow(sr, { shippingFeeCents: 18000 }), /shipment_kind_link/],
      ['entrada con ivaCents > 0', (sr) => inboundRow(sr, { ivaCents: 1 }), /shipment_kind_link/],
      ['entrada con processingFeeCents > 0', (sr) => inboundRow(sr, { processingFeeCents: 1 }), /shipment_kind_link/],
      ['entrada con totalCents > 0', (sr) => inboundRow(sr, { totalCents: 1 }), /shipment_kind_link/],
      ['entrada con PaymentIntent', (sr) => inboundRow(sr, { stripePaymentIntentId: `pi_${RUN}` }), /shipment_kind_link/],
      ['entrada SIN solicitud', () => inboundRow(null as never), /shipment_kind_link/],
      ['salida CON solicitud', (sr, u) => ({ ...inboundRow(sr), kind: 'outbound', userId: u }), /shipment_kind_link/],
      ['entrada en picking', (sr) => inboundRow(sr, { status: 'picking' }), /shipment_inbound_status/],
      ['entrada en enviado', (sr) => inboundRow(sr, { status: 'enviado' }), /shipment_inbound_status/],
      ['entrada en entregado', (sr) => inboundRow(sr, { status: 'entregado' }), /shipment_inbound_status/],
    ];
    it.each(violations)('rechazo: %s', async (_name, build, constraint) => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        await expect(tx.shipmentRequest.create({ data: build(sr.id, u.id) })).rejects.toThrow(constraint);
      });
    });

    it('entrada con orderId ⇒ rechazo (CHECK)', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        const order = await tx.order.findFirst({ select: { id: true } });
        expect(order).not.toBeNull(); // la semilla E2E trae órdenes
        await expect(tx.shipmentRequest.create({ data: inboundRow(sr.id, { orderId: order!.id }) })).rejects.toThrow(/shipment_kind_link/);
      });
    });

    it('a lo sumo UNA fila de entrada por solicitud (I-BSD-3, `@unique`)', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        await tx.shipmentRequest.create({ data: inboundRow(sr.id) });
        await expect(tx.shipmentRequest.create({ data: inboundRow(sr.id) })).rejects.toMatchObject({ code: 'P2002' });
      });
    });

    it('FK RESTRICT: no se borra una solicitud con fila de entrada', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        await tx.shipmentRequest.create({ data: inboundRow(sr.id) });
        await expect(tx.sellRequest.delete({ where: { id: sr.id } })).rejects.toThrow(/ShipmentRequest_sellRequestId_fkey|Foreign key constraint/);
      });
    });

    it('una fila de entrada que pasa de solicitado a guia y a cancelado: permitido; a picking: rechazo', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const sr = await acceptedRequest(tx, u.id);
        const row = await tx.shipmentRequest.create({ data: inboundRow(sr.id) });
        await tx.shipmentRequest.update({ where: { id: row.id }, data: { status: 'guia' } });
        await tx.shipmentRequest.update({ where: { id: row.id }, data: { status: 'cancelado' } });
        await expect(tx.shipmentRequest.update({ where: { id: row.id }, data: { status: 'picking' } })).rejects.toThrow(/shipment_inbound_status/);
      });
    });
  });

  describe('BSD-B3 (relleno P-BSD-2) — el TEXTO del UPDATE de la migración', () => {
    const FILL = statement(M72, /UPDATE "SellRequest" SET "inboundGuideClockStartedAt" = now\(\)/);

    it('ancla SOLO las aceptadas abiertas sin guía, con UN solo now() (el de la transacción); repetido no re-ancla', async () => {
      await rolledBack(async (tx) => {
        const u = await seller(tx);
        const DAY = 86_400_000;
        const a20 = await acceptedRequest(tx, u.id, { acceptedAt: new Date(Date.now() - 20 * DAY) });
        const a1 = await acceptedRequest(tx, u.id, { acceptedAt: new Date(Date.now() - DAY) });
        const a0 = await acceptedRequest(tx, u.id);
        const withGuide = await acceptedRequest(tx, u.id, { guideSentAt: new Date(), shipmentCarrier: 'DHL', shipmentTrackingNumber: `T-${RUN}` });
        const closed = await acceptedRequest(tx, u.id, { closedAt: new Date() });
        const quoted = await tx.sellRequest.create({ data: { userId: u.id, status: 'cotizada' } });
        const mine = [a20, a1, a0, withGuide, closed, quoted].map((r) => r.id);

        await tx.$executeRawUnsafe(FILL);
        const [{ now }] = await tx.$queryRawUnsafe(`SELECT now() AS now`);
        const rows: { id: string; inboundGuideClockStartedAt: Date | null }[] = await tx.sellRequest.findMany({
          where: { id: { in: mine } },
          select: { id: true, inboundGuideClockStartedAt: true },
        });
        const anchor = new Map(rows.map((r) => [r.id, r.inboundGuideClockStartedAt]));
        // UN solo valor para las tres (el `now()` de la transacción). La columna es TIMESTAMP(3) y `now()` lleva µs: Postgres
        // REDONDEA al guardar y el driver TRUNCA al leer `now()` ⇒ ±1 ms (medido: 1/1 corrida con 1 ms de diferencia).
        const fixed = [a20.id, a1.id, a0.id].map((id) => anchor.get(id)?.getTime());
        expect(new Set(fixed).size).toBe(1);
        expect(Math.abs((fixed[0] as number) - new Date(now).getTime())).toBeLessThanOrEqual(1);
        for (const id of [withGuide.id, closed.id, quoted.id]) expect(anchor.get(id)).toBeNull();

        // idempotente: una ancla ya puesta (otra fecha) NO se mueve al re-aplicar
        const old = new Date('2026-10-01T00:00:00Z');
        await tx.sellRequest.update({ where: { id: a20.id }, data: { inboundGuideClockStartedAt: old } });
        await tx.$executeRawUnsafe(FILL);
        expect((await tx.sellRequest.findUnique({ where: { id: a20.id } })).inboundGuideClockStartedAt).toEqual(old);
      });
    });

    it('⛔ el relleno no toca estado, dinero ni sellos (solo escribe una columna)', () => {
      expect(FILL).toMatch(/^UPDATE "SellRequest" SET "inboundGuideClockStartedAt" = now\(\)\s+WHERE /);
      const set = FILL.slice(FILL.indexOf('SET'), FILL.indexOf('WHERE'));
      expect(set.split(',')).toHaveLength(1);
    });
  });

  describe('M-72 aplicada: los dos valores de enum existen (cupo en UNA migración, sin M-72b)', () => {
    it('`SellRequestExpiryReason` ∋ not_continued y `SpendAlertKind` ∋ buylist_guide_due', async () => {
      const rows = await h.prisma.$queryRawUnsafe<{ t: string; v: string }[]>(
        `SELECT t.typname AS t, e.enumlabel AS v FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
          WHERE t.typname IN ('SellRequestExpiryReason','SpendAlertKind','ShipmentKind')`,
      );
      const of = (t: string) => rows.filter((r) => r.t === t).map((r) => r.v);
      expect(of('SellRequestExpiryReason')).toContain('not_continued');
      expect(of('SpendAlertKind')).toContain('buylist_guide_due');
      expect(of('ShipmentKind').sort()).toEqual(['buylist_inbound', 'outbound']);
    });
  });
});
