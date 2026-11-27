import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { BusinessException } from '../../common/business.exception';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogSyncService } from './catalog-sync.service';
import { AuditService } from '../audit/audit.service';
import { CardLinkRepairService } from './card-link-repair.service';
import { FinishReviewService } from './finish-review.service';
import { LinkExceptionsService } from './link-exceptions.service';
import { CardLinkConfirmService } from './card-link-confirm.service';
import { AutoLinkAdminService } from './auto-link-admin.service';
import { SetSearchKeyService } from './set-search-key.service';
import { TcgcsvSetImportService } from './tcgcsv-set-import.service';

/** §AUTO-ENLACE fase 3 — body de `POST /admin/catalog/link-exceptions/:setId/confirm`: el `groupId` entero de TCGCSV. */
class ConfirmGroupDto {
  @IsInt() @Min(1) groupId!: number;
}

/** §AUTO-ENLACE §9.4 — body de `POST …/link-exceptions/:setId/cards/:cardId/confirm`: el `productId` entero de TCGCSV. */
class ConfirmCardDto {
  @IsInt() @Min(1) productId!: number;
}

/** §AUTO-ENLACE fase 4 — body de `POST /admin/catalog/finish-review/:inventoryItemId` (los valores se validan en el servicio ⇒ 422, contrato §8b). */
class FinishReviewDto {
  @IsOptional() decision?: unknown;
  @IsOptional() expectedFinish?: unknown;
}

class SyncDto {
  @IsOptional() @IsString() setId?: string;
  @IsOptional() @IsString() fromReleaseDate?: string;
  /**
   * v1.27 (P-12, API_CONTRACT §M2 / ARCHITECTURE §4.25c) — con `true`, corre TAMBIÉN el resolver
   * estructural TCGCSV para cada set procesado (variantes), no solo en first-import. Aditivo,
   * default `false` (comportamiento previo exacto). Uso recomendado: `{ setId, force: true }`.
   */
  @IsOptional() @IsBoolean() force?: boolean;
}

/** §PRECIO-SIN-ENLACE — body de `POST /admin/catalog/link-repair`: el UUID LOCAL del set (⛔ no el id de pokemontcg.io). */
class LinkRepairDto {
  @IsUUID() setId!: string;
}

/**
 * M-34 — body de `POST /admin/catalog/refresh-variants`. `setId` es el externalId del set
 * (pokemontcg.io id, p. ej. `me05`), REQUERIDO. `force` opcional (simetría con `/sync`).
 */
class RefreshVariantsDto {
  @IsString() setId!: string;
  @IsOptional() @IsBoolean() force?: boolean;
}

class BackfillDto {
  @IsOptional() @IsInt() @Min(1) batchSize?: number;
  @IsOptional() @IsInt() untilYear?: number;
  @IsOptional() @IsBoolean() force?: boolean;
}

class SyncAllDto {
  @IsOptional() @IsBoolean() force?: boolean;
}

/**
 * M-35 — body de `POST /admin/catalog/refresh-variants-all` (versión BATCH del refresh solo-TCGCSV).
 * `force` opcional (simetría con `refresh-variants`/`sync-all`).
 */
class RefreshVariantsAllDto {
  @IsOptional() @IsBoolean() force?: boolean;
}

/** P-PROMOS (§5.12) — body de `POST /admin/catalog/import-tcgcsv-set`: el `groupId` entero de TCGCSV. */
class ImportTcgcsvSetDto {
  @IsInt() @Min(1) groupId!: number;
}

/** Normaliza `force` desde body ({force:true}) o query (?force=true) → boolean. */
function parseForce(bodyForce: boolean | undefined, queryForce: string | undefined): boolean {
  if (bodyForce != null) return bodyForce;
  return queryForce === 'true' || queryForce === '1';
}

/**
 * M2 — Sync de catálogo desde pokemontcg.io (super_admin, AUDITADO). API_CONTRACT §M2.
 * Todas las operaciones quedan en AuditLog (catalog.remote_sets / catalog.sync / catalog.backfill).
 */
@Controller('admin/catalog')
@Roles(Role.super_admin)
export class AdminCatalogController {
  constructor(
    private readonly sync: CatalogSyncService,
    private readonly audit: AuditService,
    private readonly tcgcsvImport: TcgcsvSetImportService,
    private readonly linkRepair: CardLinkRepairService,
    private readonly searchKeys: SetSearchKeyService,
    private readonly linkExceptions: LinkExceptionsService,
    private readonly finishReview: FinishReviewService,
    private readonly cardConfirm: CardLinkConfirmService,
    private readonly autoAdmin: AutoLinkAdminService,
  ) {}

