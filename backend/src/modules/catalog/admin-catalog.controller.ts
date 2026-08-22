import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogSyncService } from './catalog-sync.service';
import { AuditService } from '../audit/audit.service';

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
  syncStatus() {
    return this.sync.getSyncStatus();
  }

  @Post('sync')
  @HttpCode(202)
  async doSync(@Body() dto: SyncDto, @CurrentUser() user: { id: string; role: Role }) {
    // v1.27 (P-12): `force` propagado hasta importSet/importSetByExternalId (resolver estructural
    // TCGCSV por set) y registrado en el detalle de auditoría.
    const force = dto.force ?? false;
    const res = await this.sync.sync(dto.setId, dto.fromReleaseDate, force);
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

  @Post('sync-all')
  @HttpCode(202)
  async syncAll(
    @Body() dto: SyncAllDto,
    @Query('force') queryForce: string | undefined,
    @CurrentUser() user: { id: string; role: Role },
  ) {
    const force = parseForce(dto.force, queryForce);
    const res = await this.sync.syncAll({ force });
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
}
