import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * ⭐⭐ API_CONTRACT §M4-VAULT.2-bis.1 (v1.79.4) — EL SETTLE ES UN CAS. Pruebas 36(a) y 38(iii) (unidad).
 *
 * `tx.order.updateMany({ where: { id, status: { in: ['pending','failed'] } }, data })` como PRIMERA escritura de
 * la transacción, en las DOS ramas (`vault` y `settleDirectShipOrder`). `count === 0` ⇒ el perdedor de
 * la carrera ⛔ no escribe nada más (ni piezas, ni movimientos, ni colocación, ni envío) y ⛔ no avisa
 * (ni `AV-2`, ni confirmación de invitado, ni auditoría de anomalías). La mitad Postgres real (la
 * carrera con entrelazado forzado y el trigger de re-liquidaciones) vive en
 * `test/integration/vault-placement-birth.e2e-spec.ts` (35, 37, 38).
 *
 * ⭐⭐ v1.80 (§M4-VAULT.2-bis.2, `SEC-SETTLE-LATE`) — **38 (iii) ENMENDADA:** el `WHERE` es exactamente
 * `{ id, status: { in: ['pending','failed'] } }` (la constante `SETTLEABLE_ORDER_STATUSES`), ⛔ ya no
 * `{ not: 'settled' }`. Lo demás de la 38 (iii) no cambia: primera escritura, y en `vault` el `data` es
 * exactamente `{ status, settledAt }`. La tabla de estados (SL-5) y el canario de lista cerrada (SL-6)
 * viven en `test/payments.settle-late.spec.ts`.
 */

const piOf = (id: string, amount: number) => ({ id, amount, amount_received: amount, currency: 'mxn' }) as any;

