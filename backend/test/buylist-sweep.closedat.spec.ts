import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * v1.8-ronda-c / SEC-D2 — el barrido de plazos sella `closedAt` en las transiciones TERMINALES
 * (7d sin respuesta → rechazada; 30d de abandono → abandonada), para anclar la retención de INE.
 */
describe('BuylistSweepJobService.run — closedAt en transiciones terminales', () => {
  const NOW = new Date('2026-08-16T00:00:00Z');

  function build(toReject: any[], toAbandon: any[]) {
    const updates: any[] = [];
    const prisma: any = {
      sellRequest: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce(toReject) // primera query = 7d
          .mockResolvedValueOnce(toAbandon), // segunda query = 30d
        update: jest.fn(async (args: any) => {
          updates.push(args);
          return {};
        }),
      },
    };
    const svc = new BuylistSweepJobService(prisma as PrismaService);
    return { svc, updates };
  }

  it('rechazada (7d) y abandonada (30d) llevan closedAt = now', async () => {
    const { svc, updates } = build([{ id: 'sr-rej' }], [{ id: 'sr-aba' }]);
    const res = await svc.run(NOW);
    expect(res).toEqual({ rejected: 1, abandoned: 1 });

    const rej = updates.find((u) => u.where.id === 'sr-rej');
    expect(rej.data).toEqual({ status: 'rechazada', closedAt: NOW });

    const aba = updates.find((u) => u.where.id === 'sr-aba');
    expect(aba.data).toEqual({ status: 'abandonada', closedAt: NOW });
  });
});
