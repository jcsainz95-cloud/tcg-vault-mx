import { Injectable, Logger } from '@nestjs/common';
import { FxService } from '../modules/pricing/fx.service';
import { FxSnapshot } from '../modules/pricing/price-ingest.service';
import { SealedPriceIngestService } from '../modules/pricing/sealed-price-ingest.service';

const JOB = 'sealed-price-ingest';

/** Res 202 del disparo (API_CONTRACT §M10-ops). */
export interface SealedPriceIngestTriggerResult {
  job: 'sealed-price-ingest';
  enqueued: boolean;
  jobId?: string;
  /** Con el dial `sealed_price_source=off`: fail-closed, no se ingiere nada (§4.19e). */
  reason?: 'SEALED_PRICE_SOURCE_OFF';
  /** Presentes solo en el disparo acotado `{ groupId }` (verificación de esquema, §4.19f). */
  scope?: 'group';
  groupId?: number;
}

/**
 * SealedPriceIngestJobService — orquestación del job `sealed-price-ingest`
 * (v1.19-sealed-tcgcsv, ARCHITECTURE §4.19d). 1×/día tras la actualización de TCGCSV
 * (~20:00 UTC) y tras fx-refresh (orden SUAVE: `FxService.getCurrent()` degrada al último
 * FxRate). Cron por env `SEALED_PRICE_INGEST_CRON` (sugerido 21:30 UTC; horario = devops).
 *
 * Forma de ejecución (§4.19d): **secuencial y AWAITED, SIN fan-out BullMQ** — el alcance es
 * minúsculo (solo los grupos distintos de los items mapeados, decenas de requests como mucho);
 * el fan-out por grupo sería sobre-ingeniería. Si el volumen creciera, se promueve al patrón
 * parent/child sin cambiar contrato.
 *
 * - **Fail-closed por dial:** con `sealed_price_source=off` (seed) el job y el disparo manual
 *   cortocircuitan (`enqueued:false`, `reason:'SEALED_PRICE_SOURCE_OFF'`) — no-op logueado.
 * - **Single-flight:** flag en memoria (patrón de la rama secuencial de `price-ingest`); el
 *   worker BullMQ y el HTTP admin viven en el MISMO proceso, así que el flag cubre ambos.
 * - **FX una vez por corrida** (§4.15f): snapshot cargado aquí y pasado al ingest.
 */
@Injectable()
export class SealedPriceIngestJobService {
  private readonly logger = new Logger(SealedPriceIngestJobService.name);
  private running = false;

  constructor(
    private readonly fx: FxService,
    private readonly ingest: SealedPriceIngestService,
  ) {}

  /**
   * Disparo del ingest (cron o `POST /admin/jobs/sealed-price-ingest`).
   * `groupId` (entero positivo, validado por el DTO del controller) acota a UN grupo.
   */
  async run(groupId?: number): Promise<SealedPriceIngestTriggerResult> {
    const scoped: Pick<SealedPriceIngestTriggerResult, 'scope' | 'groupId'> =
      groupId != null ? { scope: 'group', groupId } : {};

    if (!(await this.ingest.isEnabled())) {
      this.logger.log(
        'sealed-price-ingest: dial sealed_price_source=off → no-op (fail-closed, §4.19e).',
      );
      return { job: JOB, enqueued: false, reason: 'SEALED_PRICE_SOURCE_OFF', ...scoped };
    }

    if (this.running) {
      this.logger.warn('sealed-price-ingest ya en curso; no se lanza otro (single-flight).');
      return { job: JOB, enqueued: false, ...scoped };
    }
    this.running = true;
    try {
      const cur = await this.fx.getCurrent();
      const fx: FxSnapshot = { rate: cur.rate, bufferPct: cur.bufferPct };
      await this.ingest.run(fx, groupId);
    } finally {
      this.running = false;
    }
    return { job: JOB, enqueued: true, ...scoped };
  }
}