function harness(opts: { won: 0 | 1; anomaly?: boolean }) {
  const ops: string[] = [];
  const rec =
    (op: string, impl: (a: any) => any = () => ({})) =>
    jest.fn(async (a: any) => {
      ops.push(op);
      return impl(a);
    });
  const tx = {
    order: {
      update: rec('order.update'),
      updateMany: rec('order.updateMany', () => ({ count: opts.won })),
    },
    inventoryItem: {
      findUnique: rec('inventoryItem.findUnique', ({ where }) => ({
        id: where.id,
        status: opts.anomaly ? 'withdrawn' : 'reserved',
        ownerUserId: 'u1',
      })),
      updateMany: rec('inventoryItem.updateMany', () => ({ count: opts.anomaly ? 0 : 1 })),
    },
    inventoryMovement: { create: rec('inventoryMovement.create') },
    shipmentRequest: {
      findFirst: rec('shipmentRequest.findFirst', () => null),
      create: rec('shipmentRequest.create'),
    },
    vaultPlacement: {
      createMany: rec('vaultPlacement.createMany', () => ({ count: 1 })),
      findUniqueOrThrow: rec('vaultPlacement.findUniqueOrThrow', () => ({ id: 'vp1' })),
    },
    vaultPlacementItem: { createMany: rec('vaultPlacementItem.createMany', () => ({ count: 1 })) },
  };
  const sent: MailMessage[] = [];
  const mail: MailPort = {
    send: jest.fn(async (m: MailMessage) => {
      sent.push(m);
    }),
  } as unknown as MailPort;
  const guestMail = { sendConfirmation: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const prisma: any = {
    order: { findUnique: jest.fn() },
    user: {
      findUnique: jest.fn().mockResolvedValue({ email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null }),
    },
    shipmentRequest: { findUnique: jest.fn().mockResolvedValue(null), updateMany: jest.fn() },
    $transaction: jest.fn(async (cb: any) => cb(tx)),
  };
  const svc = new PaymentsService(
    prisma as unknown as PrismaService,
    { getCardDetails: jest.fn().mockResolvedValue({ brand: 'visa', last4: '4242' }) } as unknown as StripeService,
    guestMail as unknown as GuestOrderMailService,
    audit as unknown as AuditService,
    mail,
  );
  return { svc, prisma, tx, ops, sent, guestMail, audit };
}

const order = (over: Record<string, unknown>) => ({
  id: 'o1',
  orderNumber: 'TCG-000001',
  userId: 'u1',
  guestEmail: null,
  locale: 'es',
  fulfillmentMode: 'vault',
  status: 'pending',
  totalCents: 1000,
  stripePaymentIntentId: 'pi_1',
  shippingAddressSnapshot: { line1: 'x' },
  items: [{ id: 'oi1', inventoryItemId: 'item1', cardSnapshot: {} }],
  ...over,
});

const WRITES_AFTER_CLAIM = [
  'inventoryItem.updateMany',
  'inventoryMovement.create',
  'vaultPlacement.createMany',
  'vaultPlacementItem.createMany',
  'shipmentRequest.create',
];

type Over = { fulfillmentMode: string; userId?: string | null; guestEmail?: string | null };
describe.each<[string, Over]>([
  ['vault (registrado)', { fulfillmentMode: 'vault' }],
  ['direct_ship registrado', { fulfillmentMode: 'direct_ship' }],
  ['direct_ship invitado', { fulfillmentMode: 'direct_ship', userId: null, guestEmail: 'g@x.mx' }],
])('settle %s', (_n, over) => {
  it('38(iii) v1.80 — la PRIMERA escritura de la tx es order.updateMany con where EXACTO { id, status: { in: [pending, failed] } }', async () => {
    const h = harness({ won: 1 });
    h.prisma.order.findUnique.mockResolvedValue(order(over));
    await h.svc.onPaymentSucceeded(piOf('pi_1', 1000));
    expect(h.tx.order.update).not.toHaveBeenCalled();
    expect(h.tx.order.updateMany).toHaveBeenCalledTimes(1);
    const arg = h.tx.order.updateMany.mock.calls[0][0];
    // ⛔ literal, no la constante: si alguien ampliara la lista, esta aserción también lo diría.
    expect(arg.where).toEqual({ id: 'o1', status: { in: ['pending', 'failed'] } });
    const firstWrite = h.ops.find((o) => !o.endsWith('findUnique') && !o.endsWith('findFirst'));
    expect(firstWrite).toBe('order.updateMany');
    if (over.fulfillmentMode === 'vault') {
      // ⛔ cero dinero: el `data` sigue siendo exactamente { status, settledAt }
      expect(arg.data).toEqual({ status: 'settled', settledAt: expect.any(Date) });
    } else {
      expect(arg.data).toEqual({
        status: 'settled',
        settledAt: expect.any(Date),
        paymentMethodBrand: 'visa',
        paymentMethodLast4: '4242',
      });
    }
  });

  it('36(a) — GANA (count 1): lo de hoy — escribe y avisa UNA vez', async () => {
    const h = harness({ won: 1 });
    h.prisma.order.findUnique.mockResolvedValue(order(over));
    await h.svc.onPaymentSucceeded(piOf('pi_1', 1000));
    expect(h.ops).toContain('inventoryItem.updateMany');
    const guest = over.guestEmail != null;
    expect(h.sent).toHaveLength(guest ? 0 : 1); // AV-2 solo al registrado
    expect(h.guestMail.sendConfirmation).toHaveBeenCalledTimes(over.fulfillmentMode === 'direct_ship' ? 1 : 0);
  });

  it('⭐⭐ 36(a) — PIERDE (count 0): ⛔ cero escrituras más, ⛔ cero AV-2, ⛔ cero confirmación de invitado, ⛔ cero auditoría', async () => {
    const h = harness({ won: 0, anomaly: true });
    h.prisma.order.findUnique.mockResolvedValue(order(over));
    await expect(h.svc.onPaymentSucceeded(piOf('pi_1', 1000))).resolves.toBeUndefined();
    for (const w of WRITES_AFTER_CLAIM) expect([w, h.ops.includes(w)]).toEqual([w, false]);
    expect(h.sent).toHaveLength(0);
    expect(h.guestMail.sendConfirmation).not.toHaveBeenCalled();
    expect(h.audit.log).not.toHaveBeenCalled();
  });
});
