import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import { PriceSyncJobService } from './price-sync.service';
import { FxRefreshJobService } from './fx-refresh.service';
import { PortfolioSnapshotJobService } from '../jobs/portfolio-snapshot.service';
import { IneRetentionJobService } from './ine-retention.service';
import { BuylistSweepJobService } from './buylist-sweep.service';
import { DisputeDeadlineJobService } from './dispute-deadline.service';
import { AuthTokenSweepJobService } from './auth-token-sweep.service';
import { SetPriceSyncJobService } from './set-price-sync.service';
import { SetValueSnapshotJobService } from './set-value-snapshot.service';

const QUEUE_NAME = 'tcg-daily';

/**
 * SchedulerService (BE-5 / v15-D1) — Cablea TODOS los jobs diarios repetibles con
 * **BullMQ + REDIS_URL**:
 *   - `fx-refresh`, `price-sync`, `portfolio-snapshot` (pricing/valuación; escalonados).
 *   - `ine-retention` (purga PII INE, LFPDPPP), `buylist-sweep` (plazos 7d/30d),
 *     `dispute-deadline` (ventana de recompra) y `auth-token-sweep` (housekeeping AuthToken).
 *
 * Activación condicionada a `REDIS_URL`: sin Redis el scheduler queda **deshabilitado**
 * (log de aviso) y NO abre conexiones — así el arranque local/tests/CI sin infra no se rompe.
 * Los mismos jobs siguen siendo **disparables manualmente** por endpoints admin
 * (`POST /admin/pricing/sync`, `POST /admin/fx/refresh`, `POST /admin/jobs/*`).
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly priceSync: PriceSyncJobService,
    private readonly fxRefresh: FxRefreshJobService,
    private readonly portfolioSnapshot: PortfolioSnapshotJobService,
    private readonly ineRetention: IneRetentionJobService,
    private readonly buylistSweep: BuylistSweepJobService,
    private readonly disputeDeadline: DisputeDeadlineJobService,
    private readonly authTokenSweep: AuthTokenSweepJobService,
    private readonly setPriceSync: SetPriceSyncJobService,
    private readonly setValueSnapshot: SetValueSnapshotJobService,
  ) {}

  async onModuleInit(): Promise<void> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) {
      this.logger.warn(
        'Scheduler deshabilitado: falta REDIS_URL. Los jobs diarios no se programan ' +
          '(siguen disponibles por disparo manual admin).',
      );
      return;
    }
    // BullMQ exige maxRetriesPerRequest=null en la conexión de los workers.
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

    // Jobs repetibles diarios (UTC). Escalonados: FX y precios antes del snapshot; los
    // barridos de PII/plazos/housekeeping en su propia franja para no solaparse.
    await this.queue.add('fx-refresh', {}, this.repeat('fx-refresh', '0 6 * * *'));
    await this.queue.add('price-sync', {}, this.repeat('price-sync', '15 6 * * *'));
    // v1.9-set-chart: orden duro FX → set-price-sync → set-value-snapshot (§4.12c).
    await this.queue.add('set-price-sync', {}, this.repeat('set-price-sync', '30 6 * * *'));
    await this.queue.add('portfolio-snapshot', {}, this.repeat('portfolio-snapshot', '0 7 * * *'));
    await this.queue.add('set-value-snapshot', {}, this.repeat('set-value-snapshot', '15 7 * * *'));
    await this.queue.add('ine-retention', {}, this.repeat('ine-retention', '30 7 * * *'));
    await this.queue.add('dispute-deadline', {}, this.repeat('dispute-deadline', '45 7 * * *'));
    await this.queue.add('buylist-sweep', {}, this.repeat('buylist-sweep', '0 8 * * *'));
    await this.queue.add('auth-token-sweep', {}, this.repeat('auth-token-sweep', '15 8 * * *'));

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case 'fx-refresh':
            return this.fxRefresh.run();
          case 'price-sync':
            return this.priceSync.run();
          case 'set-price-sync':
            return this.setPriceSync.run();
          case 'portfolio-snapshot':
            return this.portfolioSnapshot.run();
          case 'set-value-snapshot':
            return this.setValueSnapshot.run();
          case 'ine-retention':
            return this.ineRetention.run();
          case 'buylist-sweep':
            return this.buylistSweep.run();
          case 'dispute-deadline':
            return this.disputeDeadline.run();
          case 'auth-token-sweep':
            return this.authTokenSweep.run();
          default:
            this.logger.warn(`Job desconocido en la cola: ${job.name}`);
            return null;
        }
      },
      { connection: this.connection },
    );
    this.worker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.name} falló: ${err.message}`),
    );
    this.logger.log(
      'Scheduler activo (BullMQ): fx-refresh, price-sync, set-price-sync, portfolio-snapshot, ' +
        'set-value-snapshot, ine-retention, buylist-sweep, dispute-deadline, auth-token-sweep diarios.',
    );
  }

  private repeat(jobId: string, pattern: string) {
    return {
      repeat: { pattern },
      jobId: `${jobId}-daily`,
      removeOnComplete: true,
      removeOnFail: 100,
    };
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
    await this.queue?.close();
    if (this.connection) await this.connection.quit();
  }
}
