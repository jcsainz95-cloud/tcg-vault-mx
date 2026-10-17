/**
 * marketing-annotations.controller.ts — CRUD de anotaciones de fecha del Panel (h1, API_CONTRACT
 * §MKT.E; ARCHITECTURE §13.4.6).
 *
 *   GET    /admin/marketing/annotations?from&to   — lista del rango (pinta las gráficas a/b/c).
 *   POST   /admin/marketing/annotations           — crea (valida PII ⇒ 422); 201 con la fila.
 *   PATCH  /admin/marketing/annotations/:id        — edita; 404 si no existe.
 *   DELETE /admin/marketing/annotations/:id        — borra; 404 si no existe.
 *
 * 🔒 AUTZ (D-MKT-AUTZ): todas son de **SESIÓN** admin con `marketing:read` (`@RequirePermission` +
 * `PermissionGuard`, tras `JwtAuthGuard`). ⛔ NO van `@Public()`: el token opaco `marketing-reader`
 * NO es JWT ⇒ `JwtAuthGuard` lo rechaza como **401** en estas rutas (solo vale en `GET …/aggregates`).
 * Una **sesión** admin SIN `marketing:read` ⇒ **403**. Cada acceso deja fila en `MarketingAccessLog`.
 */
import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { PermissionGuard } from '../../common/guards/permission.guard';
import { MarketingAnnotationsService, type AnnotationView } from './marketing-annotations.service';
import { MarketingAccessLogService } from './marketing-access-log.service';
import { CreateAnnotationDto, ListAnnotationsQueryDto, UpdateAnnotationDto } from './dto/annotations.dto';

@Controller('admin/marketing/annotations')
@UseGuards(PermissionGuard)
@RequirePermission(Permission.marketing_read)
export class MarketingAnnotationsController {
  constructor(
    private readonly annotations: MarketingAnnotationsService,
    private readonly accessLog: MarketingAccessLogService,
  ) {}

  @Get()
  async list(@CurrentUser() user: { id: string }, @Query() q: ListAnnotationsQueryDto): Promise<AnnotationView[]> {
    const rows = await this.annotations.list(q.from, q.to);
    await this.accessLog.record({ actorUserId: user.id, screen: 'h', format: 'json', filters: { from: q.from ?? null, to: q.to ?? null }, rowCount: rows.length });
    return rows;
  }

  @Post()
  @HttpCode(201)
  async create(@CurrentUser() user: { id: string }, @Body() dto: CreateAnnotationDto): Promise<AnnotationView> {
    const row = await this.annotations.create(dto, user.id);
    await this.accessLog.record({ actorUserId: user.id, screen: 'h', format: 'json', filters: { action: 'create' }, rowCount: 1 });
    return row;
  }

  @Patch(':id')
  async update(@CurrentUser() user: { id: string }, @Param('id') id: string, @Body() dto: UpdateAnnotationDto): Promise<AnnotationView> {
    const row = await this.annotations.update(id, dto);
    await this.accessLog.record({ actorUserId: user.id, screen: 'h', format: 'json', filters: { action: 'update' }, rowCount: 1 });
    return row;
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: { id: string }, @Param('id') id: string): Promise<void> {
    await this.annotations.remove(id);
    await this.accessLog.record({ actorUserId: user.id, screen: 'h', format: 'json', filters: { action: 'delete' }, rowCount: 1 });
  }
}
