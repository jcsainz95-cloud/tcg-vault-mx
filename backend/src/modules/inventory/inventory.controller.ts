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
import { SealedGradedInventoryService } from './sealed-graded.service';
import { SealedCatalogAdminService } from './sealed-catalog-admin.service';
import { SealedProductService } from './sealed-product.service';
import { AuditService } from '../audit/audit.service';
import { BusinessException } from '../../common/business.exception';
import {
  BatchCreateInventoryRequest,
  BulkPublishRequest,
  BulkRemoveRequestDto,
  CreateItemDto,
  CreateLocationDto,
  InventoryAdjustmentRequestDto,
  MarkItemDto,
  MoveItemDto,
  PublishAllRequestDto,
  SealedSetGroupLinkRequestDto,
  SealedSyncRequestDto,
  UpdateItemDto,
} from './dto/inventory.dto';
import { Finish, ProductType, SealedGroupKind } from '@prisma/client';

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
    // v1.28 (P-25/P-20): read models de las pestañas Sellado/Gradeadas. @Optional-less: lo provee
    // el módulo; los tests unitarios del controller que no lo ejercitan pasan un stub vacío.
    private readonly sealedGraded?: SealedGradedInventoryService,
    // v1.36-sealed-alta (M-37, P-35): listado de productos sellados del set para el alta dedicada.
    private readonly sealedCatalog?: SealedCatalogAdminService,
    // v1.39-sealed-product-module (M-39, P-38): catálogo persistido `SealedProduct` + sync + curación.
    private readonly sealedProduct?: SealedProductService,
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

  // ===== v1.28 (P-25/P-20, §4.26g/h) — pestañas «Sellado» (por set) y «Gradeadas» =====

  @Get('inventory/sealed-sets')
  sealedSets(
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.sealedGraded!.sealedSetsIndex({
      q,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  @Get('inventory/sealed-sets/:setId')
  sealedSetDetail(@Param('setId') setId: string) {
    return this.sealedGraded!.sealedSetDetail(setId);
  }

  @Get('inventory/graded')
  graded(
    @Query('q') q?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.sealedGraded!.gradedIndex({
      q,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  /**
   * v1.36-sealed-alta (M-37, P-35, §4.32a) — GET /admin/inventory/sealed-catalog?setId=&groupId?=&q?=
   * Lista los PRODUCTOS SELLADOS de un set desde TCGCSV (ETB, booster box, bundle, tin, blíster) —
   * NO singles — para el alta dedicada de la pestaña «Sellado». `vault_operator+`. Reusa el proxy
   * read-only server-side de M2 (host fijo anti-SSRF). Money-safe: `marketRef` informativo (sin precio
   * ⇒ null, nunca 0). Err: 400 (setId ausente / groupId no entero positivo), 404 (set), 502 (TCGCSV).
   */
  @Get('inventory/sealed-catalog')
  async sealedCatalogList(
    @Query('setId') setId?: string,
    @Query('groupId') groupIdRaw?: string,
    @Query('q') q?: string,
  ) {
    if (!setId || setId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'setId is required');
    }
    let groupId: number | undefined;
    if (groupIdRaw != null && groupIdRaw !== '') {
      if (!/^\d+$/.test(groupIdRaw) || parseInt(groupIdRaw, 10) <= 0) {
        throw BusinessException.badRequest('VALIDATION_ERROR', 'groupId must be a positive integer');
      }
      groupId = parseInt(groupIdRaw, 10);
    }
    return this.sealedCatalog!.sealedCatalog({ setId, groupId, q });
  }

  // ===== v1.39-sealed-product-module (M-39, P-38, §4.34d) — catálogo `SealedProduct` + sync =====

  /**
   * GET /admin/inventory/sealed-products?setId=&q?=&origin?=&principalOnly?= — presentaciones selladas
   * PERSISTIDAS (active=true) del set, ordenadas §4.34c, con `marketRef` money-safe (live→caché→null).
   * `vault_operator+` (hereda el rol de la clase). `needsSync=true` ⇒ catálogo vacío. Sustituye a
   * `GET /admin/inventory/sealed-catalog` (DEPRECADO). Err: 400 (setId ausente/origin inválido), 404 (set).
   */
  @Get('inventory/sealed-products')
  async sealedProducts(
    @Query('setId') setId?: string,
    @Query('q') q?: string,
    @Query('origin') origin?: string,
    @Query('principalOnly') principalOnly?: string,
  ) {
    if (!setId || setId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'setId is required');
    }
    if (origin != null && origin !== '' && origin !== 'set_main' && origin !== 'promo_collection') {
      throw BusinessException.badRequest('VALIDATION_ERROR', `invalid origin '${origin}'`);
    }
    return this.sealedProduct!.listSealedProducts({
      setId,
      q,
      origin: origin ? (origin as SealedGroupKind) : undefined,
      principalOnly: principalOnly === 'true' || principalOnly === '1',
    });
  }

  /**
   * POST /admin/inventory/sealed-products/sync — descarga presentaciones selladas del set (o de todos)
   * desde TCGCSV, las persiste como `SealedProduct` y POBLA `CardSet.tcgcsvGroupId` + `SealedSetGroup`.
   * `super_admin` (escritura de catálogo). Auditado (`inventory.sealed_products_sync`).
   */
  @Post('inventory/sealed-products/sync')
  @HttpCode(200)
  @Roles(Role.super_admin)
  async sealedProductsSync(
    @Body() dto: SealedSyncRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.sealedProduct!.sync(dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.sealed_products_sync',
      entityType: 'SealedProduct',
      entityId: dto.setId ?? (dto.all ? 'all' : 'n/a'),
      after: { request: { setId: dto.setId, all: dto.all, groupIds: dto.groupIds }, result: res },
    });
    return res;
  }

  /**
   * GET /admin/inventory/sealed-products/sync/candidates?setId= — grupos TCGCSV candidatos por
   * name-match contra el set (bootstrap del set_main + localizar promos/colecciones). `super_admin`.
   */
  @Get('inventory/sealed-products/sync/candidates')
  @Roles(Role.super_admin)
  async sealedProductsSyncCandidates(@Query('setId') setId?: string) {
    if (!setId || setId.trim() === '') {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'setId is required');
    }
    return this.sealedProduct!.syncCandidates(setId);
  }

  /**
   * POST /admin/inventory/sealed-sets/:setId/groups — enlaza un grupo TCGCSV EXTRA (promo/colección)
   * al set (1 set → N grupos, §4.34b). `super_admin`. 201; grupo ya enlazado → 409. Auditado.
   */
  @Post('inventory/sealed-sets/:setId/groups')
  @HttpCode(201)
  @Roles(Role.super_admin)
  async linkSealedSetGroup(
    @Param('setId') setId: string,
    @Body() dto: SealedSetGroupLinkRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.sealedProduct!.linkGroup(setId, dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.sealed_set_group_link',
      entityType: 'SealedSetGroup',
      entityId: res.id,
      after: { setId, tcgplayerGroupId: dto.tcgplayerGroupId, kind: dto.kind },
    });
    return res;
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

  /**
   * P-29 — POST /admin/inventory/items/bulk-remove: baja rápida de N piezas de un (cardId, finish
   * [, condición]) de un golpe (merma/venta manual/corrección). Reusa la semántica de baja por-pieza
   * de `/adjustments` seleccionando server-side las N piezas más apropiadas. Money-safe (no toca
   * precios) y atómico (no baja más de las que hay → 422 INSUFFICIENT_STOCK). AUDITADO
   * (`inventory.bulk_remove`, con `batchKey`). Idempotente por `batchKey` opcional (v1.35, H1): un
   * reintento con la misma key devuelve la respuesta original (`idempotentReplay: true`, mismo `200`)
   * sin re-bajar. Formalizado en API_CONTRACT §M1 (v1.34/v1.35).
   */
  @Post('inventory/items/bulk-remove')
  @HttpCode(200)
  async bulkRemove(
    @Body() dto: BulkRemoveRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const out = await this.inventory.bulkRemove(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.bulk_remove',
      entityType: 'InventoryAdjustment',
      entityId: out.adjustmentIds[0],
      after: {
        // v1.35 — `batchKey` en la bitácora (paridad con adjustFound/publish-all); `idempotentReplay`
        // distingue un replay idempotente de una baja nueva en el rastro de auditoría.
        batchKey: out.batchKey,
        idempotentReplay: out.idempotentReplay,
        cardId: dto.cardId,
        finish: dto.finish,
        reason: out.reason,
        toStatus: out.toStatus,
        requested: out.requested,
        removed: out.removed,
        adjustmentIds: out.adjustmentIds,
        inventoryItemIds: out.inventoryItemIds,
        folios: out.folios,
        note: dto.note,
      },
    });
    return out;
  }

  /**
   * P-31 — GET /admin/inventory/export.xlsx: descarga el inventario de plataforma a Excel (.xlsx real,
   * una fila por PIEZA/folio). Filtros opcionales `?setId=&productType=`. Money-safe: exporta el dato
   * tal cual (sin precio → celda vacía). Devuelve el binario con cabeceras de descarga.
   */
  @Get('inventory/export.xlsx')
  async exportXlsx(
    @Res() res: Response,
    @Query('setId') setId?: string,
    @Query('productType') productType?: string,
  ) {
    if (productType != null && !PRODUCT_TYPE_FILTER_VALUES.includes(productType)) {
      throw BusinessException.badRequest(
        'VALIDATION_ERROR',
        `invalid productType '${productType}'`,
        { productType, allowed: PRODUCT_TYPE_FILTER_VALUES },
      );
    }
    const buffer = await this.inventory.exportInventoryXlsx({
      setId: setId || undefined,
      productType: productType as ProductType | undefined,
    });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader('Content-Disposition', `attachment; filename="inventario-${stamp}.xlsx"`);
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
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
