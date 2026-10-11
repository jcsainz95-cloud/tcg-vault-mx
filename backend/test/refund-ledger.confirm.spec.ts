/**
 * # refund-ledger.confirm.spec.ts — la tx de CONFIRMACIÓN de M3 (`applyStripeOutcome`), §M4-SHIP.18.2 (M5), v1.80.7.2
 *
 * Unitaria de PS-57d (la integración vive en `test/integration/full-refund-vault.e2e-spec.ts`). Norma v1.80.7.2 (D-a
 * del techlead sobre `59a0c1f`): la tx NO decide con una lectura sin candado; `onFullRefund` corre siempre (como el
 * webhook) y, tras (4), la relectura de `Order.status` bajo el candado que (3) ya tomó CLASIFICA:
 *  - `count 1` ⇒ transicionó ⇒ `AV-3` post-commit;
 *  - `count 0` ∧ `refunded` ⇒ éxito (el webhook llegó antes), sin log;
 *  - `count 0` ∧ `chargeback` ⇒ `logger.warn` con la verdad (cierre hecho, estado conservado), ⛔ nunca `error`, sin AV-3;
 *  - `count 0` ∧ cualquier otro ⇒ `logger.error` (invariante roto).
 * Mutación (c) del contrato: `log error` en vez de `warn` para `chargeback` ⇒ rojo aquí.
 */
import type { PaymentRefund } from '@prisma/client';
import { RefundLedgerService } from '../src/modules/payments/refunds/refund-ledger.service';

type Harness = {
  svc: RefundLedgerService;
  onFullRefund: jest.Mock;
  orderUpdateMany: jest.Mock;
  orderReads: jest.Mock;
  warn: jest.SpyInstance;
  error: jest.SpyInstance;
  notice: jest.SpyInstance;
};

function harness(opts: { transitioned: 0 | 1; statusAfter: string }): Harness {
  const onFullRefund = jest.fn(async () => ({}));
  const orderUpdateMany = jest.fn(async () => ({ count: opts.transitioned }));
  // Toda lectura de `Order.status` devuelve el estado final: con la lectura previa SIN candado de antes de
  // v1.80.7.2, `chargeback` cortaba ANTES de `onFullRefund` (y con `log error`).
  const orderReads = jest.fn(async () => ({ status: opts.statusAfter }));
  const tx = {
    paymentRefund: { updateMany: jest.fn(async () => ({ count: 1 })) },
    order: { findUniqueOrThrow: orderReads, findUnique: orderReads, updateMany: orderUpdateMany },
  };
  const prisma = {
    $transaction: jest.fn(async (fn: (t: unknown) => unknown) => fn(tx)),
    paymentRefund: { findUniqueOrThrow: jest.fn(async () => ({ id: 'r1', status: 'succeeded' })) },
  };
  const svc = new RefundLedgerService(prisma as never, {} as never, {} as never, { onFullRefund } as never);
  const logger = (svc as unknown as { logger: { warn: (m: string) => void; error: (m: string) => void } }).logger;
  const warn = jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
  const error = jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  const notice = jest
    .spyOn(svc as unknown as { sendOrderRefundedNotice: (id: string) => Promise<void> }, 'sendOrderRefundedNotice')
    .mockImplementation(async () => undefined);
  return { svc, onFullRefund, orderUpdateMany, orderReads, warn, error, notice };
}

const row = { id: 'r1', kind: 'order_full', orderId: 'o1', status: 'requested' } as unknown as PaymentRefund;
const confirm = (h: Harness) =>
  (h.svc as unknown as { applyStripeOutcome: (r: PaymentRefund, id: string, st: string, a: null) => Promise<unknown> }).applyStripeOutcome(
    row,
    're_1',
    'succeeded',
    null,
  );

describe('PS-57d (unitaria) — `applyStripeOutcome` clasifica DESPUÉS de (4), bajo el candado de (3)', () => {
  it('estado final `chargeback` ⇒ `onFullRefund` CORRIÓ, `logger.warn` con la verdad y ⛔ NO `logger.error`; sin AV-3', async () => {
    const h = harness({ transitioned: 0, statusAfter: 'chargeback' });
    await confirm(h);
    expect(h.onFullRefund).toHaveBeenCalledTimes(1);
    expect(h.onFullRefund).toHaveBeenCalledWith(expect.anything(), { orderId: 'o1' }, 'm3', null);
    expect(h.error).not.toHaveBeenCalled();
    expect(h.warn).toHaveBeenCalledTimes(1);
    expect(h.warn.mock.calls[0][0]).toMatch(/contracargo/);
    expect(h.warn.mock.calls[0][0]).toMatch(/cierre por reembolso total hecho/);
    expect(h.warn.mock.calls[0][0]).not.toMatch(/no se toca/);
    expect(h.notice).not.toHaveBeenCalled();
  });

  it('`onFullRefund` va ANTES de `Order → refunded` (un solo orden de candados con el webhook)', async () => {
    const h = harness({ transitioned: 1, statusAfter: 'refunded' });
    await confirm(h);
    expect(h.onFullRefund.mock.invocationCallOrder[0]).toBeLessThan(h.orderUpdateMany.mock.invocationCallOrder[0]);
    expect(h.orderUpdateMany).toHaveBeenCalledWith({ where: { id: 'o1', status: 'settled' }, data: expect.objectContaining({ status: 'refunded' }) });
  });

  it('`count 1` ⇒ transicionó ⇒ AV-3 una vez, sin logs', async () => {
    const h = harness({ transitioned: 1, statusAfter: 'refunded' });
    await confirm(h);
    expect(h.notice).toHaveBeenCalledTimes(1);
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it('`count 0` ∧ `refunded` ⇒ éxito (el webhook llegó antes, M5): sin AV-3, sin logs', async () => {
    const h = harness({ transitioned: 0, statusAfter: 'refunded' });
    await confirm(h);
    expect(h.onFullRefund).toHaveBeenCalledTimes(1);
    expect(h.notice).not.toHaveBeenCalled();
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.error).not.toHaveBeenCalled();
  });

  it.each(['failed', 'pending'])('`count 0` ∧ `%s` (inalcanzable desde `settled`) ⇒ `logger.error`, sin AV-3', async (st) => {
    const h = harness({ transitioned: 0, statusAfter: st });
    await confirm(h);
    expect(h.error).toHaveBeenCalledTimes(1);
    expect(h.error.mock.calls[0][0]).toMatch(new RegExp(st));
    expect(h.warn).not.toHaveBeenCalled();
    expect(h.notice).not.toHaveBeenCalled();
  });
});
