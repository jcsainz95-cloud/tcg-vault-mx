import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';
import { MasterSetService } from './master-set.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import {
  BatchCreateInventoryRequest,
  BulkPublishRequest,
  CreateItemDto,
  CreateLocationDto,
  InventoryAdjustmentRequestDto,
  MarkItemDto,
  MoveItemDto,
  PublishAllRequestDto,
  UpdateItemDto,
} from './dto/inventory.dto';
import { Finish, ProductType } from '@prisma/client';

/**
 * v1.28 (P-17, §M1): valores válidos de los filtros aditivos de `GET /admin/inventory/items`.
 * Un valor fuera del enum → 400 VALIDATION_ERROR (contrato); omitido = comportamiento actual.
 */
const FINISH_FILTER_VALUES: readonly string[] = Object.values(Finish);
const PRODUCT_TYPE_FILTER_VALUES: readonly string[] = Object.values(ProductType);

/**
 * M1 — Inventario y bóveda. vault_operator + super_admin. API_CONTRACT §M1.
 */
@Controller('admin')
@Roles(Role.vault_operator, Role.super_admin)
export class InventoryController {
  constructor(
    private readonly inventory: InventoryService,
    private readonly masterSetService: MasterSetService,
    private readonly audit: AuditService,
  ) {}

  // ===== v1.16-master-set (§4.17) — Master Set + inventario a escala (vault_operator+) =====

  @Get('inventory/master-sets')
  masterSets(
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
    @Query('sort') sort = 'release_desc',
  ) {
    return this.masterSetService.index({
      q,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
      sort,
    });
  }

  @Get('inventory/master-sets/:setId')
  masterSetBinder(@Param('setId') setId: string) {
    return this.masterSetService.binder(setId);
  }

