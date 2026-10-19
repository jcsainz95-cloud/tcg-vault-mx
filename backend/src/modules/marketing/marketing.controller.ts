/**
 * marketing.controller.ts — Panel de Marketing Fase 0 (API_CONTRACT §MKT.E; Brief 2 §4/§7).
 *
 *  - `GET /admin/marketing/aggregates` — token `marketing-reader` (Bearer). JSON de agregados de UNA
 *    pantalla, periodo semana/mes CERRADO. 401/400/429 según §MKT.E (token-only ⇒ NUNCA 403, D-MKT-AUTZ).
 *    `Cache-Control: no-store`.
 *  - `GET /admin/marketing/export` — sesión admin con `marketing:read`: .xlsx/.csv de UNA pantalla.
 *  - `GET /admin/marketing/export/todo` — .xlsx con una hoja por pantalla (a-h) + «Info».
 *  - `GET /admin/marketing/weekly-excel` — botón «Descargar Excel de la semana» (P2=B): .xlsx de la
 *    última semana cerrada (o la del selector), una hoja por pantalla + «Info».
 *  - `GET /admin/marketing/panel` — sesión con `marketing:read`: el MISMO `ScreenPayload` que `aggregates` para la
 *    pantalla del admin (§MKT.G.2). `GET /admin/marketing/periods` — periodos cerrados del selector (§MKT.G.3).
 *  - Tokens del analista: `marketing-tokens.controller.ts` (§MKT.G.6, solo `super_admin`).
 *
 * Cada salida deja una fila en `MarketingAccessLog` (PM-M3). Las mismas cifras en endpoint y Excel
 * para el mismo periodo (paridad A=B) por construir ambos del mismo `ScreenPayload`.
 */
import { Controller, Get, Header, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Permission, Role } from '@prisma/client';
import { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MarketingApiTokenGuard, type MarketingTokenRequest } from './marketing-token.guard';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingExportService } from './export/marketing-export.service';
import { MarketingAccessLogService } from './marketing-access-log.service';
import {
  MARKETING_SCREENS,
  marketingPeriodOptions,
  parseExportFormat,
  parseScreen,
  resolveMarketingPeriod,
  resolvePanelPeriod,
  type MarketingPeriodQuery,
  type MarketingPeriodsResponse,
  type MarketingScreen,
} from './marketing-period';
import type { ScreenPayload } from './marketing-aggregates.types';
import type { CellPrivacy, ExactPrivacy } from './small-cells';

/** Los siete parámetros de periodo, en el orden de los handlers: week, weekStart, month y los prohibidos from, to, day, preset. */
type PeriodParams = [
  week?: string,
  weekStart?: string,
  month?: string,
  from?: string,
  to?: string,
  day?: string,
  preset?: string,
];

@Controller('admin/marketing')
export class MarketingController {
  constructor(
    private readonly analytics: MarketingAnalyticsService,
    private readonly exporter: MarketingExportService,
    private readonly accessLog: MarketingAccessLogService,
  ) {}

  /**
   * Junta los parámetros de periodo (week|weekStart|month y los PROHIBIDOS from|to|day|preset) tal cual llegan, para la
   * validación de `resolveMarketingPeriod`/`resolvePanelPeriod`. ⭐ v1.104 (§0-Q punto 4 «Cómo se declara un eje», nota
   * `CEQ-MKT-1`): cada llave se declara con `@Query('<nombre>')` en el handler — ⛔ ni `@Query()` entero, ni DTO, ni
   * `req.query`, ni decorador propio: el descubrimiento de `C-EQ-1` solo ve el literal del decorador. Los prohibidos se
   * declaran TAMBIÉN, para que lleguen a la validación y den `400` (⛔ ignorarlos rompería §MKT.G.2).
   */
  private periodQuery(...p: PeriodParams): MarketingPeriodQuery {
    const [week, weekStart, month, from, to, day, preset] = p;
    return { week, weekStart, month, from, to, day, preset };
  }

