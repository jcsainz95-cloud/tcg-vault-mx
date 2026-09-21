import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { DecksMetaService } from './decks-meta.service';
import { DecksMetaRefreshService } from './decks-meta-refresh.service';

/**
 * DECKS-META §13 (Fase 1) — endpoints ADMIN (rol `vault_operator+`). Curaduría manual (fallback que
 * NO depende de Limitless en vivo), reporte de no-mapeadas y ROTACIÓN de legalidad. Money-adjacent
 * (la rotación gobierna qué se ofrece como jugable) ⇒ va a la fase de seguridad por release.
 */

class CurateDeckDto {
  @IsString() @MaxLength(120) slug!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @MaxLength(20_000) listText!: string;
  @IsOptional() @IsInt() rank?: number;
  @IsOptional() @IsNumber() sharePct?: number;
  @IsOptional() @IsInt() trend?: number;
  @IsOptional() @IsString() @MaxLength(120) formatLabel?: string;
  @IsOptional() @IsString() @MaxLength(500) sourceUrl?: string;
  @IsOptional() @IsString() @MaxLength(200) sourceTournament?: string;
  @IsOptional() @IsString() imageCardId?: string;
  @IsOptional() @IsBoolean() published?: boolean;
}

class UpdateDeckDto {
  @IsOptional() @IsInt() rank?: number;
  @IsOptional() @IsBoolean() published?: boolean;
  @IsOptional() @IsBoolean() pausedByOperator?: boolean;
  @IsOptional() @IsNumber() sharePct?: number;
  @IsOptional() @IsInt() trend?: number;
}

class StandardLegalityDto {
  // La ventana de marcas vigentes (rotación). Editar recalcula la legalidad DERIVADA sin re-sync.
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) activeMarks?: string[];
  // Override de operación por `externalId` (raro; bans puntuales sobre lo que el proveedor no marcó).
  @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) banlistCardIds?: string[];
}

@Controller('admin/decks-meta')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminDecksMetaController {
  constructor(
    private readonly service: DecksMetaService,
    private readonly refresh: DecksMetaRefreshService,
    private readonly audit: AuditService,
  ) {}

  /** Lista con estado (published, pausedByOperator, source, rank, fetchedAt, no-mapeadas). */
  @Get()
  list() {
    return this.service.adminList();
  }

  /**
   * DECKS-META Fase 2 (§8) — DRY-RUN / preview: corre el pipeline REAL (home → listas → parse →
   * match → legalidad → canary) y devuelve el reporte INLINE **sin escribir NADA publicado**. Es la
   * vía de verificación en prod (el sandbox bloquea el egress a Limitless). Operador (vault_operator+).
   *
   * Dispara egress real a un tercero (Limitless) ⇒ se AUDITA como el disparo POST (traza de quién
   * verificó y cuándo), aunque en dry-run no escriba nada publicado.
   */
  @Get('preview')
  async preview(@CurrentUser() user: { id: string; role: Role }) {
    const result = await this.refresh.run({ dryRun: true });
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'jobs.decks_meta_preview.run',
      entityType: 'Job',
      entityId: 'decks-meta-preview',
      after: {
        skipped: result.skipped,
        mode: result.mode,
        ...(result.skipped
          ? { reason: result.reason }
          : { verdict: result.report.verdict, applied: result.report.applied, deckCount: result.report.decks.length }),
      },
    });
    return result;
  }

  /** Reporte de líneas no mapeadas de listas publicadas, para curar (set+número crudos). */
  @Get('unmatched')
  unmatched() {
    return this.service.adminUnmatched();
  }

  /** Curaduría/fallback: pega un top-10 MANUAL (mismo formato/motor, `source=manual`). */
  @Post()
  curate(@Body() dto: CurateDeckDto) {
    return this.service.adminCreateOrCurate(dto);
  }

  /** Fija rank/published/pausedByOperator (curaduría ligera). */
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeckDto) {
    return this.service.adminUpdate(id, dto);
  }
}

/**
 * `PUT /admin/config/standard-legality` — el mecanismo de ROTACIÓN (§12.1). Va en su propio
 * controller de ruta (`admin/config`) porque edita `ConfigSetting`, no un `MetaDeck`.
 */
@Controller('admin/config')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminStandardLegalityController {
  constructor(private readonly service: DecksMetaService) {}

  @Put('standard-legality')
  update(@Body() dto: StandardLegalityDto, @CurrentUser('id') actorId: string) {
    return this.service.adminUpdateStandardLegality(dto, actorId ?? 'admin');
  }
}
