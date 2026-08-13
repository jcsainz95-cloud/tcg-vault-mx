import { Body, Controller, Get, Headers, HttpCode, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, ShipmentQuoteDto } from './dto/shipments.dto';

@Controller('shipments')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post('quote')
  @HttpCode(200)
  quote(@CurrentUser('id') userId: string, @Body() dto: ShipmentQuoteDto) {
    return this.shipments.quote(userId, dto.inventoryItemIds, dto.addressId);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateShipmentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.shipments.create(userId, dto.inventoryItemIds, dto.addressId, idempotencyKey);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.shipments.listMine(userId);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.shipments.getMine(userId, id);
  }
}
