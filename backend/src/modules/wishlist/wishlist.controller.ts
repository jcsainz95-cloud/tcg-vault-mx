/**
 * wishlist.controller.ts — rev v1.87⟨wishlist⟩ (API_CONTRACT §WSH.4 / §WSH.6 / §WSH.8).
 *
 * - `WishlistController` (`/wishlist`): sesión obligatoria; cualquier rol con correo (como `checkout`, Q-WSH-UX-6). Dial
 *   `wishlist_enabled = off` ⇒ `404 FEATURE_DISABLED` en las SEIS rutas. Cuerpos ESTRICTOS por parámetro (D-WSH-6).
 * - `WishlistMailActionsController` (`/wishlist/mail-actions`): `@Public`, 10/min por IP, ⛔ NO depende del dial (Q-WSH-UX-5).
 *   Va en su propio controlador porque el `@Roles` de clase de arriba exigiría sesión (RolesGuard ⇒ 401).
 * - `WishlistDemandController` (`/admin/reports/wishlist-demand`): `super_admin` (operador y cliente ⇒ 403, 818/826).
 */
import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { WishlistService } from './wishlist.service';
import { WishlistDemandService } from './wishlist-demand.service';
import {
  CreateWishlistItemDto,
  StrictBodyPipe,
  UpdateWishlistItemDto,
  WishlistAlertsDto,
  WishlistMailActionDto,
} from './dto/wishlist.dto';

@Controller('wishlist')
@Roles(Role.customer, Role.vault_operator, Role.super_admin)
export class WishlistController {
  constructor(private readonly wishlist: WishlistService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUser() user: AuthUser) {
    return this.wishlist.list(user);
  }

  @Get('preview')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @Header('Cache-Control', 'no-store')
  preview(@CurrentUser() user: AuthUser, @Query('cardId') cardId?: string) {
    return this.wishlist.preview(user, cardId);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body(new StrictBodyPipe(CreateWishlistItemDto)) dto: Record<string, unknown>) {
    return this.wishlist.create(user, dto as unknown as CreateWishlistItemDto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body(new StrictBodyPipe(UpdateWishlistItemDto)) dto: Record<string, unknown>,
  ) {
    return this.wishlist.update(user, id, (dto as unknown as UpdateWishlistItemDto).maxPct);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: AuthUser, @Param('id') id: string): Promise<void> {
    await this.wishlist.remove(user, id);
  }

  @Put('alerts')
  alerts(@CurrentUser() user: AuthUser, @Body(new StrictBodyPipe(WishlistAlertsDto)) dto: Record<string, unknown>) {
    return this.wishlist.setAlerts(user, (dto as unknown as WishlistAlertsDto).paused);
  }
}

@Controller('wishlist/mail-actions')
export class WishlistMailActionsController {
  constructor(private readonly wishlist: WishlistService) {}

  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  act(@Body(new StrictBodyPipe(WishlistMailActionDto)) dto: Record<string, unknown>) {
    return this.wishlist.mailAction(dto as unknown as WishlistMailActionDto);
  }
}

@Controller('admin/reports')
@Roles(Role.super_admin)
export class WishlistDemandController {
  constructor(private readonly demand: WishlistDemandService) {}

  @Get('wishlist-demand')
  @Header('Cache-Control', 'no-store')
  report(@Query('sort') sort?: string, @Query('dir') dir?: string) {
    return this.demand.report({ sort, dir }, new Date());
  }

  @Get('wishlist-demand/export.csv')
  @Header('Cache-Control', 'no-store')
  async exportCsv(@Res() res: Response, @Query('sort') sort?: string, @Query('dir') dir?: string) {
    const csv = await this.demand.csv({ sort, dir }, new Date());
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${csv.filename}"`);
    res.send(csv.body);
  }
}
