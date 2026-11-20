/**
 * DemandModule — §DEMANDA F1+F2 (API_CONTRACT_DEMANDA). «Demanda sin stock»: lectura de wishlist, búsquedas sin resultado y
 * búsquedas de cartas agotadas; job `demand-match`. Módulo NO financiero: no mueve dinero ni inventario. Sin ciclo: ni Wishlist,
 * ni Catalog, ni Marketing importan éste; lo importa `JobsModule` (el planificador).
 */
import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { WishlistModule } from '../wishlist/wishlist.module';
import { MarketingModule } from '../marketing/marketing.module';
import { DemandController } from './demand.controller';
import { DemandGapsService } from './demand-gaps.service';
import { DemandMatchService } from './demand-match.service';

@Module({
  imports: [CatalogModule, WishlistModule, MarketingModule],
  providers: [DemandGapsService, DemandMatchService],
  controllers: [DemandController],
  exports: [DemandMatchService],
})
export class DemandModule {}
