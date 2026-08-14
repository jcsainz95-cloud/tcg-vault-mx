import { Module } from '@nestjs/common';
import { CatalogService } from './catalog.service';
import { CatalogController } from './catalog.controller';
import { AdminCatalogController } from './admin-catalog.controller';
import { CatalogSyncService } from './catalog-sync.service';
import { PokemonTcgIoClient } from './pokemontcg-io.client';
import { PricingModule } from '../pricing/pricing.module';

@Module({
  imports: [PricingModule], // SettingsModule/AuditModule/PrismaModule son @Global
  providers: [CatalogService, CatalogSyncService, PokemonTcgIoClient],
  controllers: [CatalogController, AdminCatalogController],
  exports: [CatalogService],
})
export class CatalogModule {}
