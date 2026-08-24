import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { AuditService } from '../audit/audit.service';
import { UserAuditScope } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';

export class UpdateKycDto {
  @IsIn(['none', 'pending', 'verified', 'rejected']) kycStatus!: string;
  @IsOptional() @IsInt() @Min(0) capPerRequestCents?: number;
  @IsOptional() @IsInt() @Min(0) capPerMonthCents?: number;
}

/**
 * `PATCH /admin/users/:id/status` — **la lista `['active','blocked']` es una DECISIÓN DE PRODUCTO,
 * no un espejo del schema. NO la derives de `UserStatus`.** (T-3, techlead — v2.1.9.)
 *
 * `UserStatus` tiene TRES valores: `active | blocked | deleted`. Aquí se aceptan dos **a propósito**:
 * `deleted` lo fija **exclusivamente** `DELETE /admin/users/:id` (`AdminService.deleteUser`), que hace
 * mucho más que cambiar una columna — **anonimiza la PII**, pone `passwordHash: null`, **incrementa
 * `tokenVersion`** (revoca los JWT vivos) y borra direcciones/KYC.
 *
 * El riesgo concreto que este comentario existe para evitar: el candado de residuo de
 * `enum-values-parity.spec.ts` marca las listas de enums escritas a mano como infractoras. El día que
 * alguien «termine» esa derivación y cambie esto por `@IsIn(USER_STATUS_VALUES)`, `PATCH /status`
 * podría poner `deleted` **saltándose todo `deleteUser`**: quedaría un usuario «eliminado» con su PII
 * intacta y su sesión viva. Por eso `enum-values.ts` excluye `UserStatus` explícitamente, y por eso
 * el porqué vive AQUÍ, en el call-site, y no sólo allá donde nadie lo va a leer.
 *
 * Fijado por test: `test/admin.user-status-enum.spec.ts` (rechaza `deleted` en este DTO).
 */
export class UpdateStatusDto {
  @IsIn(['active', 'blocked']) status!: 'active' | 'blocked';
}

/**
 * Alta de usuario por admin (E1, v1.7-admin-users). API_CONTRACT §M6.
 * Solo se declara la ESTRUCTURA (@IsString) para sobrevivir al whitelist del ValidationPipe;
 * la validación SEMÁNTICA (email/rol/locale/longitud de password) vive en `AdminService.createUser`
 * y lanza `422 VALIDATION_ERROR` (el contrato exige 422; el pipe global solo da 400 estructural).
 */
class CreateAdminUserDto {
  @IsString() email!: string;
  @IsString() name!: string;
  @IsString() role!: string;
  @IsOptional() @IsString() password?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() locale?: string;
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

  /**
   * Alta de usuario por rol (E1, v1.7-admin-users). super_admin-only, auditado `user.create`,
   * NO money-out. API_CONTRACT §M6. La contraseña (autogen o provista) NUNCA entra al AuditLog.
   */
  @Post()
  @HttpCode(201)
  @Roles(Role.super_admin)
  async createUser(
    @Body() dto: CreateAdminUserDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.admin.createUser(dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.create',
      entityType: 'User',
      entityId: res.user.id,
      // SEGURIDAD: NUNCA la contraseña (temp o provista). Solo metadatos no sensibles.
      after: {
        role: res.user.role,
        emailVerified: res.user.emailVerified,
        authProvider: res.user.authProvider,
        mustChangePassword: res.mustChangePassword,
      },
    });
    return res;
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser('role') role: Role) {
    // SEC-A4: la proyección de PII depende del rol (operador recibe ficha reducida).
    return this.admin.getUser(id, role);
  }

  /**
   * Actividad / auditoría por usuario (F1, v1.7-admin-users). API_CONTRACT §M6.
   * Roles: super_admin (completo, con `ip`) y vault_operator (reducido, sin `ip`) — cubierto por
   * el guard de clase. `scope` default `target`. NUNCA expone before/after. 404 si no existe.
   */
  @Get(':id/audit')
  userAudit(
    @Param('id') id: string,
    @CurrentUser('role') role: Role,
    @Query('scope') scope = 'target',
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    const normalizedScope: UserAuditScope = (['target', 'actor', 'both'] as const).includes(
      scope as UserAuditScope,
    )
      ? (scope as UserAuditScope)
      : 'target';
    return this.audit.listForUser({
      userId: id,
      scope: normalizedScope,
      role,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
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

  /**
   * Reset de contraseña por admin (M6, super_admin) — SIN correo. API_CONTRACT §M6.
   * La contraseña temporal se devuelve UNA vez y NUNCA se registra en el AuditLog (solo el
   * hecho: quién reseteó a quién y cuándo). No es dinero saliente.
   */
  @Post(':id/reset-password')
  @HttpCode(200)
  @Roles(Role.super_admin)
  async resetPassword(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.admin.resetPassword(id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.reset_password',
      entityType: 'User',
      entityId: id,
      // SEGURIDAD: NUNCA se guarda la contraseña temporal en el before/after.
    });
    return res;
  }

  /**
   * Borrado híbrido hard/soft (M6, super_admin). API_CONTRACT §M6. Auditado con `mode`
   * (sin volcar PII). 409 CANNOT_DELETE_SELF.
   */
  @Delete(':id')
  @Roles(Role.super_admin)
  async deleteUser(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.admin.deleteUser(id, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'user.delete',
      entityType: 'User',
      entityId: id,
      after: { mode: res.mode },
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

  /**
   * v2.0 (P-48, §4.36.7c / PROJECT §N.8, criterio 95) — INSTRUMENTACIÓN de la curva: agrega las
   * operaciones CONSUMADAS por eje × `MarketBracket` (escala FIJA, independiente de la curva). Es lo
   * que evita que la calibración vuelva a ser una corazonada. v2.0 RECOLECTA; NO CALIBRA (§N.10).
   */
  @Get('pricing-brackets')
  pricingBrackets(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('axis') axis?: string,
  ) {
    if (axis !== undefined && axis !== 'sale' && axis !== 'buy') {
      throw BusinessException.validation('VALIDATION_ERROR', `invalid axis '${axis}'`, {
        field: 'axis',
        allowed: ['sale', 'buy'],
      });
    }
    return this.admin.pricingBrackets(from, to, axis);
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
