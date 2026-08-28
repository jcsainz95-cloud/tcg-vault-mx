import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import { SealedCondition, SealedSubtype } from '@prisma/client';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogService } from './catalog.service';
import { SetValueService } from './set-value.service';
import { SealedCatalogService } from './sealed-catalog.service';
import { SEALED_CONDITION_VALUES, SEALED_SUBTYPE_VALUES } from '../../common/enum-values';

/** v1.23-sealed-sales (§2-S): «avísame cuando vuelva». Identidad = productId o cardId(+subtype). */
class RestockSubscriptionDto {
  @IsString() email!: string;
  @IsOptional() @IsInt() tcgplayerProductId?: number;
  @IsOptional() @IsString() cardId?: string;
  @IsOptional() @IsIn(SEALED_SUBTYPE_VALUES) sealedSubtype?: SealedSubtype;
  @IsIn(SEALED_CONDITION_VALUES) sealedCondition!: SealedCondition;
}

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly setValue: SetValueService,
    private readonly sealed: SealedCatalogService,
  ) {}

  @Public()
  @Get('cards')
  listCards(
    @Query('q') q?: string,
    @Query('setId') setId?: string,
    @Query('rarity') rarity?: string,
    @Query('productType') productType?: string,
    @Query('condition') condition?: string,
    @Query('finish') finish?: string,
    @Query('sealedSubtype') sealedSubtype?: string,
    @Query('minPriceCents') minPriceCents?: string,
    @Query('maxPriceCents') maxPriceCents?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort?: string,
    // v1.44-graded-estimate (§2 / §4.35f): vitrina «Joyas para gradear» = ESTE endpoint filtrado
    // (`?gradingHighlight=true&sort=grading_showcase`), no un endpoint nuevo — misma teja, misma cifra,
    // cero drift con Compra. Se pasa CRUDO: el saneo (solo se acepta `"true"`) lo hace el servicio.
    @Query('gradingHighlight') gradingHighlight?: string,
  ) {
    return this.catalog.listCards({
      q,
      setId,
      rarity,
      productType,
      condition,
      finish,
      sealedSubtype,
      gradingHighlight,
      minPriceCents: minPriceCents ? parseInt(minPriceCents, 10) : undefined,
      maxPriceCents: maxPriceCents ? parseInt(maxPriceCents, 10) : undefined,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      sort,
    });
  }

  // v1.1 — facetas dinámicas de "Compra" (rarezas/sets/tipos/subtipos/rango de precio).
  @Public()
  @Get('facets')
  facets() {
    return this.catalog.facets();
  }

  // ===== v1.23-sealed-sales (§2-S) — ventana de tienda del PRODUCTO CERRADO =====
  // NOTA de orden de rutas: `catalog/sealed` va ANTES de `catalog/cards/:cardId` no aplica (prefijos
  // distintos), pero SÍ importa que `sealed/:inventoryItemId` no colisione con subrutas estáticas.

  // Grid agregado por producto+condición («N disponibles»). Filtros: set, subtipo, condición, q.
  @Public()
  @Get('sealed')
  listSealed(
    @Query('setId') setId?: string,
    @Query('sealedSubtype') sealedSubtype?: string,
    @Query('condition') condition?: string,
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort?: string,
  ) {
    return this.sealed.listSealed({
      setId,
      sealedSubtype,
      condition,
      q,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      sort,
    });
  }

  // Ficha del sellado (grupo + todas las piezas del grupo, más baratas primero) + estado de flags.
  @Public()
  @Get('sealed/:inventoryItemId')
  sealedDetail(@Param('inventoryItemId') id: string) {
    return this.sealed.sealedDetail(id);
  }

  // Tendencia de valor del sellado (FEATURE-FLAGGED sealed_value_trend → 404 FEATURE_DISABLED si off).
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('sealed/:inventoryItemId/value-history')
  sealedValueHistory(@Param('inventoryItemId') id: string, @Query('range') range = '1m') {
    return this.sealed.sealedValueHistory(id, range);
  }

  // «Avísame cuando vuelva» (FEATURE-FLAGGED sealed_restock_alerts). Respuesta NEUTRA 202 + rate-limit.
  @Public()
  @HttpCode(202)
  @Throttle({ default: { ttl: 60_000, limit: 5 } })
  @Post('sealed/restock-subscriptions')
  subscribeRestock(@Body() dto: RestockSubscriptionDto, @CurrentUser('id') userId?: string) {
    return this.sealed.subscribeRestock(dto, userId);
  }

  @Public()
  @Get('cards/:cardId')
  getCard(@Param('cardId') cardId: string) {
    return this.catalog.getCard(cardId);
  }

  @Public()
  @Get('listings/:inventoryItemId')
  getListing(@Param('inventoryItemId') id: string) {
    return this.catalog.getListing(id);
  }

  @Public()
  @Get('sets')
  listSets() {
    return this.catalog.listSets();
  }

  // v1.9-set-chart — gráfica PÚBLICA del valor del SET DESTACADO (hero de la home). El set se
  // resuelve server-side (env HOME_FEATURED_SET_ID + fallback, ARCHITECTURE §4.12b); el front NO
  // hardcodea id. Sin PII: solo valor agregado de mercado. Query ?range= (default 1m).
  // SEC-F1: rate-limit propio (60/min por IP) anti-scraping, en PARIDAD con los otros públicos
  // (BuylistCatalogController). El endpoint es público (sin sesión) pero acotado por IP.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('featured-set/value-history')
  featuredSetValueHistory(@Query('range') range = '1m') {
    return this.setValue.featuredSetHistory(range);
  }

  // v1.9-set-chart — misma serie para un set específico por su id LOCAL (CardSet.id). 404 si no existe.
  // SEC-F1: mismo rate-limit propio (60/min por IP) que el endpoint del set destacado.
  @Public()
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Get('sets/:id/value-history')
  setValueHistory(@Param('id') id: string, @Query('range') range = '1m') {
    return this.setValue.setHistoryById(id, range);
  }
}
