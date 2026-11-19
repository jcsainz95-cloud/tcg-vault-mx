import { Body, Controller, HttpCode, Param, Post } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WithdrawalReturnService } from './withdrawal-return.service';
import { ShipmentsService } from './shipments.service';

class ReturnReceivedDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}

/** §RETIRO-SALIDA punto 3 — aislado (ver `WithdrawalReturnService`). Staff (operador o súper-admin), idempotente. */
@Controller('admin/shipments')
@Roles(Role.vault_operator, Role.super_admin)
export class WithdrawalReturnController {
  constructor(
    private readonly returns: WithdrawalReturnService,
    private readonly shipments: ShipmentsService,
  ) {}

  @Post(':id/return-received')
  @HttpCode(200)
  async returnReceived(@Param('id') id: string, @Body() body: ReturnReceivedDto, @CurrentUser() user: { id: string; role: Role }) {
    await this.shipments.assertOutboundRoute(id);
    const r = await this.returns.returnReceived(id, user, body?.note);
    return { shipment: this.shipments.toAdminRow(r.row), restored: r.restored, skipped: r.skipped, won: r.won };
  }
}
