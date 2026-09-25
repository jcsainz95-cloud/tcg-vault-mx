import Stripe from 'stripe';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailMessage, MailPort } from '../src/modules/mail/mail.port';

/**
 * # `C-AV-5` — EL REGISTRADO RECIBE CONFIRMACIÓN, IGUAL QUE EL INVITADO (criterio 200)
 *
 * > **Dos pedidos idénticos**, uno de invitado y uno de registrado: **las dos bandejas reciben**, y
 * > **ninguna recibe dos**.
 *
 * El hueco que cierra, medido: `guest-order-mail.service.ts` arranca con
 * `if (!order.guestEmail) return null` ⇒ **el cliente con cuenta no recibía nada al liquidar**.
 * `AV-2` es **la negación exacta** de ese `if`, y esa exclusividad es lo que sostiene el criterio
 * **206**, que falla **por exceso**.
 *
 * Cubre además la mitad de `C-AV-10` que toca al webhook: **con el puerto lanzando siempre, el
 * settle liquida y `handleEvent` NO propaga** — *un 5xx haría que Stripe reintentara un settle ya
 * aplicado*.
 */

function buildPayments(opts: {
  order: Record<string, unknown> | null;
  user?: Record<string, unknown> | null;
  mail?: 'ok' | 'throwing';
}) {
  const sent: MailMessage[] = [];
  const guestSent: string[] = [];
  const row: Record<string, unknown> = { ...(opts.order ?? {}) };
  const tx = {
    order: { update: jest.fn().mockImplementation(async ({ data }) => Object.assign(row, data)) },
    inventoryItem: {
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    inventoryMovement: { create: jest.fn() },
    // v1.79 (M-59, §M4-VAULT.2-bis/.6): la liquidación `vault` crea su colocación y el contracargo
    // `vault` la cancela, en la MISMA tx. Dobles inertes: su forma la fija payments.vault-placement-birth.spec.ts.
    vaultPlacement: {
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'vp1' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    vaultPlacementItem: { createMany: jest.fn().mockResolvedValue({ count: 1 }) },
  };
  const prisma: any = {
    order: {
      findUnique: jest.fn().mockImplementation(async () => (opts.order ? { ...row } : null)),
      update: jest.fn().mockImplementation(async ({ data }) => Object.assign(row, data)),
    },
    user: { findUnique: jest.fn().mockResolvedValue(opts.user ?? null) },
    processedStripeEvent: { create: jest.fn(), delete: jest.fn() },
    $transaction: jest.fn().mockImplementation(async (cb: any) => cb(tx)),
  };
  const guestMail = {
    // El correo del INVITADO que ya existía: se instrumenta para contar las dos bandejas por separado.
    sendConfirmation: jest.fn().mockImplementation(async (o: any) => {
      if (o.guestEmail) guestSent.push(o.guestEmail);
    }),
  } as unknown as GuestOrderMailService;
  const mail: MailPort = {
    send: jest.fn().mockImplementation(async (m: MailMessage) => {
      if (opts.mail === 'throwing') throw new Error('resend is down');
      sent.push(m);
      return {};
    }),
  };
  const svc = new PaymentsService(
    prisma as PrismaService,
    {} as StripeService,
    guestMail,
    { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService,
    mail,
  );
  return { svc, sent, guestSent, row, prisma };
}

const BASE_ORDER = {
  id: 'ord-1',
  orderNumber: 'TCG-1001',
  status: 'pending',
  totalCents: 148000,
  currency: 'mxn',
  fulfillmentMode: 'vault',
  locale: 'es',
  items: [{ inventoryItemId: 'it-1', cardSnapshot: { name: 'Charizard VMAX', setName: 'DAA', number: '020' } }],
};
const PI = (amount: number) =>
  ({ id: 'pi_1', amount, amount_received: amount, currency: 'mxn' }) as unknown as Stripe.PaymentIntent;

describe('⭐ C-AV-5 — las dos bandejas reciben, y ninguna recibe dos', () => {
  it('REGISTRADO (`guestEmail == null`, `userId != null`) ⇒ recibe `AV-2`, y el correo de invitado NO se manda', async () => {
    const { svc, sent, guestSent } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onPaymentSucceeded(PI(148000));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ash@pallet.mx');
    expect(guestSent).toHaveLength(0);
  });

  it('INVITADO (`guestEmail != null`) ⇒ recibe el de siempre, y ⛔ NO recibe además `AV-2`', async () => {
    const { svc, sent, guestSent } = buildPayments({
      order: { ...BASE_ORDER, fulfillmentMode: 'direct_ship', guestEmail: 'guest@correo.mx', userId: null },
    });
    // La ruta `direct_ship` completa toca inventario; aquí se mide el reparto de correos, que es lo
    // que el criterio 200 norma, invocando el mismo punto de decisión.
    await svc['notifyOrderSettled']({ ...BASE_ORDER, guestEmail: 'guest@correo.mx', userId: null } as never);
    expect(sent).toHaveLength(0); // ⛔ el registrado NO se dispara para un pedido de invitado
    expect(guestSent).toHaveLength(0);
  });

  it('⛔ pedido SIN dueño y SIN invitado ⇒ cero correos (no se adivina)', async () => {
    const { svc, sent } = buildPayments({ order: { ...BASE_ORDER, guestEmail: null, userId: null } });
    await svc['notifyOrderSettled']({ ...BASE_ORDER, guestEmail: null, userId: null } as never);
    expect(sent).toHaveLength(0);
  });

  it('⛔ cuenta ANONIMIZADA ⇒ cero correos (§R.5.a)', async () => {
    const { svc, sent } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: new Date() },
    });
    await svc.onPaymentSucceeded(PI(148000));
    expect(sent).toHaveLength(0);
  });

  it('el correo repite el TOTAL PERSISTIDO al centavo (criterio 207)', async () => {
    const { svc, sent } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1', totalCents: 148099 },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onPaymentSucceeded(PI(148099));
    expect(sent[0].text).toContain('1,480.99');
  });

  it('⛔ un reintento del webhook NO manda un segundo correo (early-return por `settled`)', async () => {
    const { svc, sent, row } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onPaymentSucceeded(PI(148000));
    expect(sent).toHaveLength(1);
    expect(row.status).toBe('settled');
    await svc.onPaymentSucceeded(PI(148000)); // Stripe reintenta
    expect(sent).toHaveLength(1); // ⇐ la «una sola vez» sin estrenar columna
  });

  it('⛔ un descuadre de monto NO liquida y NO avisa (el correo no puede ir por delante del dinero)', async () => {
    const { svc, sent, row } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onPaymentSucceeded(PI(999));
    expect(row.status).toBe('pending');
    expect(sent).toHaveLength(0);
  });
});

