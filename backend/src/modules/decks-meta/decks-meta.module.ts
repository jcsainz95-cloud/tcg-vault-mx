import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DecksMetaService } from './decks-meta.service';
import { DeckMatcherService } from './deck-matcher.service';
import { DecksMetaController } from './decks-meta.controller';
import {
  AdminDecksMetaController,
  AdminStandardLegalityController,
} from './admin-decks-meta.controller';

/**
 * DECKS-META §12.2 (Fase 1) — módulo NUEVO y disjunto del mapa de streams. LEE `catalog` (precio/
 * disponibilidad reusados vía `CatalogService`, sin reinventar) y escribe SÓLO lo suyo (Meta*).
 * PrismaModule es @Global. No toca checkout/quote (el carrito sigue de cliente: el server sólo
 * devuelve los `inventoryItemId` disponibles+legales por línea).
 */
@Module({
  imports: [CatalogModule], // exporta CatalogService (precio + disponibilidad reusados, §3.4)
  providers: [DecksMetaService, DeckMatcherService],
  controllers: [DecksMetaController, AdminDecksMetaController, AdminStandardLegalityController],
})
export class DecksMetaModule {}
