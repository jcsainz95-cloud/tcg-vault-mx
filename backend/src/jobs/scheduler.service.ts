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
import { CatalogPriceSyncJobService } from './catalog-price-sync.service';
import { PriceIngestJobService, PRICE_INGEST_SET_JOB } from './price-ingest.service';
import { FxSnapshot } from '../modules/pricing/price-ingest.service';
import { bullRedisOptions } from './redis-connection.util';

const QUEUE_NAME = 'tcg-daily';

/** Throttle de logs de error de conexión (ioredis reintenta cada ~1-2s; sin esto, spamea). */
const CONN_ERROR_LOG_INTERVAL_MS = 60_000;

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
 *
 * Auditoría de precios (2026-08-17, ver BACKEND_NOTES «Auditoría de precios»):
 *  - **`family` DNS**: Railway private networking resuelve SOLO IPv6; ioredis default (IPv4)
 *    fallaba el lookup y reintentaba PARA SIEMPRE en silencio. Ahora `family: 0` por default
 *    (override: env `REDIS_FAMILY` o `?family=` en la URL). Ver `redis-connection.util.ts`.
 *  - **Boot no bloqueante**: el wiring BullMQ corre en background (`setupDone`); un Redis caído
 *    ya NO cuelga `app.listen()` (antes los `queue.add` esperaban en la offline queue de ioredis
 *    y el healthcheck del deploy moría). Cuando Redis conecta, los adds pendientes fluyen solos.
 *  - **Fallos NUNCA invisibles**: listeners `error` en conexión/cola/worker + `failed`/`completed`
 *    por job, con throttle para no spamear.
 *  - **Catch-up al boot**: si no hay ingesta de precios reciente (hoy/ayer), se encola un
 *    `price-ingest` inmediato (jobId dedup por día) — los precios se pueblan solos tras cada
 *    deploy aunque el cron de las 00:00/12:00 UTC se haya perdido.
 */
