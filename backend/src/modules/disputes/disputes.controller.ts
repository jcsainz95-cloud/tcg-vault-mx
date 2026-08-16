import { Body, Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { IsIn, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { DisputesService } from './disputes.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';

class CreateDisputeDto {
  @IsString() inventoryItemId!: string;
  @IsString() description!: string;
  // v1.2: SIN claimPhotoUploadKeys — la evidencia se envía por correo a soporte (evidenceContact).
}

class ResolveDisputeDto {
  @IsIn(['repurchase', 'reject']) resolution!: 'repurchase' | 'reject';
  @IsString() note!: string;
}

@Controller('disputes')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser('id') userId: string, @Body() dto: CreateDisputeDto) {
    return this.disputes.create(userId, dto.inventoryItemId, dto.description);
  }

  @Get()
  list(@CurrentUser('id') userId: string) {
    return this.disputes.listMine(userId);
  }

  @Get(':id')
  get(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.disputes.getMine(userId, id);
  }
}

/**
 * M8 — Disputas admin. vault_operator+ (revisión); recompra = super_admin (money-out).
 */
@Controller('admin/disputes')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminDisputesController {
  constructor(
    private readonly disputes: DisputesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.disputes.adminList(
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      userId,
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.disputes.adminGet(id);
  }

  @Post(':id/resolve')
  async resolve(
    @Param('id') id: string,
    @Body() dto: ResolveDisputeDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // Solo `repurchase` es dinero saliente: exige super_admin (auditando el intento).
    if (dto.resolution === 'repurchase' && user.role !== Role.super_admin) {
      await this.audit.log({
        actorUserId: user.id,
        actorRole: user.role,
        action: 'money_out.blocked',
        entityType: 'Dispute',
        entityId: id,
      });
      throw BusinessException.forbidden(
        'MONEY_OUT_FORBIDDEN',
        'Only super_admin may execute a repurchase',
      );
    }
    const res = await this.disputes.resolve(id, dto.resolution, dto.note, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: `dispute.${dto.resolution}`,
      entityType: 'Dispute',
      entityId: id,
      after: { note: dto.note },
    });
    return res;
  }
}
