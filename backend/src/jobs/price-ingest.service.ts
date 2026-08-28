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
  /** N-11 — disparo en segundo plano (fire-and-forget); el front pollea `sync-status`. */
  background?: boolean;
  /** N-11 — ya había un barrido en curso (single-flight); no se lanzó otro. */
  alreadyRunning?: boolean;
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
      // v1.50.2 (§4.38h): el ingest de estimados PSA corre APARTE del fan-out por set. No se encola
      // por set a propósito: su alcance es «cartas con inventario publicado», que es transversal a los
      // sets y ya viene acotado por su propio tope de cuota. Con el dial `off` (seed) es un no-op de
      // una sola lectura de config.
      await this.runGradedEstimates(fx);
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
      await this.runGradedEstimates(fx);
    } finally {
      this.running = false;
    }
    return { job: JOB, enqueued: true };
  }

  /**
   * v1.50.2 (§4.38h) — ingest de ESTIMADOS PSA (fase 2), fail-closed por su PROPIO dial.
   *
   * Se aísla en su propio `try` **a propósito**: un fallo del gancho —que es informativo— **no puede**
   * tumbar ni ensuciar el barrido de precios de venta, que sí es dinero. La relación de dependencia va
   * en un solo sentido y así se mantiene.
   */
  private async runGradedEstimates(fx: FxSnapshot): Promise<void> {
    try {
      const res = await this.ingest.ingestGradedEstimates(fx);
      if (res.escalation) {
        this.logger.error(
          `⛔ graded-estimate-ingest requiere DECISIÓN DEL ARQUITECTO (regla 9): ${res.escalation.reason}.`,
        );
      }
    } catch (e) {
      this.logger.error(`graded-estimate-ingest falló: ${(e as Error).message} (no afecta al barrido).`);
    }
  }

  /**
   * N-11 — disparo MANUAL del catálogo COMPLETO en segundo plano (fire-and-forget) con barra de
   * progreso, calcando `catalog-sync.syncAll`. Single-flight vía `PriceIngestService.getSyncStatus`.
   * Devuelve de INMEDIATO; el barrido corre secuencial (respeta el throttle/daily-stop, secuencial
   * por naturaleza) y actualiza `sync-status` por set, que el front pollea. NO bloquea el request.
   * El CRON 2×/día sigue usando `run()` (fan-out BullMQ / secuencial), sin cambios.
   */
  async runBackground(): Promise<PriceIngestTriggerResult> {
    if (this.ingest.getSyncStatus().running) {
      this.logger.warn('price-ingest ya en curso (background); no se lanza otro (single-flight).');
      return { job: JOB, enqueued: false, background: true, alreadyRunning: true };
    }
    const cur = await this.fx.getCurrent();
    const fx: FxSnapshot = { rate: cur.rate, bufferPct: cur.bufferPct };
    // Fire-and-forget: el request NO espera al barrido. Los errores se loguean (no se propagan).
    void this.ingest.ingestAll(fx).catch((e) => {
      this.logger.error(`price-ingest background falló: ${(e as Error).message}`);
    });
    return { job: JOB, enqueued: true, background: true, alreadyRunning: false };
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
    // WS-A fix-ppt: solo se encolan los sets EN SCOPE (modernos + viejos con inventario/rares) cuando
    // el proveedor es el de PAGA; con el legacy se encolan todos. Evita gastar créditos en sets viejos
    // de puro bulk. Si un child topa la cuota DIARIA, el `PptApiClient` (singleton del worker) queda
    // marcado y los children restantes cortan de inmediato sin pegarle al proveedor.
    const ids = await this.ingest.listSetIdsForIngest();
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
