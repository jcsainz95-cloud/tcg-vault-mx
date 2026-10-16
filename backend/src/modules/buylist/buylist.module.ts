import { Module } from '@nestjs/common';
import { BuylistService } from './buylist.service';
import { BuylistController } from './buylist.controller';
import { BuylistCatalogController } from './buylist-catalog.controller';
import { AdminBuylistController } from './admin-buylist.controller';
import { PricingModule } from '../pricing/pricing.module';
import { UsersModule } from '../users/users.module';
import { CatalogModule } from '../catalog/catalog.module';
// v1.96⟨mkt-tienda⟩ (§MKT.D d4): conteo anónimo del cotizador. MarketingModule exporta SOLO el
// servicio de conteo (no toca la lógica de dinero); Prisma es @Global ⇒ sin ciclo.
import { MarketingModule } from '../marketing/marketing.module';

@Module({
  // CatalogModule (exporta CatalogService) sirve la búsqueda pública del cotizador
  // (`/buylist/cards` y `/buylist/sets`) sobre TODO el catálogo (v1.3, §6).
  imports: [PricingModule, UsersModule, CatalogModule, MarketingModule],
  providers: [BuylistService],
  controllers: [BuylistController, BuylistCatalogController, AdminBuylistController],
  exports: [BuylistService],
})
export class BuylistModule {}
