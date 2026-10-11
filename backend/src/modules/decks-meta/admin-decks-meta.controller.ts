import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import {
  IsBoolean,
  IsIn,
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
import { AUTOFETCH_DIAL_VALUES, AutofetchDial } from './limitless.config';

/**
 * DECKS-META §13 (Fase 1) — endpoints ADMIN (rol `vault_operator+`). Curaduría manual (fallback que
 * NO depende de Limitless en vivo) y reporte de no-mapeadas. FUENTE-CONFIABLE (SUP-LEG): ya NO existe
 * la rotación de legalidad — Limitless publica sólo listas Standard-legal, así que no re-filtramos.
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

class SetDialDto {
  // El kill-switch de 3 estados. Encenderlo (`on`) dispara egress real + publicación ⇒ super_admin.
  @IsOptional() @IsIn(AUTOFETCH_DIAL_VALUES as unknown as string[]) autofetch?: AutofetchDial;
  // Auto-publicar los decks que pasan canary. Sólo boolean.
  @IsOptional() @IsBoolean() autopublish?: boolean;
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

  /**
   * `GET /admin/decks-meta/dial` — estado ACTUAL del dial de auto-fetch (`vault_operator+`, sólo
   * lectura). Fail-closed: keys ausentes ⇒ `{ autofetch:'off', autopublish:false }`. Se declara
   * ANTES de `PUT/GET :id` para que el segmento estático gane sobre el param.
   */
  @Get('dial')
  dial() {
    return this.service.loadDialState();
  }

  /**
   * `PUT /admin/decks-meta/dial` — escribe el dial (parcial permitido). SUPER_ADMIN sólo: encenderlo
   * (`on`) causa egress real a un tercero + publicación automática. AUDITADO (old→new), ATÓMICO y
   * VALIDADO (autofetch ∈ off/dryrun/on; autopublish boolean; cualquier otra cosa ⇒ 400).
   */
  @Put('dial')
  @Roles(Role.super_admin)
  async setDial(@Body() dto: SetDialDto, @CurrentUser() user: { id: string; role: Role }) {
    const { before, after } = await this.service.adminSetDial(dto, user.id);
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'decks_meta.dial.set',
      entityType: 'ConfigSetting',
      entityId: 'decks_meta_autofetch',
      before,
      after,
    });
    return after;
  }

  /** Fija rank/published/pausedByOperator (curaduría ligera). */
  @Put(':id')
  update(@Param('id') id: string, @Body() dto: UpdateDeckDto) {
    return this.service.adminUpdate(id, dto);
  }
}
