/**
 * reports-finance.controller.ts — §REPORTES-CEO F2b (API_CONTRACT_REPORTES §3): P&L por línea de negocio y consolidados.
 * SOLO `super_admin` (el operador y el cliente reciben 403; no existe versión con el dinero tapado). Lectura, sin caché.
 */
import { Controller, Get, Header, Query, UseGuards } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { parseEnumFilter } from '../../common/enum-filter';
import { AuditedSuperAdmin, AuditedSuperAdminGuard } from './audited-super-admin.guard';
import { PERIOD_KIND_VALUES } from '../sales-analytics/sales-period';
import { ReportsFinanceService, SERIES_GROUP_BY_VALUES, SERIES_LINE_VALUES } from './reports-finance.service';

@Controller('admin/reports/finance')
// Clase: staff (el `customer` queda fuera con 403 sin fila); cada ruta: solo `super_admin` con el 403 del operador AUDITADO
// (`user.admin_action_denied {attempted:'finance_report'}`, contrato §3 «Quién ve qué»).
@Roles(Role.vault_operator, Role.super_admin)
export class AdminReportsFinanceController {
  constructor(private readonly svc: ReportsFinanceService) {}

  @Get('pnl')
  @AuditedSuperAdmin('finance_report')
  @UseGuards(AuditedSuperAdminGuard)
  @Header('Cache-Control', 'no-store')
  pnl(@Query('from') from?: string, @Query('to') to?: string, @Query('kind') kind?: string) {
    return this.svc.report({ from, to, kind: parseEnumFilter('kind', kind, PERIOD_KIND_VALUES) });
  }

  @Get('pnl/series')
  @AuditedSuperAdmin('finance_report')
  @UseGuards(AuditedSuperAdminGuard)
  @Header('Cache-Control', 'no-store')
  series(
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('groupBy') groupBy?: string,
    @Query('line') line?: string,
    @Query('count') count?: string,
    @Query('asOf') asOf?: string,
  ) {
    return this.svc.series({
      from,
      to,
      groupBy: parseEnumFilter('groupBy', groupBy, SERIES_GROUP_BY_VALUES),
      line: parseEnumFilter('line', line, SERIES_LINE_VALUES),
      count,
      asOf,
    });
  }
}
