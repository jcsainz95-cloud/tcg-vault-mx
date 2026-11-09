import { Injectable, Logger, Optional } from '@nestjs/common';
import { CatalogContentKeyBackfillService } from './catalog-content-key-backfill.service';
import { CatalogStaleAlertService } from './catalog-stale-alert.service';
import { CatalogSyncService } from './catalog-sync.service';

/** Job `catalog-auto-watch` (cada 15 min): un paso del backfill de contentKey (reanudable) + vigilancia de >48 h sin exito. */
@Injectable()
export class CatalogAutoWatchService {
  private readonly logger = new Logger(CatalogAutoWatchService.name);
  constructor(
    private readonly backfill: CatalogContentKeyBackfillService,
    private readonly stale: CatalogStaleAlertService,
    @Optional() private readonly sync?: CatalogSyncService,
  ) {}

  async run(): Promise<{ backfill: unknown; stale: string }> {
    let bf: unknown = null;
    try {
      bf = await this.backfill.run({ isSyncRunning: () => this.sync?.getSyncStatus().running === true });
    } catch (e) {
      this.logger.warn(`catalog-auto-watch: backfill fallo (${(e as Error).message}).`);
    }
    let st = 'error';
    try {
      st = await this.stale.check();
    } catch (e) {
      this.logger.warn(`catalog-auto-watch: vigilancia fallo (${(e as Error).message}).`);
    }
    return { backfill: bf, stale: st };
  }
}
