import { OrderRefundService } from '../src/modules/orders/order-refund.service';
import { AdminOrdersController } from '../src/modules/orders/admin-orders.controller';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';

/**
 * QA MENOR-1 (2026-10-04) — `GET /admin/orders` (§M3, v1.80.8.6): la fila gana SOLO `refundReviewPending`. Las cinco
 * columnas del motivo «tras envío» (`fullRefundAfterShipment`, `shippedRefundReason`, `shippedRefundNote`,
 * `shippedRefundReasonAt`, `shippedRefundReasonByUserId`) ⛔ no viajan crudas en el listado; el detalle las expone
 * proyectadas en `fullRefundReview`. Mutación que la pone roja: devolver `fullRefundAfterShipment` o
 * `shippedRefundReason` al `...o` del listado.
 */
describe('GET /admin/orders — columnas del motivo «tras envío» fuera de la fila (MENOR-1)', () => {
  const RAW = [
    'fullRefundAfterShipment',
    'shippedRefundReason',
    'shippedRefundNote',
    'shippedRefundReasonAt',
    'shippedRefundReasonByUserId',
  ];

  function build() {
    const at = new Date('2026-10-04T10:00:00Z');
    const rows = [
      {
        id: 'pend',
        guestEmail: null,
        fullRefundClosedAt: at,
        fullRefundAfterShipment: true,
        shippedRefundReason: null,
        shippedRefundNote: null,
        shippedRefundReasonAt: null,
        shippedRefundReasonByUserId: null,
      },
      {
        id: 'rec',
        guestEmail: null,
        fullRefundClosedAt: at,
        fullRefundAfterShipment: true,
        shippedRefundReason: 'not_arrived',
        shippedRefundNote: 'n',
        shippedRefundReasonAt: at,
        shippedRefundReasonByUserId: 'u1',
      },
      {
        id: 'nosalio',
        guestEmail: 'a@b.com',
        fullRefundClosedAt: at,
        fullRefundAfterShipment: false,
        shippedRefundReason: null,
        shippedRefundNote: null,
        shippedRefundReasonAt: null,
        shippedRefundReasonByUserId: null,
      },
    ];
    const prisma: any = {
      order: { findMany: jest.fn(async () => rows), count: jest.fn(async () => rows.length) },
    };
    const ctrl = new AdminOrdersController(
      {} as OrdersService,
      prisma as PrismaService,
      { log: jest.fn() } as unknown as AuditService,
      {} as GuestOrderMailService,
      {} as OrderRefundService,
      { toDtos: jest.fn(async () => []) } as never,
      { dtosByIds: jest.fn(async () => []) } as never,
    );
    return ctrl;
  }

  it('ninguna de las cinco columnas crudas en ninguna fila', async () => {
    const res = await build().list();
    for (const row of res.data) for (const k of RAW) expect(row).not.toHaveProperty(k);
  });

  it('`refundReviewPending` sigue derivándose de las dos columnas quitadas (afterShipment ∧ sin motivo)', async () => {
    const res = await build().list();
    expect(res.data.map((r: any) => [r.id, r.refundReviewPending])).toEqual([
      ['pend', true],
      ['rec', false],
      ['nosalio', false],
    ]);
  });
});
