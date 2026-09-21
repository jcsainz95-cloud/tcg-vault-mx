import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { DecksMetaService } from './decks-meta.service';
import { DeckMatcherService } from './deck-matcher.service';
import { DecksMetaController } from './decks-meta.controller';
import { AdminDecksMetaController } from './admin-decks-meta.controller';
// DECKS-META Fase 2 (auto-fetch): adapter de fetch + orquestador del refresh semanal. El servicio
// se EXPORTA para que el scheduler BullMQ y el disparo admin (`AdminJobsController`) lo usen (§7).
import { LimitlessFetchClient } from './limitless-fetch.client';
import { DecksMetaRefreshService } from './decks-meta-refresh.service';

/**
 * DECKS-META §12.2 (Fase 1) — módulo NUEVO y disjunto del mapa de streams. LEE `catalog` (precio/
 * disponibilidad reusados vía `CatalogService`, sin reinventar) y escribe SÓLO lo suyo (Meta*).
 * PrismaModule es @Global. No toca checkout/quote (el carrito sigue de cliente: el server sólo
 * devuelve los `inventoryItemId` disponibles por línea).
 *
 * Fase 2 (auto-fetch, spec §7): añade `LimitlessFetchClient` + `DecksMetaRefreshService`
 * (ConfigModule/AuditModule son @Global). El refresh se exporta para el scheduler y el disparo admin.
 */
@Module({
  imports: [CatalogModule], // exporta CatalogService (precio + disponibilidad reusados, §3.4)
  providers: [DecksMetaService, DeckMatcherService, LimitlessFetchClient, DecksMetaRefreshService],
  controllers: [DecksMetaController, AdminDecksMetaController],
  exports: [DecksMetaRefreshService],
})
export class DecksMetaModule {}
