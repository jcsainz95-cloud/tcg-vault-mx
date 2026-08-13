import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SettingsService } from './settings.service';
import { AuditService } from '../audit/audit.service';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * M10 — Config (diales) y bitácora global. API_CONTRACT §M10. Solo super_admin.
 */
@Controller('admin')
@Roles(Role.super_admin)
export class SettingsController {
  constructor(
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('settings')
  async getSettings() {
    return this.settings.getAllDto();
  }

  @Put('settings')
  async updateSettings(
    @Body() body: Record<string, unknown>,
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: Role,
  ) {
    const before = await this.settings.getAllDto();
    const applied = await this.settings.update(body, userId);
    await this.audit.log({
      actorUserId: userId,
      actorRole: role,
      action: 'settings.update',
      entityType: 'ConfigSetting',
      before,
      after: applied,
    });
    return this.settings.getAllDto();
  }

  @Get('audit-log')
  async auditLog(
    @Query('actorUserId') actorUserId?: string,
    @Query('action') action?: string,
    @Query('entityType') entityType?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const p = Math.max(1, parseInt(page, 10) || 1);
    const ps = Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20));
    const where: Record<string, unknown> = {};
    if (actorUserId) where.actorUserId = actorUserId;
    if (action) where.action = action;
    if (entityType) where.entityType = entityType;
    if (from || to) {
      where.createdAt = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (p - 1) * ps,
        take: ps,
        select: {
          id: true,
          actorUserId: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          createdAt: true,
        },
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return { data, page: p, pageSize: ps, total };
  }
}
