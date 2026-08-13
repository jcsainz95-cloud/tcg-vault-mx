import { Body, Controller, Get, Header, Param, Patch, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsIn, IsInt, IsOptional, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';

class UpdateKycDto {
  @IsIn(['none', 'pending', 'verified', 'rejected']) kycStatus!: string;
  @IsOptional() @IsInt() @Min(0) capPerRequestCents?: number;
  @IsOptional() @IsInt() @Min(0) capPerMonthCents?: number;
}

class UpdateStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
}

/** M6 Usuarios: lista/ficha para vault_operator (limitado) + super_admin. */
@Controller('admin/users')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminUsersController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.admin.listUsers(
      q,
      status,
      Math.max(1, parseInt(page, 10) || 1),
      Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    );
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Patch(':id/kyc')
  @Roles(Role.super_admin)
  async updateKyc(
    @Param('id') id: string,
    @Body() dto: UpdateKycDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.updateUserKyc(
      id,
      dto.kycStatus,
      dto.capPerRequestCents,
      dto.capPerMonthCents,
      user.id,
    );
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.kyc.update',
      entityType: 'User',
      entityId: id,
      after: dto as unknown,
    });
    return res;
  }

  @Patch(':id/status')
  @Roles(Role.super_admin)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateStatusDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.updateUserStatus(id, dto.status);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.status.update',
      entityType: 'User',
      entityId: id,
      after: { status: dto.status },
    });
    return res;
  }
}

/** M7 Finanzas: solo super_admin. */
@Controller('admin/finance')
@Roles(Role.super_admin)
export class AdminFinanceController {
  constructor(private readonly admin: AdminService) {}

  @Get('pnl')
  pnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.pnl(from, to);
  }

  @Get('inventory-value')
  inventoryValue() {
    return this.admin.inventoryValue();
  }

  @Get('custody-value')
  custodyValue() {
    return this.admin.custodyValue();
  }

  @Get('iva')
  iva(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.ivaReport(from, to);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('report') report = 'pnl',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.admin.exportCsv(report, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    res.send(csv);
  }
}

/** M9 Reportes: solo super_admin. */
@Controller('admin/reports')
@Roles(Role.super_admin)
export class AdminReportsController {
  constructor(private readonly admin: AdminService) {}

  @Get('launch-metrics')
  launchMetrics(@Query('from') from?: string, @Query('to') to?: string) {
    return this.admin.launchMetrics(from, to);
  }

  @Get('export.csv')
  @Header('Content-Type', 'text/csv')
  async exportCsv(
    @Res() res: Response,
    @Query('report') report = 'pnl',
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const csv = await this.admin.exportCsv(report, from, to);
    res.setHeader('Content-Disposition', `attachment; filename="${report}.csv"`);
    res.send(csv);
  }
}

/** Dashboard (~8 tarjetas): vault_operator+ (dinero solo super_admin). */
@Controller('admin/dashboard')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminDashboardController {
  constructor(private readonly admin: AdminService) {}

  @Get()
  dashboard(
    @CurrentUser('role') role: Role,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.admin.dashboard(role, from, to);
  }
}
