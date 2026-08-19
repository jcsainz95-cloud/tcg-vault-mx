import { AdminJobsController } from '../src/jobs/admin-jobs.controller';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from '../src/jobs/ine-retention.service';
import { BuylistSweepJobService } from '../src/jobs/buylist-sweep.service';
import { DisputeDeadlineJobService } from '../src/jobs/dispute-deadline.service';
import { AuthTokenSweepJobService } from '../src/jobs/auth-token-sweep.service';
import { SetPriceSyncJobService } from '../src/jobs/set-price-sync.service';
import { SetValueSnapshotJobService } from '../src/jobs/set-value-snapshot.service';
import { CatalogPriceSyncJobService } from '../src/jobs/catalog-price-sync.service';
import { PriceIngestJobService } from '../src/jobs/price-ingest.service';
import { SealedPriceIngestJobService } from '../src/jobs/sealed-price-ingest.service';
import { SealedRestockNotifyService } from '../src/modules/catalog/sealed-restock-notify.service';
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
  const priceIngest = {
    run: jest.fn().mockResolvedValue({ job: 'price-ingest', enqueued: true, jobId: 'price-ingest-2026-08-17' }),
    // N-11: sin setId el disparo es fire-and-forget (background); el front pollea sync-status.
    runBackground: jest.fn().mockResolvedValue({ job: 'price-ingest', enqueued: true, background: true, alreadyRunning: false }),
  } as unknown as PriceIngestJobService;
  const sealedPriceIngest = {
    run: jest.fn().mockResolvedValue({ job: 'sealed-price-ingest', enqueued: true }),
  } as unknown as SealedPriceIngestJobService;
  const sealedRestockNotify = {
    run: jest.fn().mockResolvedValue({ job: 'sealed-restock-notify', enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' }),
  } as unknown as SealedRestockNotifyService;
  const audit = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  const ctrl = new AdminJobsController(
    snapshot, ine, sweep, dispute, tokens, setPrice, setSnap, catalogPrice, priceIngest,
    sealedPriceIngest, sealedRestockNotify, audit,
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

  // v1.14-price-ingest (WS-A): ingesta masiva. Sin setId → catálogo completo; auditado. TOCA DINERO.
  it('POST /admin/jobs/price-ingest (sin setId) → runBackground() (N-11 fire-and-forget) y audita', async () => {
    const res = await ctrl.runPriceIngest({}, user);
    // N-11: sin setId NO se bloquea; se lanza el barrido en background.
    expect(priceIngest.runBackground).toHaveBeenCalled();
    expect(priceIngest.run).not.toHaveBeenCalled();
    expect(res).toMatchObject({ job: 'price-ingest', enqueued: true, background: true });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.price_ingest.run',
        entityType: 'Job',
        entityId: 'price-ingest',
        after: { job: 'price-ingest', setId: null, enqueued: true },
      }),
    );
  });

  it('POST /admin/jobs/price-ingest { setId } pasa el set al servicio (verificación de esquema)', async () => {
    (priceIngest.run as jest.Mock).mockResolvedValueOnce({
      job: 'price-ingest',
      enqueued: true,
      scope: 'set',
      setId: 'sv8',
    });
    const res = await ctrl.runPriceIngest({ setId: 'sv8' }, user);
    expect(priceIngest.run).toHaveBeenCalledWith('sv8');
    expect(res).toMatchObject({ job: 'price-ingest', scope: 'set', setId: 'sv8' });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'jobs.price_ingest.run', after: expect.objectContaining({ setId: 'sv8' }) }),
    );
  });

  // v1.19-sealed-tcgcsv (§M10-ops): referencia de mercado del sellado. Auditado; fail-closed por dial.
  it('POST /admin/jobs/sealed-price-ingest (sin groupId) corre run() y audita jobs.sealed_price_ingest.run', async () => {
    const res = await ctrl.runSealedPriceIngest({}, user);
    expect(sealedPriceIngest.run).toHaveBeenCalledWith(undefined);
    expect(res).toEqual({ job: 'sealed-price-ingest', enqueued: true });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.sealed_price_ingest.run',
        entityType: 'Job',
        entityId: 'sealed-price-ingest',
        after: { job: 'sealed-price-ingest', groupId: null, enqueued: true },
      }),
    );
  });

  it('POST /admin/jobs/sealed-price-ingest { groupId } pasa el grupo (verificación de esquema en staging)', async () => {
    (sealedPriceIngest.run as jest.Mock).mockResolvedValueOnce({
      job: 'sealed-price-ingest',
      enqueued: true,
      scope: 'group',
      groupId: 23821,
    });
    const res = await ctrl.runSealedPriceIngest({ groupId: 23821 }, user);
    expect(sealedPriceIngest.run).toHaveBeenCalledWith(23821);
    expect(res).toMatchObject({ job: 'sealed-price-ingest', scope: 'group', groupId: 23821 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.sealed_price_ingest.run',
        after: expect.objectContaining({ groupId: 23821 }),
      }),
    );
  });

  it('POST /admin/jobs/sealed-price-ingest con dial off → 202 enqueued:false + reason (auditado)', async () => {
    (sealedPriceIngest.run as jest.Mock).mockResolvedValueOnce({
      job: 'sealed-price-ingest',
      enqueued: false,
      reason: 'SEALED_PRICE_SOURCE_OFF',
    });
    const res = await ctrl.runSealedPriceIngest({}, user);
    expect(res).toEqual({
      job: 'sealed-price-ingest',
      enqueued: false,
      reason: 'SEALED_PRICE_SOURCE_OFF',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.sealed_price_ingest.run',
        after: expect.objectContaining({ enqueued: false, reason: 'SEALED_PRICE_SOURCE_OFF' }),
      }),
    );
  });

  it('POST /admin/jobs/sealed-restock-notify con dial off → 202 enqueued:false + reason (auditado)', async () => {
    const res = await ctrl.runSealedRestockNotify(user);
    expect(sealedRestockNotify.run).toHaveBeenCalled();
    expect(res).toEqual({
      job: 'sealed-restock-notify',
      enqueued: false,
      reason: 'SEALED_RESTOCK_ALERTS_OFF',
    });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'jobs.sealed_restock_notify.run',
        entityId: 'sealed-restock-notify',
        after: expect.objectContaining({ enqueued: false, reason: 'SEALED_RESTOCK_ALERTS_OFF' }),
      }),
    );
  });
});
