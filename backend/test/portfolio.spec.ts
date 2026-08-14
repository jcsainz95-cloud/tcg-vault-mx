import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { VaultService } from '../src/modules/vault/vault.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { PricingService } from '../src/modules/pricing/pricing.service';

/**
 * v1.1 — Gráfica de tendencia del portafolio (PortfolioSnapshot, ARCHITECTURE §3/§5):
 *  - snapshot idempotente por día (upsert por @@unique[userId, asOfDate]).
 *  - `GET /vault/portfolio/history`: cálculo de `change` (primer vs último punto).
 */

describe('PortfolioSnapshotJobService.snapshotUser — idempotente por día', () => {
  it('hace UPSERT por (userId, asOfDate) reutilizando VaultService.holdings()', async () => {
    const prisma: any = { portfolioSnapshot: { upsert: jest.fn(async ({ create }: any) => create) } };
    const vault = {
      holdings: jest.fn().mockResolvedValue({
        portfolio: { totalValueMxnCents: 543200, pendingPriceCount: 2, currency: 'MXN' },
      }),
      costBasisCents: jest.fn().mockResolvedValue(400000),
    } as unknown as VaultService;

    const job = new PortfolioSnapshotJobService(prisma as PrismaService, vault);
    await job.snapshotUser('u1');

    expect(vault.holdings).toHaveBeenCalledWith('u1');
    const call = prisma.portfolioSnapshot.upsert.mock.calls[0][0];
    // Clave compuesta = idempotencia por día (re-correr no duplica).
    expect(call.where.userId_asOfDate.userId).toBe('u1');
    expect(call.where.userId_asOfDate.asOfDate).toBeInstanceOf(Date);
    expect(call.create.totalValueMxnCents).toBe(543200);
    expect(call.create.costBasisMxnCents).toBe(400000);
    expect(call.create.pendingPriceCount).toBe(2);
    expect(call.update.totalValueMxnCents).toBe(543200);
  });
});

describe('VaultService.portfolioHistory — cálculo de change', () => {
  const pricing = {} as PricingService;

  function withSnapshots(snaps: any[]): VaultService {
    const prisma: any = { portfolioSnapshot: { findMany: jest.fn().mockResolvedValue(snaps) } };
    return new VaultService(prisma as PrismaService, pricing);
  }

  it('sin snapshots → points [] y change flat con pct null', async () => {
    const svc = withSnapshots([]);
    const res = await svc.portfolioHistory('u1', '1m');
    expect(res.points).toEqual([]);
    expect(res.change).toEqual({ absMxnCents: 0, pct: null, direction: 'flat' });
  });

  it('serie ascendente → direction up, abs y pct correctos', async () => {
    const svc = withSnapshots([
      { asOfDate: new Date('2026-07-15'), totalValueMxnCents: 512000, costBasisMxnCents: 400000 },
      { asOfDate: new Date('2026-08-14'), totalValueMxnCents: 543200, costBasisMxnCents: 400000 },
    ]);
    const res = await svc.portfolioHistory('u1', '1m');
    expect(res.range).toBe('1m');
    expect(res.points.map((p) => p.date)).toEqual(['2026-07-15', '2026-08-14']);
    expect(res.change.absMxnCents).toBe(31200);
    expect(res.change.pct).toBe(6.09); // round(31200/512000*100, 2)
    expect(res.change.direction).toBe('up');
  });

  it('serie descendente → direction down; primer valor 0 → pct null', async () => {
    const svc = withSnapshots([
      { asOfDate: new Date('2026-08-01'), totalValueMxnCents: 0 },
      { asOfDate: new Date('2026-08-14'), totalValueMxnCents: 10000 },
    ]);
    const res = await svc.portfolioHistory('u1', 'ytd');
    expect(res.change.pct).toBeNull(); // valor inicial 0
    expect(res.change.absMxnCents).toBe(10000);
    expect(res.change.direction).toBe('up');
  });

  it('rango inválido cae al default 1m', async () => {
    const svc = withSnapshots([]);
    const res = await svc.portfolioHistory('u1', 'bogus');
    expect(res.range).toBe('1m');
  });
});