  @Get('remote-sets')
  async remoteSets(@CurrentUser() user: { id: string; role: Role }) {
    const res = await this.sync.remoteSets();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.remote_sets',
      entityType: 'CardSet',
    });
    return res;
  }

  /**
   * GET /admin/catalog/sync-status — progreso del barrido `sync-all` en curso (o del último).
   * Pensado para POLLING desde M2 (cada pocos segundos): por eso NO se audita (evita inundar
   * AuditLog) y NO llama a pokemontcg.io (lee estado en memoria; no consume rate-limit).
   */
  @Get('sync-status')
  async syncStatus() {
    // §PRECIO-SIN-ENLACE: `unlinkedPrice` aditivo, solo lectura LOCAL (cartas con 0 CardProduct; sin proveedores).
    return {
      ...this.sync.getSyncStatus(),
      unlinkedPrice: await this.linkRepair.unlinkedPrice(),
      // §AUTO-ENLACE fase 2: contador «quedan X · ayer Y» (contrato §5).
      // (⛔ no se llama `summary`: pisaría el `summary` del barrido que ya trae `getSyncStatus()`; contrato §8c.)
      autoLink: await this.linkExceptions.summary(),
      // §BUSCADOR-CARTAS §3: cobertura de claves impresas de set («k de N sets sin clave»), aditivo.
      searchKeys: await this.searchKeys.coverage(),
    };
  }

  /**
   * POST /admin/catalog/unify-rarities — backfill LOCAL de `Card.rarityCanonical` (money-safe).
   * Re-deriva `rarityCanonical = normalizeRarity(rarity)` para toda carta con `rarity != null` (repara
   * la regresión M-31 que fragmentaba el editor de reglas). NUNCA llama a pokemontcg.io/TCGCSV y NO
   * toca precios/`PriceReference`/composición — SOLO reescribe una columna derivada de columna local.
   * Síncrono (200) porque es un UPDATE de UNA columna con universo de rarezas distintas = decenas;
   * idempotente (segunda corrida = 0 updates). Auditado (`catalog.unify_rarities`). super_admin (hereda
   * el @Roles del controller). Ver `CatalogSyncService.unifyRarities` y docs/BACKEND_NOTES.md.
   */
  @Post('unify-rarities')
  @HttpCode(200)
  async unifyRarities(@CurrentUser() user: { id: string; role: Role }) {
    const res = await this.sync.unifyRarities();
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.unify_rarities',
      entityType: 'Card',
      after: {
        cardsProcessed: res.cardsProcessed,
        cardsUpdated: res.cardsUpdated,
        distinctCanonical: res.distinctCanonical,
        unmappedCount: res.unmapped.length,
      },
    });
    return res;
  }

  /**
   * POST /admin/catalog/link-repair {setId} — §PRECIO-SIN-ENLACE: liga SOLO las cartas sin enlace de UN set (jamás reescribe las
   * enlazadas; no es `sync` ni usa `force`). super_admin, auditado (`catalog.link_repair`), una corrida por set cada 10 min (429).
   */
  @Post('link-repair')
  @HttpCode(200)
  async doLinkRepair(@Body() dto: LinkRepairDto, @CurrentUser() user: { id: string; role: Role }) {
    // `linkedCardIds`/`samples` son de la bitácora del job (≤ 600 ids): no viajan por HTTP.
    const { name: _name, error: _error, linkedCardIds: _ids, samples: _samples, ...res } = await this.linkRepair.runForSet(dto.setId, user.id);
    void _name;
    void _error;
    void _ids;
    void _samples;
    return res;
  }

  /** GET /admin/catalog/link-exceptions — lista única de sets con cartas sin ligar, motivo, grupo usado y candidatos (solo lectura local; contrato §2). */
  @Get('link-exceptions')
  async listLinkExceptions() {
    return this.linkExceptions.list();
  }

  /** POST /admin/catalog/link-exceptions/:setId/confirm {groupId} — persiste el grupo elegido, liga y precia el set (super_admin, auditado; contrato §3). */
  @Post('link-exceptions/:setId/confirm')
  @HttpCode(200)
  async confirmLinkException(
    @Param('setId', new ParseUUIDPipe()) setId: string,
    @Body() dto: ConfirmGroupDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.linkExceptions.confirm(setId, dto.groupId, user);
  }

  /** GET /admin/catalog/link-exceptions/:setId/cards — cartas del set con `name_mismatch|collision` y sus candidatos (super_admin; contrato §9.4). */
  @Get('link-exceptions/:setId/cards')
  async listLinkExceptionCards(@Param('setId', new ParseUUIDPipe()) setId: string) {
    return this.cardConfirm.list(setId);
  }

  /** POST /admin/catalog/link-exceptions/:setId/cards/:cardId/confirm {productId} — liga UNA carta (enlace + precios + bitácora en una transacción; contrato §9.4). */
  @Post('link-exceptions/:setId/cards/:cardId/confirm')
  @HttpCode(200)
  async confirmLinkExceptionCard(
    @Param('setId', new ParseUUIDPipe()) setId: string,
    @Param('cardId', new ParseUUIDPipe()) cardId: string,
    @Body() dto: ConfirmCardDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.cardConfirm.confirm(setId, cardId, dto.productId, user);
  }

  /** POST /admin/catalog/link-exceptions/:setId/unlink — revierte lo que el job creó en ese set (super_admin; contrato §9.6 iv). */
  @Post('link-exceptions/:setId/unlink')
  @HttpCode(200)
  async unlinkSet(@Param('setId', new ParseUUIDPipe()) setId: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.autoAdmin.unlink(setId, user);
  }

  /** GET /admin/catalog/auto-link-runs?days=7 — lo que hizo el job (solo lectura sobre la bitácora; contrato §9.6 iii). */
  @Get('auto-link-runs')
  async autoLinkRuns(@Query('days') days?: string) {
    const n = days == null || days === '' ? undefined : Number(days);
    if (n != null && !Number.isInteger(n)) throw BusinessException.validation('VALIDATION_ERROR', 'days must be an integer');
    return this.autoAdmin.runs(n);
  }

  /** GET /admin/catalog/finish-review — piezas antiguas que podrían ser 1.ª edición, por confirmar (solo lectura local; contrato §8b). */
  @Get('finish-review')
  async listFinishReview(@Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    const n = limit == null || limit === '' ? undefined : Number(limit);
    if (n != null && !Number.isFinite(n)) throw BusinessException.validation('VALIDATION_ERROR', 'limit must be a number');
    return this.finishReview.list(cursor, n);
  }

  /** POST /admin/catalog/finish-review/:inventoryItemId {decision, expectedFinish} — decide una pieza (super_admin, auditado; contrato §8b). */
  @Post('finish-review/:inventoryItemId')
  @HttpCode(200)
  async decideFinishReview(
    @Param('inventoryItemId', new ParseUUIDPipe()) inventoryItemId: string,
    @Body() dto: FinishReviewDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    return this.finishReview.decide(inventoryItemId, { decision: dto.decision, expectedFinish: dto.expectedFinish }, user);
  }

  @Post('sync')
  @HttpCode(202)
  async doSync(@Body() dto: SyncDto, @CurrentUser() user: { id: string; role: Role }) {
    // v1.27 (P-12): `force` propagado hasta importSet/importSetByExternalId (resolver estructural
    // TCGCSV por set) y registrado en el detalle de auditoría.
    const force = dto.force ?? false;
    // AE-3: `sync` de UN set (1 cada 10 min por set, 429); el barrido completo no lleva este límite.
    const claimId = dto.setId ? await this.linkRepair.claimSync(dto.setId, user.id) : null;
    let res: Awaited<ReturnType<CatalogSyncService['sync']>>;
    try {
      res = await this.sync.sync(dto.setId, dto.fromReleaseDate, force);
    } catch (e) {
      if (claimId) await this.linkRepair.releaseSyncClaim(claimId);
      throw e;
    }
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.sync',
      entityType: 'CardSet',
      after: { setId: dto.setId ?? null, mode: res.mode, setsQueued: res.setsQueued, force },
    });
    return res;
  }

  /**
   * v1.3 — importa TODO el catálogo (Opción 1 del cotizador). Truly-async: encola en segundo
   * plano y responde 202 de inmediato (no importa en el request; ver DEV-1). Auditado.
   *
   * v1.6-finish — `force` (opcional, default false; body `{force:true}` o query `?force=true`)
   * reprocesa TODOS los sets remotos (incluidos los ya poblados) para refrescar
   * `availableFinishes`/precios por acabado. La firma sigue siendo compatible (force opcional).
   */
  /**
   * M-34 — POST /admin/catalog/refresh-variants — refresca VARIANTES (finishes) + precio por
   * variante de un set YA IMPORTADO usando SOLO TCGCSV (NUNCA pokemontcg.io). Síncrono (opera sobre
   * las Card existentes de UN set), 200 con resumen. Auditado (`catalog.refresh_variants`). Ver
   * `CatalogSyncService.refreshVariants` y docs/BACKEND_NOTES.md para el contrato completo.
   */
  @Post('refresh-variants')
  @HttpCode(200)
  async refreshVariants(
    @Body() dto: RefreshVariantsDto,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const force = dto.force ?? false;
    const res = await this.sync.refreshVariants(dto.setId, force);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.refresh_variants',
      entityType: 'CardSet',
      after: {
        setId: res.setId,
        cardsProcessed: res.cardsProcessed,
        cardProductsUpserted: res.cardProductsUpserted,
        pricesUpserted: res.pricesUpserted,
        pending: res.pending,
        tcgcsvReachable: res.tcgcsvReachable,
        force,
      },
    });
    return res;
  }

  /**
   * GET /admin/catalog/refresh-variants-status (M-35) — progreso + resumen agregado del barrido
   * `refresh-variants-all` en curso (o del último). Pensado para POLLING desde el front (igual que
   * `sync-status`): por eso NO se audita (evita inundar AuditLog) y NO llama a ningún upstream.
   */
  @Get('refresh-variants-status')
  refreshVariantsStatus() {
    return this.sync.getRefreshVariantsAllStatus();
  }

  /**
   * M-35 — POST /admin/catalog/refresh-variants-all — versión BATCH del `refresh-variants`: corre,
   * sobre TODOS los sets YA IMPORTADOS (los que tienen cartas en BD), el MISMO refresh solo-TCGCSV
   * por-set. NUNCA llama a pokemontcg.io (ni para listar sets). NO bloqueante (mismo modelo que
   * `sync-all`): 202 inmediato, progreso/resumen por `GET /admin/catalog/refresh-variants-status`.
   * Auditado (`catalog.refresh_variants_all`). Ver `CatalogSyncService.refreshVariantsAll`.
   */
  @Post('refresh-variants-all')
  @HttpCode(202)
  async refreshVariantsAll(
    @Body() dto: RefreshVariantsAllDto,
    @Query('force') queryForce: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const force = parseForce(dto.force, queryForce);
    const res = await this.sync.refreshVariantsAll({ force });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.refresh_variants_all',
      entityType: 'CardSet',
      after: { jobId: res.jobId, setsQueued: res.setsQueued, remaining: res.remaining, force },
    });
    return res;
  }

  @Post('sync-all')
  @HttpCode(202)
  async syncAll(
    @Body() dto: SyncAllDto,
    @Query('force') queryForce: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const force = parseForce(dto.force, queryForce);
    const res = await this.sync.syncAll({ force, actor: { kind: 'user', id: user.id, role: user.role } });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.sync_all',
      entityType: 'CardSet',
      after: { jobId: res.jobId, setsQueued: res.setsQueued, remaining: res.remaining, force },
    });
    return res;
  }

  @Post('backfill')
  @HttpCode(200)
  async backfill(
    @Body() dto: BackfillDto,
    @Query('force') queryForce: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const force = parseForce(dto.force, queryForce);
    const res = await this.sync.backfill(dto.batchSize ?? 10, dto.untilYear, force);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.backfill',
      entityType: 'CardSet',
      after: {
        imported: res.imported.length,
        newBoundary: res.newBoundary,
        remaining: res.remaining,
        force,
      },
    });
    return res;
  }

  /** GET /admin/catalog/tcgcsv-groups — SOLO los grupos de la lista explícita `TCGCSV_IMPORTABLE_GROUPS` (P-PROMOS, ARCHITECTURE §5.12). */
  @Get('tcgcsv-groups')
  tcgcsvGroups() {
    return this.tcgcsvImport.listGroups();
  }

  /** POST /admin/catalog/import-tcgcsv-set — crea/actualiza el set y sus cartas desde un grupo de TCGCSV. Idempotente. */
  @Post('import-tcgcsv-set')
  @HttpCode(200)
  async importTcgcsvSet(@Body() dto: ImportTcgcsvSetDto, @CurrentUser() user: { id: string; role: Role }) {
    // La bitácora `catalog.tcgcsv_import` la escribe el servicio DENTRO de la transacción del import.
    const res = await this.tcgcsvImport.importGroup(dto.groupId, user);
    return res;
  }
}
