import { BuylistService } from '../src/modules/buylist/buylist.service';
import { AdminBuylistController } from '../src/modules/buylist/admin-buylist.controller';
import { AuditService } from '../src/modules/audit/audit.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UsersService } from '../src/modules/users/users.service';
import { PiiCryptoService } from '../src/common/crypto/pii-crypto.service';

/**
 * v1.25-buylist-orders-pagination (§M5) — filtros server-side de `GET /admin/buylist`:
 * `status` CSV → `IN`, `q` (folio + vendedor), `from`/`to` (createdAt), `minCents`/`maxCents`
 * (quotedTotalCents), y paginación. TODOS aditivos y opcionales; omitirlos = comportamiento de HOY.
 * Los tests fijan el `where` que la capa construye (Prisma parametrizado, `mode:'insensitive'`).
 */

function buildService(prisma: any): BuylistService {
  return new BuylistService(
    prisma as unknown as PrismaService,
    {} as PricingService,
    {
      // v1.51.14 · BL-22: `adminList` deriva `offerIssueDeadlineAt` y para eso lee el dial de
      // emisión. Un `{}` aquí ya no basta.
      getNumber: jest.fn(async () => 7),
    } as unknown as SettingsService,
    {} as UsersService,
    {} as PiiCryptoService,
  );
}

function mockPrisma() {
  const findMany = jest.fn(async (_args: any) => []);
  const count = jest.fn(async (_args: any) => 0);
  return { prisma: { sellRequest: { findMany, count } }, findMany, count };
}

const whereOf = (findMany: jest.Mock) => findMany.mock.calls[0][0].where;

describe('BuylistService.adminList — filtros v1.25', () => {
  it('`status` CSV (varios) → `WHERE status IN (...)` (pestaña «Cerradas»)', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList('pagada,rechazada,abandonada', 1, 20);
    expect(whereOf(findMany)).toEqual({
      status: { in: ['pagada', 'rechazada', 'abandonada'] },
    });
  });

  it('`status` de un solo valor se comporta IDÉNTICO a hoy (escalar, no IN)', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList('verificacion', 1, 20);
    // Compat total: escalar `where.status = token` (mismo shape que antes de v1.25).
    expect(whereOf(findMany)).toEqual({ status: 'verificacion' });
  });

  it('token de `status` inválido → 400 VALIDATION_ERROR con details.invalidStatus', async () => {
    const { prisma } = mockPrisma();
    expect.assertions(3);
    try {
      await buildService(prisma).adminList('pagada,bogus', 1, 20);
    } catch (e: any) {
      expect(e.code).toBe('VALIDATION_ERROR');
      expect(e.getStatus()).toBe(400);
      expect(e.details.invalidStatus).toEqual(['bogus']);
    }
  });

  it('`q` construye el OR correcto: folio (id) + vendedor (user.name/user.email), insensitive', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList(undefined, 1, 20, undefined, { q: 'ash' });
    expect(whereOf(findMany).OR).toEqual([
      { id: { contains: 'ash', mode: 'insensitive' } },
      { user: { name: { contains: 'ash', mode: 'insensitive' } } },
      { user: { email: { contains: 'ash', mode: 'insensitive' } } },
    ]);
  });

  it('`from`/`to` → where.createdAt gte/lte', async () => {
    const { prisma, findMany } = mockPrisma();
    const gte = new Date('2026-08-01T00:00:00Z');
    const lte = new Date('2026-08-20T00:00:00Z');
    await buildService(prisma).adminList(undefined, 1, 20, undefined, { dateRange: { gte, lte } });
    expect(whereOf(findMany).createdAt).toEqual({ gte, lte });
  });

  it('`minCents`/`maxCents` → where.quotedTotalCents gte/lte (NO approvedTotalCents)', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList(undefined, 1, 20, undefined, {
      centsRange: { gte: 1000, lte: 5000 },
    });
    const where = whereOf(findMany);
    expect(where.quotedTotalCents).toEqual({ gte: 1000, lte: 5000 });
    expect(where.approvedTotalCents).toBeUndefined();
  });

  it('la paginación pasa skip/take a Prisma', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList(undefined, 3, 25);
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 50, take: 25 });
  });

  it('sin filtros nuevos el where queda vacío (comportamiento de HOY intacto)', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList(undefined, 1, 20);
    expect(whereOf(findMany)).toEqual({});
  });

  it('v1.25.1: `to` date-only (vía controller → helper) ancla `lte` a fin de día INCLUSIVO', async () => {
    const { prisma, findMany } = mockPrisma();
    const ctrl = new AdminBuylistController(
      buildService(prisma),
      { log: jest.fn() } as unknown as AuditService,
    );
    // `<input type=date>` emite date-only; el borde de día se materializa en el helper compartido.
    await ctrl.list(undefined, undefined, '1', '20', undefined, undefined, '2026-08-20');
    const { createdAt } = whereOf(findMany);
    expect(createdAt).toEqual({ lte: new Date('2026-08-20T23:59:59.999Z') });
    // Una solicitud cerrada esa tarde queda DENTRO (antes se excluía por tratarla como medianoche).
    expect(new Date('2026-08-20T15:00:00Z') <= createdAt.lte).toBe(true);
  });

  it('combina status + q + rangos + userId sin pisarse', async () => {
    const { prisma, findMany } = mockPrisma();
    await buildService(prisma).adminList('pagada,rechazada', 1, 20, 'user-1', {
      q: 'foo',
      dateRange: { gte: new Date('2026-08-01T00:00:00Z') },
      centsRange: { lte: 9000 },
    });
    const where = whereOf(findMany);
    expect(where.status).toEqual({ in: ['pagada', 'rechazada'] });
    expect(where.userId).toBe('user-1');
    expect(where.OR).toHaveLength(3);
    expect(where.createdAt).toEqual({ gte: new Date('2026-08-01T00:00:00Z') });
    expect(where.quotedTotalCents).toEqual({ lte: 9000 });
  });
});
