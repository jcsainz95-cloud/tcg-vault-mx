import { Role } from '@prisma/client';
import { OrderClaimService } from '../src/modules/orders/order-claim.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { OrderAccessTokenService } from '../src/modules/orders/order-access-token.service';

const ME = { id: 'user-1', role: Role.customer };

type OrderRow = {
  id: string;
  userId: string | null;
  guestEmail: string | null;
  claimedAt: Date | null;
  orderNumber: string;
  status: string;
  totalCents: number;
  createdAt: Date;
  settledAt: Date | null;
};

function buildService(opts: { emailVerified?: boolean; email?: string; orders?: OrderRow[] } = {}) {
  const orders: OrderRow[] = opts.orders ?? [
    {
      id: 'order-A',
      userId: null,
      guestEmail: 'juan@example.com',
      claimedAt: null,
      orderNumber: 'TCG-000001',
      status: 'settled',
      totalCents: 51812,
      createdAt: new Date('2026-08-01T00:00:00.000Z'),
      settledAt: new Date('2026-08-01T00:05:00.000Z'),
    },
  ];
  const prisma: any = {
    user: {
      findUnique: jest.fn(async () => ({
        email: opts.email ?? 'Juan@Example.com',
        emailVerified: opts.emailVerified ?? true,
      })),
    },
    order: {
      findMany: jest.fn(async ({ where }: any) =>
        orders
          .filter(
            (o) => o.guestEmail === where.guestEmail && o.userId === null && o.claimedAt === null,
          )
          .map((o) => ({ ...o, _count: { items: 2 } })),
      ),
      findUnique: jest.fn(async ({ where }: any) => orders.find((o) => o.id === where.id) ?? null),
      // UPDATE CONDICIONAL: solo gana quien cumple TODAS las condiciones (ganador único).
      updateMany: jest.fn(async ({ where, data }: any) => {
        const o = orders.find(
          (x) => x.id === where.id && x.userId === where.userId && x.guestEmail === where.guestEmail,
        );
        if (!o) return { count: 0 };
        o.userId = data.userId;
        o.claimedAt = data.claimedAt;
        return { count: 1 };
      }),
    },
  };
  const audit: any = { log: jest.fn(async () => undefined) };
  const tokens: any = { revokeAll: jest.fn(async () => 1) };
  const svc = new OrderClaimService(
    prisma as PrismaService,
    audit as AuditService,
    tokens as OrderAccessTokenService,
  );
  return { svc, prisma, audit, tokens, orders };
}

/** Reclamo del pedido (§4-G.9 / ARCHITECTURE §4.21f). */
describe('GET /orders/claimable', () => {
  it('lista los pedidos de invitado SIN reclamar con el correo verificado de la sesión', async () => {
    const { svc } = buildService();
    const res = await svc.listClaimable(ME.id);
    expect(res.data).toEqual([
      {
        orderId: 'order-A',
        orderNumber: 'TCG-000001',
        status: 'settled',
        totalCents: 51812,
        itemCount: 2,
        createdAt: new Date('2026-08-01T00:00:00.000Z'),
        settledAt: new Date('2026-08-01T00:05:00.000Z'),
      },
    ]);
  });

  it('normaliza el correo de la sesión antes de comparar (mayúsculas/espacios no cuentan)', async () => {
    const { svc, prisma } = buildService({ email: '  JUAN@EXAMPLE.COM  ' });
    await svc.listClaimable(ME.id);
    expect(prisma.order.findMany.mock.calls[0][0].where.guestEmail).toBe('juan@example.com');
  });

  it('con correo NO verificado no devuelve nada (la prueba de titularidad es el buzón)', async () => {
    const { svc } = buildService({ emailVerified: false });
    expect(await svc.listClaimable(ME.id)).toEqual({ data: [] });
  });

  it('nunca acepta un correo como parámetro (no es un oráculo)', () => {
    // La firma solo recibe el userId de la sesión: no hay forma de preguntar por un tercero.
    expect(OrderClaimService.prototype.listClaimable.length).toBe(1);
  });
});

