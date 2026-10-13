import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { BusinessException } from '../../common/business.exception';
import { StrictBodyPipe } from '../wishlist/dto/wishlist.dto';
import { CardShowService, ConfirmResult } from './card-show.service';
import { CardShowThrottleService } from './card-show-throttle.service';
import { CardShowWebhookService } from './card-show-webhook.service';
import { CardShowTokensService } from './card-show-tokens.service';
import { CardShowBodySizeGuard } from './body-size.guard';
import { ClickDto, CreateLeadDto, CreatePlayerDto, LinkActionDto } from './dto/card-show.dto';
import { ipThrottleKey } from './card-show-ip.util';
import { FORM_PURPOSES, FormPurpose, NEUTRAL_BODY, NEUTRAL_STATUS } from './card-show.constants';

/**
 * card-show.controller.ts — v1.93⟨cardshow⟩ (API_CONTRACT §CARDSHOW.2). Endpoints PÚBLICOS de la landing.
 *
 * El throttle por IP (C7) vive aquí porque necesita `req.ip` (clave del cubo, ⛔ no una cabecera) y la
 * cabecera `Retry-After`. La respuesta NEUTRA (202 `{ok:true}`) es idéntica para todo caso silencioso;
 * solo la validación de forma devuelve 400/413, el token caducado 400 FORM_EXPIRED y el throttle 429.
 * C4: el GET de confirm/cancel/unsubscribe abre una página con botón (⛔ no cambia estado); el POST actúa.
 */
@Controller('card-show')
export class CardShowController {
  constructor(
    private readonly service: CardShowService,
    private readonly throttle: CardShowThrottleService,
    private readonly webhook: CardShowWebhookService,
    private readonly tokens: CardShowTokensService,
  ) {}

  // ── GET /form-token ─────────────────────────────────────────────────────────────────────────
  @Public()
  @Get('form-token')
  async formToken(
    @Query('purpose') purposeRaw: string | undefined,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ formToken: string } | undefined> {
    const purpose: FormPurpose = (FORM_PURPOSES as readonly string[]).includes(purposeRaw ?? '')
      ? (purposeRaw as FormPurpose)
      : 'leads';
    const ipKey = ipThrottleKey(req.ip);
    const d = await this.throttle.hitFormToken(ipKey);
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    // ⛔ sin Set-Cookie, no-store, ⛔ no reflejar Origin ajeno (el CORS global ya no refleja comodín).
    res.setHeader('Cache-Control', 'no-store');
    return { formToken: this.tokens.issueFormToken(purpose) };
  }

