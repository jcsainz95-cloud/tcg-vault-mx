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
} from '@nestjs/common';
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
  MarkItemDto,
  MoveItemDto,
  UpdateItemDto,
} from './dto/inventory.dto';

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
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.inventory.listItems({
      status,
      cardId,
      ownerType,
      locationId,
      zone,
      q,
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
