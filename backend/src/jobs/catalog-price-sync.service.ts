import { Injectable, Logger } from '@nestjs/common';
import { Optional } from '@nestjs/common';
import { CatalogSyncService } from '../modules/catalog/catalog-sync.service';
import { AuditService } from '../modules/audit/audit.service';

/** AUTO-A: intentos del job diario y backoff exponencial base (10, 20, 40, 80, 160 min = ventana ~5 h). */
export const CATALOG_METADATA_ATTEMPTS = 6;
export const CATALOG_METADATA_BACKOFF_MS = 10 * 60 * 1000;
/** Tope de tiempo por intento (el worker no queda ocupado indefinidamente). */
export const CATALOG_METADATA_ATTEMPT_TIMEOUT_MS = 45 * 60 * 1000;

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

  constructor(
    private readonly catalogSync: CatalogSyncService,
    @Optional() private readonly audit?: AuditService,
  ) {}

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
  async runMetadataImport(
    ctx: { attempt?: number; jobId?: string; timeoutMs?: number } = {},
  ): Promise<{ jobId: string; setsQueued: number; remaining: number }> {
    const attempt = ctx.attempt ?? 1;
    try {
      // Actor de SISTEMA: solo este job lo construye (ningun DTO/HTTP lo acepta). Habilita el paso TCGCSV sin rol humano.
      const res = await this.catalogSync.syncAll({
        force: false,
        actor: { kind: 'system', job: 'catalog-metadata-sync', jobId: ctx.jobId, attempt },
      });
      this.logger.log(
        `catalog-metadata-sync: import de sets nuevos (jobId=${res.jobId}, setsQueued=${res.setsQueued}, intento=${attempt}).`,
      );
      // AUTO-A (b): AGUARDA el fin real del barrido y lanza si termino mal -> BullMQ reintenta con backoff (idempotente).
      await this.catalogSync.awaitSyncAll(ctx.timeoutMs ?? CATALOG_METADATA_ATTEMPT_TIMEOUT_MS);
      return res;
    } catch (e) {
      this.logger.warn(`catalog-metadata-sync: intento ${attempt}/${CATALOG_METADATA_ATTEMPTS} fallo: ${(e as Error).message}`);
      if (attempt >= CATALOG_METADATA_ATTEMPTS) {
        // Intentos agotados: queda rastro y el siguiente cron diario lo vuelve a intentar; nadie pulsa nada.
        await this.audit
          ?.log({ action: 'catalog.sync_exhausted', entityType: 'CardSet', after: { attempts: attempt, error: (e as Error).message, jobId: ctx.jobId ?? null } })
          .catch(() => undefined);
      }
      throw e;
    }
  }
}
