import { Injectable, Logger } from '@nestjs/common';
import { FxService } from '../modules/pricing/fx.service';

/**
 * FxRefreshJobService — Job diario `fx-refresh` (ARCHITECTURE §5). Obtiene USD→MXN
 * de Banxico SIE, aplica el colchón y escribe FxRate (source=banxico). Delega en FxService.
 */
@Injectable()
export class FxRefreshJobService {
  private readonly logger = new Logger(FxRefreshJobService.name);

  constructor(private readonly fx: FxService) {}

  async run() {
    const r = await this.fx.refreshFromBanxico();
    this.logger.log(`fx-refresh: rate=${r.rate} source=${r.source}`);
    return r;
  }
}
