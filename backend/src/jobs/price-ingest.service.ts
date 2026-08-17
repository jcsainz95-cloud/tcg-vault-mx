import { Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { FxService } from '../modules/pricing/fx.service';
import { FxSnapshot, PriceIngestService } from '../modules/pricing/price-ingest.service';

/** Nombre del child job por set (encolado por el parent; procesado por el worker del scheduler). */
export const PRICE_INGEST_SET_JOB = 'price-ingest-set';
const JOB = 'price-ingest';

export interface PriceIngestTriggerResult {
  job: 'price-ingest';
  enqueued: boolean;
  jobId?: string;
  scope?: 'set';
  setId?: string;
}

/**
 * PriceIngestJobService — orquestación del ingest masivo (WS-A, ARCHITECTURE §4.15c).
 *
 * Robustez (el corazón de WS-A):
 *  - **Con Redis (prod):** `run()` hace **fan-out**: encola un child `price-ingest-set` por set en
 *    la cola BullMQ (persistida) que le entrega el `SchedulerService` (`setQueue`). Cada set es su
 *    propio job → aislamiento de fallos + retry/backoff + reanudable ante reinicio. El worker del
 *    scheduler enruta cada child a `runChild()`.
 *  - **Sin Redis (local/CI/manual):** `run()` corre el ingest **secuencial y AWAITED** dentro del
 *    handler (recorre sets uno a uno). NUNCA fire-and-forget (a diferencia del `void runSyncAll`).
 *  - **FX una vez por corrida (§4.15f):** carga `FxService.getCurrent()` UNA vez y lo pasa (snapshot)
 *    a cada child (en `job.data`) o a `ingestAll`.
 *  - **Single-flight:** para el fan-out, jobId determinista por set+día (dedup de BullMQ); para el
 *    fallback secuencial, un flag en memoria (`running`).
 */
@Injectable()
export class PriceIngestJobService {
  private readonly logger = new Logger(PriceIngestJobService.name);
  /** Cola BullMQ entregada por el SchedulerService cuando hay REDIS_URL (si no, undefined). */
  private queue?: Queue;
  private running = false;

  constructor(
    private readonly fx: FxService,
    private readonly ingest: PriceIngestService,
  ) {}

  /** El SchedulerService inyecta su cola cuando Redis está disponible. */
  setQueue(queue: Queue | undefined): void {
    this.queue = queue;
  }

  /**
   * Disparo del ingest (cron o `POST /admin/jobs/price-ingest`).
   * - `setId` (externalId `sv8` o id interno) → ingesta SOLO ese set, AWAITED (verificación de
   *   esquema en la 1ª corrida, §4.15h). Siempre inline (acotado; se quiere feedback inmediato).
   * - sin `setId` → catálogo completo: fan-out por set (con Redis) o secuencial AWAITED (sin Redis).
   */
  async run(setId?: string): Promise<PriceIngestTriggerResult> {
    const cur = await this.fx.getCurrent();
    const fx: FxSnapshot = { rate: cur.rate, bufferPct: cur.bufferPct };

    if (setId) {
      await this.ingest.ingestSetByExternalId(setId, fx);
      return { job: JOB, enqueued: true, scope: 'set', setId };
    }

    if (this.queue) {
      const jobId = await this.enqueueAllSets(fx);
      return { job: JOB, enqueued: true, jobId };
    }

    // Sin Redis: secuencial AWAITED (single-flight en memoria).
    if (this.running) {
      this.logger.warn('price-ingest ya en curso (secuencial); no se lanza otro.');
      return { job: JOB, enqueued: false };
    }
    this.running = true;
    try {
      await this.ingest.ingestAll(fx);
    } finally {
      this.running = false;
    }
    return { job: JOB, enqueued: true };
  }

  /**
   * Fan-out: encola un `price-ingest-set` por set con jobId determinista por día (single-flight).
   *
   * NOTA single-flight (simétrica a la rama secuencial `run()`+`running`, ver BE-31): en la rama CON
   * cola el single-flight lo da el **jobId determinista** `price-ingest-set-<setId>-<día>` — BullMQ
   * DEDUPLICA (no encola dos veces el mismo jobId vigente) y el upsert de `PriceReference` es
   * idempotente, así que dos disparos del día no duplican trabajo ni escriben dos veces. No hay un
   * guard "ya hay corrida activa" explícito aquí (queda como deuda BE-31): es innecesario para la
   * money-safety (dedup + idempotencia lo cubren), solo afecta el valor informativo de `enqueued`.
   */
  async enqueueAllSets(fx: FxSnapshot): Promise<string> {
    if (!this.queue) throw new Error('price-ingest: no hay cola BullMQ (REDIS_URL ausente).');
    const ids = await this.ingest.listLocalSetIds();
    const day = new Date().toISOString().slice(0, 10);
    for (const setId of ids) {
      await this.queue.add(
        PRICE_INGEST_SET_JOB,
        { setId, fx },
        {
          // Idempotencia/single-flight: mismo set el mismo día no se duplica en la cola.
          jobId: `price-ingest-set-${setId}-${day}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5000 },
          removeOnComplete: true,
          removeOnFail: 100,
        },
      );
    }
    this.logger.log(`price-ingest: encolados ${ids.length} sets (fan-out BullMQ).`);
    return `price-ingest-${day}`;
  }

  /** Handler del child job (worker del scheduler): ingesta UN set con el FX del snapshot. */
  async runChild(data: { setId: string; fx: FxSnapshot }): Promise<void> {
    await this.ingest.ingestSet(data.setId, data.fx);
  }

  /**
   * Catch-up al boot (auditoría de precios 2026-08-17): si el scheduler está habilitado (hay
   * cola) y NO existe NINGUNA `PriceReference` de mercado reciente (hoy/ayer UTC), encola un
   * `price-ingest` inmediato con jobId dedup por día (`price-ingest-catchup-<día>`), para que
   * los precios se pueblen solos tras cada deploy aunque el cron 00:00/12:00 UTC se haya
   * perdido (p. ej. porque la conexión Redis estuvo rota o el deploy es nuevo).
   *
   * - Sin cola (local/CI sin Redis): no-op — NO se lanza el ingest secuencial pesado al boot.
   * - Dedup: el jobId por día + el upsert idempotente de `PriceReference` hacen que reinicios
   *   múltiples el mismo día no dupliquen trabajo.
   */
  async catchUpIfStale(): Promise<{ enqueued: boolean; reason: 'no-queue' | 'recent' | 'stale' }> {
    if (!this.queue) return { enqueued: false, reason: 'no-queue' };
    if (await this.ingest.hasRecentIngest()) {
      this.logger.log('price-ingest catch-up: hay ingesta reciente (hoy/ayer); no se encola.');
      return { enqueued: false, reason: 'recent' };
    }
    const day = new Date().toISOString().slice(0, 10);
    await this.queue.add(
      JOB,
      {},
      { jobId: `price-ingest-catchup-${day}`, removeOnComplete: true, removeOnFail: 100 },
    );
    this.logger.warn(
      `price-ingest catch-up: SIN ingesta de precios reciente → encolado price-ingest inmediato ` +
        `(jobId=price-ingest-catchup-${day}).`,
    );
    return { enqueued: true, reason: 'stale' };
  }
}
