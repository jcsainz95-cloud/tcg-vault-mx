import { Controller, Get, Param } from '@nestjs/common';
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

  @Get('holdings/:inventoryItemId')
  detail(@CurrentUser('id') userId: string, @Param('inventoryItemId') id: string) {
    return this.vault.holdingDetail(userId, id);
  }
}
