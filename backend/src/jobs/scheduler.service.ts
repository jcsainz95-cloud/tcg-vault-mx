import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis, { Redis } from 'ioredis';
import { PriceSyncJobService } from './price-sync.service';
import { FxRefreshJobService } from './fx-refresh.service';
import { PortfolioSnapshotJobService } from '../jobs/portfolio-snapshot.service';

const QUEUE_NAME = 'tcg-daily';

/**
 * SchedulerService (BE-5) — Cablea los jobs diarios repetibles con **BullMQ + REDIS_URL**:
 * `price-sync`, `fx-refresh` y `portfolio-snapshot` (este último tras el price-sync).
 *
 * Activación condicionada a `REDIS_URL`: sin Redis el scheduler queda **deshabilitado**
 * (log de aviso) y NO abre conexiones — así el arranque local/tests/CI sin infra no se rompe.
 * Los mismos jobs siguen siendo **disparables manualmente** por endpoints admin
 * (`POST /admin/pricing/sync`, `POST /admin/fx/refresh`, `POST /admin/jobs/portfolio-snapshot`).
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

    // Jobs repetibles diarios (UTC). Escalonados: FX y precios antes del snapshot.
    await this.queue.add('fx-refresh', {}, this.repeat('fx-refresh', '0 6 * * *'));
    await this.queue.add('price-sync', {}, this.repeat('price-sync', '15 6 * * *'));
    await this.queue.add('portfolio-snapshot', {}, this.repeat('portfolio-snapshot', '0 7 * * *'));

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        switch (job.name) {
          case 'fx-refresh':
            return this.fxRefresh.run();
          case 'price-sync':
            return this.priceSync.run();
          case 'portfolio-snapshot':
            return this.portfolioSnapshot.run();
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
    this.logger.log('Scheduler activo (BullMQ): fx-refresh, price-sync, portfolio-snapshot diarios.');
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
