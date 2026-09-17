import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
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
import { parseEnumFilter } from '../../common/enum-filter';
import { SEALED_GROUP_KIND_VALUES } from '../../common/enum-values';
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
  SetMainGroupRequestDto,
  UpdateItemDto,
} from './dto/inventory.dto';
import { SEALED_PRICE_STATE_VALUES } from './sealed-product.service';
import { AcquisitionType, Finish, ProductType } from '@prisma/client';

/**
 * v1.28 (P-17, §M1): valores válidos de los filtros aditivos de `GET /admin/inventory/items`.
 * Un valor fuera del enum → 400 VALIDATION_ERROR (contrato); omitido = comportamiento actual.
 */
//
// ⚠️ `readonly Finish[]`, NO `readonly string[]` (`P-89`, condición de techlead). El tipo no es
// cosmético: con `readonly string[]` el genérico `T` de `parseEnumFilter` colapsa a `string`, el
// helper devuelve `string`, y el call-site tiene que **volver a afirmar** el tipo con
// `as Finish | undefined` — es decir, la comprobación que el helper tipado acababa de devolver se
// tira a la basura una línea después. Los otros cinco módulos los tipan bien y no llevan cast
// (`shipments/shipments.service.ts:24` + `:380`).
const FINISH_FILTER_VALUES: readonly Finish[] = Object.values(Finish);
const PRODUCT_TYPE_FILTER_VALUES: readonly ProductType[] = Object.values(ProductType);

/** v1.51 (fase 8, §M1): filtros de `GET /admin/inventory/pending-publish`. */
const ACQUISITION_TYPE_FILTER_VALUES: readonly AcquisitionType[] = Object.values(AcquisitionType);

/**
 * ⭐ **`?missing=` — CLASE L (LITERAL), API_CONTRACT §0-Q punto 3 / ARCHITECTURE §4.37.**
 *
 * *El dominio no existe en el schema porque no describe un dato persistido, sino un **modo de la
 * consulta**.* `location | price` no nombra estados: nombra **qué le falta a la fila**. Por eso no
 * hay enum que derivar (`rg 'enum .*Missing' prisma/schema.prisma` ⇒ **0**, medido 2026-09-13) y no
 * hay cláusula de `PROJECT.md` que citar — **no se está recortando nada**, así que no es clase R.
 *
 * **Su declaración canónica es la línea del endpoint en `API_CONTRACT §M1`**
 * (`Query: ?missing=location|price&…`), y la paridad es a **DOS bandas**: contrato ↔ este literal.
 * No hay tercera porque no hay schema que espejar. Lo sostiene `C-EQ-1`
 * (`test/integration/enum-query-axes.e2e-spec.ts`), que además comprueba lo que la clase L ⛔ **no**
 * autoriza: que **no exista** un enum homónimo en el schema. El día que alguien lo cree, este
 * literal deja de ser legítimo y hay que derivarlo.
 *
 * ⚠️ Se **exporta** para que `C-EQ-1` mida la paridad contra el literal REAL del call-site y no
 * contra una copia suya: una segunda copia en la prueba haría que la prueba pasara justo cuando la
 * norma se rompe.
 */
