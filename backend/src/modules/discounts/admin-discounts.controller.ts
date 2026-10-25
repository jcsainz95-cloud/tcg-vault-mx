import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Response } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Actor, AdminDiscountsService } from './admin-discounts.service';

/**
 * 💰 API_CONTRACT §DSC.7 — códigos de descuento del DUEÑO: SOLO `super_admin` (`@Roles` de clase ⇒ el operador recibe `403
 * FORBIDDEN` del `RolesGuard` global antes de cualquier lectura o escritura). 21 rutas entre los dos controladores; toda
 * escritura deja `AuditLog` con antes → después (`AdminDiscountsService`). Los cuerpos se validan a mano (`unknown`): un
 * campo que la ruta no conoce es `422 { field }`, ⛔ nunca se ignora en silencio.
 */
@Controller('admin/discount-codes')
@Roles(Role.super_admin)
export class AdminDiscountCodesController {
  constructor(private readonly svc: AdminDiscountsService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Query('status') status?: string,
    @Query('state') state?: string,
    @Query('batchId') batchId?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.svc.list({ status, state, batchId, q, page, pageSize });
  }

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.create(body, user);
  }

  /** ⛔ Cero escrituras: solo `discountOf`/`allocateDiscount` (alimenta «Así lo verá el cliente»). */
  @Post('preview')
  @HttpCode(200)
  preview(@Body() body: unknown) {
    return this.svc.preview(body);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.patch(id, body, user);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.setStatus(id, 'paused', user);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.setStatus(id, 'active', user);
  }

  @Delete(':id')
  @HttpCode(204)
  async archive(@Param('id') id: string, @CurrentUser() user: Actor): Promise<void> {
    await this.svc.archive(id, user);
  }

  @Get(':id/report')
  @Header('Cache-Control', 'no-store')
  report(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.codeReport(id, { from, to });
  }

  @Get(':id/report.csv')
  @Header('Cache-Control', 'no-store')
  async reportCsv(@Param('id') id: string, @CurrentUser() user: Actor, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    sendCsv(res, await this.svc.codeReportCsv(id, { from, to }, user));
  }

  @Get(':id/audit')
  @Header('Cache-Control', 'no-store')
  audit(@Param('id') id: string, @Query('page') page?: string) {
    return this.svc.auditOf('DiscountCode', id, { page });
  }
}

@Controller('admin/discount-code-batches')
@Roles(Role.super_admin)
export class AdminDiscountCodeBatchesController {
  constructor(private readonly svc: AdminDiscountsService) {}

  @Post()
  create(@Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.createBatch(body, user);
  }

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('page') page?: string) {
    return this.svc.listBatches({ page });
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.svc.getBatch(id);
  }

  @Patch(':id')
  patch(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: Actor) {
    return this.svc.patchBatch(id, body, user);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.setBatchStatus(id, 'paused', user);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@Param('id') id: string, @CurrentUser() user: Actor) {
    return this.svc.setBatchStatus(id, 'active', user);
  }

  /** Auditado: reparte códigos. */
  @Get(':id/codes.csv')
  @Header('Cache-Control', 'no-store')
  async codesCsv(@Param('id') id: string, @CurrentUser() user: Actor, @Res() res: Response) {
    sendCsv(res, await this.svc.batchCodesCsv(id, user));
  }

  @Get(':id/report')
  @Header('Cache-Control', 'no-store')
  report(@Param('id') id: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.svc.batchReport(id, { from, to });
  }

  @Get(':id/report.csv')
  @Header('Cache-Control', 'no-store')
  async reportCsv(@Param('id') id: string, @CurrentUser() user: Actor, @Res() res: Response, @Query('from') from?: string, @Query('to') to?: string) {
    sendCsv(res, await this.svc.batchReportCsv(id, { from, to }, user));
  }

  @Get(':id/audit')
  @Header('Cache-Control', 'no-store')
  audit(@Param('id') id: string, @Query('page') page?: string) {
    return this.svc.auditOf('DiscountCodeBatch', id, { page });
  }
}

function sendCsv(res: Response, csv: { filename: string; body: string }): void {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
  res.send(csv.body);
}
