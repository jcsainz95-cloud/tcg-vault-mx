import { OrderStatus } from '@prisma/client';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { CHARGE_REFUNDED_SOURCE_STATUSES, SETTLEABLE_ORDER_STATUSES } from '../src/modules/payments/settleable-order-statuses';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { MailPort } from '../src/modules/mail/mail.port';

/**
 * ⭐⭐ API_CONTRACT §M4-VAULT.2-bis.2 (v1.80) — `SEC-SETTLE-LATE`: QUÉ ESTADOS SE LIQUIDAN. Mitad UNIDAD
 * (SL-5 y SL-6), determinista, con doble de Prisma. La mitad Postgres real + webhook firmado (SL-1…SL-4,
 * SL-7) vive en `test/integration/settle-late.e2e-spec.ts`.
 *
 * La norma: UNA constante cerrada `SETTLEABLE_ORDER_STATUSES = ['pending','failed']`; el CAS del settle
 * (ramas `vault` y `direct_ship`) filtra `status: { in: [...] }` y el early-return es su negación EXACTA
 * con la MISMA constante. Un `succeeded` con la orden fuera de la lista ⇒ `200`, ⛔ cero transacción,
 * ⛔ cero `getCardDetails`, ⛔ cero avisos, ⛔ cero `audit.log`; `logger.warn` SOLO en `refunded`/`chargeback`.
 */

const piOf = (id: string, amount: number) => ({ id, amount, amount_received: amount, currency: 'mxn' }) as any;

function harness() {
  const tx = {
    order: { update: jest.fn(), updateMany: jest.fn(async (_a: any) => ({ count: 1 })) },
    inventoryItem: {
      findUnique: jest.fn(async ({ where }: any) => ({ id: where.id, status: 'reserved', ownerUserId: 'u1' })),
      updateMany: jest.fn(async () => ({ count: 1 })),
    },
    inventoryMovement: { create: jest.fn() },
    shipmentRequest: { findFirst: jest.fn(async () => null), create: jest.fn() },
    vaultPlacement: {
      createMany: jest.fn(async () => ({ count: 1 })),
      findUniqueOrThrow: jest.fn(async () => ({ id: 'vp1' })),
    },
    vaultPlacementItem: { createMany: jest.fn(async () => ({ count: 1 })) },
  };
  const mail = { send: jest.fn(async () => ({})) } as unknown as MailPort & { send: jest.Mock };
  const guestMail = { sendConfirmation: jest.fn().mockResolvedValue(undefined) };
  const audit = { log: jest.fn().mockResolvedValue(undefined) };
  const stripe = { getCardDetails: jest.fn().mockResolvedValue({ brand: 'visa', last4: '4242' }) };
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
    stripe as unknown as StripeService,
    guestMail as unknown as GuestOrderMailService,
    audit as unknown as AuditService,
    mail,
  );
  const warn = jest.spyOn((svc as any).logger, 'warn').mockImplementation(() => undefined);
  jest.spyOn((svc as any).logger, 'error').mockImplementation(() => undefined);
  return { svc, prisma, tx, mail, guestMail, audit, stripe, warn };
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
  settledAt: null,
  items: [{ id: 'oi1', inventoryItemId: 'item1', cardSnapshot: {} }],
  ...over,
});

const settleLateWarns = (warn: jest.SpyInstance) =>
  warn.mock.calls.filter(([m]) => typeof m === 'string' && m.startsWith('SEC-SETTLE-LATE')).length;

/**
 * La tabla del contrato, ESCRITA A MANO (⛔ no derivada de la constante: si se derivara, una constante
 * mal cambiada se daría la razón a sí misma). `warn` = ¿deja la huella `logger.warn`?
 */
const TABLA: Record<string, { liquidable: boolean; warn: boolean }> = {
  pending: { liquidable: true, warn: false },
  failed: { liquidable: true, warn: false },
  settled: { liquidable: false, warn: false },
  refunded: { liquidable: false, warn: true },
  chargeback: { liquidable: false, warn: true },
};

