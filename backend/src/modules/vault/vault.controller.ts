import { Controller, Get, Param, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VaultService } from './vault.service';

@Controller('vault')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class VaultController {
  constructor(private readonly vault: VaultService) {}

  @Get('holdings')
  holdings(@CurrentUser('id') userId: string) {
    return this.vault.holdings(userId);
  }

  // v1.1 — gráfica de tendencia del portafolio (rangos 5d|15d|1m|3m|6m|1y|ytd|all).
  @Get('portfolio/history')
  portfolioHistory(@CurrentUser('id') userId: string, @Query('range') range = '1m') {
    return this.vault.portfolioHistory(userId, range);
  }

  @Get('holdings/:inventoryItemId')
  detail(@CurrentUser('id') userId: string, @Param('inventoryItemId') id: string) {
    return this.vault.holdingDetail(userId, id);
  }
}