  // ─────────────────────────── Endpoint de agregados (token marketing-reader) ───────────────────────────

  @Public() // salta JwtAuthGuard; se reautentica por token:
  @UseGuards(MarketingApiTokenGuard)
  @Get('aggregates')
  @Header('Cache-Control', 'no-store')
  async aggregates(
    @Req() req: MarketingTokenRequest,
    @Query('pantalla') pantalla?: string,
    @Query('week') week?: string,
    @Query('weekStart') weekStart?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('day') day?: string,
    @Query('preset') preset?: string,
  ): Promise<ScreenPayload> {
    const now = new Date();
    const screen = parseScreen(pantalla);
    const period = resolveMarketingPeriod(this.periodQuery(week, weekStart, month, from, to, day, preset), now);
    const payload = await this.analytics.screen(screen, period, now, 'small_cells');
    const token = req.marketingToken;
    await this.accessLog.record({
      tokenId: token?.id ?? null,
      screen,
      format: 'json',
      filters: { period: period.label, kind: period.kind },
      rowCount: payload.tables.reduce((m, t) => m + t.rows.length, 0),
    });
    return payload;
  }

  // ─────────────────────────── Pantalla del panel (sesión admin con marketing:read) ───────────────────────────

  /**
   * `GET /admin/marketing/panel` (API_CONTRACT §MKT.G.2) — los datos de UNA pantalla para pintarla. Mismo
   * `parseScreen` y misma validación de periodo que `aggregates` (sin periodo ⇒ última semana cerrada) y el
   * MISMO `analytics.screen()` ⇒ paridad A=B por construcción. ⛔ No es `@Public()`: el token opaco no es JWT ⇒ 401.
   */
  @Get('panel')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  async panel(
    @CurrentUser() user: { id: string; role?: Role },
    @Query('pantalla') pantalla?: string,
    @Query('week') week?: string,
    @Query('weekStart') weekStart?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('day') day?: string,
    @Query('preset') preset?: string,
  ): Promise<ScreenPayload> {
    const now = new Date();
    const screen = parseScreen(pantalla);
    const period = resolvePanelPeriod(this.periodQuery(week, weekStart, month, from, to, day, preset), now);
    const privacy = this.panelPrivacy(user);
    const payload = await this.analytics.screen(screen, period, now, privacy);
    await this.accessLog.record({
      actorUserId: user.id,
      tokenId: null,
      screen,
      format: 'json',
      filters: { period: period.label, kind: period.kind, surface: 'panel', privacy },
      rowCount: payload.tables.reduce((m, t) => m + t.rows.length, 0),
    });
    return payload;
  }

  /**
   * Régimen de celdas de la pantalla (API_CONTRACT v1.103 §MKT.G.2, D-MKT-PANEL-2; dueño 2026-10-18 «si cifras
   * exactas»). Lo decide el SERVIDOR por ROL, ⛔ nunca la query: `super_admin` ⇒ `exact`; cualquier otra sesión con
   * `marketing:read` ⇒ `small_cells`. Atado al rol (no a la fila `UserPermission`): delegar el permiso nunca delega
   * las cifras exactas. ÚNICO productor de `'exact'` en el módulo (candado `marketing-panel-privacy.spec.ts`).
   */
  private panelPrivacy(user: { role?: Role }): CellPrivacy {
    return user.role === Role.super_admin ? ('exact' as ExactPrivacy) : 'small_cells';
  }

  /** `GET /admin/marketing/periods` (§MKT.G.3) — selector de periodos cerrados. Sin datos de negocio ⇒ sin registro. */
  @Get('periods')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  periods(): MarketingPeriodsResponse {
    return marketingPeriodOptions(new Date());
  }

  // ─────────────────────────── Exports (sesión admin con marketing:read) ───────────────────────────