describe('AV-3 — el reembolso, y solo el TOTAL', () => {
  const charge = (amount: number, refunded: number) =>
    ({ payment_intent: 'pi_1', amount, amount_refunded: refunded }) as unknown as Stripe.Charge;

  it('reembolso TOTAL ⇒ un correo a `guestEmail ?? user.email`, con el total persistido', async () => {
    const { svc, sent } = buildPayments({
      order: { ...BASE_ORDER, status: 'settled', guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onChargeRefunded(charge(148000, 148000));
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('ash@pallet.mx');
    expect(sent[0].text).toContain('1,480.00');
  });

  it('⭐ con `guestEmail` presente, GANA `guestEmail` (§R.5)', async () => {
    const { svc, sent } = buildPayments({
      order: { ...BASE_ORDER, status: 'settled', guestEmail: 'guest@correo.mx', userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onChargeRefunded(charge(148000, 148000));
    expect(sent[0].to).toBe('guest@correo.mx');
  });

  it('⛔ reembolso PARCIAL ⇒ CERO correos (no transiciona ⇒ no hay hecho del que colgar un aviso)', async () => {
    const { svc, sent, row } = buildPayments({
      order: { ...BASE_ORDER, status: 'settled', guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onChargeRefunded(charge(148000, 1000));
    expect(sent).toHaveLength(0);
    expect(row.status).toBe('settled');
  });

  it('⛔ un segundo `charge.refunded` NO duplica (early-return por `refunded`)', async () => {
    const { svc, sent } = buildPayments({
      order: { ...BASE_ORDER, status: 'settled', guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
    });
    await svc.onChargeRefunded(charge(148000, 148000));
    await svc.onChargeRefunded(charge(148000, 148000));
    expect(sent).toHaveLength(1);
  });
});

describe('⭐⭐ C-AV-10 — con el `MailPort` LANZANDO SIEMPRE, el dinero se aplica igual', () => {
  it('el settle liquida y ⛔ no propaga (si propagara, Stripe reintentaría un settle ya aplicado)', async () => {
    const { svc, row } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
      mail: 'throwing',
    });
    await expect(svc.onPaymentSucceeded(PI(148000))).resolves.toBeUndefined();
    expect(row.status).toBe('settled');
  });

  it('el reembolso transiciona y ⛔ no propaga', async () => {
    const { svc, row } = buildPayments({
      order: { ...BASE_ORDER, status: 'settled', guestEmail: null, userId: 'u1' },
      user: { email: 'ash@pallet.mx', locale: 'es', anonymizedAt: null },
      mail: 'throwing',
    });
    await expect(
      svc.onChargeRefunded({ payment_intent: 'pi_1', amount: 148000, amount_refunded: 148000 } as unknown as Stripe.Charge),
    ).resolves.toBeUndefined();
    expect(row.status).toBe('refunded');
  });

  it('⚠️ y el fallo que este candado cazó de verdad: la lectura del DESTINATARIO va dentro del try', async () => {
    // Con `prisma.user` **ausente** (mock incompleto) el settle tiene que seguir liquidando. Fuera
    // del `try`, esa lectura convertía un hipo de la BD en un `500` del webhook sobre dinero ya
    // escrito. *Dos specs con el mock incompleto fueron el canario del fallo real.*
    const { svc, row, prisma } = buildPayments({
      order: { ...BASE_ORDER, guestEmail: null, userId: 'u1' },
      user: null,
    });
    delete (prisma as { user?: unknown }).user;
    await expect(svc.onPaymentSucceeded(PI(148000))).resolves.toBeUndefined();
    expect(row.status).toBe('settled');
  });
});