  // ── POST /leads ─────────────────────────────────────────────────────────────────────────────
  @Public()
  @UseGuards(CardShowBodySizeGuard)
  @HttpCode(NEUTRAL_STATUS)
  @Post('leads')
  async createLead(
    @Body(new StrictBodyPipe(CreateLeadDto)) dto: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<typeof NEUTRAL_BODY | undefined> {
    const ipKey = ipThrottleKey(req.ip);
    const d = await this.throttle.hitPost('leads', ipKey);
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    await this.service.createLead(dto as unknown as CreateLeadDto);
    return NEUTRAL_BODY;
  }

  // ── POST /players ───────────────────────────────────────────────────────────────────────────
  @Public()
  @UseGuards(CardShowBodySizeGuard)
  @HttpCode(NEUTRAL_STATUS)
  @Post('players')
  async createPlayer(
    @Body(new StrictBodyPipe(CreatePlayerDto)) dto: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<typeof NEUTRAL_BODY | undefined> {
    const ipKey = ipThrottleKey(req.ip);
    const d = await this.throttle.hitPost('players', ipKey);
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    await this.service.createPlayer(dto as unknown as CreatePlayerDto);
    return NEUTRAL_BODY;
  }

  // ── GET confirm/cancel/unsubscribe: ⛔ NO cambia estado, abre página con botón (C4) ───────────
  @Public()
  @Get('confirm')
  confirmPage(@Query('token') token: string, @Res() res: Response): void {
    this.actionPage(res, 'confirm', token, 'Confirmar mi registro');
  }

  @Public()
  @Get('cancel')
  cancelPage(@Query('token') token: string, @Res() res: Response): void {
    this.actionPage(res, 'cancel', token, 'Cancelar mi preinscripción');
  }

  @Public()
  @Get('unsubscribe')
  unsubscribePage(@Query('token') token: string, @Res() res: Response): void {
    this.actionPage(res, 'unsubscribe', token, 'No fui yo / Darme de baja');
  }

  // ── POST confirm/cancel/unsubscribe: ejecuta el cambio (un solo uso) ──────────────────────────
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('confirm')
  async confirm(
    @Body(new StrictBodyPipe(LinkActionDto)) dto: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<unknown> {
    const d = await this.throttle.hitConfirm(ipThrottleKey(req.ip));
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    const result: ConfirmResult = await this.service.confirm((dto as unknown as LinkActionDto).token);
    if (result.outcome === 'occupied') {
      return { ok: false, message: 'Este Player ID ya está preinscrito ese día' };
    }
    return { ok: true, state: result.state };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('cancel')
  async cancel(
    @Body(new StrictBodyPipe(LinkActionDto)) dto: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true } | undefined> {
    const d = await this.throttle.hitConfirm(ipThrottleKey(req.ip));
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    await this.service.cancel((dto as unknown as LinkActionDto).token);
    return { ok: true };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('unsubscribe')
  async unsubscribe(
    @Body(new StrictBodyPipe(LinkActionDto)) dto: Record<string, unknown>,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ ok: true } | undefined> {
    const d = await this.throttle.hitConfirm(ipThrottleKey(req.ip));
    if (!d.allowed) return this.deny(res, d.retryAfterSeconds);
    await this.service.unsubscribe((dto as unknown as LinkActionDto).token);
    return { ok: true };
  }

  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('unsubscribe-oneclick')
  async unsubscribeOneClick(@Body(new StrictBodyPipe(LinkActionDto)) dto: Record<string, unknown>): Promise<{ ok: true }> {
    await this.service.unsubscribeOneClick((dto as unknown as LinkActionDto).token);
    return { ok: true };
  }

  // ── Webhook de Resend (C6) ────────────────────────────────────────────────────────────────────
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('webhooks/resend')
  async resendWebhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers('svix-id') svixId: string,
    @Headers('svix-timestamp') svixTs: string,
    @Headers('svix-signature') svixSig: string,
  ): Promise<{ ok: true }> {
    const raw = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body ?? {});
    const ok = this.webhook.verifySignature(raw, { id: svixId, timestamp: svixTs, signature: svixSig });
    if (!ok) throw BusinessException.badRequest('VALIDATION_ERROR', 'invalid webhook signature');
    const type = typeof (req.body as { type?: unknown })?.type === 'string' ? (req.body as { type: string }).type : '';
    await this.service.handleWebhook(type);
    return { ok: true };
  }

  // ── Contador de clics (§CARDSHOW.13) ──────────────────────────────────────────────────────────
  @Public()
  @Get('ir/:destino')
  async redirect(@Param('destino') destino: string, @Query('mesa') mesa: string | undefined, @Res() res: Response): Promise<void> {
    const mesaN = mesa ? parseInt(mesa, 10) : undefined;
    await this.service.recordClick(destino, Number.isFinite(mesaN) ? mesaN : undefined);
    // ⛔ sin cookie. Redirección a un ancla de la propia landing (⛔ no open-redirect a un destino arbitrario).
    res.status(HttpStatus.FOUND).redirect(`/card-show#${encodeURIComponent(destino)}`);
  }

  @Public()
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('click')
  async click(@Body(new StrictBodyPipe(ClickDto)) dto: Record<string, unknown>): Promise<void> {
    const c = dto as unknown as ClickDto;
    await this.service.recordClick(c.destino, c.mesa, c.utmSource, c.utmContent);
  }

  // ── helpers ───────────────────────────────────────────────────────────────────────────────────

  /** 429 con `Retry-After` entero ≥ 1 (la petición rechazada ⛔ no crea fila ni manda correo). */
  private deny(res: Response, retryAfterSeconds: number): undefined {
    res.setHeader('Retry-After', String(Math.max(1, retryAfterSeconds)));
    throw new BusinessException('RATE_LIMITED', HttpStatus.TOO_MANY_REQUESTS, 'rate limited', { retryAfterSeconds });
  }

  /** Página mínima con un BOTÓN que hace el POST (C4): un escáner que hace GET no cambia nada. */
  private actionPage(res: Response, action: 'confirm' | 'cancel' | 'unsubscribe', token: string, label: string): void {
    const safeToken = String(token ?? '').replace(/[^A-Za-z0-9._-]/g, '');
    const html =
      `<!doctype html><html lang="es-MX"><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1"><title>TCG HUNT</title></head>` +
      `<body><main style="font-family:system-ui;max-width:28rem;margin:4rem auto;padding:1rem">` +
      `<h1>TCG HUNT</h1><p>Pulsa el botón para continuar.</p>` +
      `<form method="post" action="/api/v1/card-show/${action}">` +
      `<input type="hidden" name="token" value="${safeToken}">` +
      `<button type="submit">${label}</button></form></main></body></html>`;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.status(HttpStatus.OK).send(html);
  }
}
