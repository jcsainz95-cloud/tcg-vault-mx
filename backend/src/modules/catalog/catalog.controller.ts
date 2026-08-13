import { Controller, Get, Param, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { CatalogService } from './catalog.service';

@Controller('catalog')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Public()
  @Get('cards')
  listCards(
    @Query('q') q?: string,
    @Query('setId') setId?: string,
    @Query('rarity') rarity?: string,
    @Query('productType') productType?: string,
    @Query('condition') condition?: string,
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
      minPriceCents: minPriceCents ? parseInt(minPriceCents, 10) : undefined,
      maxPriceCents: maxPriceCents ? parseInt(maxPriceCents, 10) : undefined,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      sort,
    });
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
}
