import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';
import { SetValueService } from './set-value.service';

@Controller('catalog')
export class CatalogController {
  constructor(
    private readonly catalog: CatalogService,
    private readonly setValue: SetValueService,
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
  ) {
    return this.catalog.listCards({
      q,
      setId,
      rarity,
      productType,
      condition,
      finish,
      sealedSubtype,
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
  @Public()
  @Get('featured-set/value-history')
  featuredSetValueHistory(@Query('range') range = '1m') {
    return this.setValue.featuredSetHistory(range);
  }

  // v1.9-set-chart — misma serie para un set específico por su id LOCAL (CardSet.id). 404 si no existe.
  @Public()
  @Get('sets/:id/value-history')
  setValueHistory(@Param('id') id: string, @Query('range') range = '1m') {
    return this.setValue.setHistoryById(id, range);
  }
}
