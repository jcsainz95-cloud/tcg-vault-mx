import { AdminJobsController } from '../src/jobs/admin-jobs.controller';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { AuthTokenSweepJobService } from '../src/jobs/auth-token-sweep.service';
import { AuditService } from '../src/modules/audit/audit.service';
import { Role } from '@prisma/client';

/**
 * BE-5 / v15-D1 — Los 4 barridos (+ portfolio-snapshot) son disparables a mano por
 * `POST /admin/jobs/*` (super_admin), y cada disparo queda AUDITADO con su `action`.
 */
describe('AdminJobsController — disparo manual auditado de jobs', () => {
  const user = { id: 'admin-1', role: Role.super_admin };
  const snapshot = { run: jest.fn().mockResolvedValue(3) } as unknown as PortfolioSnapshotJobService;
  const ine = { run: jest.fn().mockResolvedValue({ purged: 2, scanned: 5 }) } as unknown as IneRetentionJobService;
  const sweep = { run: jest.fn().mockResolvedValue({ rejected: 1, abandoned: 4 }) } as unknown as BuylistSweepJobService;
  const dispute = { run: jest.fn().mockResolvedValue({ expired: 7 }) } as unknown as DisputeDeadlineJobService;
  const tokens = { run: jest.fn().mockResolvedValue({ deleted: 9 }) } as unknown as AuthTokenSweepJobService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const ctrl = new AdminJobsController(snapshot, ine, sweep, dispute, tokens, audit);

  beforeEach(() => jest.clearAllMocks());

  it('POST /admin/jobs/ine-retention corre run() y audita jobs.ine_retention.run', async () => {
    const res = await ctrl.runIneRetention(user);
    expect(ine.run).toHaveBeenCalled();
    expect(res).toEqual({ purged: 2, scanned: 5 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.ine_retention.run', after: { purged: 2, scanned: 5 } }),
    );
  });

  it('POST /admin/jobs/buylist-sweep corre run() y audita jobs.buylist_sweep.run', async () => {
    const res = await ctrl.runBuylistSweep(user);
    expect(sweep.run).toHaveBeenCalled();
    expect(res).toEqual({ rejected: 1, abandoned: 4 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.buylist_sweep.run' }),
    );
  });

  it('POST /admin/jobs/dispute-deadline corre run() y audita jobs.dispute_deadline.run', async () => {
    const res = await ctrl.runDisputeDeadline(user);
    expect(dispute.run).toHaveBeenCalled();
    expect(res).toEqual({ expired: 7 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.dispute_deadline.run' }),
    );
  });

  it('POST /admin/jobs/auth-token-sweep corre run() y audita jobs.auth_token_sweep.run', async () => {
    const res = await ctrl.runAuthTokenSweep(user);
    expect(tokens.run).toHaveBeenCalled();
    expect(res).toEqual({ deleted: 9 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.auth_token_sweep.run' }),
    );
  });

  it('POST /admin/jobs/portfolio-snapshot sigue funcionando (auditado)', async () => {
    const res = await ctrl.runPortfolioSnapshot(user);
    expect(snapshot.run).toHaveBeenCalled();
    expect(res).toEqual({ snapshotted: 3 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.portfolio_snapshot' }),
    );
  });
});
