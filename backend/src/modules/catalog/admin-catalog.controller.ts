import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CatalogSyncService } from './catalog-sync.service';
import { AuditService } from '../audit/audit.service';

class SyncDto {
  @IsOptional() @IsString() setId?: string;
  @IsOptional() @IsString() fromReleaseDate?: string;
}

class BackfillDto {
  @IsOptional() @IsInt() @Min(1) batchSize?: number;
  @IsOptional() @IsInt() untilYear?: number;
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

  @Post('sync')
  @HttpCode(202)
  async doSync(@Body() dto: SyncDto, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.sync.sync(dto.setId, dto.fromReleaseDate);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.sync',
      entityType: 'CardSet',
      after: { setId: dto.setId ?? null, mode: res.mode, setsQueued: res.setsQueued },
    });
    return res;
  }

  @Post('backfill')
  @HttpCode(200)
  async backfill(@Body() dto: BackfillDto, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.sync.backfill(dto.batchSize ?? 10, dto.untilYear);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'catalog.backfill',
      entityType: 'CardSet',
      after: { imported: res.imported.length, newBoundary: res.newBoundary, remaining: res.remaining },
    });
    return res;
  }
}
