import { Role } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { RefundLedgerService, SYSTEM_REFUND_ACTOR_ID } from '../src/modules/payments/refunds/refund-ledger.service';
import { refundsInPeriod } from '../src/modules/admin/pnl-core';
import { taxBaseCentsOf } from '../src/common/money';

/**
 * ⭐💰 CANDADO `REF-DASH-1` (rama `fix/pnl-finanzas`, API_CONTRACT §M4-SHIP.20 (B1)) — **LA CAPTURA DEL REEMBOLSO
 * HECHO DIRECTO EN EL PANEL DE STRIPE.**
 *
 * El defecto (hoy): un `charge.refunded` SIN `metadata.paymentRefundId` cuyo `payment_intent` resuelve a una `Order`
 * conocida NO crea fila de libro — el PARCIAL `payments.service.ts` SOLO LOGUEA (medido: `:785-791`) ⇒ el reembolso
 * es invisible al P&L.
 *
 * El arreglo (B1): nace UNA fila `stripe_dashboard` conciliada (bruto a mercancía, IVA derivado de la convención
 * CONGELADA de la orden), IDEMPOTENTE por `idempotencyKey = 'stripe-refund:'+refund.id` y `stripeRefundId` (ambos
 * @unique) ⇒ una segunda entrega del webhook NO duplica. `GET /admin/finance/pnl` del periodo del evento sube
 * `refundsCents` por el NETO (`refundsInPeriod` ya cuenta toda fila `submitted|succeeded` por `submittedAt`).
 *
 * Candado de EXTREMO A EXTREMO a nivel unitario: el webhook escribe en un `store` en memoria (que HONRA los dos
 * @unique, como Postgres) y el P&L lee del MISMO `store` HONRANDO su `where` (status + submittedAt). Así FALLA de
 * verdad si el webhook no concilia — no por un mock que responde igual a cualquier entrada.
 */

const R = 16;
const PI = 'pi_dashboard_1';
const ORDER_ID = 'ord_dashboard_1';
const PERIOD_START = new Date('2026-05-01T00:00:00.000Z');
const PERIOD_END = new Date('2026-05-31T23:59:59.999Z');
const REFUND_CREATED_S = Math.floor(new Date('2026-05-10T12:00:00.000Z').getTime() / 1000);

// `charge.refunds.data[i]` sin `metadata.paymentRefundId` ⇒ es un reembolso de panel.
function refund(id: string, amount: number, status = 'succeeded') {
  return { id, amount, status, metadata: {}, created: REFUND_CREATED_S };
}
function charge(amount: number, amountRefunded: number, refunds: ReturnType<typeof refund>[]) {
  return { payment_intent: PI, amount, amount_refunded: amountRefunded, refunds: { data: refunds } } as any;
}

/** Un `where.status.in` + `where.submittedAt {gte,lte}` HONRADOS como Postgres (el P&L no ve lo que no cae en el periodo). */
function matchesPnlWhere(row: any, where: any): boolean {
  const okStatus = Array.isArray(where?.status?.in) ? where.status.in.includes(row.status) : true;
  const sa = where?.submittedAt;
  const okDate =
    !sa || (row.submittedAt != null && (!sa.gte || row.submittedAt >= sa.gte) && (!sa.lte || row.submittedAt <= sa.lte));
  return okStatus && okDate;
}

/** BD en memoria compartida entre el webhook (escribe) y el P&L (lee), con los dos @unique de `PaymentRefund`. */
function makeHarness(orderStatus: string) {
  const store: any[] = [];
  const audits: any[] = [];
  const order = { id: ORDER_ID, ivaRatePct: R, status: orderStatus, fulfillmentMode: 'vault', stripePaymentIntentId: PI };
  const paymentRefund = {
    createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const d of data) {
        const clash = store.some(
          (x) => x.idempotencyKey === d.idempotencyKey || (d.stripeRefundId && x.stripeRefundId === d.stripeRefundId),
        );
        if (clash) {
          if (skipDuplicates) continue;
          throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
        }
        store.push({ ...d });
        count++;
      }
      return { count };
    }),
    findUniqueOrThrow: jest.fn(async ({ where }: any) => {
      const row = store.find((x) => x.idempotencyKey === where.idempotencyKey);
      if (!row) throw new Error('not found');
      return row;
    }),
    findMany: jest.fn(async ({ where }: any) => store.filter((r) => matchesPnlWhere(r, where))),
  };
  const prisma: any = {
    order: { findUnique: jest.fn(async ({ where }: any) => (where.stripePaymentIntentId === PI ? order : null)) },
    shipmentRequest: { findUnique: jest.fn(async () => null) },
    paymentRefund,
    manualRefund: { findMany: jest.fn(async () => []) },
    auditLog: { create: jest.fn(async ({ data }: any) => audits.push(data)) },
    $transaction: jest.fn(async (fn: any) => fn(prisma)),
  };
  const ledger = new RefundLedgerService(prisma, {} as any, {} as any, {} as any);
  // Orden de args: (prisma, stripe, guestMail, audit, mail?, fullRefund?, ledger?, …). `fullRefund` undefined ⇒
  // la rama legada del TOTAL; con `order.status = 'refunded'` retorna antes de notificar (sin tocar el correo).
  const payments = new PaymentsService(prisma, {} as any, {} as any, {} as any, undefined, undefined, ledger);
  return { store, audits, prisma, ledger, payments };
}