  @Get('export')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() user: { id: string },
    @Res() res: Response,
    @Query('pantalla') pantalla?: string,
    @Query('format') formatRaw?: string,
    @Query('week') week?: string,
    @Query('weekStart') weekStart?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('day') day?: string,
    @Query('preset') preset?: string,
  ): Promise<void> {
    const now = new Date();
    const screen = parseScreen(pantalla);
    const period = resolveMarketingPeriod(this.periodQuery(week, weekStart, month, from, to, day, preset), now);
    // SELECTOR (§0-Q punto 6-bis): ausente/vacío/basura ⇒ 400 {field:'format', allowed} (v1.104).
    const format = parseExportFormat(formatRaw);
    const payload = await this.analytics.screen(screen, period, now, 'small_cells');

    await this.accessLog.record({
      actorUserId: user.id,
      screen,
      format,
      filters: { period: period.label, kind: period.kind },
      rowCount: this.exporter.rowCount([payload]),
    });

    const filename = this.exporter.filename(screen, period.from, period.to, now, format);
    this.setDownloadHeaders(res, filename, format);
    if (format === 'csv') {
      res.send(this.exporter.screenCsv(payload));
    } else {
      res.send(await this.exporter.workbook([payload], now));
    }
  }

  @Get('export/todo')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  async exportAll(
    @CurrentUser() user: { id: string },
    @Res() res: Response,
    @Query('week') week?: string,
    @Query('weekStart') weekStart?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('day') day?: string,
    @Query('preset') preset?: string,
  ): Promise<void> {
    const now = new Date();
    const period = resolveMarketingPeriod(this.periodQuery(week, weekStart, month, from, to, day, preset), now);
    const payloads = await this.allScreens(period, now);
    await this.accessLog.record({
      actorUserId: user.id,
      screen: 'todo',
      format: 'xlsx',
      filters: { period: period.label, kind: period.kind },
      rowCount: this.exporter.rowCount(payloads),
    });
    const filename = this.exporter.filename('todo', period.from, period.to, now, 'xlsx');
    this.setDownloadHeaders(res, filename, 'xlsx');
    res.send(await this.exporter.workbook(payloads, now));
  }

  @Get('weekly-excel')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  async weeklyExcel(
    @CurrentUser() user: { id: string },
    @Res() res: Response,
    @Query('week') week?: string,
    @Query('weekStart') weekStart?: string,
    @Query('month') month?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('day') day?: string,
    @Query('preset') preset?: string,
  ): Promise<void> {
    const now = new Date();
    // Sin selector ⇒ última semana cerrada; con selector, valida semana/mes cerrados como el resto. Los prohibidos
    // (`from`/`to`/`day`/`preset`) llegan SIEMPRE a la validación ⇒ 400, nunca se ignoran (misma regla que el panel).
    const period = resolvePanelPeriod(this.periodQuery(week, weekStart, month, from, to, day, preset), now);
    const payloads = await this.allScreens(period, now);
    await this.accessLog.record({
      actorUserId: user.id,
      screen: 'semana',
      format: 'xlsx',
      filters: { period: period.label, kind: period.kind },
      rowCount: this.exporter.rowCount(payloads),
    });
    const filename = this.exporter.filename('semana', period.from, period.to, now, 'xlsx');
    this.setDownloadHeaders(res, filename, 'xlsx');
    res.send(await this.exporter.workbook(payloads, now));
  }

  private async allScreens(period: ReturnType<typeof resolveMarketingPeriod>, now: Date): Promise<ScreenPayload[]> {
    const out: ScreenPayload[] = [];
    for (const s of MARKETING_SCREENS) out.push(await this.analytics.screen(s as MarketingScreen, period, now, 'small_cells'));
    return out;
  }

  private setDownloadHeaders(res: Response, filename: string, format: 'xlsx' | 'csv'): void {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader(
      'Content-Type',
      format === 'csv'
        ? 'text/csv; charset=utf-8'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  }
}
