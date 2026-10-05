/**
 * `refund-reason-max.e2e-spec.ts` — **v1.82 · PNL-6 (`R69-1`)**: `RefundDto.reason` con tope de 500.
 * POR HTTP, CONTRA POSTGRES REAL. Norma: `API_CONTRACT §PNL.6`; pruebas `§PNL.8` RFD-1/RFD-2.
 *
 * - **RFD-1** `POST /admin/orders/:id/refund` con `reason` de 501 ⇒ `400 VALIDATION_ERROR {field:'reason'}`;
 *   0 filas `PaymentRefund`, Stripe no llamado, la orden sigue `settled`.
 * - **RFD-2** `reason` de 500 ⇒ pasa la validación (el reembolso corre).
 */
import { E2EHarness } from './helpers/e2e-app';
import { seedE2E } from '../../prisma/seed-e2e';
import { ShipPrepDb } from './helpers/ship-prep-db';
import { MAIL_PORT, MailPort } from '../../src/modules/mail/mail.port';

const RUN = `rfd${Date.now().toString(36)}`;

describe('E2E — v1.82 PNL-6 · `RefundDto.reason` ≤ 500', () => {
  let h: E2EHarness;
  let db: ShipPrepDb;
  let spy: jest.SpyInstance;

  beforeAll(async () => {
    h = await E2EHarness.create();
    await seedE2E(h.prisma);
    db = new ShipPrepDb(h, RUN);
    await db.init();
    spy = jest.spyOn(h.app.get<MailPort>(MAIL_PORT), 'send').mockImplementation(async () => ({}));
  });

  afterAll(async () => {
    spy?.mockRestore();
    await db.cleanup();
    await h?.close();
  });

  it('RFD-1 ⭐ `reason` de 501 ⇒ 400 VALIDATION_ERROR {field:"reason"}; 0 filas, 0 Stripe, orden intacta', async () => {
    const d = await db.mkDirect({ userId: null });
    const llamadas = h.stripe.refundCreateCalls.length;
    const res = await db.m3Refund(d.order.id, { reason: 'x'.repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details).toMatchObject({ field: 'reason', max: 500 });
    expect(await h.prisma.paymentRefund.count({ where: { orderId: d.order.id } })).toBe(0);
    expect(h.stripe.refundCreateCalls.length).toBe(llamadas);
    expect((await h.prisma.order.findUnique({ where: { id: d.order.id } }))!.status).toBe('settled');
  });

  it('RFD-2 `reason` de exactamente 500 ⇒ pasa la validación y el reembolso corre', async () => {
    const d = await db.mkDirect({ userId: null });
    const res = await db.m3Refund(d.order.id, { reason: 'y'.repeat(500) });
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    expect(await h.prisma.paymentRefund.count({ where: { orderId: d.order.id } })).toBeGreaterThan(0);
  });

  it('un `reason` no-string sigue siendo 400 del `@IsString()` de siempre (el tope no lo enmascara)', async () => {
    const d = await db.mkDirect({ userId: null });
    const res = await db.m3Refund(d.order.id, { reason: 42 });
    expect(res.status).toBe(400);
    expect(await h.prisma.paymentRefund.count({ where: { orderId: d.order.id } })).toBe(0);
  });
});
