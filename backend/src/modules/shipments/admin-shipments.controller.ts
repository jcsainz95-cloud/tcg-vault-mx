import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ShipmentsService } from './shipments.service';
import { AuditService } from '../audit/audit.service';
import { TrackingDto, UpdateStatusDto } from './dto/shipments.dto';

/**
 * M4 — Retiros / envíos (vault_operator+). API_CONTRACT §M4.
 */
@Controller('admin/shipments')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminShipmentsController {
  constructor(
    private readonly shipments: ShipmentsService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.shipments.adminList(
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  @Get('picking-list')
  pickingList(@Query('date') date?: string) {
    return this.shipments.pickingList(date);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.shipments.adminGet(id);
  }

  @Patch(':id/status')
  async status(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.shipments.updateStatus(id, dto.to);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'shipment.status',
      entityType: 'ShipmentRequest',
      entityId: id,
      after: { to: dto.to },
    });
    return res;
  }

  @Post(':id/tracking')
  async tracking(
    @Param('id') id: string,
    @Body() dto: TrackingDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.shipments.setTracking(
      id,
      dto.carrier,
      dto.trackingNumber,
      dto.shippingCostCents,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'shipment.tracking',
      entityType: 'ShipmentRequest',
      entityId: id,
      after: {
        carrier: dto.carrier,
        trackingNumber: dto.trackingNumber,
        shippingCostCents: res.shippingCostCents,
      },
    });
    return res;
  }
}
