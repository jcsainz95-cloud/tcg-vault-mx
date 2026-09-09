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

  /**
   * v1.63 (§M2-F.5): `refreshFromBanxico()` devuelve el RESULTADO REAL del fetch
   * (`updated | unchanged | failed` + `reason`), no la tasa de vuelta. El job lo registra tal cual:
   * antes, sin `BANXICO_SIE_TOKEN`, esta línea imprimía la tasa del override manual y el refresco
   * parecía haber ido bien (hecho F7). Un `failed` aquí es la señal de D-OPS-1 (falta el token).
   */
  async run() {
    const r = await this.fx.refreshFromBanxico();
    if (r.outcome === 'failed') {
      this.logger.warn(`fx-refresh: outcome=failed reason=${r.reason} (NO se consultó a Banxico o falló)`);
    } else {
      this.logger.log(`fx-refresh: outcome=${r.outcome} fetchedRate=${r.fetchedRate}`);
    }
    return r;
  }
}
