import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { UploadsService } from '../src/modules/uploads/uploads.service';

/**
 * Retención de INE (LFPDPPP): purga imágenes de INE cuando la última solicitud está
 * cerrada/pagada y venció `INE_RETENTION_DAYS`, y NO hay solicitudes abiertas.
 */
describe('IneRetentionJobService.run', () => {
  const RETENTION_DAYS = 180;
  const NOW = new Date('2026-08-13T00:00:00Z');

  function build(opts: {
    profiles: any[];
    openCountByUser: Record<string, number>;
    lastClosedByUser: Record<string, any>;
  }) {
    const deleted: string[] = [];
    const cleared: string[] = [];
    const prisma: any = {
      kycProfile: {
        findMany: jest.fn().mockResolvedValue(opts.profiles),
        update: jest.fn(async ({ where }: any) => {
          cleared.push(where.id);
        }),
      },
      sellRequest: {
        count: jest.fn(async ({ where }: any) => opts.openCountByUser[where.userId] ?? 0),
        findFirst: jest.fn(async ({ where }: any) => opts.lastClosedByUser[where.userId] ?? null),
      },
    };
    const settings = {
      getNumber: jest.fn().mockResolvedValue(RETENTION_DAYS),
    } as unknown as SettingsService;
    const uploads = {
      deleteObject: jest.fn(async (key: string) => {
        deleted.push(key);
      }),
    } as unknown as UploadsService;
    const svc = new IneRetentionJobService(prisma as PrismaService, settings, uploads);
    return { svc, prisma, deleted, cleared };
  }

  const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 3600 * 1000);

  it('purga INE de un usuario con última solicitud pagada fuera del periodo y sin solicitudes abiertas', async () => {
    const { svc, deleted, cleared } = build({
      profiles: [{ id: 'k1', userId: 'u1', ineFrontKey: 'kyc_ine/u1-front.jpg', ineBackKey: 'kyc_ine/u1-back.jpg' }],
      openCountByUser: { u1: 0 },
      lastClosedByUser: { u1: { status: 'pagada', paidAt: daysAgo(200), createdAt: daysAgo(220) } },
    });
    const res = await svc.run(NOW);
    expect(res.purged).toBe(1);
    expect(deleted).toEqual(['kyc_ine/u1-front.jpg', 'kyc_ine/u1-back.jpg']);
    expect(cleared).toEqual(['k1']);
  });

  it('NO purga si la solicitud cerró dentro del periodo de retención', async () => {
    const { svc, deleted, cleared } = build({
      profiles: [{ id: 'k1', userId: 'u1', ineFrontKey: 'f', ineBackKey: 'b' }],
      openCountByUser: { u1: 0 },
      lastClosedByUser: { u1: { status: 'pagada', paidAt: daysAgo(10), createdAt: daysAgo(30) } },
    });
    const res = await svc.run(NOW);
    expect(res.purged).toBe(0);
    expect(deleted).toHaveLength(0);
    expect(cleared).toHaveLength(0);
  });

  it('NO purga si el usuario tiene solicitudes abiertas (INE aún necesaria)', async () => {
    const { svc, deleted } = build({
      profiles: [{ id: 'k1', userId: 'u1', ineFrontKey: 'f', ineBackKey: 'b' }],
      openCountByUser: { u1: 1 },
      lastClosedByUser: { u1: { status: 'pagada', paidAt: daysAgo(300), createdAt: daysAgo(320) } },
    });
    const res = await svc.run(NOW);
    expect(res.purged).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it('NO purga si nunca cerró ninguna solicitud', async () => {
    const { svc, deleted } = build({
      profiles: [{ id: 'k1', userId: 'u1', ineFrontKey: 'f', ineBackKey: 'b' }],
      openCountByUser: { u1: 0 },
      lastClosedByUser: {},
    });
    const res = await svc.run(NOW);
    expect(res.purged).toBe(0);
    expect(deleted).toHaveLength(0);
  });

  it('usa la fecha de cierre disponible (rechazada sin paidAt → createdAt)', async () => {
    const { svc, deleted } = build({
      profiles: [{ id: 'k1', userId: 'u1', ineFrontKey: 'f', ineBackKey: null }],
      openCountByUser: { u1: 0 },
      lastClosedByUser: { u1: { status: 'rechazada', paidAt: null, createdAt: daysAgo(200) } },
    });
    const res = await svc.run(NOW);
    expect(res.purged).toBe(1);
    // Solo borra la key existente (front); la back es null.
    expect(deleted).toEqual(['f']);
  });
});
