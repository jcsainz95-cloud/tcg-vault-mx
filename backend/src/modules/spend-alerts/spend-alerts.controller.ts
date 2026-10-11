/**
 * spend-alerts.controller.ts — 💰 el panel de avisos de gasto (API_CONTRACT §19.29.9 con §19.30.2 (4), §19.31.8).
 *
 * `@Roles(vault_operator, super_admin)` + `@MoneyOut()` de CLASE: el operador recibe `403 MONEY_OUT_FORBIDDEN` y `MoneyOutGuard`
 * escribe `money_out.blocked` en TODAS las rutas, también los `GET` (PS-152). ⛔ Sin `@Roles(super_admin)` a secas: el guard de
 * roles contestaría un `403` mudo, sin bitácora. `Cache-Control: no-store`. ⛔ Sin verbo de borrado ni de «no visto».
 */
import { Body, Controller, Get, Header, HttpCode, Inject, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';
import { SpendAlertsPanelService } from './spend-alerts-panel.service';
import { SPEND_ALERTS_CLOCK, SpendClock } from './spend-alerts.constants';

@Controller('admin/spend-alerts')
@Roles(Role.vault_operator, Role.super_admin)
@MoneyOut()
export class SpendAlertsController {
  constructor(
    private readonly panel: SpendAlertsPanelService,
    private readonly audit: AuditService,
    @Inject(SPEND_ALERTS_CLOCK) private readonly clock: SpendClock,
  ) {}

  /**
   * Ejes por NOMBRE (el censo `C-EQ-1` los cruza uno a uno): `kind`/`severity` (E), `unseen`/`muted` (L) al REGISTRO de §0-Q;
   * `subjectUserId` (uuid) y `from`/`to` (días MX) a `NO_ENUM_POR_RUTA` (§19.32.1); `page`/`pageSize` transversales.
   */
  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @Query('kind') kind?: string,
    @Query('severity') severity?: string,
    @Query('subjectUserId') subjectUserId?: string,
    @Query('unseen') unseen?: string,
    @Query('muted') muted?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.panel.list({ kind, severity, subjectUserId, unseen, muted, from, to, page, pageSize });
  }

  @Get('summary')
  @Header('Cache-Control', 'no-store')
  summary(@Query('from') from?: string, @Query('to') to?: string) {
    return this.panel.summary({ from, to }, this.clock.now());
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.panel.get(id);
  }

  /** Bitácora `spend_alert.seen {count, skipped}` (§19.30.2 (4)). Idempotente: re-marcar ⇒ `updated: 0`. */
  @Post('seen')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  async seen(@Body() body: unknown, @CurrentUser() user: { id: string; role: Role }) {
    const res = await this.panel.seen(body, user.id, this.clock.now());
    await this.audit.log({
      actorUserId: user.id,
      actorRole: user.role,
      action: 'spend_alert.seen',
      entityType: 'SpendAlert',
      after: { count: res.updated, skipped: res.skipped },
    });
    return { updated: res.updated, skipped: res.skipped };
  }
}