@Injectable()
export class SchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SchedulerService.name);
  private connection?: Redis;
  private queue?: Queue;
  private worker?: Worker;
  /** Promesa del wiring BullMQ en background (expuesta para tests y para el destroy). */
  setupDone?: Promise<void>;
  private lastConnErrorAt = 0;
  private lastConnErrorMsg = '';

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
    private readonly catalogPriceSync: CatalogPriceSyncJobService,
    private readonly priceIngest: PriceIngestJobService,
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
    // Wiring en BACKGROUND: si Redis está caído/inaccesible al bootear, los `queue.add`
    // esperan en la offline queue de ioredis (que reintenta la conexión para siempre) y
    // NO deben colgar el arranque HTTP de Nest (`app.listen`). Un fallo aquí se loggea
    // como error (visible) y la app sigue sirviendo; los jobs quedan como disparo manual.
    this.setupDone = this.setup(url).catch((err: Error) => {
      this.logger.error(
        `Scheduler: fallo al inicializar BullMQ — los crons NO quedaron programados ` +
          `(los jobs siguen disponibles por disparo manual admin): ${err.message}`,
        err.stack,
      );
    });
  }

  private async setup(url: string): Promise<void> {
    // `family` DNS: Railway private networking (`redis.railway.internal`) es IPv6-only y el
    // default de ioredis es IPv4 → default dual-stack (0), overridable por REDIS_FAMILY/URL.
    const options = bullRedisOptions(url, this.config.get<string>('REDIS_FAMILY'));
    this.connection = new IORedis(url, options);
    this.connection.on('error', (err: Error) => this.logConnectionError(err));
    this.connection.on('ready', () =>
      this.logger.log('Scheduler: conexión Redis lista (BullMQ operativo).'),
    );
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });
    this.queue.on('error', (err: Error) =>
      this.logger.error(`Scheduler: error en la cola ${QUEUE_NAME}: ${err.message}`),
    );

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
    // v1.14-price-ingest (WS-A, §4.15c/§4.15g): entrega la cola al ingest para el fan-out por set.
    this.priceIngest.setQueue(this.queue);

    // WS-A — PRICING del catálogo = `price-ingest` POR DEFECTO 2×/día (reemplaza al barrido pesado
    // `catalog-price-sync force:true`, que tras el aligeramiento ya NO escribe precios). Usa el dial
    // SEMBRADO `price_provider=pokemontcg_io` (legacy, misma fuente USD de siempre → money-safe; NO
    // activa el proveedor de paga). Mismos horarios que el barrido que reemplaza: 06:00 y 18:00 CDMX
    // = 00:00 y 12:00 UTC. Configurables por env (devops ajusta sin redeploy).
    const ingestCron1 = this.config.get<string>('PRICE_INGEST_CRON_1') ?? '0 0 * * *';
    const ingestCron2 = this.config.get<string>('PRICE_INGEST_CRON_2') ?? '0 12 * * *';
    await this.queue.add('price-ingest-1', {}, this.repeat('price-ingest-1', ingestCron1));
    await this.queue.add('price-ingest-2', {}, this.repeat('price-ingest-2', ingestCron2));

    // WS-A — METADATA del catálogo = import de sets/cartas/imágenes NUEVAS con `force:false` (barato:
    // salta sets ya poblados), cadencia LIGERA (diaria), NO el barrido redundante 2×/día `force:true`.
    // El disparo manual `POST /admin/jobs/catalog-price-sync` (force:true, ops) se conserva intacto.
    const metadataCron = this.config.get<string>('CATALOG_METADATA_SYNC_CRON') ?? '0 1 * * *';
    await this.queue.add('catalog-metadata-sync', {}, this.repeat('catalog-metadata-sync', metadataCron));

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
          // WS-A: metadata del catálogo (sets nuevos, force:false) — cadencia ligera diaria.
          case 'catalog-metadata-sync':
            return this.catalogPriceSync.runMetadataImport();
          // v1.14-price-ingest (WS-A): parent (fan-out por set) y child (ingesta de UN set).
          case 'price-ingest':
          case 'price-ingest-1':
          case 'price-ingest-2':
            return this.priceIngest.run();
          case PRICE_INGEST_SET_JOB:
            return this.priceIngest.runChild(
              job.data as { setId: string; fx: FxSnapshot },
            );
          default:
            this.logger.warn(`Job desconocido en la cola: ${job.name}`);
            return null;
        }
      },
      { connection: this.connection },
    );
    // Fallos NUNCA invisibles: failed (por job, con id/intentos), error (del worker) y
    // completed (heartbeat observable de que los crons SÍ corren; ~decenas de líneas/día).
    this.worker.on('failed', (job, err) =>
      this.logger.error(
        `Job ${job?.name} (id=${job?.id}, intento ${job?.attemptsMade ?? '?'}) falló: ${err.message}`,
        err.stack,
      ),
    );
    this.worker.on('error', (err: Error) =>
      this.logger.error(`Scheduler: error del worker ${QUEUE_NAME}: ${err.message}`),
    );
    this.worker.on('completed', (job) =>
      this.logger.log(`Job ${job.name} (id=${job.id}) completado.`),
    );
    this.logger.log(
      'Scheduler activo (BullMQ): fx-refresh, price-sync, set-price-sync, portfolio-snapshot, ' +
        'set-value-snapshot, ine-retention, buylist-sweep, dispute-deadline, auth-token-sweep diarios ' +
        '+ price-ingest 2×/día (00:00 y 12:00 UTC, dial pokemontcg_io) ' +
        '+ catalog-metadata-sync diario (import de sets nuevos, force:false).',
    );

    // Catch-up (auditoría 2026-08-17): si NO hay ingesta de precios reciente (hoy/ayer),
    // encola un `price-ingest` INMEDIATO (jobId dedup por día). Así un deploy nuevo puebla
    // el catálogo sin esperar al próximo cron ni a un disparo manual. No-fatal.
    try {
      await this.priceIngest.catchUpIfStale();
    } catch (err) {
      this.logger.error(
        `Scheduler: catch-up de price-ingest falló (no fatal): ${(err as Error).message}`,
      );
    }
  }

  /** Log de errores de conexión con throttle (mismo mensaje: 1 vez/min; mensaje nuevo: siempre). */
  private logConnectionError(err: Error): void {
    const now = Date.now();
    if (
      err.message !== this.lastConnErrorMsg ||
      now - this.lastConnErrorAt >= CONN_ERROR_LOG_INTERVAL_MS
    ) {
      this.lastConnErrorMsg = err.message;
      this.lastConnErrorAt = now;
      this.logger.error(
        `Scheduler: error de conexión Redis (los crons NO corren hasta reconectar; ` +
          `ioredis sigue reintentando): ${err.message}`,
      );
    }
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
    this.priceIngest.setQueue(undefined);
    // Cierres tolerantes: si Redis nunca conectó, `close()`/`quit()` pueden fallar o colgar;
    // el shutdown no debe depender de un Redis sano.
    try {
      await this.worker?.close();
    } catch (err) {
      this.logger.warn(`Scheduler: worker.close() falló en shutdown: ${(err as Error).message}`);
    }
    try {
      await this.queue?.close();
    } catch (err) {
      this.logger.warn(`Scheduler: queue.close() falló en shutdown: ${(err as Error).message}`);
    }
    if (this.connection) {
      // `quit()` manda un comando (se encolaría offline si no hay conexión → colgaría);
      // solo se intenta con la conexión lista, si no, corte duro con `disconnect()`.
      if (this.connection.status === 'ready') {
        try {
          await this.connection.quit();
        } catch {
          this.connection.disconnect();
        }
      } else {
        this.connection.disconnect();
      }
    }
  }
}
