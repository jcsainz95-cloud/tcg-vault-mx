/**
 * demand.controller.ts — §DEMANDA F1+F2 (API_CONTRACT_DEMANDA §1-§2). `GET /admin/reports/demand-gaps` (+ `/export.csv`), `super_admin`
 * (operador y cliente ⇒ 403). Sin Content-Disposition con datos del usuario; `Cache-Control: no-store`.
 */
import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { DemandGapsService } from './demand-gaps.service';

@Controller('admin/reports')
@Roles(Role.super_admin)
export class DemandController {
  constructor(private readonly demand: DemandGapsService) {}

  @Get('demand-gaps')
  @Header('Cache-Control', 'no-store')
  report(@Query('sort') sort?: string, @Query('dir') dir?: string, @Query('limit') limit?: string) {
    return this.demand.report({ sort, dir, limit }, new Date());
  }

  @Get('demand-gaps/export.csv')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Res() res: Response, @Query('sort') sort?: string, @Query('dir') dir?: string, @Query('limit') limit?: string) {
    const csv = await this.demand.csv({ sort, dir, limit }, new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.send(csv.body);
  }
}
