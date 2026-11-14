import { closeRedisClient } from '../common/redis-close';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
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
import { OrderReservationSweepJobService } from './order-reservation-sweep.service';
import { SetPriceSyncJobService } from './set-price-sync.service';
import { SetValueSnapshotJobService } from './set-value-snapshot.service';
import {
  CATALOG_METADATA_ATTEMPTS,
  CATALOG_METADATA_BACKOFF_MS,
  CatalogPriceSyncJobService,
} from './catalog-price-sync.service';
import { PriceIngestJobService, PRICE_INGEST_SET_JOB } from './price-ingest.service';
import { SealedPriceIngestJobService } from './sealed-price-ingest.service';
import { DecksMetaRefreshService } from '../modules/decks-meta/decks-meta-refresh.service';
import { FxSnapshot } from '../modules/pricing/price-ingest.service';
import { bullRedisOptions } from './redis-connection.util';
import { isSchedulerDisabled } from '../config/test-env';
import { ShipmentTrackingPollJob } from '../modules/shipments/tracking-poll.job';
import { ShipmentLabelProcessingJob } from '../modules/shipments/label-processing.job';
import { ShipmentExtraChargesJob } from '../modules/shipments/extra-charges.job';
import { CatalogAutoWatchService } from '../modules/catalog/catalog-auto-watch.service';
import { SpendWatchService } from '../modules/spend-alerts/spend-watch.service';
import { MarketingSearchMissService } from '../modules/marketing/marketing-search-miss.service';
import { MarketingWeeklyDigestService } from '../modules/marketing/marketing-weekly-digest.service';
import { IndexInspectionService } from '../modules/marketing/index-inspection.service';
import { SpendDigestService } from '../modules/spend-alerts/spend-digest.service';
import { ManualVersionMergeService } from '../modules/pricing/manual-version-merge.service';
import { SupplyExpiryService } from '../modules/supply/supply-expiry.service';
import { WishlistNotifyService } from '../modules/wishlist/wishlist-notify.service';
import { SealedRestockNotifyService } from '../modules/catalog/sealed-restock-notify.service';
import { MeasurementDrainService } from '../modules/measurement/measurement-drain.service';
import { MarketingAccessLogService } from '../modules/marketing/marketing-access-log.service';
import { FeaturedService } from '../modules/catalog/featured.service';
import { PaymentsService } from '../modules/payments/payments.service';
import { ListingPriceService } from '../modules/pricing/listing-price.service';

const QUEUE_NAME = 'tcg-daily';
/**
 * Cola PROPIA del barrido de catálogo (CS-3). La cola `tcg-daily` la atiende UN worker con concurrency 1 y comparte ~36 jobs, entre ellos
 * los de cada minuto (`measurement-drain`, `shipment-label-processing`) y cada 5 min (`spend-watch`, `wishlist-notify`): un barrido de
 * catálogo de hasta 40 min (pausa + segunda pasada paciente) los dejaba esperando. Con su propia cola y su propio worker (concurrency 1: el
 * barrido sigue siendo single-flight) el catálogo puede tardar lo que necesite sin frenar a los demás. Elegido sobre `concurrency > 1`
 * porque varios jobs de `tcg-daily` dependen de correr de uno en uno (p. ej. fan-out de price-ingest, candados por fila).
 */
const CATALOG_QUEUE_NAME = 'tcg-catalog';

/** 💰 C1 (§19.29.7): el resumen diario al dueño sale a las 08:00 de la Ciudad de México (no hay horario de verano desde 2022). */
const SPEND_DIGEST_TZ = 'America/Mexico_City';

/** Throttle de logs de error de conexión (ioredis reintenta cada ~1-2s; sin esto, spamea). */
const CONN_ERROR_LOG_INTERVAL_MS = 60_000;

/**
 * Plazo máximo del apagado (por etapa: wiring en curso, worker, cola). Vencido el plazo se
 * loggea y se sigue: un job largo en vuelo (p. ej. `price-ingest`) NO puede dejar colgado el
 * shutdown del proceso — todos los jobs son idempotentes (upsert + jobId dedup) y BullMQ los
 * recupera como *stalled*. Configurable por env (devops) sin redeploy.
 */
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

