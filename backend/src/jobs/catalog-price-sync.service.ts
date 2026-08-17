import { Injectable, Logger } from '@nestjs/common';
import { CatalogSyncService } from '../modules/catalog/catalog-sync.service';

/**
 * CatalogPriceSyncJobService — Job programado 2×/día (v1.12-catalog-pricing, ARCHITECTURE §4.13c / §5).
 *
 * Refresca precios de TODO el catálogo + importa sets nuevos EN UNA sola pasada. pokemontcg.io no
 * expone un endpoint bulk de solo-precios (el `market` viaja embebido en cada carta), así que
 * "refrescar precios" = **re-sync completo del catálogo** con semántica `force:true`:
 * `CatalogSyncService.syncAll({ force:true })` reprocesa todos los sets remotos → `upsertCards`
 * repuebla cartas + `availableFinishes` + `PriceReference` por acabado (§4.13a) con el FX del día,
 * e importa los sets que aún no existían localmente en la misma corrida.
 *
 * Secuencial (respeta el backoff 429 del `PokemonTcgIoClient`); **single-flight** garantizado por
 * `syncAllStatus.running` dentro de `syncAll` (dos corridas no se solapan). Idempotente (upsert por
 * `externalId` / por clave día-acabado). Se programa a las 06:00 y 18:00 CDMX (= 00:00 y 12:00 UTC)
 * en `SchedulerService`, configurable por env. También disparable a mano (`POST /admin/jobs/catalog-price-sync`).
 */
@Injectable()
export class CatalogPriceSyncJobService {
  private readonly logger = new Logger(CatalogPriceSyncJobService.name);

  constructor(private readonly catalogSync: CatalogSyncService) {}

  /**
   * Lanza el re-sync completo con `force:true`. Devuelve el shape de `syncAll`
   * (`{ jobId, setsQueued, remaining }`). El barrido corre en segundo plano dentro del proceso;
   * `single-flight` evita solapes con una corrida ya en curso (retorna `setsQueued:0`).
   */
  async run(): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const res = await this.catalogSync.syncAll({ force: true });
    this.logger.log(
      `catalog-price-sync: re-sync force lanzado (jobId=${res.jobId}, setsQueued=${res.setsQueued}, remaining=${res.remaining}).`,
    );
    return res;
  }

  /**
   * WS-A (v1.14-price-ingest, §4.15g) — import de METADATA de sets NUEVOS con `force:false`
   * (barato: salta los sets ya poblados; NO re-descarga todo el catálogo). Es la cadencia LIGERA
   * que el scheduler corre a diario en lugar del barrido pesado `force:true` (cuyo rol de pricing lo
   * asumió `price-ingest`). El disparo manual `run()` (force:true) se conserva para ops.
   */
  async runMetadataImport(): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const res = await this.catalogSync.syncAll({ force: false });
    this.logger.log(
      `catalog-metadata-sync: import de sets nuevos (jobId=${res.jobId}, setsQueued=${res.setsQueued}).`,
    );
    return res;
  }
}