  @Post('inventory/items/batch')
  @HttpCode(200)
  async batchCreate(
    @Body() dto: BatchCreateInventoryRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    // El header Idempotency-Key es equivalente al `batchKey` del body (API_CONTRACT §M1).
    const batchKey = dto.batchKey ?? idempotencyKey;
    if (!batchKey || batchKey.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'batchKey is required');
    }
    const res = await this.inventory.batchCreate({ ...dto, batchKey }, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.batch_create',
      entityType: 'InventoryBatch',
      entityId: batchKey,
      after: { batchKey, idempotentReplay: res.idempotentReplay, summary: res.summary },
    });
    return res;
  }

  @Post('inventory/items/bulk-publish')
  @HttpCode(200)
  async bulkPublish(
    @Body() dto: BulkPublishRequest,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.inventory.bulkPublish(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.bulk_publish',
      entityType: 'InventoryBatch',
      entityId: dto.batchKey,
      after: { batchKey: dto.batchKey, summary: res.summary },
    });
    return res;
  }

  /**
   * v1.28 (P-19, §4.26c) — POST /admin/inventory/publish-all: publicar TODO (o un filtro) de golpe.
   * Selección server-side sin cap; tolerante por-ítem; idempotente por `batchKey`. AUDITADO
   * (`inventory.publish_all` con filtros + resumen). Toca dinero (expone piezas a la venta) →
   * gate de seguridad por release.
   */
  @Post('inventory/publish-all')
  @HttpCode(200)
  async publishAll(
    @Body() dto: PublishAllRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.inventory.publishAll(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.publish_all',
      entityType: 'InventoryBatch',
      entityId: dto.batchKey,
      after: {
        batchKey: dto.batchKey,
        filters: { setId: dto.setId, productType: dto.productType },
        idempotentReplay: res.idempotentReplay,
        summary: res.summary,
      },
    });
    return res;
  }

  // ===== v1.20-master-set-everywhere (§4.20e) — ajuste por levantamiento físico =====

  /**
   * POST /admin/inventory/adjustments — motivo OBLIGATORIO encontrada|perdida|danada|error_captura.
   * Res 201 (encontrada, crea piezas) / 200 (resto Y el replay idempotente por `batchKey`, v1.20.1:
   * un replay devuelve la respuesta original guardada con `idempotentReplay: true` y 200 aunque la
   * primera vez fuera 201). Registro triple: InventoryAdjustment (M-24) +
   * InventoryMovement(reason=adjustment) [servicio, en tx] + AuditLog action=inventory.adjustment
   * con usuario y timestamp (aquí). NO es dinero saliente (sin MoneyOutGuard) y NO vende nada.
   */
  @Post('inventory/adjustments')
  async adjust(
    @Body() dto: InventoryAdjustmentRequestDto,
    @CurrentUser() user: { id: string; role: Role },
    @Res({ passthrough: true }) res: Response,
  ) {
    const out = await this.inventory.adjust(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.adjustment',
      entityType: 'InventoryAdjustment',
      // v1.20.1: la respuesta es plural (una fila M-24 por pieza); la bitácora ancla en la primera
      // y lista TODAS en `after.adjustmentIds`.
      entityId: out.adjustmentIds[0],
      after: {
        reason: out.reason,
        adjustmentIds: out.adjustmentIds,
        inventoryItemIds: out.inventoryItemIds,
        folios: out.folios,
        fromStatus: out.fromStatus,
        toStatus: out.toStatus,
        idempotentReplay: out.idempotentReplay,
        note: dto.note,
      },
    });
    res.status(dto.reason === 'encontrada' && !out.idempotentReplay ? 201 : 200);
    return out;
  }

  @Post('inventory/items')
  async create(@Body() dto: CreateItemDto, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.inventory.createItem(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.create',
      entityType: 'InventoryItem',
      entityId: res.id,
      after: { folio: res.folio },
    });
    return res;
  }

  @Get('inventory/items')
  list(
    @Query('status') status?: string,
    @Query('cardId') cardId?: string,
    @Query('ownerType') ownerType?: string,
    @Query('locationId') locationId?: string,
    @Query('zone') zone?: string,
    @Query('q') q?: string,
    // v1.28 (P-17, §4.26d): filtros ADITIVOS del drill-down (`?cardId=&finish=&productType=`).
    @Query('finish') finish?: string,
    @Query('productType') productType?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    // Contrato §M1 v1.28: validados contra sus enums → 400 VALIDATION_ERROR si inválidos.
    if (finish != null && !FINISH_FILTER_VALUES.includes(finish)) {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid finish '${finish}'`, {
        finish,
        allowed: FINISH_FILTER_VALUES,
      });
    }
    if (productType != null && !PRODUCT_TYPE_FILTER_VALUES.includes(productType)) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `invalid productType '${productType}'`,
        { productType, allowed: PRODUCT_TYPE_FILTER_VALUES },
      );
    }
    return this.inventory.listItems({
      status,
      cardId,
      ownerType,
      locationId,
      zone,
      q,
      finish: finish as Finish | undefined,
      productType: productType as ProductType | undefined,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  @Get('inventory/items/:id')
  get(@Param('id') id: string) {
    return this.inventory.getItem(id);
  }

  @Patch('inventory/items/:id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateItemDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.inventory.updateItem(id, dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.update',
      entityType: 'InventoryItem',
      entityId: id,
    });
    return res;
  }

  @Post('inventory/items/:id/move')
  async move(
    @Param('id') id: string,
    @Body() dto: MoveItemDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.inventory.moveItem(id, dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.move',
      entityType: 'InventoryItem',
      entityId: id,
    });
    return res;
  }

  @Post('inventory/items/:id/mark')
  async mark(
    @Param('id') id: string,
    @Body() dto: MarkItemDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.inventory.markItem(id, dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: `inventory.mark_${dto.mark}`,
      entityType: 'InventoryItem',
      entityId: id,
      after: { note: dto.note },
    });
    return res;
  }

  @Get('locations')
  listLocations() {
    return this.inventory.listLocations();
  }

  @Post('locations')
  createLocation(@Body() dto: CreateLocationDto) {
    return this.inventory.createLocation(dto);
  }
}
