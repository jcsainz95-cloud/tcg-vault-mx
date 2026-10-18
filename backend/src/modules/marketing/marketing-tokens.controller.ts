/**
 * marketing-tokens.controller.ts — acceso del analista (API_CONTRACT §MKT.G.6; D-MKT-PANEL-3; cierra MKT-TL4).
 *
 *   GET  /admin/marketing/tokens              → 200 { items: MarketingApiTokenView[] }
 *   POST /admin/marketing/tokens              → 201 MarketingApiTokenIssued (el claro, UNA vez; no-store)
 *   POST /admin/marketing/tokens/:id/revoke   → 200 MarketingApiTokenView (idempotente; 404 si no existe)
 *
 * 🔒 `@Roles(super_admin)` (el `RolesGuard` de siempre), ⛔ NO `marketing:read`: leer el panel y crear una credencial
 * de 12 meses para leerlo desde fuera no son el mismo poder. ⛔ No `@Public()`: el token `marketing-reader` no es
 * JWT ⇒ 401 aquí (D-MKT-AUTZ). Estas rutas escriben `AuditLog`, no `MarketingAccessLog` (no leen datos del panel).
 */
import { Allow } from 'class-validator';
import { Body, Controller, Get, Header, HttpCode, Ip, Param, Post } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import {
  MarketingTokenAdminService,
  type MarketingApiTokenIssued,
  type MarketingApiTokenView,
} from './marketing-token-admin.service';

/** Body del POST. La FORMA la valida el servicio (⇒ 422 con `details.field`, no el 400 del pipe global). */
export class IssueMarketingTokenDto {
  @Allow()
  label?: unknown;
}

@Controller('admin/marketing/tokens')
@Roles(Role.super_admin)
export class MarketingTokensController {
  constructor(private readonly tokens: MarketingTokenAdminService) {}

  @Get()
  async list(): Promise<{ items: MarketingApiTokenView[] }> {
    return { items: await this.tokens.list() };
  }

  @Post()
  @HttpCode(201)
  @Header('Cache-Control', 'no-store')
  issue(
    @CurrentUser() user: { id: string; role?: Role },
    @Body() body: IssueMarketingTokenDto,
    @Ip() ip: string,
  ): Promise<MarketingApiTokenIssued> {
    return this.tokens.issue(body?.label, user, ip);
  }

  @Post(':id/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: { id: string; role?: Role }, @Param('id') id: string, @Ip() ip: string): Promise<MarketingApiTokenView> {
    return this.tokens.revoke(id, user, ip);
  }
}