export const PENDING_PUBLISH_MISSING_VALUES = ['location', 'price'] as const;

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
    // ⭐ `D-EQ-2` (v1.73) — `?origin=` al helper único, y es el eje que incumplía §0-Q punto 2 MÁS
    // fuerte que ningún otro: su `400` llegaba con `details` **VACÍO** (`{}`), sin `field` ni
    // `allowed` — medido, no supuesto. Además comparaba contra DOS LITERALES a mano teniendo
    // `enum SealedGroupKind` en el schema sobre columna persistida ⇒ clase E, se DERIVA (§0-Q punto
    // 3). Y `origin !== ''` descartaba la cadena vacía pero **no `' '`**: la media conformidad que
    // se lee como conformidad entera, porque un espacio es truthy y no es la cadena vacía.
    const originFilter = parseEnumFilter('origin', origin, SEALED_GROUP_KIND_VALUES);
    return this.sealedProduct!.listSealedProducts({
      setId,
      q,
      origin: originFilter,
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

  /**
   * M11 (§10) — GET /admin/inventory/sealed-price-status?q?=&state?=&page=&pageSize= — por SET de
   * sellado, su estado de precio: `priced | mapped_unpriced | unmapped` (+ `reason`). `vault_operator+`
   * (hereda el rol de la clase). **Read-only, sin red externa (O-17)**: lee estado persistido y clasifica
   * con el gate H-1; NO llama a TCGCSV. NO se audita (es una LECTURA, misma doctrina que `pending-publish`).
   * Separa lo que `sealed-sets.unmappedCount` funde («no mapeado» vs «mapeado sin precio»).
   */
  @Get('inventory/sealed-price-status')
  sealedPriceStatus(
    @Query('q') q?: string,
    @Query('state') state?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    // `?state=` DERIVADO del enum de estados (§0-Q / clase L, fuente única): valor fuera del dominio ⇒
    // 400 VALIDATION_ERROR con `details.field` + `details.allowed`; omitido/vacío ⇒ sin filtro de estado.
    const stateFilter = parseEnumFilter('state', state, SEALED_PRICE_STATE_VALUES);
    return this.sealedProduct!.sealedPriceStatus({
      q,
      state: stateFilter,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  /**
   * M11 (§11.1) — PUT /admin/inventory/sealed-sets/:setId/set-main-group — fija/REEMPLAZA el grupo
   * `set_main` del set aunque ya exista (escape de P-46; `linkGroup` sólo puebla si es null). `super_admin`.
   * AUDITADO (`inventory.sealed_set_main_group_set`, con `before/after` del `tcgcsvGroupId` — I-4). Money-safe:
   * fija de qué grupo saldrá el precio; NO fabrica precio (lo trae el job §9, gateado por el dial).
   */
  @Put('inventory/sealed-sets/:setId/set-main-group')
  @Roles(Role.super_admin)
  async setMainGroup(
    @Param('setId') setId: string,
    @Body() dto: SetMainGroupRequestDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const res = await this.sealedProduct!.setMainGroup(setId, dto);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.sealed_set_main_group_set',
      entityType: 'CardSet',
      entityId: setId,
      before: { tcgcsvGroupId: res.before },
      after: { tcgcsvGroupId: res.after, reason: dto.reason },
    });
    return res.group;
  }

  /**
   * M11 (§11.2) — DELETE /admin/inventory/sealed-sets/:setId/groups/:groupId — desenlaza un grupo mal
   * asignado; si era el `set_main`, el set vuelve a «SIN emparejar» (`CardSet.tcgcsvGroupId=null`).
   * `super_admin`. AUDITADO (`inventory.sealed_set_group_unlink`, con el `before` — I-4). Money-safe: NO
   * borra `PriceReference` ya escritas (quedan stale/inocuas); sólo cambia de dónde saldrá el precio.
   */
  @Delete('inventory/sealed-sets/:setId/groups/:groupId')
  @HttpCode(200)
  @Roles(Role.super_admin)
  async unlinkSealedSetGroup(
    @Param('setId') setId: string,
    @Param('groupId') groupIdRaw: string,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    if (!/^\d+$/.test(groupIdRaw) || parseInt(groupIdRaw, 10) <= 0) {
      throw BusinessException.badRequest('VALIDATION_ERROR', 'groupId must be a positive integer');
    }
    const groupId = parseInt(groupIdRaw, 10);
    const before = await this.sealedProduct!.unlinkGroup(setId, groupId);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'inventory.sealed_set_group_unlink',
      entityType: 'SealedSetGroup',
      entityId: `${setId}:${groupId}`,
      before,
    });
    return before;
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
    // `P-84`/§0-Q: mismo helper y mismo `details.field` que el resto. Antes emitía
    // `{ productType, allowed }` — sin `field`, que §0-Q exige. Cambio ADITIVO y sin consumidores
    // (`rg 'details\.(productType|allowed)' frontend/` ⇒ cero, medido 2026-09-13).
    const productTypeFilter = parseEnumFilter('productType', productType, PRODUCT_TYPE_FILTER_VALUES);
    const buffer = await this.inventory.exportInventoryXlsx({
      setId: setId || undefined,
      productType: productTypeFilter,
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
    // `P-84`/§0-Q — estos dos YA validaban contra el enum derivado (por eso eran los únicos ejes de
    // enum de este endpoint que **no** daban `500`): es el patrón que el resto copió. Lo que cambia es
    // solo la forma del `details`, que usaba la llave del campo (`{ finish }`) en vez de `field`.
    const finishFilter = parseEnumFilter('finish', finish, FINISH_FILTER_VALUES);
    const productTypeFilter = parseEnumFilter('productType', productType, PRODUCT_TYPE_FILTER_VALUES);
    return this.inventory.listItems({
      status,
      cardId,
      ownerType,
      locationId,
      zone,
      q,
      finish: finishFilter,
      productType: productTypeFilter,
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(100, Math.max(1, parseInt(pageSize, 10) || 20)),
    });
  }

  /**
   * ⚠️ v1.51 (fase 8, D10, criterio 125 · §M1) — **`GET /admin/inventory/pending-publish`: la cola de
   * «listas para publicar».** *Comprar bien y dejar la carta en una caja sin precio es comprar mal.*
   *
   * **Es una LECTURA y no se audita**: no cambia nada y no revela dato sensible alguno — misma
   * doctrina que la mesa de decisión (§4.39f). Auditar cada vistazo a una cola de trabajo llenaría la
   * bitácora de ruido y **enterraría los actos que sí importan**.
   */
  @Get('inventory/pending-publish')
  pendingPublish(
    @Query('missing') missing?: string,
    @Query('acquisitionType') acquisitionType?: string,
    @Query('setId') setId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    // Filtros validados contra sus enums → 400 VALIDATION_ERROR (mismo patrón que `GET
    // /admin/inventory/items`). Un filtro inválido que se ignorara en silencio devolvería una cola
    // MÁS GRANDE de la que el operador pidió, y él la leería como si fuera la filtrada.
    // ⭐ `D-EQ-2` (v1.73) — `?missing=` al helper único. Su `throw` propio emitía `details.missing`
    // (la llave del campo) y NO `details.field`, que §0-Q punto 2 declara OBLIGATORIO SIEMPRE: el
    // operador de una cola con dos ejes de enum no podía saber CUÁL le rechazaron. Y `missing != null`
    // dejaba pasar `''` y `' '` a la validación ⇒ `400` donde la fila 1 manda `200`.
    const missingFilter = parseEnumFilter('missing', missing, PENDING_PUBLISH_MISSING_VALUES);
    // `P-84`/§0-Q: misma alineación aditiva de `details` (antes `{ acquisitionType, allowed }`).
    const acquisitionTypeFilter = parseEnumFilter(
      'acquisitionType',
      acquisitionType,
      ACQUISITION_TYPE_FILTER_VALUES,
    );
    return this.inventory.pendingPublish({
      missing: missingFilter,
      acquisitionType: acquisitionTypeFilter,
      setId,
      page: Math.max(1, parseInt(page, 10) || 1),
      // `pageSize` ≤ 100 (contrato §M1), como el resto de los listados de back-office.
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