const PERIOD = { gte: PERIOD_START, lte: PERIOD_END };
const EXPECTED_NET = taxBaseCentsOf(5000, R); // 4310 — mercancía NETA de un reembolso de 5000 al 16 %
const EXPECTED_IVA = 5000 - EXPECTED_NET; // 690

describe('REF-DASH-1 · reembolso del panel de Stripe → fila stripe_dashboard conciliada', () => {
  it('PARCIAL sin paymentRefundId ⇒ nace fila stripe_dashboard SUCCEEDED (hoy: solo loguea ⇒ rojo)', async () => {
    const h = makeHarness('settled');
    await h.payments.onChargeRefunded(charge(10000, 5000, [refund('re_partial', 5000)]));

    expect(h.store).toHaveLength(1);
    const row = h.store[0];
    expect(row.kind).toBe('stripe_dashboard');
    expect(row.status).toBe('succeeded');
    expect(row.orderId).toBe(ORDER_ID);
    expect(row.idempotencyKey).toBe('stripe-refund:re_partial');
    expect(row.stripeRefundId).toBe('re_partial');
    // desglose money-safe: bruto a mercancía, IVA por RESTA con la tasa CONGELADA de la orden; comisión 0.
    expect(row.amountCents).toBe(5000);
    expect(row.merchandiseCents).toBe(5000);
    expect(row.merchandiseIvaCents).toBe(EXPECTED_IVA);
    expect(row.shippingCents).toBe(0);
    expect(row.processingFeeCents).toBe(0);
    expect(row.compensationCents).toBe(0);
    // succeeded ⇒ submittedAt = succeededAt = la fecha del reembolso.
    expect(row.submittedAt).toEqual(new Date(REFUND_CREATED_S * 1000));
    expect(row.succeededAt).toEqual(new Date(REFUND_CREATED_S * 1000));
    // actor de SISTEMA (centinela documentado) + rol super_admin.
    expect(row.requestedByUserId).toBe(SYSTEM_REFUND_ACTOR_ID);
    expect(row.requestedByRole).toBe(Role.super_admin);
  });

  it('TOTAL sin paymentRefundId ⇒ nace fila stripe_dashboard SUCCEEDED', async () => {
    const h = makeHarness('refunded'); // rama legada del TOTAL retorna tras conciliar, sin notificar
    await h.payments.onChargeRefunded(charge(5000, 5000, [refund('re_total', 5000)]));
    expect(h.store).toHaveLength(1);
    expect(h.store[0].kind).toBe('stripe_dashboard');
    expect(h.store[0].status).toBe('succeeded');
    expect(h.store[0].amountCents).toBe(5000);
  });

  it('IDEMPOTENTE: la SEGUNDA entrega del mismo webhook NO duplica', async () => {
    const h = makeHarness('settled');
    const c = charge(10000, 5000, [refund('re_partial', 5000)]);
    await h.payments.onChargeRefunded(c);
    await h.payments.onChargeRefunded(c); // reentrega
    expect(h.store).toHaveLength(1);
    expect(h.audits.filter((a) => a.action === 'payment_refund.dashboard_reconciled')).toHaveLength(1);
  });

  it('el P&L del periodo del evento sube refundsCents por el NETO (y el IVA devuelto)', async () => {
    const h = makeHarness('settled');
    await h.payments.onChargeRefunded(charge(10000, 5000, [refund('re_partial', 5000)]));
    const acc = await refundsInPeriod(h.prisma, PERIOD);
    expect(acc.refundsCents).toBe(EXPECTED_NET); // 4310
    expect(acc.ivaRefundedCents).toBe(EXPECTED_IVA); // 690
    expect(acc.refundedFeesCents).toBe(0);
  });

  it('un reembolso FUERA del periodo no cuenta (el where.submittedAt se HONRA)', async () => {
    const h = makeHarness('settled');
    await h.payments.onChargeRefunded(charge(10000, 5000, [refund('re_partial', 5000)]));
    const acc = await refundsInPeriod(h.prisma, { gte: new Date('2026-06-01T00:00:00.000Z'), lte: new Date('2026-06-30T23:59:59.999Z') });
    expect(acc.refundsCents).toBe(0);
  });

  it('con metadata.paymentRefundId (reembolso de la APP) NO nace fila stripe_dashboard', async () => {
    const h = makeHarness('settled');
    const c = charge(10000, 5000, [{ id: 're_app', amount: 5000, status: 'succeeded', metadata: { paymentRefundId: 'pr_app' }, created: REFUND_CREATED_S }]);
    await h.payments.onChargeRefunded(c);
    expect(h.store).toHaveLength(0);
  });
});
