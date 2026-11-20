/**
 * DemandCoreModule — §DEMANDA: la escritura de demanda por carta agotada (`DemandSearchService`). Sin dependencia de Marketing, para que
 * `MarketingModule` lo importe sin ciclo (DemandModule importa Marketing y este módulo).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DemandSearchService } from './demand-search.service';

@Module({
  imports: [CatalogModule],
  providers: [DemandSearchService],
  exports: [DemandSearchService],
})
export class DemandCoreModule {}