type Over = { fulfillmentMode: string; userId?: string | null; guestEmail?: string | null };
describe.each<[string, Over]>([
  ['vault (registrado)', { fulfillmentMode: 'vault' }],
  ['direct_ship registrado', { fulfillmentMode: 'direct_ship' }],
  ['direct_ship invitado', { fulfillmentMode: 'direct_ship', userId: null, guestEmail: 'g@x.mx' }],
])('⭐⭐ SL-5 — tabla de estados del settle, %s', (_n, over) => {
  it.each(Object.entries(TABLA))('%s', async (status, fila) => {
    const h = harness();
    h.prisma.order.findUnique.mockResolvedValue(order({ ...over, status }));
    await expect(h.svc.onPaymentSucceeded(piOf('pi_1', 1000))).resolves.toBeUndefined();

    if (fila.liquidable) {
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(h.tx.order.updateMany).toHaveBeenCalledTimes(1);
      // El CAS lleva la lista, literal (mismo predicado para el early-return que dejó pasar este estado).
      expect(h.tx.order.updateMany.mock.calls[0][0]).toMatchObject({
        where: { id: 'o1', status: { in: ['pending', 'failed'] } },
      });
    } else {
      expect(h.prisma.$transaction).toHaveBeenCalledTimes(0);
      expect(h.tx.order.updateMany).toHaveBeenCalledTimes(0);
      expect(h.tx.order.update).toHaveBeenCalledTimes(0);
      expect(h.stripe.getCardDetails).toHaveBeenCalledTimes(0);
      expect(h.mail.send).toHaveBeenCalledTimes(0);
      expect(h.guestMail.sendConfirmation).toHaveBeenCalledTimes(0);
      expect(h.audit.log).toHaveBeenCalledTimes(0);
    }
    expect(settleLateWarns(h.warn)).toBe(fila.warn ? 1 : 0);
    if (fila.warn) {
      const [msg] = h.warn.mock.calls.find(([m]) => String(m).startsWith('SEC-SETTLE-LATE'))!;
      expect(msg).toContain('TCG-000001');
      expect(msg).toContain(status);
      expect(msg).toContain('pi_1');
    }
  });

  it('el warn de SEC-SETTLE-LATE usa el id cuando no hay orderNumber', async () => {
    const h = harness();
    h.prisma.order.findUnique.mockResolvedValue(order({ ...over, status: 'chargeback', orderNumber: null }));
    await h.svc.onPaymentSucceeded(piOf('pi_1', 1000));
    expect(settleLateWarns(h.warn)).toBe(1);
    expect(String(h.warn.mock.calls[0][0])).toContain('o1');
  });

  it('⛔ el tardío sale ANTES de H1: un importe que no cuadra sobre una orden `chargeback` tampoco audita', async () => {
    const h = harness();
    h.prisma.order.findUnique.mockResolvedValue(order({ ...over, status: 'chargeback' }));
    await h.svc.onPaymentSucceeded(piOf('pi_1', 999));
    expect(h.audit.log).toHaveBeenCalledTimes(0);
    expect(h.prisma.$transaction).toHaveBeenCalledTimes(0);
  });
});

describe('⭐⭐ SL-6 — canario de lista CERRADA: todo valor de OrderStatus está decidido', () => {
  // Una fila EXPLÍCITA por valor del enum. Un valor nuevo sin fila ⇒ rojo: se decide, ⛔ no se hereda.
  const DECIDIDO: Record<string, 'sí' | 'no'> = {
    pending: 'sí',
    failed: 'sí',
    settled: 'no',
    refunded: 'no',
    chargeback: 'no',
  };

  it('cada valor del enum tiene fila, y la fila coincide con SETTLEABLE_ORDER_STATUSES', () => {
    const enumValues = Object.values(OrderStatus) as string[];
    const sinFila = enumValues.filter((v) => !(v in DECIDIDO));
    expect(sinFila).toEqual([]);
    for (const v of enumValues) {
      expect([v, (SETTLEABLE_ORDER_STATUSES as readonly string[]).includes(v)]).toEqual([v, DECIDIDO[v] === 'sí']);
    }
    // Y la constante no nombra nada fuera del enum (ni repetidos).
    expect([...SETTLEABLE_ORDER_STATUSES].sort()).toEqual(['failed', 'pending']);
  });

  it('la tabla de SL-5 cubre los mismos valores que el enum (una tabla nueva no se queda atrás)', () => {
    expect(Object.keys(TABLA).sort()).toEqual((Object.values(OrderStatus) as string[]).sort());
  });
});

describe('🔒💰 SL-11 (v1.80.8.3) — canario de `CHARGE_REFUNDED_SOURCE_STATUSES`: todo OrderStatus decidido', () => {
  // Desde qué estados un `charge.refunded` TOTAL lleva la orden a `refunded` (§M4-SHIP.18.2 bloque v1.80.8.3).
  // Una fila EXPLÍCITA por valor del enum: un valor nuevo sin fila ⇒ rojo (se decide, ⛔ no se hereda).
  const FUENTE_DE_REEMBOLSO_TOTAL: Record<string, 'sí' | 'no'> = {
    pending: 'sí',
    failed: 'sí',
    settled: 'sí',
    refunded: 'no',
    chargeback: 'no',
  };

  it('cada valor del enum tiene fila, y la fila coincide con CHARGE_REFUNDED_SOURCE_STATUSES', () => {
    const enumValues = Object.values(OrderStatus) as string[];
    expect(enumValues.filter((v) => !(v in FUENTE_DE_REEMBOLSO_TOTAL))).toEqual([]);
    for (const v of enumValues) {
      expect([v, (CHARGE_REFUNDED_SOURCE_STATUSES as readonly string[]).includes(v)]).toEqual([
        v,
        FUENTE_DE_REEMBOLSO_TOTAL[v] === 'sí',
      ]);
    }
    expect([...CHARGE_REFUNDED_SOURCE_STATUSES].sort()).toEqual(['failed', 'pending', 'settled']);
  });

  it('relación FIJA: CHARGE_REFUNDED_SOURCE_STATUSES = SETTLEABLE_ORDER_STATUSES ∪ {settled}', () => {
    const union = [...new Set([...SETTLEABLE_ORDER_STATUSES, 'settled'])].sort();
    expect([...new Set(CHARGE_REFUNDED_SOURCE_STATUSES)].sort()).toEqual(union);
    expect(CHARGE_REFUNDED_SOURCE_STATUSES).toHaveLength(union.length); // sin repetidos
  });
});
