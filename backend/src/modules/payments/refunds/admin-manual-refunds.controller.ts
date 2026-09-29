/**
 * §M4-SHIP.15.13 (+ .17.3, .17.8) — la cubeta «Reembolsos manuales (SPEI)». TODOS los verbos `@Roles(super_admin)` +
 * `@MoneyOut()` (el operador ⇒ `403 MONEY_OUT_FORBIDDEN`, auditado): el operador no toca esta cubeta de ninguna forma
 * (ni lectura: es dinero y PII bancaria). `reveal-clabe` ⇒ `Cache-Control: no-store`.
 */
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../../common/decorators/roles.decorator';
import { MoneyOut } from '../../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ManualRefundService } from './manual-refund.service';
import { ManualRefundNoteDto, ManualRefundPaidDto } from './dto/manual-refunds.dto';

@Controller('admin/manual-refunds')
// `@Roles(operador+)` + `@MoneyOut()` a nivel de clase: el que decide (y AUDITA el intento del operador) es `MoneyOutGuard`,
// como en M3. ⛔ Sin `@Roles(super_admin)` aquí: el guard de roles contestaría `FORBIDDEN` sin bitácora.
@Roles(Role.vault_operator, Role.super_admin)
@MoneyOut()
export class AdminManualRefundsController {
  constructor(private readonly manual: ManualRefundService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@Query('status') status?: string, @Query('q') q?: string, @Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.manual.list({ status, q, page, pageSize });
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  get(@Param('id') id: string) {
    return this.manual.get(id);
  }

  /** 🔒 La CLABE en claro + `revealToken` (§M4-SHIP.17.3 (3)). UNA bitácora por llamada. */
  @Get(':id/reveal-clabe')
  @Header('Cache-Control', 'no-store')
  revealClabe(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.manual.revealClabe(id, user);
  }

  /** 💰 Marcar pagada — exige el `revealToken` del reveal (§M4-SHIP.17.3 (4)). */
  @Post(':id/paid')
  @HttpCode(200)
  paid(@Param('id') id: string, @Body() body: ManualRefundPaidDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.manual.paid(id, body, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@Param('id') id: string, @Body() body: ManualRefundNoteDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.manual.cancel(id, body, user);
  }

  /** 💰 Re-emitir una cancelada (§M4-SHIP.17.8). */
  @Post(':id/reissue')
  @HttpCode(200)
  reissue(@Param('id') id: string, @Body() body: ManualRefundNoteDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.manual.reissue(id, body, user);
  }
}