/** `await` acotado: resuelve con el resultado o, vencido el plazo, con `'timeout'`. */
async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | 'timeout'> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), ms);
        // No mantiene vivo el event loop (importante para que jest/Node puedan salir).
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

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
  /** Cola/worker propios del barrido de catálogo (CS-3). */
  private catalogQueue?: Queue;
  private catalogWorker?: Worker;
  private worker?: Worker;
  /** Promesa del wiring BullMQ en background (expuesta para tests y para el destroy). */
  setupDone?: Promise<void>;
  private lastConnErrorAt = 0;
  private lastConnErrorMsg = '';
  /** El módulo ya se está destruyendo: el wiring en curso debe abortar en su próximo punto. */
  private destroying = false;

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
    private readonly sealedPriceIngest: SealedPriceIngestJobService,
    // v1.21-guest-checkout (T9): barrido de reservas de pedidos de invitado sin pagar.
    private readonly orderReservationSweep: OrderReservationSweepJobService,
    // DECKS-META Fase 2 (§7): refresh SEMANAL de decks meta desde Limitless (fail-closed por dial).
    private readonly decksMetaRefresh: DecksMetaRefreshService,
    // ⭐💰 D2d (API_CONTRACT §M4-SHIP.19.10): los tres jobs de Skydropx (no-op con `shipping_provider='off'`). `@Optional()`
    // SOLO por las pruebas unitarias que construyen el planificador a mano con la lista posicional de antes; en la app
    // `ShipmentsModule` los exporta y `JobsModule` lo importa (lo asevera `sdx-d2d-charges.e2e-spec.ts:132-133` con el AppModule real).
    @Optional() private readonly shipmentTrackingPoll?: ShipmentTrackingPollJob,
    @Optional() private readonly shipmentLabelProcessing?: ShipmentLabelProcessingJob,
    @Optional() private readonly shipmentExtraCharges?: ShipmentExtraChargesJob,
    // 💰 C1 (API_CONTRACT §M4-SHIP.19.33.9): los dos jobs de avisos al dueño (D2g). `@Optional()` por la misma razón que los de
    // D2d; en la app los exporta `SpendAlertsModule` (lo asevera `sdx-c1-jobs.e2e-spec.ts` con el AppModule real).
    @Optional() private readonly spendWatch?: SpendWatchService,
    @Optional() private readonly spendDigest?: SpendDigestService,
    // rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.5 y §WSH.7 (a), D-WSH-1): el aviso «ya la tenemos» y el «avísame» de sellados,
    // cada 5 min. `@Optional()` por la misma razón que los de D2d/C1; la app real los inyecta (WSH-T24 e2e).
    @Optional() private readonly wishlistNotify?: WishlistNotifyService,
    @Optional() private readonly sealedRestockNotify?: SealedRestockNotifyService,
    // v1.102⟨mkt-fase2⟩ (API_CONTRACT §MKT.H.6): drenado de la cola de medición cada minuto (con `MEASUREMENT_MODE=off` solo
    // purga; ⛔ no sale a la red) y la retención de 12 meses del registro de accesos del Panel (ARCHITECTURE §13.4.4).
    // `@Optional()` por la misma razón que los de D2d/C1.
    @Optional() private readonly measurementDrain?: MeasurementDrainService,
    @Optional() private readonly marketingAccessLog?: MarketingAccessLogService,
    // v1.113⟨portada⟩ (§DYN.2.3): el tic de Destacadas del día.
    @Optional() private readonly featuredRotation?: FeaturedService,
    // AUTO: backfill de contentKey + alerta >48 h (al final: los specs construyen el planificador con la lista posicional).
    @Optional() private readonly catalogAutoWatch?: CatalogAutoWatchService,
    // MKT-V2 (m99): correo semanal del lunes y retención de c6. Al final por la misma razón (listas posicionales de los specs).
    @Optional() private readonly marketingWeeklyDigest?: MarketingWeeklyDigestService,
    @Optional() private readonly marketingSearchMiss?: MarketingSearchMissService,
    // §D9 8.3 (conciliación del costo real de Stripe, cada 30 min) y 8.2 (recálculo de `ListingPrice` por versión de fórmula, cada
    // 10 min). Al final y `@Optional()` por la misma razón (listas posicionales de los specs).
    @Optional() private readonly payments?: PaymentsService,
    @Optional() private readonly listingPrices?: ListingPriceService,
    // §GSHOP.A: revisión de indexación (6 ticks diarios 03:00-08:00 CDMX). Al final y `@Optional()` por la misma razón.
    @Optional() private readonly indexInspection?: IndexInspectionService,
    // §PROV F1: caducidad horaria de solicitudes, ofertas y acuerdos sin recoger.
    @Optional() private readonly supplyExpiry?: SupplyExpiryService,
    // §ALTA-LIGA-2: fusión diaria de versiones de liga manuales con el producto real.
    @Optional() private readonly manualVersionMerge?: ManualVersionMergeService,
  ) {}

  async onModuleInit(): Promise<void> {
    // Bajo la suite automatizada el scheduler NO arranca (ver `config/test-env.ts`): cada
    // harness E2E levanta el AppModule completo y, con Redis real, registraba crons + worker
    // sobre la cola compartida y el catch-up de `price-ingest` disparaba ingesta REAL contra
    // pokemontcg.io → `worker.close()` esperaba a ese job y el `afterAll` colgaba (CI run
    // 32080601928), además de escrituras de fondo no deterministas en la BD de test.
    // Se puede re-activar con `E2E_ENABLE_SCHEDULER=true`. Fuera de `NODE_ENV=test` no aplica.
    if (isSchedulerDisabled()) {
      this.logger.warn(
        'Scheduler deshabilitado bajo NODE_ENV=test (E2E_ENABLE_SCHEDULER=true para forzarlo).',
      );
      return;
    }
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
    this.catalogQueue = new Queue(CATALOG_QUEUE_NAME, { connection: this.connection });
    this.catalogQueue.on('error', (err: Error) =>
      this.logger.error(`Scheduler: error en la cola ${CATALOG_QUEUE_NAME}: ${err.message}`),
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
    // v1.21-guest-checkout (T9, ARCHITECTURE §4.21e): a diferencia del resto de barridos, este
    // NO es diario — una reserva sin pagar bloquea PIEZAS ÚNICAS durante
    // ORDER_RESERVATION_TTL_MIN (60 min), así que barre cada 15 min para que el inventario
    // vuelva a estar vendible poco después de vencer. Cron overridable por env (devops).
    // v1.68 (§4-R.4): `order-reservation-sweep` SUSTITUYE a `guest-order-sweep` (barre las DOS rutas
    // por `reservedUntil`). La env `GUEST_ORDER_SWEEP_CRON` se conserva por compatibilidad. El
    // repetible viejo que quedó registrado en Redis se retira (best-effort) para que no dispare
    // «Job desconocido» cada 15 min.
    const guestSweepCron = this.config.get<string>('GUEST_ORDER_SWEEP_CRON') ?? '*/15 * * * *';
    try {
      await this.queue.removeRepeatable(
        'guest-order-sweep',
        { pattern: guestSweepCron },
        'guest-order-sweep-daily',
      );
    } catch {
      // Best-effort: si no existe (o la cola no lo soporta), el alias del worker lo absorbe.
    }
    await this.queue.add(
      'order-reservation-sweep',
      {},
      this.repeat('order-reservation-sweep', guestSweepCron),
    );
    // v1.14-price-ingest (WS-A, §4.15c/§4.15g): entrega la cola al ingest para el fan-out por set.
    this.priceIngest.setQueue(this.queue);

    // WS-A — PRICING del catálogo = `price-ingest` POR DEFECTO 2×/día (reemplaza al barrido pesado
    // `catalog-price-sync force:true`, que tras el aligeramiento ya NO escribe precios). El proveedor
    // lo resuelve `PriceIngestService.providerFor()` leyendo el dial `price_provider` **de este
    // entorno**; ⚠️ v1.65 (`API_CONTRACT §M10-PP`, `I-PP2`): el scheduler NO afirma qué valor corre —
    // se LEE de `GET /admin/settings`. Mismos horarios que el barrido que reemplaza: 06:00 y 18:00
    // CDMX = 00:00 y 12:00 UTC. Configurables por env (devops ajusta sin redeploy).
    const ingestCron1 = this.config.get<string>('PRICE_INGEST_CRON_1') ?? '0 0 * * *';
    const ingestCron2 = this.config.get<string>('PRICE_INGEST_CRON_2') ?? '0 12 * * *';
    await this.queue.add('price-ingest-1', {}, this.repeat('price-ingest-1', ingestCron1));
    await this.queue.add('price-ingest-2', {}, this.repeat('price-ingest-2', ingestCron2));

    // v1.19-sealed-tcgcsv (§4.19d) — referencia de mercado del SELLADO: 1×/día tras la
    // actualización de TCGCSV (~20:00 UTC) y tras fx-refresh (orden SUAVE, §4.15g). Sugerido
    // 21:30 UTC; configurable por env (horario exacto = devops). El job corre secuencial y
    // AWAITED dentro del worker (sin fan-out; alcance minúsculo) y es fail-closed por el dial
    // `sealed_price_source` (seed `off`): hasta el flip en staging es un no-op logueado.
    const sealedIngestCron = this.config.get<string>('SEALED_PRICE_INGEST_CRON') ?? '30 21 * * *';
    await this.queue.add('sealed-price-ingest', {}, this.repeat('sealed-price-ingest', sealedIngestCron));

    // DECKS-META Fase 2 (§7): refresh SEMANAL de decks meta — lunes 09:00 UTC (03:00 CDMX; tras
    // cargar los resultados de torneos del fin de semana). Configurable por env. Fail-closed por el
    // dial `decks_meta_autofetch` (seed off): hasta el flip es un no-op logueado; el disparo manual
    // `POST /admin/jobs/decks-meta-refresh` (incluido el dry-run) sigue disponible sin Redis.
    const decksMetaCron = this.config.get<string>('DECKS_META_REFRESH_CRON') ?? '0 9 * * 1';
    await this.queue.add('decks-meta-refresh', {}, this.repeatWeekly('decks-meta-refresh', decksMetaCron));

    // WS-A — METADATA del catálogo = import de sets/cartas/imágenes NUEVAS con `force:false` (barato:
    // salta sets ya poblados), cadencia LIGERA (diaria), NO el barrido redundante 2×/día `force:true`.
    // El disparo manual `POST /admin/jobs/catalog-price-sync` (force:true, ops) se conserva intacto.
    const metadataCron = this.config.get<string>('CATALOG_METADATA_SYNC_CRON') ?? '0 1 * * *';
    // AUTO-A (b): 6 intentos con backoff exponencial desde 10 min (10, 20, 40, 80, 160 min): pokemontcg.io falla a ratos y
    // `runMetadataImport` ahora AGUARDA el barrido y lanza si termino mal, asi que nadie tiene que reintentar a mano.
    // CS-3: va a SU cola (`tcg-catalog`); el repetible viejo de `tcg-daily` se retira para que no corra dos veces.
    await this.retireOldCatalogRepeatable();
    await this.catalogQueue!.add('catalog-metadata-sync', {}, {
      ...this.repeat('catalog-metadata-sync', metadataCron),
      attempts: CATALOG_METADATA_ATTEMPTS,
      backoff: { type: 'exponential', delay: CATALOG_METADATA_BACKOFF_MS },
    });

    // AUTO: backfill de contentKey (reanudable) + alerta > 48 h sin exito del catalogo; cada 15 min (el paso es barato cuando no hay nada).
    const autoWatchCron = this.config.get<string>('CATALOG_AUTO_WATCH_CRON') ?? '*/15 * * * *';
    if (this.catalogAutoWatch) await this.queue.add('catalog-auto-watch', {}, this.repeatEvery('catalog-auto-watch', autoWatchCron));

    // ⭐💰 D2d (§M4-SHIP.19.10): Skydropx. Crons por env (devops ajusta sin redeploy); los tres son no-op con el dial
    // `shipping_provider='off'` (seed) y con el adaptador `noop`. El sondeo y la guía en proceso son de alta frecuencia: su
    // `jobId` lleva `-cron` (no son diarios). ⛔ Ninguno compra (PS-99).
    const trackingCron = this.config.get<string>('SHIPMENT_TRACKING_POLL_CRON') ?? '*/10 * * * *';
    const labelProcessingCron = this.config.get<string>('SHIPMENT_LABEL_PROCESSING_CRON') ?? '* * * * *';
    const extraChargesCron = this.config.get<string>('SHIPMENT_EXTRA_CHARGES_CRON') ?? '30 8 * * *';
    if (this.shipmentTrackingPoll && this.shipmentLabelProcessing && this.shipmentExtraCharges) {
      await this.queue.add('shipment-tracking-poll', {}, this.repeatEvery('shipment-tracking-poll', trackingCron));
      await this.queue.add('shipment-label-processing', {}, this.repeatEvery('shipment-label-processing', labelProcessingCron));
      await this.queue.add('shipment-extra-charges', {}, this.repeat('shipment-extra-charges', extraChargesCron));
    } else {
      this.logger.error('Scheduler: los jobs de Skydropx NO están inyectados; shipment-* no quedan programados.');
    }

    // 💰 C1 (§M4-SHIP.19.33.9, §19.29.7): avisos al dueño. `spend-watch` cada 5 min (marca del dueño, correos pendientes, lotes,
    // saldo, AG-8 (b), AG-10); `spend-digest` a las 08:00 de MÉXICO — `tz` lo admite la BullMQ instalada (5.81.3 pasa `tz` a
    // cron-parser 4.9.0; medido en BACKEND_NOTES §66), así que no hace falta el `0 14 * * *` UTC. Single-flight: el candado
    // consultivo de cada servicio (⛔ nada nuevo aquí). Crons por env.
    const spendWatchCron = this.config.get<string>('SPEND_WATCH_CRON') ?? '*/5 * * * *';
    const spendDigestCron = this.config.get<string>('SPEND_DIGEST_CRON') ?? '0 8 * * *';
    if (this.spendWatch && this.spendDigest) {
      await this.queue.add('spend-watch', {}, this.repeatEvery('spend-watch', spendWatchCron));
      await this.queue.add('spend-digest', {}, this.repeatTz('spend-digest', spendDigestCron, SPEND_DIGEST_TZ));
    } else {
      this.logger.error('Scheduler: los jobs de avisos al dueño NO están inyectados; spend-watch y spend-digest no quedan programados.');
    }

    // rev v1.87⟨wishlist⟩ (§WSH.5, §WSH.7 (a), D-WSH-1): los dos avisos al cliente, cada 5 min por defecto (crons por env,
    // sufijo `-cron`). Single-flight entre instancias: el candado consultivo de cada servicio (D-WSH-7). El aviso de sellados
    // con su dial `sealed_restock_alerts` `off` es un no-op logueado; la lista de deseos siempre corre.
    const wishlistCron = this.config.get<string>('WISHLIST_NOTIFY_CRON') ?? '*/5 * * * *';
    const restockCron = this.config.get<string>('SEALED_RESTOCK_NOTIFY_CRON') ?? '*/5 * * * *';
    if (this.wishlistNotify && this.sealedRestockNotify) {
      await this.queue.add('wishlist-notify', {}, this.repeatEvery('wishlist-notify', wishlistCron));
      await this.queue.add('sealed-restock-notify', {}, this.repeatEvery('sealed-restock-notify', restockCron));
    } else {
      this.logger.error('Scheduler: los jobs de avisos al cliente NO están inyectados; wishlist-notify y sealed-restock-notify no quedan programados.');
    }

    // v1.102⟨mkt-fase2⟩ (§MKT.H.6): `measurement-drain` cada minuto (sufijo `-cron`) y la retención del registro de accesos
    // del Panel una vez al día. Crons por env.
    const measurementDrainCron = this.config.get<string>('MEASUREMENT_DRAIN_CRON') ?? '* * * * *';
    const accessLogRetentionCron = this.config.get<string>('MARKETING_ACCESS_LOG_RETENTION_CRON') ?? '45 8 * * *';
    if (this.measurementDrain && this.marketingAccessLog) {
      await this.queue.add('measurement-drain', {}, this.repeatEvery('measurement-drain', measurementDrainCron));
      await this.queue.add('marketing-access-log-retention', {}, this.repeat('marketing-access-log-retention', accessLogRetentionCron));
    } else {
      this.logger.error('Scheduler: los jobs de marketing NO están inyectados; measurement-drain y marketing-access-log-retention no quedan programados.');
    }

    // MKT-V2 (§3, §7): correo semanal del lunes (cada hora de 08:30 a 20:30 CDMX; idempotente por `MarketingWeeklyDigest`) y la
    // retención diaria de c6. Patrones fijos en código (cero variables nuevas); el interruptor es `ConfigSetting`.
    if (this.marketingWeeklyDigest && this.marketingSearchMiss) {
      await this.queue.add('marketing-weekly-digest', {}, { repeat: { pattern: '30 8-20 * * 1', tz: SPEND_DIGEST_TZ }, jobId: 'marketing-weekly-digest-cron', removeOnComplete: true, removeOnFail: 100 });
      await this.queue.add('marketing-search-miss-retention', {}, this.repeat('marketing-search-miss-retention', '50 8 * * *'));
      // c6 (§7): cierre del día a las 00:10 CDMX (hashes → `people`, borra hashes y sal). Reintenta solo (6 veces, espera creciente);
      // además se cierra perezosamente al escribir si el job no corrió. Idempotente.
      await this.queue.add('marketing-search-close', {}, { ...this.repeatTz('marketing-search-close', '10 0 * * *', SPEND_DIGEST_TZ), attempts: 6, backoff: { type: 'exponential', delay: 60_000 } });
    } else {
      this.logger.error('Scheduler: los jobs de marketing v2 NO están inyectados; marketing-weekly-digest y marketing-search-miss-retention no quedan programados.');
    }

    // §GSHOP.A: `gsc-index-inspect`, 6 ticks al día (03:00-08:00 CDMX; patrón fijo en código, cero variables nuevas). Idempotente por
    // selección (filas más viejas primero): un tick que muera lo retoma el siguiente. El interruptor es `ConfigSetting` `gsc_index_inspect`.
    if (this.indexInspection) {
      await this.queue.add('gsc-index-inspect', {}, { repeat: { pattern: '0 3-8 * * *', tz: SPEND_DIGEST_TZ }, jobId: 'gsc-index-inspect-cron', removeOnComplete: true, removeOnFail: 100 });
    } else {
      this.logger.error('Scheduler: IndexInspectionService NO está inyectado; gsc-index-inspect no queda programado.');
    }

    // v1.113⟨portada⟩ (API_CONTRACT §DYN.2.3): Destacadas del día. Un TIC cada 15 min (no un cron fijo): el cambio diario
    // cuelga del dial `featured_rotation_hour` (mover la hora no re-registra nada), un fallo se reintenta solo y un
    // arranque tras caída se pone al día solo (ARCHITECTURE §4.DYN (b)).
    const featuredCron = this.config.get<string>('FEATURED_ROTATION_CRON') ?? '*/15 * * * *';
    if (this.featuredRotation) {
      await this.queue.add('featured-rotation', {}, this.repeatEvery('featured-rotation', featuredCron));
    } else {
      this.logger.error('Scheduler: FeaturedService NO está inyectado; featured-rotation no queda programado.');
    }

    // §D9 8.3: conciliación idempotente del costo REAL de Stripe (filas FEE_INCLUDED sin dato, últimos 30 días), cada 30 min.
    if (this.payments) {
      await this.queue.add('stripe-fee-reconcile', {}, this.repeatEvery('stripe-fee-reconcile', '*/30 * * * *'));
    } else {
      this.logger.error('Scheduler: PaymentsService NO está inyectado; stripe-fee-reconcile no queda programado.');
    }
    // §D9 8.2: si la versión de la fórmula de `P` cambió (despliegue o dial), recálculo COMPLETO una vez; cada 10 min mientras difiera.
    if (this.listingPrices) {
      await this.queue.add('listing-price-formula', {}, this.repeatEvery('listing-price-formula', '*/10 * * * *'));
    } else {
      this.logger.error('Scheduler: ListingPriceService NO está inyectado; listing-price-formula no queda programado.');
    }

    // §PROV F1: `supply-expiry` cada hora (idempotente: UPDATE condicionados).
    if (this.supplyExpiry) {
      await this.queue.add('supply-expiry', {}, this.repeat('supply-expiry', '15 * * * *'));
    } else {
      this.logger.error('Scheduler: SupplyExpiryService NO está inyectado; supply-expiry no queda programado.');
    }

    // §ALTA-LIGA-2: `manual-version-merge` diario 05:40 UTC (idempotente; también dispara el sync/import/attach).
    if (this.manualVersionMerge) {
      await this.queue.add('manual-version-merge', {}, this.repeat('manual-version-merge', '40 5 * * *'));
    } else {
      this.logger.error('Scheduler: ManualVersionMergeService NO está inyectado; manual-version-merge no queda programado.');
    }

    // El wiring corre en background: si mientras tanto empezó el shutdown, NO se crea el worker
    // (se quedaría vivo tras el destroy: handle abierto + jobs procesándose en un proceso que
    // se está apagando). La cola/conexión ya creadas las cierra `onModuleDestroy`, que espera
    // a `setupDone` antes de cerrar.
    if (this.destroying) {
      this.logger.warn('Scheduler: shutdown en curso durante el wiring; no se crea el worker.');
      return;
    }

    this.worker = new Worker(
      QUEUE_NAME,
      async (job) => this.process(job),
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
    // CS-3: worker PROPIO del catálogo (concurrency 1 ⇒ single-flight). Mismo enrutado (`process`) y mismos registros de fallo.
    this.catalogWorker = new Worker(CATALOG_QUEUE_NAME, async (job) => this.process(job), { connection: this.connection, concurrency: 1 });
    this.catalogWorker.on('failed', (job, err) =>
      this.logger.error(`Job ${job?.name} (id=${job?.id}, intento ${job?.attemptsMade ?? '?'}) falló: ${err.message}`, err.stack),
    );
    this.catalogWorker.on('error', (err: Error) => this.logger.error(`Scheduler: error del worker ${CATALOG_QUEUE_NAME}: ${err.message}`));
    this.catalogWorker.on('completed', (job) => this.logger.log(`Job ${job.name} (id=${job.id}) completado.`));
    this.logger.log(
      'Scheduler activo (BullMQ): fx-refresh, price-sync, set-price-sync, portfolio-snapshot, ' +
        'set-value-snapshot, ine-retention, buylist-sweep, dispute-deadline, auth-token-sweep diarios ' +
        '+ price-ingest 2×/día (00:00 y 12:00 UTC, dial price_provider) ' +
        '+ sealed-price-ingest diario (21:30 UTC, dial sealed_price_source, seed off) ' +
        '+ catalog-metadata-sync diario (import de sets nuevos, force:false) ' +
        '+ shipment-tracking-poll / shipment-label-processing / shipment-extra-charges (Skydropx, dial shipping_provider) ' +
        '+ spend-watch (cada 5 min) / spend-digest (08:00 America/Mexico_City) ' +
        '+ wishlist-notify / sealed-restock-notify (cada 5 min; dial sealed_restock_alerts) ' +
        '+ measurement-drain (cada minuto; MEASUREMENT_MODE, off por defecto) / marketing-access-log-retention (diario).',
    );

    // Catch-up (auditoría 2026-08-17): si NO hay ingesta de precios reciente (hoy/ayer),
    // encola un `price-ingest` INMEDIATO (jobId dedup por día). Así un deploy nuevo puebla
    // el catálogo sin esperar al próximo cron ni a un disparo manual. No-fatal.
    try {
      if (this.destroying) return;
      await this.priceIngest.catchUpIfStale();
    } catch (err) {
      this.logger.error(
        `Scheduler: catch-up de price-ingest falló (no fatal): ${(err as Error).message}`,
      );
    }
  }

  /**
   * El enrutado del worker: nombre de job ⇒ servicio. Método (y no un cierre dentro de `setup`) para que la prueba de
   * integración de C1 (`sdx-c1-jobs.e2e-spec.ts`, PS-172 (c)) recorra el MISMO camino que el cron con el AppModule real, sin
   * Redis: un `case` que falte se ve allí, no solo en la unitaria con BullMQ mockeado.
   */
  async process(job: { name: string; data?: unknown; id?: string; attemptsMade?: number }): Promise<unknown> {
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
      // v1.68 (§4-R.4): libera reservas VENCIDAS de las dos rutas (bóveda e invitado) + rama
      // legada. `guest-order-sweep` se acepta un release como alias (repetible viejo en Redis).
      case 'order-reservation-sweep':
      case 'guest-order-sweep':
        return this.orderReservationSweep.run();
      // WS-A: metadata del catálogo (sets nuevos, force:false) — cadencia ligera diaria.
      case 'catalog-metadata-sync':
        return this.catalogPriceSync.runMetadataImport({ attempt: (job.attemptsMade ?? 0) + 1, jobId: job.id });
      // v1.14-price-ingest (WS-A): parent (fan-out por set) y child (ingesta de UN set).
      case 'price-ingest':
      case 'price-ingest-1':
      case 'price-ingest-2':
        return this.priceIngest.run();
      case PRICE_INGEST_SET_JOB:
        return this.priceIngest.runChild(
          job.data as { setId: string; fx: FxSnapshot },
        );
      // v1.19-sealed-tcgcsv (§4.19d): referencia del SELLADO — secuencial AWAITED,
      // single-flight, fail-closed por dial `sealed_price_source`.
      case 'sealed-price-ingest':
        return this.sealedPriceIngest.run();
      // DECKS-META Fase 2 (§7): refresh semanal. Idempotente (supersede-based) + single-flight
      // (flag en memoria del servicio). Fail-closed por dial: sin `on` no publica.
      case 'decks-meta-refresh':
        return this.decksMetaRefresh.run({});
      // ⭐💰 D2d (§M4-SHIP.19.10): rastreo (lote), guía en proceso + verificación + huérfanas, cargos extra.
      case 'shipment-tracking-poll':
        return this.shipmentTrackingPoll?.run() ?? null;
      case 'shipment-label-processing':
        return this.shipmentLabelProcessing?.run() ?? null;
      case 'shipment-extra-charges':
        return this.shipmentExtraCharges?.run() ?? null;
      // 💰 C1 (§M4-SHIP.19.33.9): avisos al dueño. `run()` toma `now` del reloj del módulo; `run({})` = ayer en México.
      case 'catalog-auto-watch':
        return this.catalogAutoWatch?.run() ?? null;
      case 'spend-watch':
        return this.spendWatch?.run() ?? null;
      case 'spend-digest':
        return this.spendDigest?.run({}) ?? null;
      // rev v1.87⟨wishlist⟩ (§WSH.5, §WSH.7 (a)): los dos avisos al cliente.
      case 'wishlist-notify':
        return this.wishlistNotify?.run() ?? null;
      case 'sealed-restock-notify':
        return this.sealedRestockNotify?.run() ?? null;
      // v1.102⟨mkt-fase2⟩ (§MKT.H.6, §13.4.4): drenado de la cola de medición y retención del registro de accesos.
      case 'measurement-drain':
        return this.measurementDrain?.run() ?? null;
      case 'marketing-access-log-retention':
        return this.marketingAccessLog?.purgeExpired() ?? null;
      case 'marketing-weekly-digest':
        return this.marketingWeeklyDigest?.run() ?? null;
      case 'gsc-index-inspect':
        return this.indexInspection?.tick() ?? null;
      case 'marketing-search-close':
        return this.marketingSearchMiss?.closePastDays() ?? null;
      case 'marketing-search-miss-retention':
        return this.marketingSearchMiss?.purgeExpired() ?? null;
      case 'featured-rotation':
        return this.featuredRotation?.tick() ?? null;
      case 'stripe-fee-reconcile':
        return this.payments?.reconcileStripeFees() ?? null;
      case 'manual-version-merge':
        return this.manualVersionMerge?.runAll() ?? null;
      case 'supply-expiry':
        return this.supplyExpiry?.run() ?? null;
      case 'listing-price-formula':
        return this.listingPrices?.formulaTick() ?? null;
      default:
        this.logger.warn(`Job desconocido en la cola: ${job.name}`);
        return null;
    }
  }

  /** Retira (best-effort) el repetible `catalog-metadata-sync` que quedó en `tcg-daily` antes de pasar a su cola propia. Idempotente. */
  private async retireOldCatalogRepeatable(): Promise<void> {
    try {
      const q = this.queue as Queue & { getRepeatableJobs?: () => Promise<{ name: string; key: string }[]>; removeRepeatableByKey?: (k: string) => Promise<unknown> };
      if (typeof q.getRepeatableJobs !== 'function' || typeof q.removeRepeatableByKey !== 'function') return;
      for (const r of (await q.getRepeatableJobs()).filter((x) => x.name === 'catalog-metadata-sync')) await q.removeRepeatableByKey(r.key);
    } catch (e) {
      this.logger.warn(`Scheduler: no se pudo retirar el repetible viejo de catalog-metadata-sync en ${QUEUE_NAME}: ${(e as Error).message}`);
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

  /** Igual que `repeat` pero con sufijo `-cron` (⭐ D2d): jobs de alta frecuencia (cada minuto / cada 10 min). */
  private repeatEvery(jobId: string, pattern: string) {
    return {
      repeat: { pattern },
      jobId: `${jobId}-cron`,
      removeOnComplete: true,
      removeOnFail: 100,
    };
  }

  /** Igual que `repeat` (sufijo `-daily`) pero con zona horaria (💰 C1: `spend-digest` a las 08:00 de México, §19.29.7). */
  private repeatTz(jobId: string, pattern: string, tz: string) {
    return {
      repeat: { pattern, tz },
      jobId: `${jobId}-daily`,
      removeOnComplete: true,
      removeOnFail: 100,
    };
  }

  /** Igual que `repeat` pero con sufijo `-weekly` (DECKS-META Fase 2, §7): el job es semanal, no diario. */
  private repeatWeekly(jobId: string, pattern: string) {
    return {
      repeat: { pattern },
      jobId: `${jobId}-weekly`,
      removeOnComplete: true,
      removeOnFail: 100,
    };
  }

  async onModuleDestroy(): Promise<void> {
    this.destroying = true;
    this.priceIngest.setQueue(undefined);

    const timeoutMs =
      Number(this.config.get<string>('SCHEDULER_SHUTDOWN_TIMEOUT_MS')) || DEFAULT_SHUTDOWN_TIMEOUT_MS;

    // 1. Esperar (acotado) al wiring en background: cerrar a medias dejaba cola/worker creados
    //    DESPUÉS del destroy, es decir, conexiones ioredis vivas que nadie cierra (los "handles
    //    abiertos" que hacían que jest no saliera).
    if (this.setupDone) {
      const r = await withTimeout(
        this.setupDone.catch(() => undefined),
        timeoutMs,
      );
      if (r === 'timeout') {
        this.logger.warn('Scheduler: el wiring BullMQ no terminó a tiempo; se cierra igual.');
      }
    }

    // 2. Cierres tolerantes Y ACOTADOS: si Redis nunca conectó, `close()`/`quit()` pueden fallar
    //    o colgar; y `worker.close()` (sin force) espera a que TERMINE el job en vuelo — un
    //    `price-ingest` largo dejaba el shutdown colgado. Vencido el plazo se sigue: los jobs son
    //    idempotentes y BullMQ recupera el abandonado como *stalled*.
    const bounded = async (label: string, op: () => Promise<unknown>) => {
      const r = await withTimeout(
        op().catch((err: Error) => {
          this.logger.warn(`Scheduler: ${label} falló en shutdown: ${err.message}`);
        }),
        timeoutMs,
      );
      if (r === 'timeout') {
        this.logger.warn(
          `Scheduler: ${label} excedió ${timeoutMs} ms en shutdown; se continúa (el job en ` +
            `vuelo se recupera como stalled).`,
        );
      }
    };
    if (this.worker) await bounded('worker.close()', () => this.worker!.close());
    if (this.catalogWorker) await bounded('catalogWorker.close()', () => this.catalogWorker!.close());
    if (this.queue) await bounded('queue.close()', () => this.queue!.close());
    if (this.catalogQueue) await bounded('catalogQueue.close()', () => this.catalogQueue!.close());
    if (this.connection) {
      // `quit()` manda un comando (se encolaría offline si no hay conexión → colgaría): solo con la conexión `ready`;
      // si no, o si `quit` no contesta en el plazo, corte duro con `disconnect()` (helper común, TD-HND-3).
      await closeRedisClient(this.connection, { timeoutMs, requireReady: true });
    }
  }
}
