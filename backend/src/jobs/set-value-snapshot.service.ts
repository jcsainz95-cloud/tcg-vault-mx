import { Injectable, Logger } from '@nestjs/common';
import { SetValueService } from '../modules/catalog/set-value.service';

/**
 * SetValueSnapshotJobService — Job diario `set-value-snapshot` (v1.9-set-chart, ARCHITECTURE
 * §4.12c / §5). Tras `set-price-sync`, computa el valor agregado del set destacado HOY
 * (server-side desde PriceReference real, SEC-A1) y hace UPSERT del SetValueSnapshot del día
 * (idempotente por `@@unique[setId, asOfDate]`). Es "captúralo diario": la serie del hero se
 * siembra con el valor de hoy y crece día a día (no se fabrican puntos). Delega en
 * `SetValueService.snapshotFeaturedSet()` para no duplicar la lógica de resolución/agregación.
 */
@Injectable()
export class SetValueSnapshotJobService {
  private readonly logger = new Logger(SetValueSnapshotJobService.name);

  constructor(private readonly setValue: SetValueService) {}

  async run(): Promise<{
    setId: string | null;
    totalValueMxnCents: number;
    pricedCardCount: number;
    totalCardCount: number;
  }> {
    return this.setValue.snapshotFeaturedSet();
  }
}
