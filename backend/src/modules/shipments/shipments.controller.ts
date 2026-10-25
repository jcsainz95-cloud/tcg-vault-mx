import { Body, Controller, Get, Headers, HttpCode, Ip, Param, Post, Res } from '@nestjs/common';
import { Response } from 'express';
import { retryAfterOf } from '../discounts/discounts.service';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { RequireEmailVerified } from '../../common/decorators/require-email-verified.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentsService } from './shipments.service';
import { CreateShipmentDto, ShipmentQuoteDto } from './dto/shipments.dto';

@Controller('shipments')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Post('quote')
  @HttpCode(200)
  quote(@CurrentUser('id') userId: string, @Body() dto: ShipmentQuoteDto, @Ip() ip?: string) {
    // 💰 v1.110 (§DSC.8): sin `discountCode`, la llamada de hoy (I-1).
    if (dto.discountCode === undefined) return this.shipments.quote(userId, dto.inventoryItemIds, dto.addressId);
    return this.shipments.quote(userId, dto.inventoryItemIds, dto.addressId, { discountCode: dto.discountCode, ip });
  }

  // v1.5: retirar/enviar es acción sensible → requiere emailVerified (el `quote` no se bloquea).
  @RequireEmailVerified()
  @Post()
  @HttpCode(201)
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateShipmentDto,
    @Headers('idempotency-key') idempotencyKey?: string,
    @Res({ passthrough: true }) res?: Response,
    @Ip() ip?: string,
  ) {
    // 💰 v1.110 (§DSC.8): sin `discountCode`, la llamada de hoy (I-1); `429` ⇒ cabecera `Retry-After`.
    if (dto.discountCode === undefined) return this.shipments.create(userId, dto.inventoryItemIds, dto.addressId, idempotencyKey);
    return this.shipments
      .create(userId, dto.inventoryItemIds, dto.addressId, idempotencyKey, { discountCode: dto.discountCode, ip })
      .catch((e: unknown) => {
        const retryAfter = retryAfterOf(e);
        if (retryAfter !== null) res?.setHeader('Retry-After', String(retryAfter));
        throw e;
      });
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
