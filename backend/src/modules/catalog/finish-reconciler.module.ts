import { Module } from '@nestjs/common';
import { FinishReconciler } from './finish-reconciler.service';

/**
 * FinishReconcilerModule (v1.22-1, ARCHITECTURE §4.22g/§4.22h) — aloja al ÚNICO escritor de
 * `Card.availableFinishes`. Vive en su propio módulo (sin dependencias más allá del `PrismaService`
 * @Global) para que TANTO `CatalogModule` (catalog-sync) COMO `PricingModule` (price-ingest) lo
 * importen y COMPARTAN la misma instancia SIN crear un ciclo de módulos entre ellos (evita
 * `forwardRef`). El reconciliador pertenece conceptualmente a `catalog` (vive en su carpeta).
 */
@Module({
  providers: [FinishReconciler],
  exports: [FinishReconciler],
})
export class FinishReconcilerModule {}
