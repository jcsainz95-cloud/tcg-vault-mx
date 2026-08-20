import { AdminOrdersController } from '../src/modules/orders/admin-orders.controller';
import { OrdersService } from '../src/modules/orders/orders.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { StripeService } from '../src/modules/payments/stripe.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { GuestOrderMailService } from '../src/modules/orders/guest-order-mail.service';

/**
 * v1.25-buylist-orders-pagination (§M3) — filtros server-side de `GET /admin/orders`: `q`
 * (folio/comprador, invitado y con cuenta) y rango de MONTO sobre `totalCents`. Aditivos y
 * opcionales; omitirlos = comportamiento de HOY. Se combinan con los filtros existentes
 * (`status`/`userId`/`from`/`to`/`guest`/`needsManual`) sin pisarlos. Validación → 400.
 *
 * Firma posicional de `list`:
 *   (status, userId, from, to, guest, needsManual, page, pageSize, q, minCents, maxCents)
 */

function build() {
  const rows = [{ id: 'o1', guestEmail: null }];
  const prisma: any = {
    order: {
      findMany: jest.fn(async () => rows),
      count: jest.fn(async () => rows.length),
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

describe('GET /admin/orders — filtros v1.25', () => {
  it('`q` → OR contains sobre orderNumber/guestEmail/user.name/user.email + userId EXACTO', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(
      undefined, undefined, undefined, undefined, undefined, undefined, '1', '20', 'ash',
    );
    expect(whereOf(prisma).OR).toEqual([
      { orderNumber: { contains: 'ash', mode: 'insensitive' } },
      { guestEmail: { contains: 'ash', mode: 'insensitive' } },
      { userId: 'ash' },
      { user: { name: { contains: 'ash', mode: 'insensitive' } } },
      { user: { email: { contains: 'ash', mode: 'insensitive' } } },
    ]);
  });

  it('`minCents`/`maxCents` → where.totalCents gte/lte', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(
      undefined, undefined, undefined, undefined, undefined, undefined, '1', '20', undefined,
      '1000', '5000',
    );
    expect(whereOf(prisma).totalCents).toEqual({ gte: 1000, lte: 5000 });
  });

  it('se combina con los filtros existentes (status + q) sin pisarlos', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(
      'settled', undefined, undefined, undefined, 'true', undefined, '1', '20', 'foo',
    );
    const where = whereOf(prisma);
    expect(where.status).toBe('settled');
    expect(where.guestEmail).toEqual({ not: null });
    expect(where.OR).toHaveLength(5);
  });

  it('SIN params nuevos el listado no cambia (comportamiento por defecto idéntico)', async () => {
    const { ctrl, prisma } = build();
    const res = await ctrl.list();
    const where = whereOf(prisma);
    expect(where).not.toHaveProperty('OR');
    expect(where).not.toHaveProperty('totalCents');
    expect(Object.keys(res).sort()).toEqual(['data', 'page', 'pageSize', 'total']);
    expect(res.data[0]).toMatchObject({ id: 'o1', isGuestOrder: false });
  });

  it('`from`/`to` siguen aplicando sobre createdAt (paridad con buylist)', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(
      undefined, undefined, '2026-08-01T00:00:00Z', '2026-08-20T00:00:00Z',
    );
    expect(whereOf(prisma).createdAt).toEqual({
      gte: new Date('2026-08-01T00:00:00Z'),
      lte: new Date('2026-08-20T00:00:00Z'),
    });
  });

  it('v1.25.1: `to` date-only ancla `lte` a fin de día INCLUSIVO → incluye una orden de esa tarde', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(undefined, undefined, undefined, '2026-08-20');
    const { createdAt } = whereOf(prisma);
    // Fin de día UTC inclusivo, NO medianoche (que excluiría casi toda la jornada money-adjacent).
    expect(createdAt).toEqual({ lte: new Date('2026-08-20T23:59:59.999Z') });
    // Una orden cerrada esa tarde queda DENTRO del rango (antes se excluía por medianoche).
    const afternoonRow = new Date('2026-08-20T15:00:00Z');
    expect(afternoonRow <= createdAt.lte).toBe(true);
  });

  it('v1.25.1: `from`/`to` datetime completo se usa TAL CUAL (sin ajuste de borde)', async () => {
    const { ctrl, prisma } = build();
    await ctrl.list(undefined, undefined, '2026-08-20T09:00:00Z', '2026-08-20T17:00:00Z');
    expect(whereOf(prisma).createdAt).toEqual({
      gte: new Date('2026-08-20T09:00:00Z'),
      lte: new Date('2026-08-20T17:00:00Z'),
    });
  });

  it('`minCents` no entero → 400 VALIDATION_ERROR', async () => {
    const { ctrl } = build();
    expect.assertions(2);
    try {
      await ctrl.list(
        undefined, undefined, undefined, undefined, undefined, undefined, '1', '20', undefined,
        '1.5',
      );
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.getStatus()).toBe(400);
    }
  });

  it('`maxCents < minCents` → 400 VALIDATION_ERROR', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.list(
        undefined, undefined, undefined, undefined, undefined, undefined, '1', '20', undefined,
        '5000', '1000',
      ),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('`pageSize` > 100 → 400 VALIDATION_ERROR', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.list(undefined, undefined, undefined, undefined, undefined, undefined, '1', '101'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('fecha no parseable → 400 VALIDATION_ERROR', async () => {
    const { ctrl } = build();
    await expect(
      ctrl.list(undefined, undefined, 'not-a-date'),
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
