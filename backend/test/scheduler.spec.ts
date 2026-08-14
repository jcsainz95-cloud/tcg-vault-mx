import { ConfigService } from '@nestjs/config';
import { SchedulerService } from '../src/jobs/scheduler.service';
import { PriceSyncJobService } from '../src/jobs/price-sync.service';
import { FxRefreshJobService } from '../src/jobs/fx-refresh.service';
import { PortfolioSnapshotJobService } from '../src/jobs/portfolio-snapshot.service';

/**
 * BE-5 — El scheduler BullMQ solo se activa con REDIS_URL. Sin él queda DESHABILITADO y
 * NO abre conexiones (así el arranque local/tests/CI sin infra no se rompe). Los jobs
 * siguen disparables manualmente por endpoints admin.
 */
describe('SchedulerService — gating por REDIS_URL', () => {
  const jobs = {} as PriceSyncJobService;
  const fx = {} as FxRefreshJobService;
  const snap = {} as PortfolioSnapshotJobService;

  it('sin REDIS_URL: onModuleInit es no-op y onModuleDestroy no falla', async () => {
    const config = new ConfigService({}); // sin REDIS_URL
    const svc = new SchedulerService(config, jobs, fx, snap);
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await expect(svc.onModuleDestroy()).resolves.toBeUndefined();
  });
});
