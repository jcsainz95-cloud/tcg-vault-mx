/**
 * marketing.controller.ts — Panel de Marketing Fase 0 (API_CONTRACT §MKT.E; Brief 2 §4/§7).
 *
 *  - `GET /admin/marketing/aggregates` — token `marketing-reader` (Bearer). JSON de agregados de UNA
 *    pantalla, periodo semana/mes CERRADO. 401/403/400/429 según §MKT.E. `Cache-Control: no-store`.
 *  - `GET /admin/marketing/export` — sesión admin con `marketing:read`: .xlsx/.csv de UNA pantalla.
 *  - `GET /admin/marketing/export/todo` — .xlsx con una hoja por pantalla (a-h) + «Info».
 *  - `GET /admin/marketing/weekly-excel` — botón «Descargar Excel de la semana» (P2=B): .xlsx de la
 *    última semana cerrada (o la del selector), una hoja por pantalla + «Info».
 *
 * Cada salida deja una fila en `MarketingAccessLog` (PM-M3). Las mismas cifras en endpoint y Excel
 * para el mismo periodo (paridad A=B) por construir ambos del mismo `ScreenPayload`.
 */
import { Controller, Get, Header, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Permission } from '@prisma/client';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { MarketingApiTokenGuard } from './marketing-token.guard';
import { MarketingAnalyticsService } from './marketing-analytics.service';
import { MarketingExportService } from './export/marketing-export.service';
import { MarketingAccessLogService } from './marketing-access-log.service';
import {
  lastClosedWeekStart,
  MARKETING_SCREENS,
  parseScreen,
  resolveMarketingPeriod,
  type MarketingPeriodQuery,
  type MarketingScreen,
} from './marketing-period';
import type { ScreenPayload } from './marketing-aggregates.types';
import { BusinessException } from '../../common/business.exception';

@Controller('admin/marketing')
export class MarketingController {
  constructor(
    private readonly analytics: MarketingAnalyticsService,
    private readonly exporter: MarketingExportService,
    private readonly accessLog: MarketingAccessLogService,
  ) {}

  /** Pasa los parámetros de periodo (week|weekStart|month y los prohibidos) tal cual a la validación. */
  private periodQuery(q: Record<string, unknown>): MarketingPeriodQuery {
    return { week: q.week, weekStart: q.weekStart, month: q.month, from: q.from, to: q.to, day: q.day, preset: q.preset };
  }

  // ─────────────────────────── Endpoint de agregados (token marketing-reader) ───────────────────────────

  @Public() // salta JwtAuthGuard; se reautentica por token:
  @UseGuards(MarketingApiTokenGuard)
  @Get('aggregates')
  @Header('Cache-Control', 'no-store')
  async aggregates(@Req() req: Request, @Query() q: Record<string, unknown>): Promise<ScreenPayload> {
    const now = new Date();
    const screen = parseScreen(q.pantalla);
    const period = resolveMarketingPeriod(this.periodQuery(q), now);
    const payload = await this.analytics.screen(screen, period, now);
    const token = (req as unknown as { marketingToken?: { id: string } }).marketingToken;
    await this.accessLog.record({
      tokenId: token?.id ?? null,
      screen,
      format: 'json',
      filters: { period: period.label, kind: period.kind },
      rowCount: payload.tables.reduce((m, t) => m + t.rows.length, 0),
    });
    return payload;
  }

  // ─────────────────────────── Exports (sesión admin con marketing:read) ───────────────────────────

  @Get('export')
  @RequirePermission(Permission.marketing_read)
  @Header('Cache-Control', 'no-store')
  async export(
    @CurrentUser() user: { id: string },
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const now = new Date();
    const screen = parseScreen(q.pantalla);
    const period = resolveMarketingPeriod(this.periodQuery(q), now);
    const format = q.format === 'csv' ? 'csv' : q.format === 'xlsx' ? 'xlsx' : undefined;
    if (!format) throw BusinessException.badRequest('VALIDATION_ERROR', 'format must be xlsx or csv');
    const payload = await this.analytics.screen(screen, period, now);

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
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const now = new Date();
    const period = resolveMarketingPeriod(this.periodQuery(q), now);
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
    @Query() q: Record<string, unknown>,
    @Res() res: Response,
  ): Promise<void> {
    const now = new Date();
    // Sin selector ⇒ última semana cerrada; con selector, valida semana/mes cerrados como el resto.
    const hasPeriod = q.week !== undefined || q.weekStart !== undefined || q.month !== undefined;
    const period = resolveMarketingPeriod(
      hasPeriod ? this.periodQuery(q) : { weekStart: lastClosedWeekStart(now) },
      now,
    );
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
    for (const s of MARKETING_SCREENS) out.push(await this.analytics.screen(s as MarketingScreen, period, now));
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
