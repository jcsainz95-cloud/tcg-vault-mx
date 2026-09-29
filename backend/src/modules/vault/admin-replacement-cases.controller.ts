/**
 * §M4-SHIP.15 — el apartado «Por reponer»: lecturas y `replace` para operador+; `refund-preview` solo `super_admin`;
 * `refund` y `void` con `@MoneyOut()` (= solo `super_admin`, y el operador recibe `403 MONEY_OUT_FORBIDDEN` AUDITADO
 * por `MoneyOutGuard`, como M3 — D-8: el operador abre casos y repone, ⛔ no reembolsa desde el apartado). Lecturas
 * con `Cache-Control: no-store` (la cola se sondea cada 60 s).
 */
import { Body, Controller, Get, Header, HttpCode, Param, Post, Query } from '@nestjs/common';
import { Role } from '@prisma/client';
import { Roles } from '../../common/decorators/roles.decorator';
import { MoneyOut } from '../../common/decorators/money-out.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ReplacementCaseService } from './replacement-case.service';
import { CaseRefundDto, ReplaceCaseDto, VoidCaseDto } from './dto/replacement-cases.dto';

@Controller('admin/replacement-cases')
@Roles(Role.vault_operator, Role.super_admin)
export class AdminReplacementCasesController {
  constructor(private readonly cases: ReplacementCaseService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(
    @CurrentUser() user: { id: string; role: Role },
    @Query('state') state?: string,
    @Query('source') source?: string,
    @Query('overdue') overdue?: string,
    @Query('q') q?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.cases.list({ state, source, overdue, q, page, pageSize }, user.role);
  }

  @Get(':id')
  @Header('Cache-Control', 'no-store')
  detail(@Param('id') id: string, @CurrentUser() user: { id: string; role: Role }) {
    return this.cases.detail(id, user.role);
  }

  /** 💰 Previsualización del reparto (súper-admin; lectura, sin candados, sin bitácora). */
  @Get(':id/refund-preview')
  @Roles(Role.super_admin)
  @Header('Cache-Control', 'no-store')
  refundPreview(@Param('id') id: string, @Query('amountCents') amountCents?: string) {
    return this.cases.refundPreview(id, amountCents);
  }

  /** Reponer (otra pieza de identidad idéntica) o «apareció» (la misma pieza). Operador+. ⛔ Cero dinero. */
  @Post(':id/replace')
  @HttpCode(200)
  replace(@Param('id') id: string, @Body() body: ReplaceCaseDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.cases.replace(id, body, user);
  }

  /** 💰 Reembolsar sin reposición por el monto capturado (solo súper-admin). */
  @Post(':id/refund')
  @HttpCode(200)
  @MoneyOut()
  refund(@Param('id') id: string, @Body() body: CaseRefundDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.cases.refund(id, body, user);
  }

  /** 💰 Anular (solo si la orden de origen ya no está liquidada o no existe). Puede emitir `shipment_fee`. */
  @Post(':id/void')
  @HttpCode(200)
  @MoneyOut()
  void(@Param('id') id: string, @Body() body: VoidCaseDto, @CurrentUser() user: { id: string; role: Role }) {
    return this.cases.void(id, body, user);
  }
}
