import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { InventoryService } from './inventory.service';
import { AuditService } from '../audit/audit.service';
import {
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
    private readonly audit: AuditService,
  ) {}

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
