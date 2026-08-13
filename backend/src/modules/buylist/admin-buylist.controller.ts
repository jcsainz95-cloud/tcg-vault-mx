import { Body, Controller, Get, Headers, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BuylistService } from './buylist.service';
import { AuditService } from '../audit/audit.service';
import { ItemDecisionDto, PaySpeiDto } from './dto/buylist.dto';

/**
 * M5 — Buylist admin. vault_operator hasta verificación; super_admin pago SPEI.
 * API_CONTRACT §M5.
 */
@Controller('admin/buylist')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminBuylistController {
  constructor(
    private readonly buylist: BuylistService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.buylist.adminList(
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.buylist.adminGet(id);
  }

  @Post(':id/receive')
  async receive(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.receive(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.receive',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  @Post(':id/verify')
  async verify(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.buylist.verify(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.verify',
      entityType: 'SellRequest',
      entityId: id,
    });
    return res;
  }

  @Patch('items/:itemId/decision')
  async decision(
    @Param('itemId') itemId: string,
    @Body() dto: ItemDecisionDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.itemDecision(itemId, dto.decision, dto.approvedPriceCents);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: `buylist.item.${dto.decision}`,
      entityType: 'SellRequestItem',
      entityId: itemId,
      after: { approvedPriceCents: dto.approvedPriceCents },
    });
    return res;
  }

  @Post('items/:itemId/convert-to-inventory')
  async convert(
    @Param('itemId') itemId: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.buylist.convertToInventory(itemId, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'buylist.convert_to_inventory',
      entityType: 'SellRequestItem',
      entityId: itemId,
      after: res,
    });
    return res;
  }

  @Post(':id/pay-spei')
  @MoneyOut()
  async paySpei(
    @Param('id') id: string,
    @Body() dto: PaySpeiDto,
    @CurrentUser() user: { id: string; role: Role },
    @Headers('idempotency-key') _idempotencyKey?: string,
  ) {
    const res = await this.buylist.paySpei(id, dto.speiReference, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'sellrequest.pay_spei',
      entityType: 'SellRequest',
      entityId: id,
      after: { speiReference: dto.speiReference },
    });
    return res;
  }
}
