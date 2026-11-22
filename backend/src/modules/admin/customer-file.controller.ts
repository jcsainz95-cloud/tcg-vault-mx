/**
 * customer-file.controller.ts — §FICHA-CLIENTE (docs/API_CONTRACT_FICHA_CLIENTE.md): `overview` y notas internas de
 * `/admin/users/:id/*`. Roles: `vault_operator` + `super_admin` (guard de clase); cuenta `supplier` ⇒ 404; respuestas `no-store`.
 */
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { NotSupplierTargetGuard } from '../../common/guards/not-supplier-target.guard';
import { ActorThrottlerGuard } from './actor-throttler.guard';
import { CustomerNotesService } from './customer-notes.service';
import { CustomerOverviewService } from './customer-overview.service';

/** Solo ESTRUCTURA: el rango/trim de `body` (1–1000, 400) lo decide el servicio, que es quien lo guarda. */
export class CreateCustomerNoteDto {
  @IsString() body!: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsUUID() clientRequestId?: string;
}
export class UpdateCustomerNoteDto {
  @IsOptional() @IsString() body?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
}

type Actor = { id: string; role: Role };

@Controller('admin/users')
@Roles(Role.vault_operator, Role.super_admin)
@UseGuards(NotSupplierTargetGuard)
export class AdminCustomerFileController {
  constructor(
    private readonly overview: CustomerOverviewService,
    private readonly notes: CustomerNotesService,
  ) {}

  @Get(':id/overview')
  @Header('Cache-Control', 'no-store')
  getOverview(@Param('id') id: string) {
    return this.overview.overview(id);
  }

  @Get(':id/notes')
  @Header('Cache-Control', 'no-store')
  listNotes(@Param('id') id: string, @CurrentUser() actor: Actor, @Query('cursor') cursor?: string, @Query('limit') limit?: string) {
    return this.notes.list(id, actor, { cursor, limit });
  }

  /** 201 al crear; 200 con la nota ya creada si `clientRequestId` se repite (doble clic). */
  @Post(':id/notes')
  @UseGuards(ActorThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  async createNote(
    @Param('id') id: string,
    @Body() dto: CreateCustomerNoteDto,
    @CurrentUser() actor: Actor,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { note, created } = await this.notes.create(id, actor, dto);
    res.status(created ? 201 : 200);
    return note;
  }

  @Patch(':id/notes/:noteId')
  @UseGuards(ActorThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  updateNote(@Param('id') id: string, @Param('noteId') noteId: string, @Body() dto: UpdateCustomerNoteDto, @CurrentUser() actor: Actor) {
    return this.notes.update(id, noteId, actor, dto);
  }

  @Delete(':id/notes/:noteId')
  @HttpCode(204)
  @UseGuards(ActorThrottlerGuard)
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @Header('Cache-Control', 'no-store')
  async deleteNote(@Param('id') id: string, @Param('noteId') noteId: string, @CurrentUser() actor: Actor): Promise<void> {
    await this.notes.remove(id, noteId, actor);
  }
}
