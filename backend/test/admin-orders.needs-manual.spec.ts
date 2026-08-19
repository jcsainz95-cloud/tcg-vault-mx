import { AdminOrdersController } from '../src/modules/orders/admin-orders.controller';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';

/**
 * v1.21.2 (§M3, aditivo) — `GET /admin/orders?needsManual=true`: la **cola de contracargos por
 * resolver**. Sin ella, el desenlace humano (`chargeback-inventory`) existe pero nadie sabría
 * cuándo llamarlo: la pieza congelada se quedaría congelada para siempre, que es exactamente el
 * daño que el congelamiento quería evitar.
 *
 * Es un filtro OPCIONAL sobre un listado que ya existía: sin el parámetro, el comportamiento y la
 * forma de la respuesta no cambian.
 */
describe('GET /admin/orders?needsManual', () => {
  function build() {
    const rows = [
      { id: 'o1', guestEmail: 'a@b.com', chargebackNeedsManual: true },
      { id: 'o2', guestEmail: null, chargebackNeedsManual: false },
    ];
    const prisma: any = {
      order: {
        findMany: jest.fn(async ({ where }: any) =>
          rows.filter((r) =>
            where.chargebackNeedsManual === undefined
              ? true
              : r.chargebackNeedsManual === where.chargebackNeedsManual,
          ),
        ),
        count: jest.fn(async () => 2),
      },
    };
    const ctrl = new AdminOrdersController(
      {} as OrdersService,
      prisma as PrismaService,
      {} as StripeService,
      { log: jest.fn() } as unknown as AuditService,
      {} as GuestOrderMailService,
    );
    return { ctrl, prisma };
  }

  const whereOf = (prisma: any) => prisma.order.findMany.mock.calls[0][0].where;

  it('`needsManual=true` filtra la cola de contracargos por resolver', async () => {
    const { ctrl, prisma } = build();
    const res = await ctrl.list(undefined, undefined, undefined, undefined, undefined, 'true');
    expect(whereOf(prisma)).toMatchObject({ chargebackNeedsManual: true });
    expect(res.data.map((o) => o.id)).toEqual(['o1']);
  });

  it('`needsManual=false` devuelve las ya resueltas', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(undefined, undefined, undefined, undefined, undefined, 'false');
    expect(whereOf(prisma)).toMatchObject({ chargebackNeedsManual: false });
  });

  it('SIN el parámetro el listado no cambia (comportamiento por defecto idéntico)', async () => {
    const { ctrl, prisma } = build();
    const res = await ctrl.list();
    expect(whereOf(prisma)).not.toHaveProperty('chargebackNeedsManual');
    expect(res.data).toHaveLength(2);
    // La forma de la respuesta tampoco cambia.
    expect(Object.keys(res).sort()).toEqual(['data', 'page', 'pageSize', 'total']);
  });

  it('un valor arbitrario NO filtra (no se inventan semánticas)', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(undefined, undefined, undefined, undefined, undefined, 'sí');
    expect(whereOf(prisma)).not.toHaveProperty('chargebackNeedsManual');
  });

  it('se combina con los filtros existentes sin pisarlos', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list('chargeback', undefined, undefined, undefined, 'true', 'true');
    expect(whereOf(prisma)).toMatchObject({
      status: 'chargeback',
      guestEmail: { not: null },
      chargebackNeedsManual: true,
    });
  });

  it('cada fila sigue trayendo `isGuestOrder` (proyección sin cambios)', async () => {
    const { ctrl } = build();
    const res = await ctrl.list(undefined, undefined, undefined, undefined, undefined, 'true');
    expect(res.data[0]).toMatchObject({ id: 'o1', isGuestOrder: true });
  });
});