describe('POST /orders/claim', () => {
  it('vincula el pedido (userId + claimedAt), revoca sus tokens y audita', async () => {
    const { svc, audit, tokens, orders } = buildService();
    const res = await svc.claim(ME, ['order-A']);
    expect(res).toEqual({ claimed: ['order-A'], failed: [] });
    expect(orders[0].userId).toBe(ME.id);
    expect(orders[0].claimedAt).toBeInstanceOf(Date);
    expect(tokens.revokeAll).toHaveBeenCalledWith('order-A', expect.any(Date));
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'order.claim', entityType: 'Order', entityId: 'order-A' }),
    );
  });

  it('el UPDATE es CONDICIONAL: `userId IS NULL AND guestEmail = :correoVerificado`', async () => {
    const { svc, prisma } = buildService();
    await svc.claim(ME, ['order-A']);
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'order-A', userId: null, guestEmail: 'juan@example.com' },
      }),
    );
  });

  it('SOLO UNA VEZ: un segundo reclamo del mismo pedido falla con ORDER_ALREADY_CLAIMED (criterio 55)', async () => {
    const { svc } = buildService();
    await svc.claim(ME, ['order-A']);
    const second = await svc.claim({ id: 'user-2', role: Role.customer }, ['order-A']);
    expect(second.claimed).toEqual([]);
    expect(second.failed).toEqual([{ orderId: 'order-A', code: 'ORDER_ALREADY_CLAIMED' }]);
  });

  it('correo distinto al del pedido ⇒ CLAIM_EMAIL_MISMATCH (no se puede robar un pedido ajeno)', async () => {
    const { svc } = buildService({ email: 'otro@example.com' });
    const res = await svc.claim(ME, ['order-A']);
    expect(res.claimed).toEqual([]);
    expect(res.failed).toEqual([{ orderId: 'order-A', code: 'CLAIM_EMAIL_MISMATCH' }]);
  });

  it('con correo NO verificado no reclama nada (registrarse con el correo de un tercero no basta)', async () => {
    const { svc, orders } = buildService({ emailVerified: false });
    const res = await svc.claim(ME, ['order-A']);
    expect(res.claimed).toEqual([]);
    expect(orders[0].userId).toBeNull();
  });

  it('un pedido que no existe ⇒ NOT_FOUND, y no tumba al resto del lote (parcial-tolerante)', async () => {
    const { svc } = buildService();
    const res = await svc.claim(ME, ['order-A', 'order-inexistente']);
    expect(res.claimed).toEqual(['order-A']);
    expect(res.failed).toEqual([{ orderId: 'order-inexistente', code: 'NOT_FOUND' }]);
  });

  it('un pedido con cuenta (no de invitado) no es reclamable', async () => {
    const { svc } = buildService({
      orders: [
        {
          id: 'order-cuenta',
          userId: 'otro-user',
          guestEmail: null,
          claimedAt: null,
          orderNumber: 'TCG-000002',
          status: 'settled',
          totalCents: 1000,
          createdAt: new Date(),
          settledAt: null,
        },
      ],
    });
    const res = await svc.claim(ME, ['order-cuenta']);
    expect(res.claimed).toEqual([]);
    expect(res.failed).toEqual([{ orderId: 'order-cuenta', code: 'NOT_FOUND' }]);
  });

  it('el reclamo NO cambia destino, precio, estado ni la propiedad de los items (criterio 54)', async () => {
    const { svc, prisma } = buildService();
    await svc.claim(ME, ['order-A']);
    // El único UPDATE es el condicional sobre Order con exactamente dos campos.
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
    expect(Object.keys(prisma.order.updateMany.mock.calls[0][0].data).sort()).toEqual(
      ['claimedAt', 'userId'].sort(),
    );
    expect(prisma.order.updateMany.mock.calls[0][0].data).not.toHaveProperty('fulfillmentMode');
    // No hay ninguna escritura sobre inventario en este servicio.
    expect((prisma as { inventoryItem?: unknown }).inventoryItem).toBeUndefined();
  });

  it('deduplica ids repetidos en el mismo lote', async () => {
    const { svc, prisma } = buildService();
    const res = await svc.claim(ME, ['order-A', 'order-A']);
    expect(res.claimed).toEqual(['order-A']);
    expect(prisma.order.updateMany).toHaveBeenCalledTimes(1);
  });
});
