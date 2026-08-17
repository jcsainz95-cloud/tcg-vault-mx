import { AdminJobsController } from '../src/jobs/admin-jobs.controller';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { AuthTokenSweepJobService } from '../src/jobs/auth-token-sweep.service';
import { SetPriceSyncJobService } from '../src/jobs/set-price-sync.service';
import { SetValueSnapshotJobService } from '../src/jobs/set-value-snapshot.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';
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
  const setPrice = {
    run: jest.fn().mockResolvedValue({ setId: 's1', priced: 8, total: 10 }),
  } as unknown as SetPriceSyncJobService;
  const setSnap = {
    run: jest.fn().mockResolvedValue({ setId: 's1', totalValueMxnCents: 12345, pricedCardCount: 8, totalCardCount: 10 }),
  } as unknown as SetValueSnapshotJobService;
  const catalogPrice = {
    run: jest.fn().mockResolvedValue({ jobId: 'catalog-sync-all-1', setsQueued: 5, remaining: 0 }),
  } as unknown as CatalogPriceSyncJobService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const ctrl = new AdminJobsController(
    snapshot, ine, sweep, dispute, tokens, setPrice, setSnap, catalogPrice, audit,
  );

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
    // RB-1: taxonomía uniforme `.run`; RB-2: entityType/entityId presentes.
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.portfolio_snapshot.run',
        entityType: 'Job',
        entityId: 'portfolio-snapshot',
      }),
    );
  });

  // v1.9-set-chart: disparos manuales para sembrar el primer punto sin esperar al cron.
  it('POST /admin/jobs/set-price-sync corre run() y audita jobs.set_price_sync.run', async () => {
    const res = await ctrl.runSetPriceSync(user);
    expect(setPrice.run).toHaveBeenCalled();
    expect(res).toEqual({ setId: 's1', priced: 8, total: 10 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.set_price_sync.run',
        entityType: 'Job',
        entityId: 'set-price-sync',
      }),
    );
  });

  it('POST /admin/jobs/set-value-snapshot corre run() y audita jobs.set_value_snapshot.run', async () => {
    const res = await ctrl.runSetValueSnapshot(user);
    expect(setSnap.run).toHaveBeenCalled();
    expect(res).toEqual({ setId: 's1', totalValueMxnCents: 12345, pricedCardCount: 8, totalCardCount: 10 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.set_value_snapshot.run',
        entityType: 'Job',
        entityId: 'set-value-snapshot',
      }),
    );
  });

  // v1.12-catalog-pricing: disparo manual del re-sync completo del catálogo (force:true).
  it('POST /admin/jobs/catalog-price-sync corre run() y audita jobs.catalog_price_sync.run', async () => {
    const res = await ctrl.runCatalogPriceSync(user);
    expect(catalogPrice.run).toHaveBeenCalled();
    expect(res).toEqual({ jobId: 'catalog-sync-all-1', setsQueued: 5, remaining: 0 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.catalog_price_sync.run',
        entityType: 'Job',
        entityId: 'catalog-price-sync',
      }),
    );
  });
});
