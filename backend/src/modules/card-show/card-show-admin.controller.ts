import { Controller, Get, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { CardShowService } from './card-show.service';
import { withBom } from './csv.util';

/**
 * card-show-admin.controller.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.15). Panel SOLO `super_admin`.
 * ⛔ PENDING no aparece en listados/conteos/CSV. El CSV del torneo (único destino de `playerName`/
 * `playerId`) es para el organizador. Cada export deja 1 `AuditLog`. ⛔ Sin IP en ninguna salida.
 */
@Controller('admin/card-show')
@Roles(Role.super_admin)
export class CardShowAdminController {
  constructor(
    private readonly service: CardShowService,
    private readonly audit: AuditService,
  ) {}

  @Get('leads')
  listLeads(
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.service.listLeads({ status, type, q, from, to, ...this.paging(page, pageSize) });
  }

  @Get('players')
  listPlayers(
    @Query('status') status?: string,
    @Query('day') day?: string,
    @Query('game') game?: string, // ⭐M-84 filtro por juego (CardShowGame; fuera de dominio ⇒ 400)
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '20',
  ) {
    return this.service.listPlayers({ status, day, game, q, from, to, ...this.paging(page, pageSize) });
  }

  @Post('leads/:id/release')
  async release(@Param('id') id: string, @CurrentUser('id') userId: string) {
    await this.service.releaseLead(id, userId);
    return { ok: true };
  }

  @Post('reopen-sending')
  async reopen(@CurrentUser('id') userId: string) {
    await this.service.reopenSending(userId);
    return { ok: true };
  }

  @Get('leads/export.csv')
  async exportLeads(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const csv = await this.service.exportLeadsCsv({ status, type, q, from, to });
    await this.audit.log({ actorUserId: userId, action: 'card_show.export_leads_csv', entityType: 'CardShow' });
    this.sendCsv(res, 'card-show-leads.csv', csv);
  }

  @Get('players/export.csv')
  async exportPlayers(
    @CurrentUser('id') userId: string,
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('day') day?: string,
    @Query('game') game?: string, // ⭐M-84 mismo dominio/conducta que la ruta JSON de /players
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const csv = await this.service.exportPlayersCsv({ status, day, game, q, from, to });
    await this.audit.log({ actorUserId: userId, action: 'card_show.export_players_csv', entityType: 'CardShow' });
    this.sendCsv(res, 'card-show-players.csv', csv);
  }

  private paging(page: string, pageSize: string): { page: number; pageSize: number } {
    return {
      page: Math.max(1, parseInt(page, 10) || 1),
      pageSize: Math.min(200, Math.max(1, parseInt(pageSize, 10) || 20)),
    };
  }

  private sendCsv(res: Response, filename: string, csv: string): void {
    // BOM de UTF-8 para que Excel (Windows) no rompa los acentos — §CARDSHOW.15. No cambia columnas.
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(withBom(csv));
  }
}
