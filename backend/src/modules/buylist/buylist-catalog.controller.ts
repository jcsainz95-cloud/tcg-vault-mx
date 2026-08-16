import { Controller, Get, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from '../catalog/catalog.service';

/**
 * Cotizador — búsqueda pública sobre TODO el catálogo (tabla `Card`), API_CONTRACT §6 (v1.3).
 *
 * Distinto de "Compra" (`/catalog/*`, acotado a inventario publicado con precio,
 * ARCHITECTURE §4.9): aquí el usuario puede elegir CUALQUIER carta importada para cotizar,
 * aunque no la tengamos en bóveda. El resultado alimenta `POST /buylist/quote` (recibe `cardId`).
 *
 * Rate-limit anti-scraping (60/min por IP, más estricto que el global de 300/min) SIN exigir
 * sesión: la búsqueda es pública pero acotada para no facilitar el volcado del catálogo.
 */
@Controller('buylist')
export class BuylistCatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('cards')
  cards(
    @Query('setId') setId?: string,
    @Query('q') q?: string,
    @Query('rarity') rarity?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.catalog.searchAllCards({
      setId,
      q,
      rarity,
      page: Math.max(1, parseInt(page, 10) || 1),
      // Tope de servidor (≤100) como el resto de endpoints paginados públicos.
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('sets')
  sets() {
    return this.catalog.listSetsWithImportedCards();
  }
}
